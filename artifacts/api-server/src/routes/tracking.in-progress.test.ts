import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-in-progress-collection";
vi.mock("../middlewares/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = USER_ID; next(); },
  requireAdmin: (_req: any, res: any) => res.sendStatus(403),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }) },
}));
vi.mock("pino-http", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("@clerk/express", () => ({ clerkMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

import supertest from "supertest";
import app from "../app";
import { db, episodesTable, titlesTable, usersTable, watchedEpisodesTable, watchedTitlesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

let titleIds: number[] = [];
let episodeIds: number[] = [];

async function page(path: string, beforeId?: number) {
  const response = await supertest(app).get(`/api/me/shows${path}`).query({
    limit: 24,
    ...(beforeId === undefined ? {} : { beforeId }),
  });
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("private, no-cache");
  return response.body as { title: { id: number }; watchedEpisodes: number; nextEpisode: { id: number } | null }[];
}

const ids = (rows: Awaited<ReturnType<typeof page>>) => rows.map(row => row.title.id);

beforeAll(async () => {
  await db.insert(usersTable).values({ id: USER_ID, email: "in-progress-pagination@example.test" }).onConflictDoNothing();
  titleIds = (await db.insert(titlesTable).values(
    Array.from({ length: 70 }, (_, i) => ({ name: `__progress_page_${i}__`, type: "tv" as const })),
  ).returning({ id: titlesTable.id })).map(row => row.id);
  episodeIds = (await db.insert(episodesTable).values(
    titleIds.flatMap(titleId => [1, 2].map(episodeNumber => ({
      titleId, seasonNumber: 1, episodeNumber, name: `Episode ${episodeNumber}`,
    }))),
  ).returning({ id: episodesTable.id })).map(row => row.id);
  await db.insert(watchedTitlesTable).values(titleIds.map(titleId => ({ userId: USER_ID, titleId })));
  await db.insert(watchedEpisodesTable).values(
    titleIds.slice(0, 26).map((titleId, i) => ({
      userId: USER_ID, titleId, episodeId: episodeIds[i * 2],
    })),
  );
});

afterAll(async () => {
  await db.delete(watchedEpisodesTable).where(eq(watchedEpisodesTable.userId, USER_ID));
  await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.userId, USER_ID));
  await db.delete(episodesTable).where(inArray(episodesTable.titleId, titleIds));
  await db.delete(titlesTable).where(inArray(titlesTable.id, titleIds));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
});

describe("in-progress show discovery across large libraries", () => {
  it("finds older in-progress titles on separate pages before loading the full library", async () => {
    const fullFirst = await page("");
    expect(ids(fullFirst)).toEqual(titleIds.slice(-24).reverse());
    const progressFirst = await page("/in-progress");
    expect(ids(progressFirst)).toEqual(titleIds.slice(2, 26).reverse());
    expect(progressFirst[0]).toMatchObject({ watchedEpisodes: 1, nextEpisode: { id: episodeIds[51] } });
    const progressSecond = await page("/in-progress", ids(progressFirst).at(-1));
    expect(ids(progressSecond)).toEqual(titleIds.slice(0, 2).reverse());
    expect(new Set([...ids(fullFirst), ...ids(progressFirst), ...ids(progressSecond)]).size).toBe(50);
  });

  it("uses immutable IDs even if progress changes between requests", async () => {
    const fullFirst = await page("");
    const progressFirst = await page("/in-progress");
    // A newer title becomes eligible, one already-seen title completes, and an
    // older, not-yet-seen title completes. None can move across an ID cursor.
    await db.insert(watchedEpisodesTable).values([
      { userId: USER_ID, titleId: titleIds[69], episodeId: episodeIds[138] },
      { userId: USER_ID, titleId: titleIds[25], episodeId: episodeIds[51] },
      { userId: USER_ID, titleId: titleIds[1], episodeId: episodeIds[3] },
    ]);
    const fullSecond = await page("", ids(fullFirst).at(-1));
    expect(ids(fullSecond)).toEqual(titleIds.slice(22, 46).reverse());
    const fullThird = await page("", ids(fullSecond).at(-1));
    const fullFourth = await page("", ids(fullThird).at(-1));
    const allFullIds = [...ids(fullFirst), ...ids(fullSecond), ...ids(fullThird), ...ids(fullFourth)];
    expect(allFullIds).toEqual([...titleIds].reverse());
    expect(new Set(allFullIds).size).toBe(70);
    const progressSecond = await page("/in-progress", ids(progressFirst).at(-1));
    expect(ids(progressSecond)).toEqual([titleIds[0]]);
    expect(new Set([...ids(progressFirst), ...ids(progressSecond)]).size).toBe(25);
    expect(ids(await page("/in-progress"))[0]).toBe(titleIds[69]);
    expect((await page("/in-progress", ids(progressSecond).at(-1)))).toEqual([]);
  });

  it("rejects invalid cursors for the independent feed", async () => {
    expect((await supertest(app).get("/api/me/shows/in-progress").query({ beforeId: -1 })).status).toBe(400);
    expect((await supertest(app).get("/api/me/shows/in-progress").query({ offset: 24 })).status).toBe(400);
  });
});