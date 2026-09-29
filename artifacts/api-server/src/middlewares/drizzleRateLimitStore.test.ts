import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { DrizzleRateLimitStore } from "./drizzleRateLimitStore";

const prefixes: string[] = [];

function store() {
  const prefix = `restart_test_${randomUUID()}`;
  prefixes.push(prefix);
  return new DrizzleRateLimitStore(prefix);
}

afterEach(async () => {
  for (const prefix of prefixes.splice(0)) {
    await db.execute(sql`DELETE FROM rate_limit_hits WHERE key LIKE ${prefix + ":%"}`);
  }
});

describe("persistent rate limit store", () => {
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
    const restartedInstance = makeApp(new DrizzleRateLimitStore(persistentStore.prefix));
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