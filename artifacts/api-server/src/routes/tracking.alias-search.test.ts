import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-tracked-show-alias-search";

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

import express from "express";
import supertest from "supertest";
import trackingRouter from "./tracking";
import {
  db,
  episodesTable,
  titleAliasesTable,
  titlesTable,
  usersTable,
  watchedEpisodesTable,
  watchedTitlesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const app = express();
app.use(express.json());
app.use("/api", trackingRouter);

let titleIds: number[] = [];
let episodeIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values({
    id: USER_ID,
    email: "tracked-show-alias-search@example.test",
  }).onConflictDoNothing();

  titleIds = (await db.insert(titlesTable).values([
    { name: "__shared_canonical_show__", type: "tv" },
    { name: "__localized_series_one__", type: "tv" },
    { name: "__localized_series_two__", type: "tv" },
  ]).returning({ id: titlesTable.id })).map(({ id }) => id);

  episodeIds = (await db.insert(episodesTable).values(
    titleIds.map((titleId) => ({
      titleId,
      seasonNumber: 1,
      episodeNumber: 1,
      name: "Pilot",
    })),
  ).returning({ id: episodesTable.id })).map(({ id }) => id);

  await db.insert(watchedTitlesTable).values(
    titleIds.map((titleId) => ({ userId: USER_ID, titleId })),
  );
  // The most recent localized series is caught up; the other two have an
  // unwatched episode, allowing status filtering to be tested with alias search.
  await db.insert(watchedEpisodesTable).values({
    userId: USER_ID,
    titleId: titleIds[2],
    episodeId: episodeIds[2],
  });
  await db.insert(titleAliasesTable).values([
    {
      titleId: titleIds[1],
      alias: "Shared Local Title",
      normalizedAlias: "sharedlocaltitle",
      sourceName: "Editorial test",
      isEditorial: true,
    },
    {
      titleId: titleIds[1],
      alias: "Another Shared Regional Name",
      normalizedAlias: "anothersharedregionalname",
      sourceName: "Editorial test",
      isEditorial: true,
    },
    {
      titleId: titleIds[2],
      alias: "Shared Local Title",
      normalizedAlias: "sharedlocaltitle",
      sourceName: "Editorial test",
      isEditorial: true,
    },
  ]);
});

afterAll(async () => {
  await db.delete(watchedEpisodesTable).where(eq(watchedEpisodesTable.userId, USER_ID));
  await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.userId, USER_ID));
  if (titleIds.length) {
    await db.delete(episodesTable).where(inArray(episodesTable.titleId, titleIds));
    await db.delete(titlesTable).where(inArray(titlesTable.id, titleIds));
  }
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
});

const getShowIds = (response: { body: Array<{ title: { id: number } }> }) =>
  response.body.map((show) => show.title.id);

describe("tracked show search by canonical and alternate titles", () => {
  it("matches canonical and alternate names once each across status-filtered pages", async () => {
    const firstPage = await supertest(app)
      .get("/api/me/shows")
      .query({ q: "sHaReD", limit: 1 });
    expect(firstPage.status).toBe(200);
    expect(getShowIds(firstPage)).toEqual([titleIds[2]]);

    const secondPage = await supertest(app)
      .get("/api/me/shows")
      .query({ q: "shared", limit: 1, beforeId: titleIds[2] });
    expect(secondPage.status).toBe(200);
    expect(getShowIds(secondPage)).toEqual([titleIds[1]]);

    const thirdPage = await supertest(app)
      .get("/api/me/shows")
      .query({ q: "shared", limit: 1, beforeId: titleIds[1] });
    expect(thirdPage.status).toBe(200);
    expect(getShowIds(thirdPage)).toEqual([titleIds[0]]);
    expect(new Set([
      ...getShowIds(firstPage),
      ...getShowIds(secondPage),
      ...getShowIds(thirdPage),
    ]).size).toBe(3);

    const canonicalMatch = await supertest(app)
      .get("/api/me/shows")
      .query({ q: "canonical" });
    expect(getShowIds(canonicalMatch)).toEqual([titleIds[0]]);

    const upNextFirstPage = await supertest(app)
      .get("/api/me/shows")
      .query({ q: "shared", status: "up-next", limit: 1 });
    expect(getShowIds(upNextFirstPage)).toEqual([titleIds[1]]);

    const upNextSecondPage = await supertest(app)
      .get("/api/me/shows")
      .query({ q: "shared", status: "up-next", limit: 1, beforeId: titleIds[1] });
    expect(getShowIds(upNextSecondPage)).toEqual([titleIds[0]]);

    const caughtUp = await supertest(app)
      .get("/api/me/shows")
      .query({ q: "shared", status: "caught-up" });
    expect(getShowIds(caughtUp)).toEqual([titleIds[2]]);
  });
});
