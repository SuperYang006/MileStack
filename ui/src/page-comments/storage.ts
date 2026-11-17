import type { CommentTarget, ElementAnchor, PageComment } from "./model.js";

export const STORAGE_KEY = "ms-page-comments";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function createCommentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readAnchor(value: unknown): ElementAnchor | null {
  if (!isRecord(value)) return null;
  return {
    x: numberValue(value.x),
    y: numberValue(value.y),
    width: numberValue(value.width),
    height: numberValue(value.height),
  };
}

function readTarget(value: unknown): CommentTarget | null {
  if (!isRecord(value)) return null;
  const anchor = readAnchor(value.anchor);
  if (!anchor) return null;
  const tag = stringValue(value.tag);
  const selector = stringValue(value.selector);
  if (!tag || !selector) return null;
  return {
    tag,
    id: stringValue(value.id),
    testId: stringValue(value.testId),
    text: stringValue(value.text),
    classes: stringArray(value.classes),
    areaClasses: stringArray(value.areaClasses),
    components: stringArray(value.components),
    selector,
    description: stringValue(value.description) || `<${tag}>`,
    anchor,
  };
}

function readComment(value: unknown): PageComment | null {
  if (!isRecord(value)) return null;
  const target = readTarget(value.target);
  if (!target) return null;
  const comment = stringValue(value.comment);
  const route = stringValue(value.route);
  if (!comment || !route) return null;
  return {
    id: stringValue(value.id) || createCommentId(),
    route,
    origin: stringValue(value.origin),
    viewport: stringValue(value.viewport),
    target,
    formItem: stringValue(value.formItem),
    section: stringValue(value.section),
    comment,
    createdAt: stringValue(value.createdAt) || new Date().toISOString(),
  };
}

export function loadComments(storage: StorageLike): PageComment[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => readComment(entry))
      .filter((entry): entry is PageComment => entry !== null);
  } catch {
    return [];
  }
}

export function saveComments(storage: StorageLike, comments: readonly PageComment[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(comments));
  } catch {
    // Storage can be unavailable in private windows; comments stay in memory.
  }
}
