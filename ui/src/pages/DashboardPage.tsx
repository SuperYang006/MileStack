import React, { useEffect, useMemo, useRef, useState } from "react";
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
import {
  projectStatusQueryOptions,
  projectStatusQueryKey,
  refreshProjectStatusAfterDeletion,
} from "./projectStatusQuery";
import type {
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
  const [lastProject, setLastProject] = useState<ProjectSummary>({ id: "", name: "", goal: null });
  const [isDisconnectNoticeDismissed, setIsDisconnectNoticeDismissed] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

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
  });

  const releaseTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.releaseTask(taskId),
    onSuccess: invalidateProjectQueries,
  });

  const approveTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.approveTask(taskId),
    onSuccess: (_, taskId) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
    },
    onError: (_, taskId) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", taskId] });
    },
  });

  const checkIntegrationMutation = useMutation({
    mutationFn: ({ taskId, reviewId }: { taskId: string; reviewId: string }) =>
      apiClient.checkTaskIntegration(taskId, reviewId),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
    },
    onError: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
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
    onError: (error: Error) => {
      alert(`退回返工失败：${error.message}`);
    },
  });

  const reopenTaskMutation = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      apiClient.reopenCompletedTask(taskId, reason),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
    },
  });
  // An offline dashboard is still a dashboard: it keeps the frame and the last
  // known project name, but never the last task snapshot.
  const visibleStatus =
    !isServiceDisconnected && status ? status : createEmptyProjectStatus(lastProject);

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
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 font-mono text-zinc-500 text-xs">
        正在连接 MileStack 数据总线...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 pb-16 lg:pb-0 selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Header */}
      <Header
        project={visibleStatus.project}
        isBackendConnected={!isServiceDisconnected}
        runtimeVersion={isServiceDisconnected ? null : runtimeHealth?.version ?? null}
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
        onOpenArchive={() => setIsArchiveOpen(true)}
        completedCount={visibleStatus.counts.completed}
        isRefreshing={isRefetching}
      />

      {/* Offline Notice: stays after the dialog is closed so the empty queues below
          are never read as an empty project. */}
      {isServiceDisconnected && (
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-4">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 font-mono text-[11px] text-rose-200">
            <WifiOff className="w-3.5 h-3.5 shrink-0 text-rose-400" />
            <span>服务离线，当前不显示任务数据。请确认 milestack serve 仍在运行后重试。</span>
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 w-full space-y-6 lg:flex lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:flex-col lg:space-y-3 lg:overflow-hidden">
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
        />

        {/* Four active queue regions: symmetric 2x2 grid on wide screens; natural stack on mobile. */}
        <div className="grid grid-cols-1 gap-6 lg:flex-1 lg:min-h-0 lg:grid-cols-2 lg:grid-rows-2 lg:items-stretch lg:gap-3">
          {/* Top-left: 已就绪 */}
          <div className="lg:h-full lg:min-h-0">
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

          {/* Top-right: 正在进行 */}
          <div className="lg:h-full lg:min-h-0">
            <CurrentTasks
              tasks={visibleStatus.current}
              allTasks={allTasks}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onReleaseTask={(id) => releaseTaskMutation.mutate(id)}
              isServiceOffline={isServiceDisconnected}
            />
          </div>

          {/* Bottom-left: 待审核 */}
          <div className="lg:h-full lg:min-h-0">
            <ReviewTasks
              tasks={visibleStatus.inReview}
              onApprove={(id) => approveTaskMutation.mutate(id)}
              onCheckIntegration={(taskId, reviewId) =>
                checkIntegrationMutation.mutate({ taskId, reviewId })
              }
              checkingTaskId={
                checkIntegrationMutation.isPending
                  ? checkIntegrationMutation.variables?.taskId ?? null
                  : null
              }
              onWaiveApproval={(taskId, reason) =>
                waiveTaskApprovalMutation.mutate({ taskId, reason })
              }
              onRequestChanges={(taskId, feedback, findingClosures) =>
                requestChangesMutation.mutate({ taskId, feedback, findingClosures })
              }
              onSelectTask={(id) => setSelectedTaskId(id)}
            />
          </div>

          {/* Bottom-right: 草稿箱 */}
          <div className="lg:h-full lg:min-h-0">
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
      </main>

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
          integrationPolicyMutation.mutate({ taskId, ...policy })
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
        availableTasks={[
          ...visibleStatus.current,
          ...visibleStatus.next,
          ...visibleStatus.blocked,
          ...visibleStatus.inbox,
        ]}
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
    </div>
  );
};
