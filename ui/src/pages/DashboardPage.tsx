import React, { useState, useMemo } from "react";
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
import type { TaskSummary, CreateTaskPayload, EditInboxTaskPayload, TaskDetails, RiskLevel } from "../types";

export const DashboardPage: React.FC = () => {
  const queryClient = useQueryClient();

  // State
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [briefingTask, setBriefingTask] = useState<TaskSummary | null>(null);
  const [editingInboxTask, setEditingInboxTask] = useState<TaskSummary | TaskDetails | null>(null);
  const [isArchiveExpanded, setIsArchiveExpanded] = useState(false);

  // Queries
  const {
    data: status,
    isLoading: isStatusLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["projectStatus"],
    queryFn: () => apiClient.getProjectStatus(),
    refetchInterval: 5000, // Poll every 5s per technical design
  });

  const { data: backendConnected = false } = useQuery({
    queryKey: ["backendHealth"],
    queryFn: () => apiClient.isBackendAvailable(),
    refetchInterval: 10000,
  });

  const completedTasksQuery = useInfiniteQuery({
    queryKey: ["completedTasks"],
    queryFn: ({ pageParam }) =>
      apiClient.listTasks("completed", 100, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    enabled: isArchiveExpanded,
  });

  const completedTasks = useMemo(() => {
    const loaded = completedTasksQuery.data?.pages.flatMap((page) => page.tasks) ?? [];
    return Array.from(new Map(loaded.map((task) => [task.id, task])).values());
  }, [completedTasksQuery.data]);

  const invalidateProjectQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["projectStatus"] });
    void queryClient.invalidateQueries({ queryKey: ["completedTasks"] });
  };

  const { data: selectedDetails, isLoading: isDetailsLoading, isError: isDetailsError } = useQuery({
    queryKey: ["taskDetails", selectedTaskId],
    queryFn: () => (selectedTaskId ? apiClient.getTaskDetails(selectedTaskId) : null),
    enabled: !!selectedTaskId,
    refetchInterval: 5000,
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
    onSuccess: (_, taskId) => {
      invalidateProjectQueries();
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
    onSuccess: (_, taskId) => {
      invalidateProjectQueries();
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
  });

  const requestChangesMutation = useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback: string }) =>
      apiClient.requestTaskChanges(taskId, feedback),
    onSuccess: (_, variables) => {
      invalidateProjectQueries();
      queryClient.invalidateQueries({ queryKey: ["taskDetails", variables.taskId] });
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
  const allTasks = useMemo(
    () => (status ? buildTaskIndex(status, completedTasks) : new Map()),
    [status, completedTasks],
  );

  if (isStatusLoading || !status) {
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
        project={status.project}
        isBackendConnected={backendConnected}
        onRefresh={() => {
          refetch();
          if (isArchiveExpanded) {
            void completedTasksQuery.refetch();
          }
          if (selectedTaskId) {
            queryClient.invalidateQueries({ queryKey: ["taskDetails", selectedTaskId] });
          }
        }}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        isRefreshing={isRefetching}
      />

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 w-full space-y-6 lg:flex lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:flex-col lg:space-y-3 lg:overflow-hidden">
        {/* Blocked Section (Top priority when tasks are blocked) */}
        <BlockedTasks
          tasks={status.blocked}
          onSelectTask={(id) => setSelectedTaskId(id)}
        />
        {/* Execution Flow View (Compact topology for branches and dependencies) */}
        <ExecutionFlowView
          status={status}
          additionalCompletedTasks={completedTasks}
          onSelectTask={(id) => setSelectedTaskId(id)}
        />

        {/* Four queue regions: wide screens use a fixed 2x2 viewport grid; narrow screens flow normally. */}
        <div className="grid grid-cols-1 gap-6 lg:flex-1 lg:min-h-0 lg:grid-cols-2 lg:grid-rows-2 lg:items-stretch lg:gap-3">
          {/* Top-left: review status and currently running tasks are two independent cards. */}
          <div className="space-y-3 lg:h-full lg:min-h-0 lg:flex lg:flex-col lg:space-y-0 lg:gap-3">
            <ReviewTasks
              tasks={status.inReview}
              onApprove={(id) => approveTaskMutation.mutate(id)}
              onRequestChanges={(taskId, feedback) =>
                requestChangesMutation.mutate({ taskId, feedback })
              }
              onSelectTask={(id) => setSelectedTaskId(id)}
            />
            <CurrentTasks
              tasks={status.current}
              allTasks={allTasks}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onReleaseTask={(id) => releaseTaskMutation.mutate(id)}
            />
          </div>

          {/* Top-right: ready queue. */}
          <div className="lg:h-full lg:min-h-0">
            <NextTasks
              tasks={status.next}
              allTasks={allTasks}
              onReorder={(id, dir) => reorderTaskMutation.mutate({ taskId: id, direction: dir })}
              onReturnToInbox={(id) => returnReadyMutation.mutate(id)}
              onDeleteTask={(id) => deleteReadyMutation.mutate(id)}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onOpenBriefing={(task) => setBriefingTask(task)}
            />
          </div>

          {/* Bottom-left: inbox. */}
          <div className="lg:h-full lg:min-h-0">
            <InboxTasks
              tasks={status.inbox}
              allTasks={allTasks}
              onConfirmTask={(id, riskLevel) => confirmInboxMutation.mutate({ taskId: id, riskLevel })}
              onDeleteTask={(id) => deleteInboxMutation.mutate(id)}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onEditTask={(task) => setEditingInboxTask(task)}
              onCreateTask={() => setIsCreateModalOpen(true)}
            />
          </div>

          {/* Bottom-right: completed archive keeps its own paged scroll region. */}
          <div className="lg:h-full lg:min-h-0">
            <RecentTasks
              tasks={completedTasks}
              totalCount={status.counts.completed}
              isExpanded={isArchiveExpanded}
              onToggleExpanded={() => setIsArchiveExpanded((expanded) => !expanded)}
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
          </div>
        </div>
      </main>

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
        onRequestChanges={(taskId, feedback) =>
          requestChangesMutation.mutate({ taskId, feedback })
        }
      />
      <EditInboxModal
        task={editingInboxTask}
        isOpen={!!editingInboxTask}
        onClose={() => setEditingInboxTask(null)}
        availableTasks={[
          ...status.current,
          ...status.next,
          ...status.blocked,
          ...status.inbox,
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
        project={status.project}
        isOpen={!!briefingTask}
        onClose={() => setBriefingTask(null)}
      />
    </div>
  );
};
