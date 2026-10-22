import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export const RATE_LIMIT_CLEANUP_BATCH_SIZE = 500;
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
export const RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD = 3;
export const RATE_LIMIT_CLEANUP_WARNING_INTERVAL_MS = 15 * 60_000;
export const RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS = 5 * 60_000;

/**
 * One bounded, atomic batch shared by all namespaces. Row locks serialize this
 * with counter renewal, and SKIP LOCKED lets other API instances work on other
 * rows without waiting on either cleanup or live requests.
 */
export async function pruneExpiredRateLimitHits(): Promise<number> {
  const result = await db.execute(sql`
    WITH expired AS (
      SELECT key FROM rate_limit_hits
      WHERE reset_time <= NOW()
      ORDER BY reset_time
      LIMIT ${RATE_LIMIT_CLEANUP_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM rate_limit_hits AS counters
    USING expired
    WHERE counters.key = expired.key AND counters.reset_time <= NOW()
  `);
  return result.rowCount ?? 0;
}

const stores = new Set<object>();
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
// Fixed-size, process-local measurements; no client keys or batch history.
let activeBatchStartedAt: number | undefined;
let lastStallWarningAt = -Infinity;
let consecutiveCappedBatches = 0;
let lastCapWarningAt = -Infinity;

async function runCleanupBatch(): Promise<void> {
  const startedAt = performance.now();
  activeBatchStartedAt = startedAt;
  try {
    const deletedRows = await pruneExpiredRateLimitHits();
    const completedAt = performance.now();
    const hitCap = deletedRows >= RATE_LIMIT_CLEANUP_BATCH_SIZE;
    consecutiveCappedBatches = hitCap
      ? Math.min(consecutiveCappedBatches + 1, Number.MAX_SAFE_INTEGER)
      : 0;
    if (!hitCap) lastCapWarningAt = -Infinity;
    const measurements = {
      event: "rate_limit_cleanup",
      outcome: "success",
      durationMs: Math.round(completedAt - startedAt),
      deletedRows,
      batchSize: RATE_LIMIT_CLEANUP_BATCH_SIZE,
      intervalMs: RATE_LIMIT_CLEANUP_INTERVAL_MS,
      hitCap,
      consecutiveCappedBatches,
    };
    logger.info(measurements, "Rate-limit counter cleanup completed");
    if (
      consecutiveCappedBatches >= RATE_LIMIT_CLEANUP_CAP_WARNING_THRESHOLD &&
      completedAt - lastCapWarningAt >= RATE_LIMIT_CLEANUP_WARNING_INTERVAL_MS
    ) {
      lastCapWarningAt = completedAt;
      logger.warn(
        measurements,
        "Rate-limit cleanup repeatedly reached its batch cap; expired counters may be accumulating. " +
          "Consider increasing RATE_LIMIT_CLEANUP_BATCH_SIZE or reducing RATE_LIMIT_CLEANUP_INTERVAL_MS " +
          "after checking database load. Keep the reset_time expiry checks and SKIP LOCKED protection.",
      );
    }
  } catch {
    consecutiveCappedBatches = 0;
    lastCapWarningAt = -Infinity;
    // Database errors can embed SQL parameters/client keys. Log only bounded,
    // aggregate failure metadata, never the raw error or query.
    logger.warn(
      {
        event: "rate_limit_cleanup",
        outcome: "failure",
        durationMs: Math.round(performance.now() - startedAt),
        batchSize: RATE_LIMIT_CLEANUP_BATCH_SIZE,
        intervalMs: RATE_LIMIT_CLEANUP_INTERVAL_MS,
      },
      "Rate-limit counter cleanup failed; deleted-row count is unknown. Retrying on the next scheduled tick.",
    );
  }
}

export function registerRateLimitCleanup(store: object): void {
  stores.add(store);
  if (timer) return;
  if (!running) {
    consecutiveCappedBatches = 0;
    lastCapWarningAt = -Infinity;
  }
  timer = setInterval(() => {
    if (running) {
      const now = performance.now();
      if (
        activeBatchStartedAt !== undefined &&
        now - activeBatchStartedAt >= RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS &&
        now - lastStallWarningAt >= RATE_LIMIT_CLEANUP_WARNING_INTERVAL_MS
      ) {
        lastStallWarningAt = now;
        logger.warn(
          {
            event: "rate_limit_cleanup",
            outcome: "stalled",
            durationMs: Math.round(now - activeBatchStartedAt),
            thresholdMs: RATE_LIMIT_CLEANUP_STALL_THRESHOLD_MS,
            batchSize: RATE_LIMIT_CLEANUP_BATCH_SIZE,
            intervalMs: RATE_LIMIT_CLEANUP_INTERVAL_MS,
          },
          "Rate-limit counter cleanup exceeded its operational duration threshold; " +
            "the batch is still pending and no overlapping batch will start. Check database health and locks.",
        );
      }
      return;
    }
    running = true;
    void runCleanupBatch().finally(() => {
      activeBatchStartedAt = undefined;
      lastStallWarningAt = -Infinity;
      running = false;
    });
  }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
  timer.unref();
}

export function unregisterRateLimitCleanup(store: object): void {
  stores.delete(store);
  if (stores.size === 0 && timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
