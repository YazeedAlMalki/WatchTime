import { afterEach, describe, expect, it, vi } from "vitest";
import type { Options } from "express-rate-limit";
import { DrizzleRateLimitStore } from "./drizzleRateLimitStore";
import {
  RATE_LIMIT_CLEANUP_BATCH_SIZE,
  RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
  RATE_LIMIT_CLEANUP_INTERVAL_MS,
  RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS,
  RATE_LIMIT_CLEANUP_WARNING_INTERVAL_MS,
} from "./rateLimitCleanup";

const { execute, warn, info } = vi.hoisted(() => ({
  execute: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { execute } }));
vi.mock("../lib/logger", () => ({ logger: { warn, info } }));

const stores: DrizzleRateLimitStore[] = [];
function initializedStore() {
  const store = new DrizzleRateLimitStore("scheduler-test");
  stores.push(store);
  store.init({ windowMs: 60_000 } as Options);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.shutdown();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("rate-limit background cleanup", () => {
  it("shares one unref'ed timer across namespaces and stops after the last shutdown", async () => {
    vi.useFakeTimers();
    execute.mockResolvedValue({ rowCount: 0 });
    const first = initializedStore();
    const second = initializedStore();
    first.init({ windowMs: 1_000 } as Options);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(1);
    first.shutdown();
    expect(vi.getTimerCount()).toBe(1);
    second.shutdown();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(1);
    initializedStore();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not overlap slow batches and retries logged failures on the next tick", async () => {
    vi.useFakeTimers();
    let reject!: (reason: Error) => void;
    execute.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    execute.mockResolvedValue({ rowCount: 0 });
    initializedStore();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS * 3);
    expect(execute).toHaveBeenCalledTimes(1);
    const error = new Error("database unavailable: private-client-key");
    Object.assign(error, { query: "private-client-key", params: ["private-client-key"] });
    reject(error);
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith(
      {
        event: "rate_limit_cleanup",
        outcome: "failure",
        durationMs: expect.any(Number),
        batchSize: RATE_LIMIT_CLEANUP_BATCH_SIZE,
        intervalMs: RATE_LIMIT_CLEANUP_INTERVAL_MS,
      },
      expect.stringContaining("Retrying on the next scheduled tick"),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-client-key");
    expect(info).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"] as const)(
    "keeps one timer and resumes cleanup when stores restart during a pending %s",
    async (outcome) => {
      vi.useFakeTimers();
      vi.spyOn(performance, "now").mockImplementation(() => Date.now());
      execute.mockResolvedValue({ rowCount: RATE_LIMIT_CLEANUP_BATCH_SIZE });
      const first = initializedStore();
      await vi.advanceTimersByTimeAsync(
        RATE_LIMIT_CLEANUP_INTERVAL_MS * RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
      );
      expect(warn).toHaveBeenCalledTimes(1);

      let resolve!: (result: { rowCount: number }) => void;
      let reject!: (reason: Error) => void;
      execute.mockImplementationOnce(() => new Promise<{ rowCount: number }>((done, fail) => {
        resolve = done;
        reject = fail;
      }));
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
      const callsBeforeSettlement = RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD + 1;
      expect(execute).toHaveBeenCalledTimes(callsBeforeSettlement);

      try {
        first.shutdown();
        expect(vi.getTimerCount()).toBe(0);
        // Offset the replacement interval from the original timer's schedule.
        await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS / 2);
        const replacement = initializedStore();
        replacement.init({ windowMs: 1_000 } as Options);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS * 2);
        expect(execute).toHaveBeenCalledTimes(callsBeforeSettlement);
        expect(info).toHaveBeenCalledTimes(RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        if (outcome === "success") {
          resolve({ rowCount: RATE_LIMIT_CLEANUP_BATCH_SIZE });
        } else {
          reject(new Error("database unavailable"));
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(execute).toHaveBeenCalledTimes(callsBeforeSettlement);
        expect(vi.getTimerCount()).toBe(1);
        if (outcome === "success") {
          expect(info).toHaveBeenLastCalledWith(
            expect.objectContaining({ consecutiveCappedBatches: callsBeforeSettlement }),
            expect.any(String),
          );
          // Restarting during a running batch preserves both streak and throttle.
          expect(warn).toHaveBeenCalledTimes(1);
        } else {
          expect(warn).toHaveBeenCalledTimes(2);
          expect(warn).toHaveBeenLastCalledWith(
            expect.objectContaining({ outcome: "failure" }),
            expect.stringContaining("Retrying on the next scheduled tick"),
          );
        }

        await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS - 1);
        expect(execute).toHaveBeenCalledTimes(callsBeforeSettlement);
        await vi.advanceTimersByTimeAsync(1);
        expect(execute).toHaveBeenCalledTimes(callsBeforeSettlement + 1);
        expect(info).toHaveBeenLastCalledWith(
          expect.objectContaining({
            consecutiveCappedBatches: outcome === "success" ? callsBeforeSettlement + 1 : 1,
          }),
          expect.any(String),
        );
        expect(warn).toHaveBeenCalledTimes(outcome === "success" ? 1 : 2);

        await vi.advanceTimersByTimeAsync(
          RATE_LIMIT_CLEANUP_INTERVAL_MS * (RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD - 1),
        );
        expect(execute).toHaveBeenCalledTimes(
          callsBeforeSettlement + RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
        );
        expect(warn).toHaveBeenCalledTimes(outcome === "success" ? 1 : 3);
        if (outcome === "failure") {
          expect(warn).toHaveBeenLastCalledWith(
            expect.objectContaining({
              hitCap: true,
              consecutiveCappedBatches: RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
            }),
            expect.stringContaining("expired counters may be accumulating"),
          );
        }
        expect(vi.getTimerCount()).toBe(1);
        replacement.shutdown();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        // Never leave module-level running state pending if an assertion fails.
        resolve({ rowCount: 0 });
        await vi.advanceTimersByTimeAsync(0);
      }
    },
  );

  it("starts a fresh cap-warning streak after full shutdown and an idle restart", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    execute.mockResolvedValue({ rowCount: RATE_LIMIT_CLEANUP_BATCH_SIZE });
    const first = initializedStore();
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_INTERVAL_MS * RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    first.shutdown();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD);

    initializedStore();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(info).toHaveBeenLastCalledWith(
      expect.objectContaining({ consecutiveCappedBatches: 1 }),
      expect.any(String),
    );
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_INTERVAL_MS * (RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD - 2),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    // Still inside the previous warning's throttle window: both state values
    // must reset, not just the consecutive-cap count.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hitCap: true,
        consecutiveCappedBatches: RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
      }),
      expect.stringContaining("expired counters may be accumulating"),
    );
  });

  it("logs bounded aggregate measurements for full, partial, and empty batches", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100).mockReturnValueOnce(127)
      .mockReturnValueOnce(200).mockReturnValueOnce(213)
      .mockReturnValueOnce(300).mockReturnValueOnce(302);
    execute.mockResolvedValueOnce({ rowCount: RATE_LIMIT_CLEANUP_BATCH_SIZE })
      .mockResolvedValueOnce({ rowCount: 7 })
      .mockResolvedValueOnce({ rowCount: 0 });
    initializedStore();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS * 3);
    expect(execute).toHaveBeenCalledTimes(3); // No extra backlog/count queries.
    for (const [index, [deletedRows, durationMs, hitCap, streak]] of [
      [RATE_LIMIT_CLEANUP_BATCH_SIZE, 27, true, 1],
      [7, 13, false, 0],
      [0, 2, false, 0],
    ].entries()) {
      expect(info).toHaveBeenNthCalledWith(index + 1, {
        event: "rate_limit_cleanup",
        outcome: "success",
        durationMs,
        deletedRows,
        batchSize: RATE_LIMIT_CLEANUP_BATCH_SIZE,
        intervalMs: RATE_LIMIT_CLEANUP_INTERVAL_MS,
        hitCap,
        consecutiveCappedBatches: streak,
      }, "Rate-limit counter cleanup completed");
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns on an unresolved batch without overlap, throttles reminders, and resets after completion", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    let resolve!: (result: { rowCount: number }) => void;
    const pendingBatch = () => new Promise<{ rowCount: number }>((done) => { resolve = done; });
    execute.mockImplementationOnce(pendingBatch).mockResolvedValue({ rowCount: 0 });
    initializedStore();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS - RATE_LIMIT_CLEANUP_INTERVAL_MS,
    );
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      {
        event: "rate_limit_cleanup",
        outcome: "stalled",
        durationMs: RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS,
        thresholdMs: RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS,
        batchSize: RATE_LIMIT_CLEANUP_BATCH_SIZE,
        intervalMs: RATE_LIMIT_CLEANUP_INTERVAL_MS,
      },
      expect.stringContaining("no overlapping batch will start"),
    );
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_WARNING_INTERVAL_MS - RATE_LIMIT_CLEANUP_INTERVAL_MS,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1); // No per-batch watchdog timers accumulate.

    resolve({ rowCount: 7 });
    await vi.advanceTimersByTimeAsync(0);
    expect(info).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "success", deletedRows: 7 }),
      expect.any(String),
    );
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);

    // A new slow batch gets its own threshold and is not suppressed by the
    // previous batch's reminder throttle.
    execute.mockImplementationOnce(pendingBatch);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS - RATE_LIMIT_CLEANUP_INTERVAL_MS,
    );
    expect(warn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ durationMs: RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS }),
      expect.any(String),
    );
    expect(execute).toHaveBeenCalledTimes(3);
    resolve({ rowCount: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_WARNING_INTERVAL_MS);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("warns after repeated full batches and throttles reminders until recovery", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    execute.mockResolvedValue({ rowCount: RATE_LIMIT_CLEANUP_BATCH_SIZE });
    initializedStore();
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_INTERVAL_MS * (RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD - 1),
    );
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        hitCap: true,
        consecutiveCappedBatches: RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
      }),
      expect.stringContaining("expired counters may be accumulating"),
    );
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_WARNING_INTERVAL_MS - RATE_LIMIT_CLEANUP_INTERVAL_MS,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(warn).toHaveBeenCalledTimes(2);
    execute.mockResolvedValueOnce({ rowCount: 1 });
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_INTERVAL_MS * RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
    );
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("breaks the full-batch streak on failure instead of inferring backlog from unknown results", async () => {
    vi.useFakeTimers();
    execute.mockResolvedValue({ rowCount: RATE_LIMIT_CLEANUP_BATCH_SIZE });
    initializedStore();
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_INTERVAL_MS * (RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD - 1),
    );
    execute.mockRejectedValueOnce(new Error("private-client-key"));
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS * 2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenLastCalledWith(
      expect.objectContaining({ consecutiveCappedBatches: 1 }),
      expect.any(String),
    );
    await vi.advanceTimersByTimeAsync(
      RATE_LIMIT_CLEANUP_INTERVAL_MS * (RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD - 1),
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
