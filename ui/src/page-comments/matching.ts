import type { ElementSignals } from "./model.js";

export interface ElementMatch {
  accepted: boolean;
  score: number;
  semanticScore: number;
  pathScore: number;
}

export interface Candidate<T> {
  value: T;
  signals: ElementSignals;
}

/** Identity points needed before a candidate is trusted after a DOM change. */
const REQUIRED_SEMANTIC_SCORE = 14;

function rejected(): ElementMatch {
  return { accepted: false, score: 0, semanticScore: 0, pathScore: 0 };
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compareText(
  snapshotText: string,
  candidateText: string,
): { score: number; conflict: boolean } {
  const snapshot = normalized(snapshotText);
  const candidate = normalized(candidateText);
  if (!snapshot || !candidate) return { score: 0, conflict: false };
  if (snapshot === candidate) return { score: 30, conflict: false };
  if (snapshot.includes(candidate) || candidate.includes(snapshot)) {
    return { score: 15, conflict: false };
  }
  // Different visible copy means this is a different element: a structural
  // path alone must never reattach a comment to it.
  return { score: 0, conflict: true };
}

function overlapScore(
  snapshot: readonly string[],
  candidate: readonly string[],
  weight: number,
  cap: number,
): number {
  if (snapshot.length === 0 || candidate.length === 0) return 0;
  const candidateSet = new Set(candidate);
  let hits = 0;
  for (const value of snapshot) {
    if (candidateSet.has(value)) hits += 1;
  }
  return Math.min(hits * weight, cap);
}

function componentScore(
  snapshot: readonly string[],
  candidate: readonly string[],
): number {
  if (snapshot.length === 0 || candidate.length === 0) return 0;
  if (snapshot[0] !== undefined && snapshot[0] === candidate[0]) return 10;
  return overlapScore(snapshot, candidate, 3, 9);
}

/**
 * Scores how likely a current DOM element is the element a comment was written
 * against. Text conflicts reject the candidate outright, so a matching
 * structural path can never pull a comment onto unrelated content.
 */
export function compareElementSignals(
  snapshot: ElementSignals,
  candidate: ElementSignals,
): ElementMatch {
  const text = compareText(snapshot.text, candidate.text);
  // An input's captured "text" is its current value, which changes while the
  // developer types; a value mismatch alone must not detach the comment.
  const formControlValue =
    snapshot.tag === candidate.tag &&
    (snapshot.tag === "input" || snapshot.tag === "textarea" || snapshot.tag === "select");
  if (text.conflict && !formControlValue) return rejected();

  const idMatches = snapshot.id !== "" && snapshot.id === candidate.id;
  const testIdMatches = snapshot.testId !== "" && snapshot.testId === candidate.testId;
  const tagMatches = snapshot.tag !== "" && snapshot.tag === candidate.tag;

  const semanticScore =
    (idMatches ? 40 : 0) +
    (testIdMatches ? 35 : 0) +
    text.score +
    overlapScore(snapshot.classes, candidate.classes, 6, 12) +
    overlapScore(snapshot.areaClasses, candidate.areaClasses, 3, 6) +
    componentScore(snapshot.components, candidate.components);

  const pathScore =
    (snapshot.selector !== "" && snapshot.selector === candidate.selector ? 10 : 0) +
    (tagMatches ? 5 : 0);

  const hasIdentityClues =
    snapshot.id !== "" ||
    snapshot.testId !== "" ||
    snapshot.text !== "" ||
    snapshot.classes.length > 0 ||
    snapshot.areaClasses.length > 0 ||
    snapshot.components.length > 0;

  const accepted = (tagMatches || idMatches || testIdMatches) &&
    (hasIdentityClues
      ? semanticScore >= REQUIRED_SEMANTIC_SCORE
      : snapshot.selector !== "" && snapshot.selector === candidate.selector);

  return { accepted, score: semanticScore + pathScore, semanticScore, pathScore };
}

/**
 * Picks the best accepted candidate. `preferenceOf` only breaks score ties,
 * for example to prefer a visible element that still sits near the original
 * comment position.
 */
export function pickBestCandidate<T>(
  snapshot: ElementSignals,
  candidates: ReadonlyArray<Candidate<T>>,
  preferenceOf?: (value: T) => number,
): T | null {
  let bestValue: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestPreference = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const match = compareElementSignals(snapshot, candidate.signals);
    if (!match.accepted) continue;
    const preference = preferenceOf ? preferenceOf(candidate.value) : 0;
    if (match.score > bestScore || (match.score === bestScore && preference > bestPreference)) {
      bestValue = candidate.value;
      bestScore = match.score;
      bestPreference = preference;
    }
  }

  return bestValue;
}
