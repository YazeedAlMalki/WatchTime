/**
 * Integration tests: My Shows data stays in sync across clients.
 *
 * Both the web app and the mobile app call the same API server endpoints
 * (POST /api/episodes/:id/watched, GET /api/me/shows, etc.). This test
 * confirms that marking an episode watched via one client is immediately
 * visible to any other client fetching from the same API — no extra sync
 * layer is needed because the server is the single source of truth.
 *
 * Strategy:
 *  - Mock auth so requests run without Clerk tokens.
 *  - Seed a title with a small episode set.
 *  - Mark episodes watched via the POST route (simulating one client).
 *  - Call GET /api/me/shows (simulating the other client) and assert the
 *    returned progress exactly reflects the marks made.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

const SYNC_USER_ID = "test-sync-user-001";

vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = SYNC_USER_ID;
    req.isAdmin = true;
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = SYNC_USER_ID;
    next();
  },
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
  getAuth: () => ({ userId: SYNC_USER_ID }),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: { emailAddress: "sync-test@test.com" },
        firstName: "Sync", lastName: "Test",
      }),
    },
  },
}));

vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

import supertest from "supertest";
import app from "../app";
import {
  db,
  usersTable,
  titlesTable,
  episodesTable,
  watchedEpisodesTable,
  watchedTitlesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

// ─── Seed data ────────────────────────────────────────────────────────────────

let titleId: number;
let episodeIds: number[] = [];

beforeAll(async () => {
  await db
    .insert(usersTable)
    .values({ id: SYNC_USER_ID, email: "sync-test@test.com", name: "Sync Test", isAdmin: false })
    .onConflictDoNothing();

  const [title] = await db
    .insert(titlesTable)
    .values({ name: "__sync_test_show__", type: "tv", popularity: 0 })
    .returning();
  titleId = title.id;

  const eps = await db
    .insert(episodesTable)
    .values([
      { titleId, seasonNumber: 1, episodeNumber: 1, name: "Pilot" },
      { titleId, seasonNumber: 1, episodeNumber: 2, name: "Episode 2" },
      { titleId, seasonNumber: 1, episodeNumber: 3, name: "Episode 3" },
      { titleId, seasonNumber: 1, episodeNumber: 4, name: "Episode 4" },
    ])
    .returning({ id: episodesTable.id });
  episodeIds = eps.map(e => e.id);
});

afterAll(async () => {
  await db
    .delete(watchedEpisodesTable)
    .where(and(eq(watchedEpisodesTable.userId, SYNC_USER_ID), eq(watchedEpisodesTable.titleId, titleId)));
  await db
    .delete(watchedTitlesTable)
    .where(and(eq(watchedTitlesTable.userId, SYNC_USER_ID), eq(watchedTitlesTable.titleId, titleId)));
  await db.delete(episodesTable).where(eq(episodesTable.titleId, titleId));
  await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  await db.delete(usersTable).where(eq(usersTable.id, SYNC_USER_ID));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("My Shows cross-client sync", () => {
  it("marking an episode on one client is immediately visible to another fetching GET /api/me/shows", async () => {
    // Simulate web client: mark episodes 1 and 2 watched.
    const mark1 = await supertest(app)
      .post(`/api/episodes/${episodeIds[0]}/watched`)
      .send({});
    expect(mark1.status).toBe(200);

    const mark2 = await supertest(app)
      .post(`/api/episodes/${episodeIds[1]}/watched`)
      .send({});
    expect(mark2.status).toBe(200);

    // Simulate mobile client: fetch My Shows — the show must appear with
    // watchedEpisodes = 2 and the next episode pointing at episode 3.
    const shows = await supertest(app).get("/api/me/shows");
    expect(shows.status).toBe(200);

    const tracked = (shows.body as any[]).find(s => s.title.id === titleId);
    expect(tracked).toBeDefined();
    expect(tracked.watchedEpisodes).toBe(2);
    expect(tracked.totalEpisodes).toBe(4);
    expect(tracked.nextEpisode).not.toBeNull();
    expect(tracked.nextEpisode.episodeNumber).toBe(3);
  });

  it("marking the next episode on mobile advances nextEpisode for the web client", async () => {
    // Simulate mobile client: mark episode 3 watched.
    const mark3 = await supertest(app)
      .post(`/api/episodes/${episodeIds[2]}/watched`)
      .send({});
    expect(mark3.status).toBe(200);

    // Simulate web client: re-fetch My Shows — next episode must now be 4.
    const shows = await supertest(app).get("/api/me/shows");
    expect(shows.status).toBe(200);

    const tracked = (shows.body as any[]).find(s => s.title.id === titleId);
    expect(tracked).toBeDefined();
    expect(tracked.watchedEpisodes).toBe(3);
    expect(tracked.nextEpisode?.episodeNumber).toBe(4);
  });

  it("marking the final episode shows the show as caught up on both clients", async () => {
    // Simulate mobile: mark episode 4.
    const mark4 = await supertest(app)
      .post(`/api/episodes/${episodeIds[3]}/watched`)
      .send({});
    expect(mark4.status).toBe(200);

    // Both clients see caught up (nextEpisode is null).
    const shows = await supertest(app).get("/api/me/shows");
    expect(shows.status).toBe(200);

    const tracked = (shows.body as any[]).find(s => s.title.id === titleId);
    expect(tracked).toBeDefined();
    expect(tracked.watchedEpisodes).toBe(4);
    expect(tracked.totalEpisodes).toBe(4);
    expect(tracked.nextEpisode).toBeNull();
  });

  it("unmarking an episode on web is immediately reflected for a mobile fetch", async () => {
    // Simulate web client: unmark episode 4.
    const unmark = await supertest(app)
      .delete(`/api/episodes/${episodeIds[3]}/watched`);
    expect(unmark.status).toBe(200);

    // Mobile client: episode 4 should be the next episode again.
    const shows = await supertest(app).get("/api/me/shows");
    expect(shows.status).toBe(200);

    const tracked = (shows.body as any[]).find(s => s.title.id === titleId);
    expect(tracked).toBeDefined();
    expect(tracked.watchedEpisodes).toBe(3);
    expect(tracked.nextEpisode?.episodeNumber).toBe(4);
  });
});
