import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export const RATE_LIMIT_CLEANUP_BATCH_SIZE = 500;
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;

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

export function registerRateLimitCleanup(store: object): void {
  stores.add(store);
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void pruneExpiredRateLimitHits()
      .catch((err: unknown) => {
        // Cleanup is best-effort, never part of the request path. Retry on the
        // next tick, but make database failures visible rather than hiding them.
        logger.warn({ err }, "Rate-limit counter cleanup failed");
      })
      .finally(() => {
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
