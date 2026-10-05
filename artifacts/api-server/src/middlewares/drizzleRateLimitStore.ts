/**
 * A persistent express-rate-limit Store backed by the existing PostgreSQL DB.
 *
 * Each rate-limiter gets its own namespace prefix so their keys never collide.
 * The increment is a single atomic UPSERT, safe under concurrent requests and
 * across multiple server instances sharing the same database.
 */

import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { registerRateLimitCleanup, unregisterRateLimitCleanup } from "./rateLimitCleanup";

export class DrizzleRateLimitStore implements Store {
  private windowMs = 60_000;
  readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  /** Called by express-rate-limit once during setup — captures the windowMs. */
  init(options: Options): void {
    this.windowMs = options.windowMs;
    registerRateLimitCleanup(this);
  }

  shutdown(): void {
    unregisterRateLimitCleanup(this);
  }

  private key(rawKey: string): string {
    return `${this.prefix}:${rawKey}`;
  }

  async increment(rawKey: string): Promise<ClientRateLimitInfo> {
    const k = this.key(rawKey);
    const windowSecs = Math.ceil(this.windowMs / 1000);

    // Atomic upsert:
    //  • First request in a window  → insert with hits = 1, reset_time = now + window
    //  • Subsequent requests        → increment hits, keep existing reset_time
    //  • Window expired             → reset hits to 1, set new reset_time
    const result = await db.execute(sql`
      INSERT INTO rate_limit_hits (key, hits, reset_time)
      VALUES (
        ${k},
        1,
        NOW() + (${windowSecs} * INTERVAL '1 second')
      )
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE
          WHEN rate_limit_hits.reset_time <= NOW() THEN 1
          ELSE rate_limit_hits.hits + 1
        END,
        reset_time = CASE
          WHEN rate_limit_hits.reset_time <= NOW()
            THEN NOW() + (${windowSecs} * INTERVAL '1 second')
          ELSE rate_limit_hits.reset_time
        END
      RETURNING hits, reset_time
    `);

    const row = (result as any).rows[0] as { hits: number; reset_time: Date };
    return {
      totalHits: row.hits,
      resetTime: new Date(row.reset_time),
    };
  }

  async decrement(rawKey: string): Promise<void> {
    const k = this.key(rawKey);
    await db.execute(sql`
      UPDATE rate_limit_hits
      SET hits = GREATEST(0, hits - 1)
      WHERE key = ${k}
    `);
  }

  async resetKey(rawKey: string): Promise<void> {
    const k = this.key(rawKey);
    await db.execute(sql`DELETE FROM rate_limit_hits WHERE key = ${k}`);
  }

  async resetAll(): Promise<void> {
    const namespace = this.prefix + ":";
    await db.execute(sql`
      DELETE FROM rate_limit_hits
      WHERE left(key, ${namespace.length}) = ${namespace}
    `);
  }
}
