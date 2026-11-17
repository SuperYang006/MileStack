export const MISSING_TARGET_RETRY_MS = 1000;
export const MAX_MISSING_TARGET_RETRIES = 5;

export interface PlacementRetryTimers {
  set(callback: () => void, delayMs: number): number;
  clear(handle: number): void;
}

/**
 * Schedules bounded re-location attempts while a comment target is missing.
 * DOM mutations always trigger their own locate pass; this only adds retries
 * for the case where the element reappears without a later observed mutation.
 */
export class MissingTargetRetry {
  private handle: number | null = null;
  private attempts = 0;

  constructor(
    private readonly timers: PlacementRetryTimers,
    private readonly delayMs: number = MISSING_TARGET_RETRY_MS,
    private readonly maxAttempts: number = MAX_MISSING_TARGET_RETRIES,
  ) {}

  update(missingCount: number, retry: () => void): void {
    if (missingCount === 0) {
      this.reset();
      return;
    }
    if (this.handle !== null || this.attempts >= this.maxAttempts) return;
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.attempts += 1;
      retry();
    }, this.delayMs);
  }

  reset(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
    this.attempts = 0;
  }

  dispose(): void {
    this.reset();
  }
}
