import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Header } from "../components/Header";
import { CurrentTasks } from "../components/CurrentTasks";
import { NextTasks } from "../components/NextTasks";
import { BlockedTasks } from "../components/BlockedTasks";
import { InboxTasks } from "../components/InboxTasks";
import { RecentTasks } from "../components/RecentTasks";
import { ReviewTasks } from "../components/ReviewTasks";
import { ExecutionFlowView } from "../components/ExecutionFlowView";
import { buildTaskIndex } from "../utils/dependencyGraph";
import { TaskDetailModal } from "../components/TaskDetailModal";
import { CreateTaskModal } from "../components/CreateTaskModal";
import { BriefingModal } from "../components/BriefingModal";
import { EditInboxModal } from "../components/EditInboxModal";
import { DeleteTaskConfirmModal } from "../components/DeleteTaskConfirmModal";
import { ServiceDisconnectedModal } from "../components/ServiceDisconnectedModal";
import { PageCommentsModal } from "../components/PageCommentsModal";
import {
  BatchIntegrationNotice,
  OperationErrorNotice,
  type BatchIntegrationSummary,
  type OperationError,
} from "../components/OperationErrorNotice";
import { summarizeBatchIntegrationResult } from "../utils/reviewRecords";
import {
  projectStatusQueryOptions,
  projectStatusQueryKey,
  refreshProjectStatusAfterDeletion,
} from "./projectStatusQuery";
import type {
  BatchIntegrationCheckItemInput,
  ProjectStatus,
  ProjectSummary,
  TaskSummary,
  CreateTaskPayload,
  EditInboxTaskPayload,
  FindingClosureInput,
  TaskDetails,
  RiskLevel,
} from "../types";

const POLL_INTERVAL_MS = 15_000;

/** The dashboard never invents tasks. While the service is unreachable the same
 *  page renders with empty queues so the disconnection cannot be mistaken for an
 *  empty project. */
function createEmptyProjectStatus(project: ProjectSummary): ProjectStatus {
  return {
    project,
    latestUpdatedAt: null,
    counts: {
      inbox: 0,
      ready: 0,
      running: 0,
      blocked: 0,
      inReview: 0,
      completed: 0,
      total: 0,
    },
    current: [],
    next: [],
    blocked: [],
    inReview: [],
    inbox: [],
    recentlyCompleted: [],
  };
}

/** Wide screens keep the dashboard in one viewport: inside each queue column,
 *  populated queues take their content height and only compress — then scroll
 *  internally — when the column together overflows, while empty queues hold a
 *  single status row. A populated queue never shrinks below its title row plus
 *  first card (a measured floor, see measureQueueSlotHeights) while the column
 *  can afford every floor. When the floors together would overflow the column,
 *  every queue first keeps its title row and a usable list viewport, then the
 *  remaining column height is shared in proportion to how much more each first
 *  card still needs (see applySlotHeights), so a very tall first card shrinks
 *  its own queue instead of leaving its neighbour with a title and no operable
 *  content. Leftover space stays below the column, never inside a panel. */
function queueSlotClass(taskCount: number): string {
  return taskCount > 0 ? "lg:min-h-0" : "lg:shrink-0";
}

type QueueSlotKey = "next" | "inReview" | "current" | "inbox";

/** Card content a populated queue keeps visible when the column cannot afford
 *  every full first card: enough for the first card's title and action row. */
const MIN_LIST_VIEWPORT = 64;

interface QueueSlotHeights {
  /** Panel height that shows the title row and the whole first card. */
  firstCard: number;
  /** Panel height that keeps the title row plus MIN_LIST_VIEWPORT of card. */
  minimum: number;
}

/** Heights a populated panel needs, measured from the rendered panel: real
 *  font metrics and card content set the floor, not hardcoded pixels. The
 *  scrollable list is the section's second child and the first card carries
 *  data-queue-card. Returns null when the slot does not hold the populated
 *  section layout. */
function measureQueueSlotHeights(slot: HTMLElement): QueueSlotHeights | null {
  const section = slot.firstElementChild;
  if (!(section instanceof HTMLElement)) return null;
  const header = section.children[0];
  const list = section.children[1];
  if (!(header instanceof HTMLElement) || !(list instanceof HTMLElement)) return null;
  const firstCard = list.querySelector<HTMLElement>("[data-queue-card]");
  if (!firstCard) return null;
  const listStyle = window.getComputedStyle(list);
  const sectionStyle = window.getComputedStyle(section);
  // Undo any list scrolling so the floor describes the unscrolled position of
  // the first card's bottom edge, plus the list padding and panel border below
  // it.
  const firstCardBottom =
    firstCard.getBoundingClientRect().bottom +
    list.scrollTop -
    section.getBoundingClientRect().top;
  const firstCardFloor =
    firstCardBottom +
    parseFloat(listStyle.paddingBottom) +
    parseFloat(sectionStyle.borderBottomWidth);
  const chrome =
    parseFloat(sectionStyle.borderTopWidth) +
    header.offsetHeight +
    parseFloat(listStyle.paddingTop) +
    parseFloat(listStyle.paddingBottom) +
    parseFloat(sectionStyle.borderBottomWidth);
  const minimum = Math.min(firstCardFloor, chrome + MIN_LIST_VIEWPORT);
  if (!Number.isFinite(firstCardFloor) || firstCardFloor <= 0) return null;
  if (!Number.isFinite(minimum) || minimum <= 0) return null;
  return { firstCard: firstCardFloor, minimum };
}

/** Space a column can spend on its populated queues' heights: the column's own
 *  height minus the inter-slot gaps and any empty status rows sharing it. The
 *  column's height does not depend on the floors (its wrapper can shrink), so
 *  the budget is stable across applications. Returns null when the column
 *  generates no box — below lg it is display:contents, where an inline
 *  min-height is inert and budgeting would read meaningless zeros. */
function measureColumnSlotBudget(
  column: HTMLElement,
  slots: ReadonlyArray<{ slot: HTMLElement; populated: boolean }>,
): number | null {
  const columnStyle = window.getComputedStyle(column);
  if (columnStyle.display === "contents") return null;
  const columnHeight = column.clientHeight;
  if (columnHeight <= 0) return null;
  const gap = Number.parseFloat(columnStyle.rowGap) || 0;
  const emptyHeight = slots
    .filter((entry) => !entry.populated)
    .reduce((sum, entry) => sum + entry.slot.offsetHeight, 0);
  const budget =
    columnHeight - gap * Math.max(0, slots.length - 1) - emptyHeight;
  return Number.isFinite(budget) ? budget : null;
}

function useDocumentVisible(): boolean {
  const [isVisible, setIsVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return isVisible;
}

export const DashboardPage: React.FC = () => {
  const queryClient = useQueryClient();
  const isDocumentVisible = useDocumentVisible();
  const forceFullStatusRef = useRef(false);

  // State
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [briefingTask, setBriefingTask] = useState<TaskSummary | null>(null);
  const [editingInboxTask, setEditingInboxTask] = useState<TaskSummary | TaskDetails | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<{
    taskId: string;
    taskTitle: string;
    source: "inbox" | "ready";
  } | null>(null);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isPageCommentsOpen, setIsPageCommentsOpen] = useState(false);
  const [lastProject, setLastProject] = useState<ProjectSummary>({ id: "", name: "", goal: null });
  const [isDisconnectNoticeDismissed, setIsDisconnectNoticeDismissed] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [operationError, setOperationError] = useState<OperationError | null>(null);
  const [batchIntegrationNotice, setBatchIntegrationNotice] =
    useState<BatchIntegrationSummary | null>(null);

  // Every failed action reports the operation that failed and the service's own
  // reason. Successful actions stay silent: the changed queue is the feedback.
  const reportOperationFailure = useCallback(
    (operation: string) => (error: Error) => {
      setBatchIntegrationNotice(null);
      setOperationError((previous) => ({
        id: (previous?.id ?? 0) + 1,
        operation,
        message: error.message || "未知错误",
      }));
    },
    [],
  );
  const dismissOperationError = useCallback(() => setOperationError(null), []);
  const dismissBatchIntegrationNotice = useCallback(
    () => setBatchIntegrationNotice(null),
    [],
  );

  // Queries. A failed call is never retried into a fake result: it marks the
  // service offline right away, and the notice waits for a real recovery.
  const {
    data: status,
    isLoading: isStatusLoading,
    isError: isStatusError,
    isRefetching,
    refetch,
  } = useQuery({
    ...projectStatusQueryOptions(queryClient, forceFullStatusRef),
    enabled: isDocumentVisible,
    retry: false,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const { data: runtimeHealth, isFetched: isHealthFetched } = useQuery({
    queryKey: ["backendHealth"],
    queryFn: () => apiClient.getRuntimeHealth(),
    enabled: isDocumentVisible,
    retry: false,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const isServiceDisconnected = isStatusError || (isHealthFetched && runtimeHealth === null);

  useEffect(() => {
    if (status?.project.name) {
      setLastProject(status.project);
      document.title = status.project.name;
    }
  }, [status?.project.name]);

  // One notice per disconnection: closing it keeps the offline state, and only a
  // real recovery rearms it for the next one.
  useEffect(() => {
    if (!isServiceDisconnected) {
      setIsDisconnectNoticeDismissed(false);
    }
  }, [isServiceDisconnected]);

  // A disconnection closes every surface that holds or writes task data, so no
  // stale snapshot or local edit can survive into the offline state.
  useEffect(() => {
    if (!isServiceDisconnected) return;
    setSelectedTaskId(null);
    setBriefingTask(null);
    setIsCreateModalOpen(false);
    setEditingInboxTask(null);
    setIsArchiveOpen(false);
  }, [isServiceDisconnected]);

  const completedTasksQuery = useInfiniteQuery({
    queryKey: ["completedTasks"],
    queryFn: ({ pageParam }) =>
      apiClient.listTasks("completed", 100, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: isArchiveOpen && isDocumentVisible,
  });

  const completedTasks = useMemo(() => {
    if (isServiceDisconnected) return [];
    const loaded = completedTasksQuery.data?.pages.flatMap((page) => page.tasks) ?? [];
    return Array.from(new Map(loaded.map((task) => [task.id, task])).values());
  }, [completedTasksQuery.data, isServiceDisconnected]);

  const invalidateProjectQueries = () => {
    void queryClient.invalidateQueries({ queryKey: projectStatusQueryKey });
    void queryClient.invalidateQueries({ queryKey: ["completedTasks"] });
  };

  const refreshProjectQueriesAfterDeletion = async () => {
    const statusRefresh = refreshProjectStatusAfterDeletion(queryClient, forceFullStatusRef);
    void queryClient.invalidateQueries({ queryKey: ["completedTasks"] });
    await statusRefresh;
  };

  const { data: selectedDetails, isLoading: isDetailsLoading, isError: isDetailsError } = useQuery({
    queryKey: ["taskDetails", selectedTaskId],
    queryFn: () => (selectedTaskId ? apiClient.getTaskDetails(selectedTaskId) : null),
    enabled: isDocumentVisible && !!selectedTaskId,
    retry: false,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // Mutations
  const createTaskMutation = useMutation({
    mutationFn: (payload: CreateTaskPayload) => apiClient.createTask(payload),
    onSuccess: invalidateProjectQueries,
  });

  const createTasksBatchMutation = useMutation({
    mutationFn: (payloads: CreateTaskPayload[]) => apiClient.createTasks(payloads),
    onSuccess: invalidateProjectQueries,
  });
  const confirmInboxMutation = useMutation({
    mutationFn: ({ taskId, riskLevel }: { taskId: string; riskLevel?: RiskLevel }) =>
      apiClient.confirmInboxTask(taskId, riskLevel),
    onSuccess: invalidateProjectQueries,
    onError: reportOperationFailure("确认入队"),
  });

  const editInboxTaskMutation = useMutation({
    mutationFn: ({ taskId, payload }: { taskId: string; payload: EditInboxTaskPayload }) =>
      apiClient.editInboxTask(taskId, payload),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
    },
  });


  const deleteInboxMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.deleteInboxTask(taskId),
    onSuccess: async (_, taskId) => {
      await refreshProjectQueriesAfterDeletion();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
      if (selectedTaskId === taskId) setSelectedTaskId(null);
    },
  });

  const returnReadyMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.returnReadyTaskToInbox(taskId),
    onSuccess: (_, taskId) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
    },
  });

  const deleteReadyMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.deleteReadyTask(taskId),
    onSuccess: async (_, taskId) => {
      await refreshProjectQueriesAfterDeletion();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
      if (selectedTaskId === taskId) setSelectedTaskId(null);
    },
  });

  const reorderTaskMutation = useMutation({
    mutationFn: ({ taskId, direction }: { taskId: string; direction: "up" | "down" }) =>
      apiClient.reorderReadyTask(taskId, direction),
    onSuccess: invalidateProjectQueries,
    onError: reportOperationFailure("调整顺序"),
  });

  const releaseTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.releaseTask(taskId),
    onSuccess: invalidateProjectQueries,
    onError: reportOperationFailure("释放"),
  });

  const approveTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.approveTask(taskId),
    onSuccess: (_, taskId) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
    },
    onError: (error, taskId) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
      reportOperationFailure("批准")(error);
    },
  });

  const checkIntegrationMutation = useMutation({
    mutationFn: ({ taskId, reviewId }: { taskId: string; reviewId: string }) =>
      apiClient.checkTaskIntegration(taskId, reviewId),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
    },
    onError: (error, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
      reportOperationFailure("检查并归档")(error);
    },
  });

  const checkBatchIntegrationMutation = useMutation({
    mutationFn: (items: BatchIntegrationCheckItemInput[]) =>
      apiClient.checkTasksIntegration(items),
    onMutate: () => {
      setOperationError(null);
      setBatchIntegrationNotice(null);
    },
    onSuccess: (result, items) => {
      forceFullStatusRef.current = true;
      invalidateProjectQueries();
      for (const item of items) {
        queryClient.invalidateQueries({ queryKey: ["taskDetails", item.taskId] });
      }
      const summary = summarizeBatchIntegrationResult(result);
      if (summary) {
        setBatchIntegrationNotice((previous) => ({
          id: (previous?.id ?? 0) + 1,
          ...summary,
        }));
      }
    },
    onError: (error, items) => {
      forceFullStatusRef.current = true;
      invalidateProjectQueries();
      for (const item of items) {
        queryClient.invalidateQueries({ queryKey: ["taskDetails", item.taskId] });
      }
      reportOperationFailure("批量检查并归档")(error);
    },
  });

  const integrationPolicyMutation = useMutation({
    mutationFn: ({
      taskId,
      integrationRequired,
      integrationTargetBranch,
      integrationNotRequiredReason,
    }: {
      taskId: string;
      integrationRequired: boolean;
      integrationTargetBranch: string;
      integrationNotRequiredReason?: string | null;
    }) => apiClient.setTaskIntegrationPolicy(taskId, {
      integrationRequired,
      integrationTargetBranch,
      integrationNotRequiredReason,
    }),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
    },
  });

  const waiveTaskApprovalMutation = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      apiClient.waiveTaskApproval(taskId, reason),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
    },
    onError: reportOperationFailure("直接验收"),
  });

  const requestChangesMutation = useMutation({
    mutationFn: ({
      taskId,
      feedback,
      findingClosures,
    }: {
      taskId: string;
      feedback: string;
      findingClosures?: FindingClosureInput[];
    }) => apiClient.requestTaskChanges(taskId, feedback, findingClosures),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
    },
    onError: reportOperationFailure("退回返工"),
  });

  const reopenTaskMutation = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      apiClient.reopenCompletedTask(taskId, reason),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
    },
    onError: reportOperationFailure("重新打开"),
  });
  // An offline dashboard is still a dashboard: it keeps the frame and the last
  // known project name, but never the last task snapshot.
  const visibleStatus =
    !isServiceDisconnected && status ? status : createEmptyProjectStatus(lastProject);

  // Populated queue slots keep their title-plus-first-card floor as an inline
  // min-height, overriding the Tailwind lg:min-h-0 fallback so the column's
  // flex algorithm can never compress a small queue past its only visible
  // task. The heights are budgeted per column: when every full floor fits,
  // they hold as measured. When the floors together exceed the column, each
  // queue first keeps its title row and a usable list viewport, and only the
  // rest of the column is shared in proportion to how much more each first
  // card needs — so a very tall first card shrinks its own queue instead of
  // leaving its neighbour with a title and no operable content. Clearing the
  // property restores the bare slot when a queue empties; below lg the slot is
  // display:contents, where the value is inert.
  const queueSlotRefs = useRef<Record<QueueSlotKey, HTMLElement | null>>({
    next: null,
    inReview: null,
    current: null,
    inbox: null,
  });

  useLayoutEffect(() => {
    const slots: Array<[QueueSlotKey, TaskSummary[]]> = [
      ["next", visibleStatus.next],
      ["inReview", visibleStatus.inReview],
      ["current", visibleStatus.current],
      ["inbox", visibleStatus.inbox],
    ];
    const applySlotHeights = () => {
      // Heights are budgeted per flex column: measured for every slot in that
      // column first, then allocated together. While every populated queue's
      // full title-plus-first-card floor fits, the floors hold as measured.
      // When they overflow, the title row and usable list viewport of every
      // populated queue are reserved before the remaining height is shared by
      // first-card need, so the column never overflows and no queue is reduced
      // to a title above an unusable list.
      const columns = new Map<
        HTMLElement,
        Array<{ slot: HTMLElement; heights: QueueSlotHeights | null }>
      >();
      for (const [key, tasks] of slots) {
        const slot = queueSlotRefs.current[key];
        if (!slot) continue;
        const column = slot.parentElement;
        if (!(column instanceof HTMLElement)) continue;
        const group = columns.get(column) ?? [];
        group.push({
          slot,
          heights: tasks.length > 0 ? measureQueueSlotHeights(slot) : null,
        });
        columns.set(column, group);
      }
      for (const [column, group] of columns) {
        const budget = measureColumnSlotBudget(
          column,
          group.map((entry) => ({ slot: entry.slot, populated: entry.heights !== null })),
        );
        const populated = group.flatMap((entry) => (entry.heights ? [entry.heights] : []));
        const totalFirstCards = populated.reduce((sum, heights) => sum + heights.firstCard, 0);
        const totalMinimum = populated.reduce((sum, heights) => sum + heights.minimum, 0);
        const firstCardSlack = Math.max(0, totalFirstCards - totalMinimum);
        for (const { slot, heights } of group) {
          if (!heights) {
            slot.style.removeProperty("min-height");
            continue;
          }
          let target = heights.firstCard;
          if (budget !== null && budget < totalFirstCards) {
            if (budget >= totalMinimum) {
              const firstCardShare =
                firstCardSlack > 0 ? (budget - totalMinimum) / firstCardSlack : 0;
              target =
                heights.minimum +
                firstCardShare * (heights.firstCard - heights.minimum);
            } else {
              target = (Math.max(budget, 0) * heights.minimum) / totalMinimum;
            }
          }
          slot.style.minHeight = `${target}px`;
        }
      }
    };
    applySlotHeights();

    // Card text rewraps with the viewport and fonts may load late; re-measure
    // on both instead of trusting a stale floor.
    let frame: number | null = null;
    const scheduleRemeasure = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        applySlotHeights();
      });
    };
    window.addEventListener("resize", scheduleRemeasure);
    void document.fonts.ready.then(scheduleRemeasure);
    return () => {
      window.removeEventListener("resize", scheduleRemeasure);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [visibleStatus.next, visibleStatus.inReview, visibleStatus.current, visibleStatus.inbox]);

  const reconnect = async () => {
    setIsReconnecting(true);
    forceFullStatusRef.current = true;
    try {
      await Promise.all([refetch(), queryClient.refetchQueries({ queryKey: ["backendHealth"] })]);
    } finally {
      setIsReconnecting(false);
    }
  };

  const openCreateModal = () => {
    if (isServiceDisconnected) return;
    setIsCreateModalOpen(true);
  };

  const confirmPendingDeletion = async () => {
    if (!pendingDeletion) return;
    if (pendingDeletion.source === "inbox") {
      await deleteInboxMutation.mutateAsync(pendingDeletion.taskId);
    } else {
      await deleteReadyMutation.mutateAsync(pendingDeletion.taskId);
    }
  };

  const allTasks = useMemo(
    () => buildTaskIndex(visibleStatus, completedTasks),
    [visibleStatus, completedTasks],
  );

  if (isStatusLoading || (!status && !isServiceDisconnected)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-500 text-xs">
        正在连接 MileStack 数据总线...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 pb-16 lg:h-screen lg:pb-0 selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Header */}
      <Header
        project={visibleStatus.project}
        isBackendConnected={!isServiceDisconnected}
        runtimeVersion={isServiceDisconnected ? null : runtimeHealth?.version ?? null}
        runtimeUpdate={isServiceDisconnected ? null : runtimeHealth?.update ?? null}
        onRefresh={() => {
          forceFullStatusRef.current = true;
          void refetch();
          if (isArchiveOpen) {
            void completedTasksQuery.refetch();
          }
          if (selectedTaskId) {
            queryClient.invalidateQueries({ queryKey: ["taskDetails", selectedTaskId] });
          }
        }}
        onOpenCreateModal={openCreateModal}
        onOpenPageComments={() => setIsPageCommentsOpen(true)}
        onOpenArchive={() => setIsArchiveOpen(true)}
        completedCount={visibleStatus.counts.completed}
        isRefreshing={isRefetching}
      />

      {/* Offline Notice: stays after the dialog is closed so the empty queues below
          are never read as an empty project. */}
      {isServiceDisconnected && (
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-4">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-200">
            <WifiOff className="w-3.5 h-3.5 shrink-0 text-rose-400" />
            <span>
              服务离线，当前不显示任务数据。请确认{" "}
              <span className="font-mono">milestack serve</span> 仍在运行后重试。
            </span>
            <button
              type="button"
              onClick={() => void reconnect()}
              disabled={isReconnecting}
              className="ml-auto inline-flex items-center gap-1.5 rounded border border-rose-800/70 bg-rose-950/50 px-2 py-1 text-rose-100 hover:bg-rose-900/50 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isReconnecting ? "animate-spin" : ""}`} />
              {isReconnecting ? "正在重新连接..." : "重新连接"}
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 w-full space-y-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:space-y-3 lg:overflow-hidden lg:pb-3">
        {/* Blocked Section (Top priority when tasks are blocked) */}
        <BlockedTasks
          tasks={visibleStatus.blocked}
          onSelectTask={(id) => setSelectedTaskId(id)}
        />
        {/* Execution Flow View (Compact topology for branches and dependencies) */}
        <ExecutionFlowView
          status={visibleStatus}
          additionalCompletedTasks={completedTasks}
          onSelectTask={(id) => setSelectedTaskId(id)}
          onConfirmTask={(id, riskLevel) => confirmInboxMutation.mutate({ taskId: id, riskLevel })}
        />

        {/* Four active queue regions keep their 2x2 positions on wide screens:
            left column 已就绪 + 待审核, right column 正在进行 + 草稿箱. Each column
            is a flex stack — an empty queue holds a single status row and
            populated queues take their content height, never shrinking below
            their measured title-plus-first-card floor while the column can
            afford every floor. When the floors together overflow the column,
            each queue first keeps its title row and a usable list viewport,
            then shares the rest by first-card need and scrolls internally.
            Below lg the column wrappers flatten to display:contents and the
            order utilities restore the original natural stack order. */}
        <div className="flex flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-3">
          {/* Wide screens: left column. Narrow screens: display contents. */}
          <div className="contents lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-3">
            {/* Top-left: 已就绪 */}
            <div
              ref={(el) => {
                queueSlotRefs.current.next = el;
              }}
              className={`order-1 ${queueSlotClass(visibleStatus.next.length)}`}
            >
              <NextTasks
                tasks={visibleStatus.next}
                allTasks={allTasks}
                onReorder={(id, dir) => reorderTaskMutation.mutate({ taskId: id, direction: dir })}
                onReturnToInbox={(id) => returnReadyMutation.mutate(id)}
                onRequestDelete={(task) =>
                  setPendingDeletion({ taskId: task.id, taskTitle: task.title, source: "ready" })
                }
                onSelectTask={(id) => setSelectedTaskId(id)}
                onOpenBriefing={(task) => setBriefingTask(task)}
              />
            </div>

            {/* Bottom-left: 待审核 */}
            <div
              ref={(el) => {
                queueSlotRefs.current.inReview = el;
              }}
              className={`order-3 ${queueSlotClass(visibleStatus.inReview.length)}`}
            >
              <ReviewTasks
                tasks={visibleStatus.inReview}
                onApprove={(id) => approveTaskMutation.mutate(id)}
                onCheckIntegration={(taskId, reviewId) =>
                  checkIntegrationMutation.mutate({ taskId, reviewId })
                }
                onCheckBatchIntegration={(items) => {
                  if (checkBatchIntegrationMutation.isPending) return;
                  checkBatchIntegrationMutation.mutate(items);
                }}
                checkingTaskId={
                  checkIntegrationMutation.isPending
                    ? checkIntegrationMutation.variables?.taskId ?? null
                    : null
                }
                isBatchCheckingIntegration={checkBatchIntegrationMutation.isPending}
                onWaiveApproval={(taskId, reason) =>
                  waiveTaskApprovalMutation.mutate({ taskId, reason })
                }
                onRequestChanges={(taskId, feedback, findingClosures) =>
                  requestChangesMutation.mutate({ taskId, feedback, findingClosures })
                }
                onSelectTask={(id) => setSelectedTaskId(id)}
              />
            </div>
          </div>

          {/* Wide screens: right column. Narrow screens: display contents. */}
          <div className="contents lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-3">
            {/* Top-right: 正在进行 */}
            <div
              ref={(el) => {
                queueSlotRefs.current.current = el;
              }}
              className={`order-2 ${queueSlotClass(visibleStatus.current.length)}`}
            >
              <CurrentTasks
                tasks={visibleStatus.current}
                allTasks={allTasks}
                onSelectTask={(id) => setSelectedTaskId(id)}
                onReleaseTask={(id) => releaseTaskMutation.mutate(id)}
                isServiceOffline={isServiceDisconnected}
              />
            </div>

            {/* Bottom-right: 草稿箱 */}
            <div
              ref={(el) => {
                queueSlotRefs.current.inbox = el;
              }}
              className={`order-4 ${queueSlotClass(visibleStatus.inbox.length)}`}
            >
              <InboxTasks
                tasks={visibleStatus.inbox}
                allTasks={allTasks}
                onConfirmTask={(id, riskLevel) => confirmInboxMutation.mutate({ taskId: id, riskLevel })}
                onRequestDelete={(task) =>
                  setPendingDeletion({ taskId: task.id, taskTitle: task.title, source: "inbox" })
                }
                onSelectTask={(id) => setSelectedTaskId(id)}
                onEditTask={(task) => setEditingInboxTask(task)}
                onCreateTask={isServiceDisconnected ? undefined : openCreateModal}
              />
            </div>
          </div>
        </div>
      </main>

      <OperationErrorNotice error={operationError} onDismiss={dismissOperationError} />
      <BatchIntegrationNotice
        summary={batchIntegrationNotice}
        onDismiss={dismissBatchIntegrationNotice}
      />

      {/* Archive Slide-over Drawer */}
      <RecentTasks
        isOpen={isArchiveOpen}
        onClose={() => setIsArchiveOpen(false)}
        tasks={completedTasks}
        totalCount={visibleStatus.counts.completed}
        isLoading={completedTasksQuery.isLoading}
        isError={completedTasksQuery.isError}
        hasMore={completedTasksQuery.hasNextPage ?? false}
        isLoadingMore={completedTasksQuery.isFetchingNextPage}
        onLoadMore={() => {
          if (
            completedTasksQuery.hasNextPage &&
            !completedTasksQuery.isFetchingNextPage
          ) {
            void completedTasksQuery.fetchNextPage();
          }
        }}
        onSelectTask={(id) => setSelectedTaskId(id)}
        onReopenTask={(taskId, reason) => reopenTaskMutation.mutate({ taskId, reason })}
      />

      {/* Modals */}
      <TaskDetailModal
        details={selectedDetails || null}
        isOpen={!!selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        isLoading={isDetailsLoading}
        isError={isDetailsError}
        onEditInboxTask={(task) => setEditingInboxTask(task)}
        allTasks={allTasks}
        onSelectTask={(id) => setSelectedTaskId(id)}
        onApprove={(id) => approveTaskMutation.mutate(id)}
        onCheckIntegration={(taskId, reviewId) =>
          checkIntegrationMutation.mutate({ taskId, reviewId })
        }
        onSetIntegrationPolicy={(taskId, policy) =>
          integrationPolicyMutation.mutateAsync({ taskId, ...policy })
        }
        isCheckingIntegration={checkIntegrationMutation.isPending}
        isSavingIntegrationPolicy={integrationPolicyMutation.isPending}
        onWaiveApproval={(taskId, reason) =>
          waiveTaskApprovalMutation.mutate({ taskId, reason })
        }
        onRequestChanges={(taskId, feedback, findingClosures) =>
          requestChangesMutation.mutate({ taskId, feedback, findingClosures })
        }
      />
      <EditInboxModal
        task={editingInboxTask}
        isOpen={!!editingInboxTask}
        onClose={() => setEditingInboxTask(null)}
        availableTasks={Array.from(allTasks.values())}
        onSubmit={async (taskId, payload) => {
          await editInboxTaskMutation.mutateAsync({ taskId, payload });
        }}
      />
      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={async (payload) => {
          await createTaskMutation.mutateAsync(payload);
        }}
        onBatchSubmit={async (payloads) => {
          await createTasksBatchMutation.mutateAsync(payloads);
        }}
      />

      <BriefingModal
        task={briefingTask}
        project={visibleStatus.project}
        isOpen={!!briefingTask}
        onClose={() => setBriefingTask(null)}
      />

      <DeleteTaskConfirmModal
        isOpen={pendingDeletion !== null}
        taskId={pendingDeletion?.taskId ?? ""}
        taskTitle={pendingDeletion?.taskTitle ?? ""}
        taskSourceLabel={pendingDeletion?.source === "ready" ? "就绪队列" : "草稿箱"}
        onClose={() => setPendingDeletion(null)}
        onConfirm={confirmPendingDeletion}
      />

      <ServiceDisconnectedModal
        isOpen={isServiceDisconnected && !isDisconnectNoticeDismissed}
        isReconnecting={isReconnecting}
        onReconnect={reconnect}
        onClose={() => setIsDisconnectNoticeDismissed(true)}
      />

      <PageCommentsModal
        isOpen={isPageCommentsOpen}
        onClose={() => setIsPageCommentsOpen(false)}
      />
    </div>
  );
};
