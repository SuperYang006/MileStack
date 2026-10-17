import { z } from "zod";

export const taskStatuses = [
  "inbox",
  "ready",
  "running",
  "blocked",
  "in_review",
  "completed",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export const taskEventTypes = [
  "created",
  "confirmed",
  "started",
  "progress",
  "blocked",
  "resumed",
  "released",
  "submitted_for_review",
  "review_started",
  "review_passed",
  "approved",
  "changes_requested",
  "reopened",
  "completed",
] as const;

export type TaskEventType = (typeof taskEventTypes)[number];

/**
 * An acceptance criterion as stored and read. The id is a stable identity that
 * survives text edits and is never the criterion text itself, so delivery
 * results can match a criterion without comparing the full text.
 */
export const acceptanceCriterionSchema = z
  .object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
  })
  .strict();

export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

/**
 * JSON payload stored in `tasks.acceptance_criteria`. The plain string array is
 * the legacy shape and stays readable without a manual backfill.
 */
export type AcceptanceCriteriaPayload = Array<string | AcceptanceCriterion>;

export function normalizeAcceptanceCriteriaPayload(
  raw: unknown,
): AcceptanceCriterion[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const criteria: AcceptanceCriterion[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text.length > 0) {
        criteria.push({ id: `legacy-${index}`, text });
      }
      return;
    }
    if (entry !== null && typeof entry === "object") {
      const record = entry as { id?: unknown; text?: unknown };
      if (typeof record.text === "string" && record.text.trim().length > 0) {
        const id =
          typeof record.id === "string" && record.id.trim().length > 0
            ? record.id
            : `legacy-${index}`;
        criteria.push({ id, text: record.text.trim() });
      }
    }
  });
  return criteria;
}

