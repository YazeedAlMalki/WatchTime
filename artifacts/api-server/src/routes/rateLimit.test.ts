import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import express from "express";
import { and, eq, like } from "drizzle-orm";
import {
  db,
  contributionsTable,
  feedbackTable,
  reportsTable,
  titlesTable,
  usersTable,
  watchedTitlesTable,
} from "@workspace/db";

// Substitute only the persistent store: the routes still load the real limiter
// configurations, including their keys, windows, limits, headers and messages.
const stores = vi.hoisted(() => [] as Array<{ resetAll: () => void }>);
vi.mock("../middlewares/drizzleRateLimitStore", async () => {
  const { MemoryStore } = await import("express-rate-limit");
  return {
    DrizzleRateLimitStore: class extends MemoryStore {
      constructor(_prefix: string) {
        super();
        stores.push(this);
      }
    },
  };
});

const USER_ID = "test-spam-limits-user";
vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => { req.userId = USER_ID; next(); },
  requireAuth: (req: any, _res: any, next: any) => { req.userId = USER_ID; next(); },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
    trace: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }),
  },
}));
vi.mock("pino-http", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: USER_ID }),
  clerkClient: { users: { getUser: async () => ({ primaryEmailAddress: { emailAddress: "spam-limits@test.com" } }) } },
}));
vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

import miscRouter from "./misc";
import safetyRouter from "./safety";

const app = express();
app.use(express.json());
app.use("/api", miscRouter, safetyRouter);

let titleId: number;
const eligibilityTitleIds: number[] = [];
const feedbackMessage = "rate-limit-integration: feedback";

beforeAll(async () => {
  await db.insert(usersTable).values({
    id: USER_ID, email: "spam-limits@test.com", name: "Spam Limit Test", isAdmin: false,
  }).onConflictDoNothing();
  const [title] = await db.insert(titlesTable)
    .values({ name: "__spam_limit_test__", type: "movie", popularity: 0 }).returning();
  titleId = title.id;
  for (let i = 0; i < 5; i++) {
    const [watchedTitle] = await db.insert(titlesTable)
      .values({ name: `__spam_limit_eligibility_${i}__`, type: "movie", popularity: 0 }).returning();
    eligibilityTitleIds.push(watchedTitle.id);
    await db.insert(watchedTitlesTable).values({ userId: USER_ID, titleId: watchedTitle.id });
  }
});

beforeEach(() => {
  for (const store of stores) store.resetAll();
});

afterEach(async () => {
  await db.delete(feedbackTable).where(like(feedbackTable.message, "rate-limit-integration:%"));
  await db.delete(reportsTable).where(and(eq(reportsTable.userId, USER_ID), eq(reportsTable.titleId, titleId)));
  await db.delete(contributionsTable).where(and(eq(contributionsTable.userId, USER_ID), eq(contributionsTable.titleId, titleId)));
});

afterAll(async () => {
  await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.userId, USER_ID));
  await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  for (const id of eligibilityTitleIds) await db.delete(titlesTable).where(eq(titlesTable.id, id));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
});

function expectBlocked(res: supertest.Response, limit: number, message: string) {
  expect(res.status).toBe(429);
  expect(res.body).toEqual({ error: message });
  expect(res.headers["x-ratelimit-limit"]).toBe(String(limit));
  expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  expect(Number(res.headers["x-ratelimit-reset"])).toBeGreaterThan(Math.floor(Date.now() / 1000));
}

describe("submission spam limits", () => {
  it("accepts five feedback requests from one IP, then blocks the sixth", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await supertest(app).post("/api/feedback")
        .send({ category: "general", message: feedbackMessage });
      expect(res.status).toBe(201);
    }
    const blocked = await supertest(app).post("/api/feedback")
      .send({ category: "general", message: feedbackMessage });
    expectBlocked(blocked, 5, "Too many feedback submissions. Please wait before trying again.");
    const saved = await db.select().from(feedbackTable).where(eq(feedbackTable.message, feedbackMessage));
    expect(saved).toHaveLength(5);
  });

  it("accepts ten reports from one user, then blocks the eleventh", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await supertest(app).post(`/api/titles/${titleId}/safety/reports`)
        .send({ reason: "other" });
      expect(res.status).toBe(201);
    }
    const blocked = await supertest(app).post(`/api/titles/${titleId}/safety/reports`)
      .send({ reason: "other" });
    expectBlocked(blocked, 10, "Too many safety reports. Please wait before submitting another.");
    const saved = await db.select().from(reportsTable)
      .where(and(eq(reportsTable.userId, USER_ID), eq(reportsTable.titleId, titleId)));
    expect(saved).toHaveLength(10);
  });

  it("accepts twenty contributions from one user, then blocks the twenty-first", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await supertest(app).post(`/api/titles/${titleId}/safety/contributions`)
        .send({ category: "violence", severity: "mild" });
      expect(res.status).toBe(201);
    }
    const blocked = await supertest(app).post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "violence", severity: "mild" });
    expectBlocked(blocked, 20, "Daily contribution limit reached. You can submit more contributions tomorrow.");
    const saved = await db.select().from(contributionsTable)
      .where(and(eq(contributionsTable.userId, USER_ID), eq(contributionsTable.titleId, titleId)));
    expect(saved).toHaveLength(20);
  });
});