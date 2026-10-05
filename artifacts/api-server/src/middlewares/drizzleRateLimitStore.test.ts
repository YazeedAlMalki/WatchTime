import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { DrizzleRateLimitStore } from "./drizzleRateLimitStore";
import { pruneExpiredRateLimitHits, RATE_LIMIT_CLEANUP_BATCH_SIZE } from "./rateLimitCleanup";

const prefixes: string[] = [];
const stores: DrizzleRateLimitStore[] = [];

function store() {
  const prefix = `restart_test_${randomUUID()}`;
  prefixes.push(prefix);
  const instance = new DrizzleRateLimitStore(prefix);
  stores.push(instance);
  return instance;
}

afterEach(async () => {
  for (const instance of stores.splice(0)) instance.shutdown();
  for (const prefix of prefixes.splice(0)) {
    await db.execute(sql`DELETE FROM rate_limit_hits WHERE key LIKE ${prefix + ":%"}`);
  }
});

describe("persistent rate limit store", () => {
  it("deletes expired counters across namespaces while preserving active windows", async () => {
    const first = store();
    const second = store();
    const active = await first.increment("active");
    await first.increment("active");
    await db.execute(sql`
      INSERT INTO rate_limit_hits (key, hits, reset_time) VALUES
        (${first.prefix + ":expired"}, 9, TIMESTAMP '1970-01-01'),
        (${second.prefix + ":expired"}, 7, TIMESTAMP '1970-01-01')
    `);
    await pruneExpiredRateLimitHits();
    const expired = await db.execute(sql`
      SELECT key FROM rate_limit_hits
      WHERE key IN (${first.prefix + ":expired"}, ${second.prefix + ":expired"})
    `);
    expect(expired.rows).toEqual([]);
    const preserved = await first.increment("active");
    expect(preserved.totalHits).toBe(3);
    expect(preserved.resetTime).toEqual(active.resetTime);
  });

  it("bounds each cleanup pass and supports concurrent cleanup instances", async () => {
    const instance = store();
    const size = RATE_LIMIT_CLEANUP_BATCH_SIZE * 2 + 1;
    await db.execute(sql`
      INSERT INTO rate_limit_hits (key, hits, reset_time)
      SELECT ${instance.prefix + ":"} || n, 1, TIMESTAMP '1970-01-01'
      FROM generate_series(1, ${size}) AS n
    `);
    const deleted = await Promise.all([
      pruneExpiredRateLimitHits(),
      pruneExpiredRateLimitHits(),
    ]);
    for (const count of deleted) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(RATE_LIMIT_CLEANUP_BATCH_SIZE);
    }
    const remaining = await db.execute(sql`
      SELECT key FROM rate_limit_hits WHERE key LIKE ${instance.prefix + ":%"}
    `);
    expect(remaining.rows.length).toBeGreaterThanOrEqual(1);
    expect(remaining.rows.length).toBeLessThan(size);
    await pruneExpiredRateLimitHits();
    expect((await db.execute(sql`
      SELECT key FROM rate_limit_hits WHERE key LIKE ${instance.prefix + ":%"}
    `)).rows).toEqual([]);
  });

  it("skips locked expired counters and preserves a concurrent renewal", async () => {
    const instance = store();
    const key = instance.prefix + ":client";
    await instance.increment("client");
    await db.execute(sql`
      UPDATE rate_limit_hits SET reset_time = TIMESTAMP '1970-01-01'
      WHERE key = ${key}
    `);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT key FROM rate_limit_hits WHERE key = $1 FOR UPDATE", [key]);
      await pruneExpiredRateLimitHits();
      expect((await client.query("SELECT hits FROM rate_limit_hits WHERE key = $1", [key])).rowCount)
        .toBe(1);
      await client.query(
        "UPDATE rate_limit_hits SET hits = 1, reset_time = NOW() + INTERVAL '1 minute' WHERE key = $1",
        [key],
      );
      await client.query("COMMIT");
      await pruneExpiredRateLimitHits();
      expect((await instance.increment("client")).totalHits).toBe(2);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("retains a feedback-style 429 after recreating the app and store", async () => {
    const persistentStore = store();
    const makeApp = (rateStore: DrizzleRateLimitStore) => {
      const app = express();
      app.post(
        "/api/feedback",
        rateLimit({
          windowMs: 60 * 60 * 1000,
          limit: 5,
          standardHeaders: "draft-7",
          legacyHeaders: false,
          keyGenerator: () => "same-client",
          store: rateStore,
        }),
        (_req, res) => res.sendStatus(201),
      );
      return app;
    };

    const firstInstance = makeApp(persistentStore);
    for (let n = 0; n < 5; n++) {
      expect((await supertest(firstInstance).post("/api/feedback")).status).toBe(201);
    }

    // A new limiter and store have no process-local counters, just as after restart.
    const restartedStore = new DrizzleRateLimitStore(persistentStore.prefix);
    stores.push(restartedStore);
    const restartedInstance = makeApp(restartedStore);
    const blocked = await supertest(restartedInstance).post("/api/feedback");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.ratelimit).toBeDefined();
  });

  it("atomically shares increments between instances and starts a new window on expiry", async () => {
    const first = store();
    const second = new DrizzleRateLimitStore(first.prefix);
    const hits = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second).increment("client"),
      ),
    );
    expect(hits.map((hit) => hit.totalHits).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 12 }, (_, index) => index + 1));

    const oldReset = hits[0].resetTime;
    expect(oldReset).toBeDefined();
    await db.execute(sql`
      UPDATE rate_limit_hits SET reset_time = NOW() - INTERVAL '1 second'
      WHERE key = ${first.prefix + ":client"}
    `);
    const renewed = await second.increment("client");
    expect(renewed.totalHits).toBe(1);
    expect(renewed.resetTime).toBeDefined();
    expect(renewed.resetTime!.getTime()).toBeGreaterThan(Date.now());

    await first.decrement("client");
    expect((await second.increment("client")).totalHits).toBe(1);
    await first.resetKey("client");
    expect((await second.increment("client")).totalHits).toBe(1);
    await second.increment("other-client");
    await first.resetAll();
    expect((await second.increment("client")).totalHits).toBe(1);
    expect((await second.increment("other-client")).totalHits).toBe(1);
  });
});