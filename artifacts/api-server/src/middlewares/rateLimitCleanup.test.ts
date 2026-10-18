import { afterEach, describe, expect, it, vi } from "vitest";
import type { Options } from "express-rate-limit";
import { DrizzleRateLimitStore } from "./drizzleRateLimitStore";
import {
  RATE_LIMIT_CLEANUP_BATCH_SIZE,
  RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD,
  RATE_LIMIT_CLEANUP_INTERVAL_MS,
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
