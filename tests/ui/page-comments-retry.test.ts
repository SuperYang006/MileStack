import { describe, expect, it } from "vitest";
import {
  MAX_MISSING_TARGET_RETRIES,
  MissingTargetRetry,
  MISSING_TARGET_RETRY_MS,
  type PlacementRetryTimers,
} from "../../ui/src/page-comments/placement-retry.js";

function fakeTimers(): {
  timers: PlacementRetryTimers;
  pending: Map<number, () => void>;
  delays: number[];
  fireNext: () => void;
} {
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let nextId = 1;
  return {
    pending,
    delays,
    timers: {
      set(callback, delayMs) {
        const id = nextId;
        nextId += 1;
        pending.set(id, callback);
        delays.push(delayMs);
        return id;
      },
      clear(handle) {
        pending.delete(handle);
      },
    },
    fireNext() {
      const entry = pending.entries().next();
      if (entry.done) throw new Error("没有待触发的重试");
      const [id, callback] = entry.value;
      pending.delete(id);
      callback();
    },
  };
}

describe("missing target retries", () => {
  it("schedules one retry per interval instead of one per DOM update", () => {
    const fake = fakeTimers();
    const retry = new MissingTargetRetry(fake.timers);
    let calls = 0;

    retry.update(1, () => {
      calls += 1;
    });
    retry.update(1, () => {
      calls += 1;
    });

    expect(fake.pending.size).toBe(1);
    expect(fake.delays).toEqual([MISSING_TARGET_RETRY_MS]);
    expect(calls).toBe(0);

    fake.fireNext();
    expect(calls).toBe(1);
  });

  it("keeps retrying a target that is still missing at the next interval", () => {
    const fake = fakeTimers();
    const retry = new MissingTargetRetry(fake.timers);
    let calls = 0;
    const requestRetry = () => {
      calls += 1;
      retry.update(1, requestRetry);
    };

    retry.update(1, requestRetry);
    for (let index = 0; index < 3; index += 1) fake.fireNext();

    expect(calls).toBe(3);
    expect(fake.pending.size).toBe(1);
  });

  it("stops after the bounded attempt count", () => {
    const fake = fakeTimers();
    const retry = new MissingTargetRetry(fake.timers);
    let calls = 0;
    const requestRetry = () => {
      calls += 1;
      retry.update(1, requestRetry);
    };

    retry.update(1, requestRetry);
    for (let index = 0; index < MAX_MISSING_TARGET_RETRIES; index += 1) {
      fake.fireNext();
    }
    retry.update(1, requestRetry);

    expect(calls).toBe(MAX_MISSING_TARGET_RETRIES);
    expect(fake.pending.size).toBe(0);
  });

  it("cancels and resets once every target is placed again", () => {
    const fake = fakeTimers();
    const retry = new MissingTargetRetry(fake.timers);

    retry.update(1, () => {});
    retry.update(0, () => {});

    expect(fake.pending.size).toBe(0);

    let calls = 0;
    retry.update(1, () => {
      calls += 1;
    });
    fake.fireNext();
    expect(calls).toBe(1);
  });
});
