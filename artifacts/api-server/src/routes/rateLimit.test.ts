/**
 * Integration tests: rate limiters block spam before it reaches admins.
 *
 * Strategy:
 *  - Mock the rateLimiters module to use low limits (limit: 1) with the default
 *    in-memory store for test isolation.
 *  - Use a unique key per test so tests never interfere with each other.
 *  - Assert that the (limit+1)th request gets 429 with correct headers and body.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import rateLimit from "express-rate-limit";

// ─── Mock rate limiters with limit=1, in-memory, skip=false ──────────────────
// Each call to the factory creates a fresh store, giving each test file its own counters.
vi.mock("../middlewares/rateLimiters", () => ({
  feedbackRateLimit: rateLimit({
    windowMs: 60_000,
    limit: 1,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req: any) => req.headers["x-test-key"] ?? req.ip ?? "test",
    message: { error: "Too many feedback submissions. Please wait before trying again." },
  }),
  publicStatsRateLimit: rateLimit({
    windowMs: 60_000,
    limit: 1,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req: any) => req.headers["x-test-key"] ?? req.ip ?? "test",
    message: { error: "Too many stats requests. Please wait before trying again." },
  }),
  safetyReportRateLimit: rateLimit({
    windowMs: 60_000,
    limit: 1,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req: any) => req.headers["x-test-key"] ?? (req as any).userId ?? req.ip ?? "test",
    message: { error: "Too many safety reports. Please wait before submitting another." },
  }),
  safetyContributionRateLimit: rateLimit({
    windowMs: 60_000,
    limit: 1,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req: any) => req.headers["x-test-key"] ?? (req as any).userId ?? req.ip ?? "test",
    message: { error: "Daily contribution limit reached. You can submit more contributions tomorrow." },
  }),
  // Other routers are mounted in the same app; pass through their limits so
  // this focused suite can still construct the complete route tree.
  importCreateRateLimit: (_req: any, _res: any, next: any) => next(),
  importConfirmRateLimit: (_req: any, _res: any, next: any) => next(),
}));

// ─── Silence logger + clerk mocks ────────────────────────────────────────────
const RATE_USER_ID = "test-ratelimit-user-001";

vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => { req.userId = RATE_USER_ID; req.isAdmin = true; next(); },
  requireAuth:  (req: any, _res: any, next: any) => { req.userId = RATE_USER_ID; next(); },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), error: vi.fn(), warn: vi.fn(),
    debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }),
  },
}));

vi.mock("pino-http", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: RATE_USER_ID }),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: "ratelimit@test.com" },
        firstName: "Rate", lastName: "Test",
      }),
    },
  },
}));

vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Import app + DB after mocks ─────────────────────────────────────────────
import supertest from "supertest";
import app from "../app";
import { db, usersTable, titlesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

let titleId: number;

beforeAll(async () => {
  await db.insert(usersTable)
    .values({ id: RATE_USER_ID, email: "ratelimit@test.com", name: "Rate Test", isAdmin: false })
    .onConflictDoNothing();

  const [t] = await db.insert(titlesTable)
    .values({ name: "__rate_limit_test__", type: "movie", popularity: 0 })
    .returning();
  titleId = t.id;
});

afterAll(async () => {
  await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  await db.delete(usersTable).where(eq(usersTable.id, RATE_USER_ID));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Assert the 429 response is well-formed: correct JSON body and RateLimit headers. */
function assert429(res: supertest.Response, expectedMessage: string) {
  expect(res.status).toBe(429);
  expect(res.body).toHaveProperty("error");
  expect(res.body.error).toBe(expectedMessage);

  // express-rate-limit draft-7 sends at least one of these header forms.
  const headers = res.headers as Record<string, string>;
  const hasRateLimitHeader =
    "ratelimit-limit" in headers ||
    "ratelimit" in headers ||
    "x-ratelimit-limit" in headers;
  expect(hasRateLimitHeader).toBe(true);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/feedback — rate limit", () => {
  it("allows the first request and blocks the second with 429", async () => {
    // Use a unique X-Test-Key so this test's counter is isolated.
    const key = `feedback-rl-test-${Date.now()}`;

    const first = await supertest(app)
      .post("/api/feedback")
      .set("X-Test-Key", key)
      .send({ category: "general", message: "hello world" });

    // First request: should succeed (201) or fail for other reasons (not 429).
    expect(first.status).not.toBe(429);

    const second = await supertest(app)
      .post("/api/feedback")
      .set("X-Test-Key", key)
      .send({ category: "general", message: "second attempt" });

    assert429(second, "Too many feedback submissions. Please wait before trying again.");
  });
});

describe("GET /api/stats/public — rate limit", () => {
  it("allows the first request and blocks the second with 429", async () => {
    const key = `stats-rl-test-${Date.now()}`;

    const first = await supertest(app)
      .get("/api/stats/public")
      .set("X-Test-Key", key);

    expect(first.status).toBe(200);

    const second = await supertest(app)
      .get("/api/stats/public")
      .set("X-Test-Key", key);

    assert429(second, "Too many stats requests. Please wait before trying again.");
  });
});

describe("POST /api/titles/:id/safety/reports — rate limit", () => {
  it("allows the first request and blocks the second with 429", async () => {
    const key = `report-rl-test-${Date.now()}`;

    const first = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .set("X-Test-Key", key)
      .send({ reason: "inaccurate data" });

    expect(first.status).not.toBe(429);

    const second = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .set("X-Test-Key", key)
      .send({ reason: "another report" });

    assert429(second, "Too many safety reports. Please wait before submitting another.");
  });
});

describe("POST /api/titles/:id/safety/contributions — rate limit", () => {
  it("blocks the second request with 429 regardless of eligibility check", async () => {
    // The rate limiter runs before the contribution-eligibility check, so the
    // second request is blocked at the middleware layer (429) even if the user
    // doesn't have enough watched episodes to actually submit a contribution.
    const key = `contribution-rl-test-${Date.now()}`;

    const first = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .set("X-Test-Key", key)
      .send({ category: "violence", severity: "mild" });

    // First request either succeeds (201) or fails eligibility (403) — not 429.
    expect(first.status).not.toBe(429);

    const second = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .set("X-Test-Key", key)
      .send({ category: "violence", severity: "mild" });

    assert429(second, "Daily contribution limit reached. You can submit more contributions tomorrow.");
  });
});
