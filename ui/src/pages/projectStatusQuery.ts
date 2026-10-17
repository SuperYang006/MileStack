import type { QueryClient } from "@tanstack/react-query";

import { apiClient } from "../api/client.js";
import type { ProjectStatus } from "../types.js";

export const projectStatusQueryKey = ["projectStatus"] as const;

export function projectStatusQueryOptions(
  queryClient: QueryClient,
  forceFullStatusRef: { current: boolean },
) {
  return {
    queryKey: projectStatusQueryKey,
    queryFn: async () => {
      const previous = queryClient.getQueryData<ProjectStatus>(projectStatusQueryKey);
      const since = forceFullStatusRef.current
        ? undefined
        : previous?.latestUpdatedAt ?? undefined;
      forceFullStatusRef.current = false;
      const nextStatus = await apiClient.getProjectStatus(undefined, since);
      if (nextStatus) return nextStatus;
      if (previous) return previous;
      throw new Error("Project status was not returned.");
    },
  };
}

export async function refreshProjectStatusAfterDeletion(
  queryClient: QueryClient,
  forceFullStatusRef: { current: boolean },
): Promise<void> {
  forceFullStatusRef.current = true;
  await queryClient.invalidateQueries({ queryKey: projectStatusQueryKey });
}
