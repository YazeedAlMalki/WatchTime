import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-collection-pagination";

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
import { db, episodesTable, titlesTable, usersTable, watchedEpisodesTable, watchedTitlesTable, watchlistTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

let showIds: number[] = [];
let movieIds: number[] = [];
let episodeIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values({ id: USER_ID, email: "pagination@example.test" }).onConflictDoNothing();
  showIds = (await db.insert(titlesTable).values(
    Array.from({ length: 5 }, (_, i) => ({ name: `__pagination_show_${i}__`, type: "tv" as const })),
  ).returning({ id: titlesTable.id })).map(row => row.id);
  movieIds = (await db.insert(titlesTable).values(
    Array.from({ length: 5 }, (_, i) => ({ name: `__pagination_movie_${i}__`, type: "movie" as const })),
  ).returning({ id: titlesTable.id })).map(row => row.id);
  episodeIds = (await db.insert(episodesTable).values(
    showIds.map(titleId => ({ titleId, seasonNumber: 1, episodeNumber: 1, name: "Pilot" })),
  ).returning({ id: episodesTable.id })).map(row => row.id);
  await db.insert(watchedTitlesTable).values([
    ...showIds.slice(0, 4).map(titleId => ({ userId: USER_ID, titleId })),
    ...movieIds.slice(0, 4).map(titleId => ({ userId: USER_ID, titleId })),
  ]);
  await db.insert(watchlistTable).values(movieIds.slice(0, 4).map(titleId => ({ userId: USER_ID, titleId })));
});

afterAll(async () => {
  await db.delete(watchedEpisodesTable).where(eq(watchedEpisodesTable.userId, USER_ID));
  await db.delete(watchlistTable).where(eq(watchlistTable.userId, USER_ID));
  await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.userId, USER_ID));
  await db.delete(episodesTable).where(inArray(episodesTable.titleId, showIds));
  await db.delete(titlesTable).where(inArray(titlesTable.id, [...showIds, ...movieIds]));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
});

async function page(path: string, boundary?: number | string) {
  const response = await supertest(app).get(`/api/me/${path}`).query({
    limit: 2,
    ...(boundary === undefined ? {} : path === "shows" ? { beforeId: boundary } : { before: boundary }),
  });
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("private, no-cache");
  expect(response.headers.vary).toContain("Authorization");
  expect(response.headers.vary).toContain("Cookie");
  return response.body as Array<{ id?: number; title?: { id: number }; watchedEpisodes?: number; collectionCursor?: string }>;
}

function ids(rows: Awaited<ReturnType<typeof page>>) {
  return rows.map(row => row.title?.id ?? row.id!);
}

describe("personal collection page boundaries", () => {
  it("does not move shows across pages when progress changes, and includes every unseen show once", async () => {
    const first = await page("shows");
    expect(ids(first)).toEqual([showIds[3], showIds[2]]);

    // Mark a show on each side of the boundary. Progress used to sort this
    // list, so either update could previously shift an offset page.
    await db.insert(watchedEpisodesTable).values([
      { userId: USER_ID, titleId: showIds[3], episodeId: episodeIds[3] },
      { userId: USER_ID, titleId: showIds[1], episodeId: episodeIds[1] },
    ]);
    const second = await page("shows", ids(first).at(-1));
    expect(ids(second)).toEqual([showIds[1], showIds[0]]);
    expect(second[0].watchedEpisodes).toBe(1);
    expect(await page("shows", ids(second).at(-1))).toEqual([]);
    expect(ids([...first, ...second])).toEqual([...showIds.slice(0, 4)].reverse());
  });

  it("keeps unseen movies after a first-page removal and a newer membership addition", async () => {
    const first = await page("movies");
    expect(ids(first)).toEqual([movieIds[3], movieIds[2]]);
    await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.titleId, movieIds[3]));
    await db.insert(watchedTitlesTable).values({ userId: USER_ID, titleId: movieIds[4] });

    const second = await page("movies", first.at(-1)?.collectionCursor);
    expect(ids(second)).toEqual([movieIds[1], movieIds[0]]);
    expect(await page("movies", second.at(-1)?.collectionCursor)).toEqual([]);
    expect(ids([...first, ...second])).toEqual([...movieIds.slice(0, 4)].reverse());
    // A new item above the boundary is picked up by a fresh first-page fetch.
    expect(ids(await page("movies"))).toEqual([movieIds[4], movieIds[2]]);
  });

  it("keeps unseen watchlist titles after removal and insertion between requests", async () => {
    const first = await page("watchlist");
    expect(ids(first)).toEqual([movieIds[3], movieIds[2]]);
    await db.delete(watchlistTable).where(eq(watchlistTable.titleId, movieIds[3]));
    await db.insert(watchlistTable).values({ userId: USER_ID, titleId: movieIds[4] });

    const second = await page("watchlist", first.at(-1)?.collectionCursor);
    expect(ids(second)).toEqual([movieIds[1], movieIds[0]]);
    expect(await page("watchlist", second.at(-1)?.collectionCursor)).toEqual([]);
    expect(ids([...first, ...second])).toEqual([...movieIds.slice(0, 4)].reverse());
    expect(ids(await page("watchlist"))).toEqual([movieIds[4], movieIds[2]]);
  });

  it("orders saved collections by their timestamps, not catalog title IDs", async () => {
    const future = new Date("2099-01-01T00:00:00.000Z");
    await db.update(watchedTitlesTable).set({ watchedAt: future }).where(eq(watchedTitlesTable.titleId, movieIds[0]));
    await db.update(watchlistTable).set({ createdAt: future }).where(eq(watchlistTable.titleId, movieIds[1]));
    expect(ids(await page("movies"))).toEqual([movieIds[0], movieIds[4]]);
    expect(ids(await page("watchlist"))).toEqual([movieIds[1], movieIds[4]]);
  });

  it("rejects invalid boundaries instead of returning ambiguous pages", async () => {
    for (const path of ["shows", "movies", "watchlist"]) {
      expect((await supertest(app).get(`/api/me/${path}`).query(path === "shows" ? { beforeId: -1 } : { before: "invalid" })).status).toBe(400);
      expect((await supertest(app).get(`/api/me/${path}`).query({ offset: 2 })).status).toBe(400);
      expect((await supertest(app).get(`/api/me/${path}`).query(path === "shows" ? { before: "anything" } : { beforeId: 2 })).status).toBe(400);
    }
  });
});