import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_A = "test-mood-discovery-user-a";
const USER_B = "test-mood-discovery-user-b";

vi.mock("../middlewares/auth", () => ({
  requireAdmin: (_req: any, res: any) => res.status(403).json({ error: "Forbidden" }),
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.get("x-test-user");
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    req.userId = userId;
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }),
  },
}));
vi.mock("pino-http", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

import supertest from "supertest";
import app from "../app";
import { db, moodDiscoveryStateTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const emptyState = {
  saved: [],
  savedContext: {},
  dismissed: [],
  viewed: {},
  feedback: {},
};

beforeAll(async () => {
  await db.insert(usersTable).values([
    { id: USER_A, email: "mood-a@example.test", isAdmin: false },
    { id: USER_B, email: "mood-b@example.test", isAdmin: false },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(moodDiscoveryStateTable).where(inArray(moodDiscoveryStateTable.userId, [USER_A, USER_B]));
  await db.delete(usersTable).where(inArray(usersTable.id, [USER_A, USER_B]));
});

describe("cross-device mood discovery state", () => {
  it("keeps personal state private and rejects stale concurrent revisions", async () => {
    expect((await supertest(app).get("/api/me/mood-discovery")).status).toBe(401);

    const firstRead = await supertest(app)
      .get("/api/me/mood-discovery")
      .set("x-test-user", USER_A);
    expect(firstRead.status).toBe(200);
    expect(firstRead.body).toEqual({ state: emptyState, revision: 0 });

    const state = {
      saved: ["summer-bakery"],
      savedContext: {
        "summer-bakery": {
          preset: "comfort",
          savedAt: 1_750_000_000_000,
          filters: { context: "solo", maxRuntime: 120 },
        },
      },
      dismissed: ["moonlit-library"],
      viewed: {
        "summer-bakery": {
          lastViewedAt: 1_750_000_000_001,
          watched: true,
          rating: 4,
          feedback: [],
        },
      },
      feedback: { "summer-bakery": ["hideSimilar"] },
    };

    const saved = await supertest(app)
      .put("/api/me/mood-discovery")
      .set("x-test-user", USER_A)
      .send({ expectedRevision: 0, state });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ state, revision: 1, accepted: true });

    const secondClientRead = await supertest(app)
      .get("/api/me/mood-discovery")
      .set("x-test-user", USER_A);
    expect(secondClientRead.body).toEqual({ state, revision: 1 });

    const otherUserRead = await supertest(app)
      .get("/api/me/mood-discovery")
      .set("x-test-user", USER_B);
    expect(otherUserRead.body).toEqual({ state: emptyState, revision: 0 });

    const invalid = await supertest(app)
      .put("/api/me/mood-discovery")
      .set("x-test-user", USER_A)
      .send({
        expectedRevision: 1,
        state: {
          ...state,
          viewed: { item: { lastViewedAt: 1, watched: true, rating: 6, feedback: [] } },
        },
      });
    expect(invalid.status).toBe(400);

    const mobileEdit = { ...state, saved: [...state.saved, "mobile-pick"] };
    const webEdit = { ...state, saved: [...state.saved, "web-pick"] };
    const competingWrites = await Promise.all([
      supertest(app)
        .put("/api/me/mood-discovery")
        .set("x-test-user", USER_A)
        .send({ expectedRevision: 1, state: mobileEdit }),
      supertest(app)
        .put("/api/me/mood-discovery")
        .set("x-test-user", USER_A)
        .send({ expectedRevision: 1, state: webEdit }),
    ]);
    expect(competingWrites.map((response) => response.body.accepted).sort()).toEqual([false, true]);
    const winner = competingWrites.find((response) => response.body.accepted)!.body;
    const loser = competingWrites.find((response) => !response.body.accepted)!.body;
    expect(winner.revision).toBe(2);
    expect(loser.revision).toBe(2);
    expect(loser.state).toEqual(winner.state);
    expect(["mobile-pick", "web-pick"].some((id) => winner.state.saved.includes(id))).toBe(true);

    const removed = await supertest(app)
      .put("/api/me/mood-discovery")
      .set("x-test-user", USER_A)
      .send({ expectedRevision: 2, state: { ...emptyState, viewed: state.viewed } });
    expect(removed.body).toMatchObject({ revision: 3, accepted: true });
    const finalRead = await supertest(app).get("/api/me/mood-discovery").set("x-test-user", USER_A);
    expect(finalRead.body).toEqual({
      state: { ...emptyState, viewed: state.viewed },
      revision: 3,
    });
  });
});
