import { afterEach, describe, expect, it, vi } from "vitest";
import type { Options } from "express-rate-limit";
import { DrizzleRateLimitStore } from "./drizzleRateLimitStore";
import { RATE_LIMIT_CLEANUP_INTERVAL_MS } from "./rateLimitCleanup";

const { execute, warn } = vi.hoisted(() => ({
  execute: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { execute } }));
vi.mock("../lib/logger", () => ({ logger: { warn } }));

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
    const error = new Error("database unavailable");
    reject(error);
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith({ err: error }, "Rate-limit counter cleanup failed");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
