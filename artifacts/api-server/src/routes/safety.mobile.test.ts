/**
 * Integration tests: safety reports and contributions submitted from the mobile
 * app flow reach the admin moderation queue.
 *
 * Strategy:
 *  - Mock requireAuth so tests run without Clerk tokens (mirrors what the mobile
 *    client does — it sends a Bearer token; here we short-circuit at the
 *    middleware boundary exactly as the audit-log tests do).
 *  - Use the real database so inserts and selects reflect actual behaviour.
 *  - Happy-path tests POST a report / contribution then confirm the record is
 *    visible in the admin GET /api/admin/reports and /api/admin/contributions
 *    queues respectively.
 *  - Rate-limit tests verify the endpoint returns 429 with an error body that
 *    the mobile SafetyReportModal / SafetyContributeModal can detect via
 *    `err?.response?.status === 429`.
 *  - Eligibility tests verify the 403 path for contributions (< 5 watched
 *    items) returns the error body the mobile UI inspects.
 *
 * Mobile Alert copy (confirmed against artifacts/watchtime-mobile/app/title/[id].tsx):
 *   Report 429  → "You've submitted too many reports recently. Please wait before trying again."
 *   Contribute 429 → "You've reached the daily contribution limit. Try again tomorrow."
 *   Contribute 403 → "You need to watch at least 5 titles or episodes before contributing."
 */

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

// ─── Stable test identities ──────────────────────────────────────────────────
const MOBILE_USER_ID = "test-mobile-safety-user-001";
const ADMIN_USER_ID = "test-mobile-safety-admin-001";

// ─── Mock auth so requireAuth / requireAdmin just stamp req.userId ────────────
vi.mock("../middlewares/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = MOBILE_USER_ID;
    next();
  },
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = ADMIN_USER_ID;
    req.isAdmin = true;
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// ─── Rate-limiter mocks — pass-through by default; individual tests can
//     override with mockImplementationOnce to simulate a 429 response. ────────
const mockReportRateLimit = vi.fn((_req: any, _res: any, next: any) => next());
const mockContributionRateLimit = vi.fn((_req: any, _res: any, next: any) => next());

vi.mock("../middlewares/rateLimiters", () => ({
  safetyReportRateLimit: (req: any, res: any, next: any) =>
    mockReportRateLimit(req, res, next),
  safetyContributionRateLimit: (req: any, res: any, next: any) =>
    mockContributionRateLimit(req, res, next),
  feedbackRateLimit: (_req: any, _res: any, next: any) => next(),
}));

// ─── Silence pino logger ─────────────────────────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

vi.mock("pino-http", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: MOBILE_USER_ID }),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: "mobile@test.com" },
        firstName: "Mobile",
        lastName: "User",
      }),
    },
  },
}));

vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

// ─── Import app + DB AFTER mocks ──────────────────────────────────────────────
import supertest from "supertest";
import app from "../app";
import {
  db,
  usersTable,
  titlesTable,
  reportsTable,
  contributionsTable,
  watchedEpisodesTable,
  watchedTitlesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── Global fixtures ──────────────────────────────────────────────────────────

let titleId: number;
/** Five extra titles used as distinct watched-title entries for the eligibility gate. */
const eligibilityTitleIds: number[] = [];

beforeAll(async () => {
  // Ensure both the mobile user and admin user rows exist.
  await db
    .insert(usersTable)
    .values([
      { id: MOBILE_USER_ID, email: "mobile@test.com", name: "Mobile User", isAdmin: false },
      { id: ADMIN_USER_ID, email: "admin-mobile-test@test.com", name: "Admin User", isAdmin: false },
    ])
    .onConflictDoNothing();

  // Insert the primary test title for reports/contributions.
  const [t] = await db
    .insert(titlesTable)
    .values({ name: "__mobile_safety_test_title__", type: "tv", popularity: 0 })
    .returning();
  titleId = t.id;

  // Insert 5 extra titles that the test user can "watch" to satisfy the
  // eligibility gate (watchedTitlesTable has a unique (userId, titleId) index,
  // so we need distinct titleIds).
  for (let i = 1; i <= 5; i++) {
    const [et] = await db
      .insert(titlesTable)
      .values({ name: `__mobile_safety_elig_title_${i}__`, type: "movie", popularity: 0 })
      .returning();
    eligibilityTitleIds.push(et.id);
  }
});

afterAll(async () => {
  // Cascade deletes contributions, reports, and watched records via FK.
  await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  for (const etId of eligibilityTitleIds) {
    await db.delete(titlesTable).where(eq(titlesTable.id, etId));
  }
  await db.delete(usersTable).where(eq(usersTable.id, MOBILE_USER_ID));
  await db.delete(usersTable).where(eq(usersTable.id, ADMIN_USER_ID));
});

// ─── POST /api/titles/:id/safety/reports ─────────────────────────────────────

describe("POST /api/titles/:id/safety/reports (mobile flow)", () => {
  const createdReportIds: number[] = [];

  afterEach(async () => {
    for (const id of createdReportIds) {
      await db.delete(reportsTable).where(eq(reportsTable.id, id));
    }
    createdReportIds.length = 0;
  });

  it("creates a report and it appears in the admin queue with status 'open'", async () => {
    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .send({
        reason: "incorrect_info",
        sourceName: "Common Sense Media",
        details: "The violence rating is too low for this episode.",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.titleId).toBe(titleId);
    expect(res.body.reason).toBe("incorrect_info");
    expect(res.body.sourceName).toBe("Common Sense Media");
    expect(res.body.status).toBe("open");
    createdReportIds.push(res.body.id);

    // Verify the record appears in the admin reports queue.
    const adminRes = await supertest(app).get("/api/admin/reports");
    expect(adminRes.status).toBe(200);

    const found = adminRes.body.find((r: any) => r.id === res.body.id);
    expect(found).toBeDefined();
    expect(found.titleId).toBe(titleId);
    expect(found.reason).toBe("incorrect_info");
    expect(found.sourceName).toBe("Common Sense Media");
    expect(found.status).toBe("open");
  });

  it("creates a report with only the required reason field", async () => {
    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .send({ reason: "wrong_title" });

    expect(res.status).toBe(201);
    expect(res.body.reason).toBe("wrong_title");
    expect(res.body.sourceName).toBeNull();
    expect(res.body.details).toBeNull();
    expect(res.body.status).toBe("open");
    createdReportIds.push(res.body.id);

    // Confirm it surfaces in the admin queue filtered to open status.
    const adminRes = await supertest(app).get("/api/admin/reports?status=open");
    expect(adminRes.status).toBe(200);
    const found = adminRes.body.find((r: any) => r.id === res.body.id);
    expect(found).toBeDefined();
    expect(found.titleId).toBe(titleId);
  });

  it("returns 400 when reason is missing", async () => {
    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .send({ details: "no reason provided" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent title", async () => {
    const res = await supertest(app)
      .post("/api/titles/999999999/safety/reports")
      .send({ reason: "other" });

    expect(res.status).toBe(404);
  });

  it("returns 429 when the rate limit is exceeded — mobile shows correct Alert copy", async () => {
    // Simulate the rate limiter firing (mobile SafetyReportModal checks
    // err?.response?.status === 429 and shows:
    // "You've submitted too many reports recently. Please wait before trying again.")
    mockReportRateLimit.mockImplementationOnce((_req: any, res: any) => {
      res.status(429).json({
        error: "Too many safety reports. Please wait before submitting another.",
      });
    });

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/reports`)
      .send({ reason: "outdated_info" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many/i);
  });
});

// ─── POST /api/titles/:id/safety/contributions ────────────────────────────────

describe("POST /api/titles/:id/safety/contributions (mobile flow)", () => {
  const createdContributionIds: number[] = [];
  const watchedTitleRowIds: number[] = [];

  afterEach(async () => {
    for (const id of createdContributionIds) {
      await db.delete(contributionsTable).where(eq(contributionsTable.id, id));
    }
    createdContributionIds.length = 0;

    // Remove watched title rows added for eligibility.
    for (const id of watchedTitleRowIds) {
      await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.id, id));
    }
    watchedTitleRowIds.length = 0;
  });

  /** Insert one watched-title row per eligibility title so the mobile user
   *  passes the CONTRIBUTION_THRESHOLD (5) gate.  Each title is distinct so
   *  the unique (userId, titleId) index is never violated. */
  async function grantEligibility() {
    for (const etId of eligibilityTitleIds) {
      const [row] = await db
        .insert(watchedTitlesTable)
        .values({ userId: MOBILE_USER_ID, titleId: etId })
        .onConflictDoNothing()
        .returning();
      if (row) watchedTitleRowIds.push(row.id);
    }
  }

  it("creates a contribution and it appears in the admin queue with status 'pending'", async () => {
    await grantEligibility();

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({
        category: "Violence",
        severity: "moderate",
        description: "Several intense action sequences in episodes 3–5.",
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.titleId).toBe(titleId);
    expect(res.body.category).toBe("Violence");
    expect(res.body.severity).toBe("moderate");
    expect(res.body.description).toBe("Several intense action sequences in episodes 3–5.");
    expect(res.body.status).toBe("pending");
    createdContributionIds.push(res.body.id);

    // Verify the record appears in the admin contributions queue.
    const adminRes = await supertest(app).get("/api/admin/contributions");
    expect(adminRes.status).toBe(200);

    const found = adminRes.body.find((c: any) => c.id === res.body.id);
    expect(found).toBeDefined();
    expect(found.titleId).toBe(titleId);
    expect(found.category).toBe("Violence");
    expect(found.severity).toBe("moderate");
    expect(found.status).toBe("pending");
  });

  it("creates a contribution with optional season/episode fields preserved", async () => {
    await grantEligibility();

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({
        category: "Language",
        severity: "mild",
        seasonNumber: 2,
        episodeNumber: 4,
        description: null,
      });

    expect(res.status).toBe(201);
    expect(res.body.seasonNumber).toBe(2);
    expect(res.body.episodeNumber).toBe(4);
    expect(res.body.description).toBeNull();
    createdContributionIds.push(res.body.id);

    // Confirm it surfaces in the admin queue filtered to pending status.
    const adminRes = await supertest(app).get("/api/admin/contributions?status=pending");
    expect(adminRes.status).toBe(200);
    const found = adminRes.body.find((c: any) => c.id === res.body.id);
    expect(found).toBeDefined();
    expect(found.seasonNumber).toBe(2);
    expect(found.episodeNumber).toBe(4);
  });

  it("returns 403 when the user has fewer than 5 watched items — mobile shows eligibility Alert", async () => {
    // No watched records inserted: user has 0 watched items, below threshold.
    // Mobile SafetyContributeModal checks status === 403 and shows:
    // "You need to watch at least 5 titles or episodes before contributing."
    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Drugs", severity: "mild" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/5/); // threshold value present in message
  });

  it("returns 400 when required fields are missing", async () => {
    await grantEligibility();

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Violence" }); // severity missing

    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent title", async () => {
    await grantEligibility();

    const res = await supertest(app)
      .post("/api/titles/999999999/safety/contributions")
      .send({ category: "Violence", severity: "mild" });

    expect(res.status).toBe(404);
  });

  it("returns 429 when the daily contribution rate limit is exceeded — mobile shows correct Alert copy", async () => {
    // Simulate the rate limiter firing (mobile SafetyContributeModal checks
    // status === 429 and shows:
    // "You've reached the daily contribution limit. Try again tomorrow.")
    mockContributionRateLimit.mockImplementationOnce((_req: any, res: any) => {
      res.status(429).json({
        error: "Daily contribution limit reached. You can submit more contributions tomorrow.",
      });
    });

    await grantEligibility();

    const res = await supertest(app)
      .post(`/api/titles/${titleId}/safety/contributions`)
      .send({ category: "Violence", severity: "moderate" });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/limit/i);
  });
});
