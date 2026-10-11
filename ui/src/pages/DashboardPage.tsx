import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { Header } from "../components/Header";
import { CurrentTasks } from "../components/CurrentTasks";
import { NextTasks } from "../components/NextTasks";
import { BlockedTasks } from "../components/BlockedTasks";
import { InboxTasks } from "../components/InboxTasks";
import { RecentTasks } from "../components/RecentTasks";
import { TaskDetailModal } from "../components/TaskDetailModal";
import { CreateTaskModal } from "../components/CreateTaskModal";
import { BriefingModal } from "../components/BriefingModal";
import type { TaskSummary, CreateTaskPayload } from "../types";

export const DashboardPage: React.FC = () => {
  const queryClient = useQueryClient();

  // State
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [briefingTask, setBriefingTask] = useState<TaskSummary | null>(null);

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

  const { data: selectedDetails, isLoading: isDetailsLoading } = useQuery({
    queryKey: ["taskDetails", selectedTaskId],
    queryFn: () => (selectedTaskId ? apiClient.getTaskDetails(selectedTaskId) : null),
    enabled: !!selectedTaskId,
    refetchInterval: 5000,
  });

  // Mutations
  const createTaskMutation = useMutation({
    mutationFn: (payload: CreateTaskPayload) => apiClient.createTask(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectStatus"] }),
  });

  const createTasksBatchMutation = useMutation({
    mutationFn: (payloads: CreateTaskPayload[]) => apiClient.createTasks(payloads),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectStatus"] }),
  });
  const confirmInboxMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.confirmInboxTask(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectStatus"] }),
  });

  const deleteInboxMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.deleteInboxTask(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectStatus"] }),
  });

  const reorderTaskMutation = useMutation({
    mutationFn: ({ taskId, direction }: { taskId: string; direction: "up" | "down" }) =>
      apiClient.reorderReadyTask(taskId, direction),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectStatus"] }),
  });

  const releaseTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.releaseTask(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projectStatus"] }),
  });

  if (isStatusLoading || !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 font-mono text-zinc-500 text-xs">
        // 正在连接 MileStack 数据总线...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 pb-16 selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Header */}
      <Header
        project={status.project}
        isBackendConnected={backendConnected}
        onRefresh={() => {
          refetch();
          if (selectedTaskId) {
            queryClient.invalidateQueries({ queryKey: ["taskDetails", selectedTaskId] });
          }
        }}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        isRefreshing={isRefetching}
      />

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 w-full space-y-6">
        {/* Blocked Section (Top priority when tasks are blocked) */}
        <BlockedTasks
          tasks={status.blocked}
          onSelectTask={(id) => setSelectedTaskId(id)}
        />

        {/* Current & Next Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left Column: Currently running */}
          <div className="space-y-6">
            <CurrentTasks
              tasks={status.current}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onReleaseTask={(id) => releaseTaskMutation.mutate(id)}
            />

            {/* Inbox Section */}
            <InboxTasks
              tasks={status.inbox}
              onConfirmTask={(id) => confirmInboxMutation.mutate(id)}
              onDeleteTask={(id) => deleteInboxMutation.mutate(id)}
              onSelectTask={(id) => setSelectedTaskId(id)}
            />
          </div>

          {/* Right Column: Next Tasks (Ready queue) */}
          <div className="space-y-6">
            <NextTasks
              tasks={status.next}
              onReorder={(id, dir) => reorderTaskMutation.mutate({ taskId: id, direction: dir })}
              onSelectTask={(id) => setSelectedTaskId(id)}
              onOpenBriefing={(task) => setBriefingTask(task)}
            />

            {/* Recently Completed */}
            <RecentTasks
              tasks={status.recentlyCompleted}
              onSelectTask={(id) => setSelectedTaskId(id)}
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
