import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Persistent store for express-rate-limit counters.
 * One row per (namespaced) key; reset_time marks the end of the current window.
 * An atomic upsert in DrizzleRateLimitStore handles concurrent increments safely.
 */
export const rateLimitHitsTable = pgTable("rate_limit_hits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull().default(1),
  resetTime: timestamp("reset_time").notNull(),
}, (table) => [
  index("rate_limit_hits_reset_time_idx").on(table.resetTime),
]);
