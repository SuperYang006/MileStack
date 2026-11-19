import type { TaskSummary } from "../types.js";

/** Eight-character shorthand used across the dashboard for task references. */
export function shortTaskId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Splits pasted text the same way the previous manual dependency field did:
 * commas or newlines separate ids, blank entries are dropped, and duplicates
 * collapse to the first occurrence.
 */
export function parseDependencyIds(raw: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of raw.split(/[\n,]/)) {
    const id = entry.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Returns the tasks a draft can add as a dependency, excluding itself and ids
 * that are already selected. An empty query lists everything still available.
 */
export function filterDependencyCandidates(
  tasks: readonly TaskSummary[],
  options: {
    currentTaskId: string;
    selectedIds: readonly string[];
    query: string;
    limit?: number;
  },
): TaskSummary[] {
  const selected = new Set(options.selectedIds);
  // The interface renders short ids with a leading "#"; strip it so a query
  // copied straight from the screen still matches the raw task id.
  const normalizedQuery = options.query.trim().toLowerCase().replace(/^#+/, "");
  const candidates = tasks.filter((task) => {
    if (task.id === options.currentTaskId || selected.has(task.id)) {
      return false;
    }
    if (normalizedQuery.length === 0) {
      return true;
    }
    return (
      task.title.toLowerCase().includes(normalizedQuery) ||
      task.id.toLowerCase().includes(normalizedQuery)
    );
  });
  return options.limit === undefined ? candidates : candidates.slice(0, options.limit);
}
