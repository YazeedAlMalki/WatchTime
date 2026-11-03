import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_A = "test-import-user-a";
const USER_B = "test-import-user-b";

vi.mock("../middlewares/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.header("x-test-user");
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    req.userId = userId;
    next();
  },
  requireAdmin: (_req: any, res: any) => res.status(403).json({ error: "Forbidden" }),
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
import { logger } from "../lib/logger";
import { runCatalogSync, type SourceItem } from "../seed-real";
import {
  db,
  episodesTable,
  importItemsTable,
  importsTable,
  integrationHealthTable,
  pool,
  rateLimitHitsTable,
  titlesTable,
  titleAliasesTable,
  usersTable,
  watchedEpisodesTable,
  watchedTitlesTable,
  watchlistTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

let movieId: number;
let showId: number;
let altTitleId: number;
let largeBatchTitleId: number;
let rollbackValidId: number;
let rollbackBrokenId: number;
let ambiguousTitleIds: number[] = [];
let cleanupTitleIds: number[] = [];

beforeAll(async () => {
  await db.delete(rateLimitHitsTable).where(inArray(rateLimitHitsTable.key, [
    `import_create:${USER_A}`,
    `import_confirm:${USER_A}`,
    `import_create:${USER_B}`,
    `import_confirm:${USER_B}`,
  ]));
  await db.insert(usersTable).values([
    { id: USER_A, email: "import-a@example.test", isAdmin: false },
    { id: USER_B, email: "import-b@example.test", isAdmin: false },
  ]).onConflictDoNothing();
  [movieId] = (await db.insert(titlesTable).values({ name: "__import_integration_movie__", type: "movie", year: 2024, imdbId: "tt1234567" }).returning({ id: titlesTable.id })).map((row) => row.id);
  [showId] = (await db.insert(titlesTable).values({ name: "__import_integration_show__", type: "tv", year: 2024 }).returning({ id: titlesTable.id })).map((row) => row.id);
  [altTitleId, rollbackValidId, rollbackBrokenId, largeBatchTitleId, ...ambiguousTitleIds] = (await db.insert(titlesTable).values([
    { name: "__import_alt_canonical__", altTitles: ["__import_alt_alias__", "العنوان المحلي"], type: "movie", year: 2020 },
    { name: "__import_rollback_valid__", type: "movie", year: 2021 },
    { name: "__import_rollback_broken__", type: "movie", year: 2022 },
    { name: "__import_large_batch__", type: "movie", year: 2025 },
    { name: "__import_ambiguous_title__", altTitles: ["عنوان ملتبس"], type: "movie", year: 2023, tmdbId: 700001 },
    { name: "__import_ambiguous_title__", altTitles: ["عنوان ملتبس"], type: "movie", year: 2023, tmdbId: 700001 },
  ]).returning({ id: titlesTable.id })).map((row) => row.id);
  cleanupTitleIds = [movieId, showId, altTitleId, rollbackValidId, rollbackBrokenId, largeBatchTitleId, ...ambiguousTitleIds];
  await db.insert(episodesTable).values({ titleId: showId, seasonNumber: 1, episodeNumber: 1, name: "Pilot" });
});

afterAll(async () => {
  await db.delete(rateLimitHitsTable).where(inArray(rateLimitHitsTable.key, [
    `import_create:${USER_A}`,
    `import_confirm:${USER_A}`,
    `import_create:${USER_B}`,
    `import_confirm:${USER_B}`,
  ]));
  await db.delete(importsTable).where(inArray(importsTable.userId, [USER_A, USER_B]));
  await db.delete(watchedEpisodesTable).where(inArray(watchedEpisodesTable.userId, [USER_A, USER_B]));
  await db.delete(watchedTitlesTable).where(inArray(watchedTitlesTable.userId, [USER_A, USER_B]));
  await db.delete(watchlistTable).where(inArray(watchlistTable.userId, [USER_A, USER_B]));
  await db.delete(episodesTable).where(eq(episodesTable.titleId, showId));
  await db.delete(titlesTable).where(inArray(titlesTable.id, cleanupTitleIds));
  await db.delete(usersTable).where(eq(usersTable.id, USER_A));
  await db.delete(usersTable).where(eq(usersTable.id, USER_B));
});

describe("private, idempotent watch-history imports", () => {
  it("rejects an unauthenticated import request", async () => {
    const response = await supertest(app).post("/api/imports").send({
      source: "generic",
      fileName: "history.csv",
      content: "kind,title\nwatched_movie,Not permitted",
    });
    expect(response.status).toBe(401);
  });

  it("previews, protects cross-user jobs, and confirms all selected rows atomically", async () => {
    const content = [
      "kind,title,type,year,imdbId,season,episode,watchedAt",
      "watched_movie,__import_integration_movie__,movie,2024,tt1234567,,,2024-01-02",
      "watched_episode,__import_integration_show__,tv,2024,,1,1,2024-01-03",
      "watchlist,__import_integration_movie__,movie,2024,tt1234567,,,",
    ].join("\n");
    const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({ source: "generic", fileName: "history.csv", content });
    expect(created.status).toBe(201);
    expect(created.body.summary.matched).toBe(3);
    const jobId = created.body.id;

    const forbidden = await supertest(app).get(`/api/imports/${jobId}`).set("x-test-user", USER_B);
    expect(forbidden.status).toBe(404);

    const completed = await supertest(app).post(`/api/imports/${jobId}/confirm`).set("x-test-user", USER_A);
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("confirmed");
    const [watchedMovie, watchedEpisode, inWatchlist] = await Promise.all([
      db.select().from(watchedTitlesTable).where(and(eq(watchedTitlesTable.userId, USER_A), eq(watchedTitlesTable.titleId, movieId))),
      db.select().from(watchedEpisodesTable).where(and(eq(watchedEpisodesTable.userId, USER_A), eq(watchedEpisodesTable.titleId, showId))),
      db.select().from(watchlistTable).where(and(eq(watchlistTable.userId, USER_A), eq(watchlistTable.titleId, movieId))),
    ]);
    expect(watchedMovie).toHaveLength(1);
    expect(watchedEpisode).toHaveLength(1);
    expect(inWatchlist).toHaveLength(1);

    // These reads are shared by web and mobile clients and must immediately
    // reflect the import committed above.
    const [movies, shows, watchlist, recent] = await Promise.all([
      supertest(app).get("/api/me/movies").set("x-test-user", USER_A),
      supertest(app).get("/api/me/shows").set("x-test-user", USER_A),
      supertest(app).get("/api/me/watchlist").set("x-test-user", USER_A),
      supertest(app).get("/api/me/recent").set("x-test-user", USER_A),
    ]);
    expect(movies.body.some((title: { id: number }) => title.id === movieId)).toBe(true);
    expect(shows.body.some((show: { title: { id: number } }) => show.title.id === showId)).toBe(true);
    expect(watchlist.body.some((title: { id: number }) => title.id === movieId)).toBe(true);
    expect(recent.body.some((item: { titleId: number }) => item.titleId === showId)).toBe(true);
  });

  it("prevents another account from resolving an owner's ambiguous import item", async () => {
    const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
      source: "generic",
      fileName: "private-ambiguous-review.csv",
      content: "kind,title,type,year,watchedAt\nwatched_movie,__import_ambiguous_title__,movie,2023,2024-02-03",
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("ready");
    expect(created.body.items).toHaveLength(1);
    const item = created.body.items[0];
    expect(item).toMatchObject({
      classification: "ambiguous",
      titleId: null,
      episodeId: null,
      selected: false,
      errorCode: "multiple_titles",
    });
    expect(item.candidates.map((candidate: { titleId: number }) => candidate.titleId).sort((a: number, b: number) => a - b))
      .toEqual([...ambiguousTitleIds].sort((a, b) => a - b));
    const [storedBefore] = await db.select().from(importItemsTable).where(eq(importItemsTable.id, item.id));
    expect(storedBefore).toBeDefined();
    const readTracking = () => Promise.all([
      db.select().from(watchedTitlesTable).where(inArray(watchedTitlesTable.userId, [USER_A, USER_B])).orderBy(watchedTitlesTable.id),
      db.select().from(watchedEpisodesTable).where(inArray(watchedEpisodesTable.userId, [USER_A, USER_B])).orderBy(watchedEpisodesTable.id),
      db.select().from(watchlistTable).where(inArray(watchlistTable.userId, [USER_A, USER_B])).orderBy(watchlistTable.id),
    ]);
    const trackingBefore = await readTracking();

    // The candidate is valid for this unresolved item, so ownership alone
    // must prevent the second account from resolving it.
    const rejected = await supertest(app)
      .patch(`/api/imports/${created.body.id}/items/${item.id}`)
      .set("x-test-user", USER_B)
      .send({ titleId: item.candidates[0].titleId });
    expect(rejected.status).toBe(404);
    expect(rejected.body).toEqual({ error: "Import not found" });

    const [storedAfter] = await db.select().from(importItemsTable).where(eq(importItemsTable.id, item.id));
    expect(storedAfter).toEqual(storedBefore);
    const preview = await supertest(app).get(`/api/imports/${created.body.id}`).set("x-test-user", USER_A);
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual(created.body);
    expect(await readTracking()).toEqual(trackingBefore);
  });

  it("returns the same job for a repeat upload and never applies it twice", async () => {
    const content = "kind,title,type,year\nwatched_movie,__import_integration_movie__,movie,2024";
    const first = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({ source: "generic", fileName: "repeat.csv", content });
    expect(first.status).toBe(201);
    const repeat = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({ source: "generic", fileName: "renamed.csv", content });
    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(first.body.id);
    await Promise.all([
      supertest(app).post(`/api/imports/${first.body.id}/confirm`).set("x-test-user", USER_A),
      supertest(app).post(`/api/imports/${first.body.id}/confirm`).set("x-test-user", USER_A),
    ]);
    const rows = await db.select().from(watchedTitlesTable).where(and(eq(watchedTitlesTable.userId, USER_A), eq(watchedTitlesTable.titleId, movieId)));
    expect(rows).toHaveLength(1);
  });

  it("keeps identical uploads private and matches each user's new preview to the current alias owner", async () => {
    const alias = "利用者別の地域タイトル";
    const fixtures: SourceItem[] = [990096, 990097].map((tvmazeId, index) => ({
      key: `test:import-private-alias-${index}`,
      source: "tvmaze",
      type: "tv",
      name: `__import_private_alias_${index}__`,
      tvmazeId,
      expectedTitle: `__import_private_alias_${index}__`,
      expectedYear: 2020,
      expectedImdbId: `tt999009${index + 6}`,
      aliases: index === 0 ? [{
        alias, language: "ja", sourceName: "JA Wikipedia",
        sourceUrl: `https://ja.wikipedia.org/wiki/${alias}`,
      }] : [],
      popularity: 0,
    }));
    const users = [USER_A, USER_B];
    const rateLimitKeys = users.flatMap((user) => [`import_create:${user}`, `import_confirm:${user}`]);
    const healthSnapshot = await db.select().from(integrationHealthTable);
    const jobIds: number[] = [];
    let titleIds: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const fixture = fixtures.find((item) => String(input).includes(`/shows/${item.tvmazeId}?`));
      if (!fixture) throw new Error(`Unexpected catalog request: ${input}`);
      return new Response(JSON.stringify({
        id: fixture.tvmazeId,
        name: fixture.name,
        type: "Scripted",
        genres: ["Drama"],
        premiered: "2020-01-01",
        status: "Ended",
        summary: "<p>Private import fixture</p>",
        image: null,
        externals: { imdb: fixture.expectedImdbId },
        _embedded: {
          cast: [],
          episodes: [{ season: 2, number: 3, name: "Fixture episode", airdate: "2020-02-03" }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    try {
      await db.delete(rateLimitHitsTable).where(inArray(rateLimitHitsTable.key, rateLimitKeys));
      const initial = await runCatalogSync({ dryRun: false, allowPartial: true }, fixtures.map((item) => ({ ...item, aliases: [] })));
      expect(initial?.failures).toEqual([]);
      const refreshed = await runCatalogSync({ dryRun: false, allowPartial: true }, fixtures);
      expect(refreshed?.succeeded).toBe(2);
      expect(refreshed?.failures).toEqual([]);
      const titles = await db.select().from(titlesTable).where(inArray(titlesTable.imdbId, ["tt9990096", "tt9990097"]));
      expect(titles).toHaveLength(2);
      const primaryId = titles.find((title) => title.imdbId === "tt9990096")!.id;
      const secondaryId = titles.find((title) => title.imdbId === "tt9990097")!.id;
      titleIds = [primaryId, secondaryId];
      const episodes = await db.select().from(episodesTable).where(inArray(episodesTable.titleId, titleIds));
      const primaryEpisode = episodes.find((episode) => episode.titleId === primaryId)!;
      const secondaryEpisode = episodes.find((episode) => episode.titleId === secondaryId)!;
      const upload = {
        source: "generic",
        fileName: "private-regional-history.csv",
        content: [
          "kind,title,type,year,season,episode",
          `watchlist,${alias},tv,2020,,`,
          `watched_episode,${alias},tv,2020,2,3`,
        ].join("\n"),
      };
      const sortedItems = (items: { rowNumber: number }[]) => [...items].sort((a, b) => a.rowNumber - b.rowNumber);
      const first = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send(upload);
      if (first.body.id) jobIds.push(first.body.id);
      expect(first.status).toBe(201);
      expect(first.body.status).toBe("ready");
      expect(first.body.summary).toMatchObject({ matched: 2, ambiguous: 0, unmatched: 0 });
      expect(sortedItems(first.body.items)).toMatchObject([
        { classification: "matched", titleId: primaryId, selected: true },
        { classification: "matched", titleId: primaryId, episodeId: primaryEpisode.id, selected: true },
      ]);

      const moved = await runCatalogSync({ dryRun: false, allowPartial: true }, [
        { ...fixtures[0], aliases: [] },
        { ...fixtures[1], aliases: fixtures[0].aliases },
      ]);
      expect(moved?.succeeded).toBe(2);
      expect(moved?.failures).toEqual([]);
      const owners = await db.select().from(titleAliasesTable).where(and(
        inArray(titleAliasesTable.titleId, titleIds), eq(titleAliasesTable.alias, alias),
      ));
      expect(owners.map((row) => row.titleId)).toEqual([secondaryId]);

      // Exactly the same source and bytes must be classified anew for USER_B.
      const second = await supertest(app).post("/api/imports").set("x-test-user", USER_B).send(upload);
      if (second.body.id) jobIds.push(second.body.id);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect(second.body.status).toBe("ready");
      expect(second.body.summary).toMatchObject({ matched: 2, ambiguous: 0, unmatched: 0 });
      expect(sortedItems(second.body.items)).toMatchObject([
        { classification: "matched", titleId: secondaryId, selected: true },
        { classification: "matched", titleId: secondaryId, episodeId: secondaryEpisode.id, selected: true },
      ]);
      const jobs = await db.select().from(importsTable).where(inArray(importsTable.id, jobIds));
      expect(jobs).toHaveLength(2);
      expect(jobs.find((job) => job.id === first.body.id)?.userId).toBe(USER_A);
      expect(jobs.find((job) => job.id === second.body.id)?.userId).toBe(USER_B);
      expect(new Set(jobs.map((job) => job.fingerprint)).size).toBe(1);

      for (const [job, stranger] of [[first.body, USER_B], [second.body, USER_A]] as const) {
        const responses = await Promise.all([
          supertest(app).get(`/api/imports/${job.id}`).set("x-test-user", stranger),
          supertest(app).get(`/api/imports/${job.id}/report`).set("x-test-user", stranger),
          supertest(app).patch(`/api/imports/${job.id}/items/${job.items[0].id}`).set("x-test-user", stranger).send({ skip: true }),
          supertest(app).post(`/api/imports/${job.id}/confirm`).set("x-test-user", stranger),
        ]);
        expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
      }
      const history = async (userId: string) => {
        const [watchlist, watchedEpisodes, watchedTitles] = await Promise.all([
          db.select().from(watchlistTable).where(and(eq(watchlistTable.userId, userId), inArray(watchlistTable.titleId, titleIds))),
          db.select().from(watchedEpisodesTable).where(and(eq(watchedEpisodesTable.userId, userId), inArray(watchedEpisodesTable.titleId, titleIds))),
          db.select().from(watchedTitlesTable).where(and(eq(watchedTitlesTable.userId, userId), inArray(watchedTitlesTable.titleId, titleIds))),
        ]);
        return { watchlist, watchedEpisodes, watchedTitles };
      };
      expect(await history(USER_A)).toEqual({ watchlist: [], watchedEpisodes: [], watchedTitles: [] });
      expect(await history(USER_B)).toEqual({ watchlist: [], watchedEpisodes: [], watchedTitles: [] });
      for (const [job, owner] of [[first.body, USER_A], [second.body, USER_B]] as const) {
        const preview = await supertest(app).get(`/api/imports/${job.id}`).set("x-test-user", owner);
        expect(preview.status).toBe(200);
        expect(preview.body.status).toBe("ready");
        expect(sortedItems(preview.body.items)).toEqual(sortedItems(job.items));
      }
      const confirmedB = await supertest(app).post(`/api/imports/${second.body.id}/confirm`).set("x-test-user", USER_B);
      expect(confirmedB.status).toBe(200);
      expect(confirmedB.body.status).toBe("confirmed");
      expect(confirmedB.body.summary).toMatchObject({ applied: 2, selected: 2, skipped: 0 });
      const historyB = await history(USER_B);
      expect(historyB.watchlist).toMatchObject([{ titleId: secondaryId, userId: USER_B }]);
      expect(historyB.watchedEpisodes).toMatchObject([{ titleId: secondaryId, episodeId: secondaryEpisode.id, userId: USER_B }]);
      expect(historyB.watchedTitles).toMatchObject([{ titleId: secondaryId, userId: USER_B }]);
      expect(await history(USER_A)).toEqual({ watchlist: [], watchedEpisodes: [], watchedTitles: [] });
      const untouchedA = await supertest(app).get(`/api/imports/${first.body.id}`).set("x-test-user", USER_A);
      expect(untouchedA.status).toBe(200);
      expect(untouchedA.body.status).toBe("ready");
      expect(sortedItems(untouchedA.body.items)).toEqual(sortedItems(first.body.items));

      const confirmedA = await supertest(app).post(`/api/imports/${first.body.id}/confirm`).set("x-test-user", USER_A);
      expect(confirmedA.status).toBe(200);
      expect(confirmedA.body.status).toBe("confirmed");
      expect(confirmedA.body.summary).toMatchObject({ applied: 2, selected: 2, skipped: 0 });
      const historyA = await history(USER_A);
      expect(historyA.watchlist).toMatchObject([{ titleId: primaryId, userId: USER_A }]);
      expect(historyA.watchedEpisodes).toMatchObject([{ titleId: primaryId, episodeId: primaryEpisode.id, userId: USER_A }]);
      expect(historyA.watchedTitles).toMatchObject([{ titleId: primaryId, userId: USER_A }]);
      expect(await history(USER_B)).toEqual(historyB);
      const unchangedB = await supertest(app).get(`/api/imports/${second.body.id}`).set("x-test-user", USER_B);
      expect(unchangedB.status).toBe(200);
      expect(unchangedB.body).toEqual(confirmedB.body);
    } finally {
      vi.unstubAllGlobals();
      await db.delete(rateLimitHitsTable).where(inArray(rateLimitHitsTable.key, rateLimitKeys));
      if (jobIds.length) await db.delete(importsTable).where(inArray(importsTable.id, jobIds));
      if (titleIds.length) {
        await db.delete(watchedEpisodesTable).where(and(inArray(watchedEpisodesTable.userId, users), inArray(watchedEpisodesTable.titleId, titleIds)));
        await db.delete(watchedTitlesTable).where(and(inArray(watchedTitlesTable.userId, users), inArray(watchedTitlesTable.titleId, titleIds)));
        await db.delete(watchlistTable).where(and(inArray(watchlistTable.userId, users), inArray(watchlistTable.titleId, titleIds)));
      }
      await db.delete(titlesTable).where(inArray(titlesTable.imdbId, ["tt9990096", "tt9990097"]));
      await db.delete(integrationHealthTable);
      if (healthSnapshot.length) await db.insert(integrationHealthTable).values(healthSnapshot);
    }
  });

  it("uses external IDs and alternate titles, but leaves ambiguity and non-exact episodes unresolved", async () => {
    const content = [
      "kind,title,type,year,imdbId,tmdbId,season,episode",
      "watched_movie,Incorrect display name,movie,1900,tt1234567,,,",
      "watched_movie,__import_alt_alias__,movie,2020,,,,",
      "watched_movie,العنوان المحلي,movie,2020,,,,",
      "watched_episode,__import_integration_show__,tv,2024,,,1,99",
      "watched_movie,__import_ambiguous_title__,movie,2023,,,,",
      "watched_movie,عنوان ملتبس,movie,2023,,,,",
      "watched_movie,External-ID collision,movie,2023,,700001,,",
      "watched_movie,Conflicting IDs,movie,2024,tt1234567,700001,,",
    ].join("\n");
    const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
      source: "generic", fileName: "matching.csv", content,
    });
    expect(created.status).toBe(201);
    const byRow = new Map(created.body.items.map((item: { rowNumber: number }) => [item.rowNumber, item]));
    expect((byRow.get(1) as any).titleId).toBe(movieId);
    expect((byRow.get(1) as any).classification).toBe("duplicate");
    expect((byRow.get(2) as any).titleId).toBe(altTitleId);
    expect((byRow.get(2) as any).classification).toBe("matched");
    expect((byRow.get(3) as any).titleId).toBe(altTitleId);
    expect((byRow.get(3) as any).classification).toBe("duplicate");
    expect((byRow.get(4) as any).classification).toBe("unmatched");
    expect((byRow.get(4) as any).errorCode).toBe("episode_not_found");
    expect((byRow.get(5) as any).classification).toBe("ambiguous");
    expect((byRow.get(5) as any).candidates.map((candidate: { titleId: number }) => candidate.titleId).sort()).toEqual(ambiguousTitleIds.sort());
    expect((byRow.get(6) as any).classification).toBe("ambiguous");
    expect((byRow.get(6) as any).candidates.map((candidate: { titleId: number }) => candidate.titleId).sort()).toEqual(ambiguousTitleIds.sort());
    expect((byRow.get(7) as any).classification).toBe("ambiguous");
    expect((byRow.get(7) as any).candidates).toHaveLength(2);
    expect((byRow.get(8) as any).classification).toBe("unmatched");

    const resolved = await supertest(app)
      .patch(`/api/imports/${created.body.id}/items/${(byRow.get(5) as any).id}`)
      .set("x-test-user", USER_A)
      .send({ titleId: ambiguousTitleIds[0] });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({
      classification: "matched",
      selected: true,
      titleId: ambiguousTitleIds[0],
    });
  });

  it.each([
    { name: "reuses the saved preview for identical uploads after a regional alias moves and confirms idempotently", freshImport: false, removeAlias: false, resolveEpisode: false },
    { name: "reuses the completed import result for identical uploads after a regional alias moves without tracking its new owner", freshImport: false, removeAlias: false, resolveEpisode: false, confirmBeforeRefresh: true },
    { name: "matches a fresh regional import to the current alias owner after a refresh", freshImport: true, removeAlias: false, resolveEpisode: false },
    { name: "leaves a fresh import unmatched after its regional alias is removed without changing an earlier preview", freshImport: true, removeAlias: true, resolveEpisode: false },
    { name: "matches a fresh import to an editorially preserved regional alias after its provider withdraws it", freshImport: true, removeAlias: true, resolveEpisode: false, preserveEditorial: true },
    { name: "matches and tracks a fresh regional import while another catalog provider still supports its alias", freshImport: true, removeAlias: false, resolveEpisode: false, retainProvider: true },
    { name: "records only the chosen show's episode and parent history after reviewing a shared regional title", freshImport: false, removeAlias: false, resolveEpisode: true },
    { name: "does not add history twice when a shared-alias episode becomes watched before manual review", freshImport: false, removeAlias: false, resolveEpisode: true, alreadyWatched: true },
    { name: "does not let another account's watched shared-alias episode block manual review or confirmation", freshImport: false, removeAlias: false, resolveEpisode: true, otherAccountWatched: true },
    { name: "imports the chosen shared-alias episode when a different episode of that show is already watched", freshImport: false, removeAlias: false, resolveEpisode: true, differentEpisodeWatched: true },
  ])("$name", async ({ freshImport, removeAlias, resolveEpisode, alreadyWatched = false, otherAccountWatched = false, differentEpisodeWatched = false, preserveEditorial = false, retainProvider = false, confirmBeforeRefresh = false }) => {
    // Catalog-refresh scenarios must not consume the quota of later import tests.
    await db.delete(rateLimitHitsTable).where(inArray(rateLimitHitsTable.key, [
      `import_create:${USER_A}`,
      `import_confirm:${USER_A}`,
    ]));
    const fixtures: SourceItem[] = [
      {
        key: "test:import-refresh-primary",
        source: "tvmaze",
        type: "tv",
        name: "__import_refresh_primary__",
        tvmazeId: 990091,
        expectedTitle: "__import_refresh_primary__",
        expectedYear: 2020,
        expectedImdbId: "tt9990091",
        aliases: [
          { alias: "地域限定タイトル", language: "ja", sourceName: "JA Wikipedia", sourceUrl: "https://ja.wikipedia.org/wiki/地域限定タイトル" },
          { alias: "共通タイトル", language: "ja", sourceName: "JA Wikipedia", sourceUrl: "https://ja.wikipedia.org/wiki/共通タイトル" },
        ],
        popularity: 0,
      },
      {
        key: "test:import-refresh-secondary",
        source: "tvmaze",
        type: "tv",
        name: "__import_refresh_secondary__",
        tvmazeId: 990092,
        expectedTitle: "__import_refresh_secondary__",
        expectedYear: 2020,
        expectedImdbId: "tt9990092",
        aliases: [
          { alias: "共通タイトル", language: "ja", sourceName: "JA Wikipedia", sourceUrl: "https://ja.wikipedia.org/wiki/共通タイトル" },
        ],
        popularity: 0,
      },
    ];
    const healthSnapshot = await db.select().from(integrationHealthTable);
    let importId: number | undefined;
    let freshImportId: number | undefined;
    let regionalTitleIds: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (retainProvider && String(input) === "https://en.wikipedia.org/api/rest_v1/page/summary/Import_refresh_primary") {
        return new Response(JSON.stringify({ extract: "A second provider's summary of the regional fixture." }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      const fixture = fixtures.find((item) => String(input).includes(`/shows/${item.tvmazeId}?`));
      if (!fixture) throw new Error(`Unexpected catalog request: ${input}`);
      return new Response(JSON.stringify({
        id: fixture.tvmazeId,
        name: fixture.name,
        type: "Scripted",
        genres: ["Drama"],
        premiered: "2020-01-01",
        status: "Ended",
        summary: "<p>Fixture</p>",
        image: null,
        externals: { imdb: fixture.expectedImdbId },
        _embedded: {
          cast: [],
          episodes: [{ season: 2, number: 3, name: "Regional fixture episode", airdate: "2020-02-03" }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    try {
      // Seed the canonical titles first, then add their sourced aliases in a refresh.
      const initial = await runCatalogSync({ dryRun: false, allowPartial: true }, fixtures.map((item) => ({ ...item, aliases: [] })));
      expect(initial?.failures).toEqual([]);
      const refreshed = await runCatalogSync({ dryRun: false, allowPartial: true }, fixtures);
      expect(refreshed?.succeeded).toBe(2);
      expect(refreshed?.failures).toEqual([]);

      if (retainProvider) {
        const secondProvider = await runCatalogSync({ dryRun: false, allowPartial: true }, [{
          key: "test:import-refresh-primary-wikipedia",
          source: "wikipedia",
          type: "tv",
          name: fixtures[0].name,
          imdbId: fixtures[0].expectedImdbId!,
          wikiPage: "Import_refresh_primary",
          aliases: [fixtures[0].aliases![0]],
          popularity: 0,
        }]);
        expect(secondProvider?.succeeded).toBe(1);
        expect(secondProvider?.failures).toEqual([]);
      }

      const titles = await db.select().from(titlesTable).where(inArray(titlesTable.imdbId, ["tt9990091", "tt9990092"]));
      expect(titles).toHaveLength(2);
      const primaryId = titles.find((title) => title.imdbId === "tt9990091")!.id;
      const secondaryId = titles.find((title) => title.imdbId === "tt9990092")!.id;
      regionalTitleIds = [primaryId, secondaryId];
      const aliases = await db.select().from(titleAliasesTable).where(inArray(titleAliasesTable.titleId, [primaryId, secondaryId]));
      expect(aliases.find((alias) => alias.titleId === primaryId && alias.alias === "地域限定タイトル")).toMatchObject({
        language: "ja",
        isEditorial: false,
        providerSources: retainProvider ? ["tvmaze", "wikipedia"] : ["tvmaze"],
      });
      expect(aliases.filter((alias) => alias.alias === "共通タイトル")).toHaveLength(2);
      const [regionalEpisode] = await db.select().from(episodesTable).where(and(
        eq(episodesTable.titleId, primaryId),
        eq(episodesTable.seasonNumber, 2),
        eq(episodesTable.episodeNumber, 3),
      ));
      expect(regionalEpisode).toBeDefined();
      const matchingEpisodes = await db.select().from(episodesTable).where(and(
        inArray(episodesTable.titleId, [primaryId, secondaryId]),
        eq(episodesTable.seasonNumber, 2),
        eq(episodesTable.episodeNumber, 3),
      ));
      expect(matchingEpisodes.map((episode) => episode.titleId).sort((a, b) => a - b))
        .toEqual([primaryId, secondaryId].sort((a, b) => a - b));

      if (resolveEpisode) {
        // Both shows offer S2E3. Choose the second candidate so a resolver
        // that accidentally uses the first show's episode cannot pass.
        const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
          source: "generic",
          fileName: "reviewed-shared-episode.csv",
          content: "kind,title,type,year,season,episode\nwatched_episode,共通タイトル,tv,2020,2,3",
        });
        expect(created.status).toBe(201);
        importId = created.body.id;
        expect(created.body.items).toHaveLength(1);
        const item = created.body.items[0];
        expect(item).toMatchObject({
          kind: "watched_episode",
          classification: "ambiguous",
          titleId: null,
          episodeId: null,
          selected: false,
          errorCode: "multiple_titles",
        });
        expect(item.candidates.map((candidate: { titleId: number }) => candidate.titleId).sort((a: number, b: number) => a - b))
          .toEqual([primaryId, secondaryId].sort((a, b) => a - b));
        const chosenCandidate = item.candidates[1];
        const chosenEpisode = matchingEpisodes.find((episode) => episode.titleId === chosenCandidate.titleId)!;
        expect(chosenEpisode).toBeDefined();
        const historyFilter = and(
          eq(watchedEpisodesTable.userId, USER_A),
          inArray(watchedEpisodesTable.titleId, regionalTitleIds),
        );
        const parentHistoryFilter = and(
          eq(watchedTitlesTable.userId, USER_A),
          inArray(watchedTitlesTable.titleId, regionalTitleIds),
        );
        // Seed history only after the ambiguous preview, so PATCH must check
        // the exact imported episode rather than treating the show as watched.
        if (differentEpisodeWatched) {
          const [otherEpisode] = await db.insert(episodesTable).values({
            titleId: chosenCandidate.titleId,
            seasonNumber: 2,
            episodeNumber: 4,
            name: "Previously watched episode",
          }).returning();
          expect(otherEpisode.id).not.toBe(chosenEpisode.id);
          await db.insert(watchedEpisodesTable).values({
            userId: USER_A,
            titleId: chosenCandidate.titleId,
            episodeId: otherEpisode.id,
            watchedAt: new Date("2020-02-04T12:00:00Z"),
          });
          await db.insert(watchedTitlesTable).values({
            userId: USER_A,
            titleId: chosenCandidate.titleId,
            watchedAt: new Date("2020-02-04T12:00:00Z"),
          });
        }
        const previousEpisodes = await db.select().from(watchedEpisodesTable).where(historyFilter);
        const previousParents = await db.select().from(watchedTitlesTable).where(parentHistoryFilter);
        expect(previousEpisodes).toHaveLength(differentEpisodeWatched ? 1 : 0);
        expect(previousParents).toHaveLength(differentEpisodeWatched ? 1 : 0);
        if (alreadyWatched) {
          expect(await db.select().from(watchedEpisodesTable).where(historyFilter)).toEqual([]);
          expect(await db.select().from(watchedTitlesTable).where(parentHistoryFilter)).toEqual([]);
          // Another action marks this exact episode watched after preview but
          // before the user chooses the ambiguous title.
          const existingEpisodes = await db.insert(watchedEpisodesTable).values({
            userId: USER_A,
            titleId: chosenCandidate.titleId,
            episodeId: chosenEpisode.id,
          }).returning();
          const existingParents = await db.insert(watchedTitlesTable).values({
            userId: USER_A,
            titleId: chosenCandidate.titleId,
          }).returning();
          const resolved = await supertest(app)
            .patch(`/api/imports/${importId}/items/${item.id}`)
            .set("x-test-user", USER_A)
            .send({ titleId: chosenCandidate.titleId });
          const duplicateMatch = {
            id: item.id,
            kind: "watched_episode",
            classification: "duplicate",
            titleId: chosenCandidate.titleId,
            episodeId: chosenEpisode.id,
            selected: false,
            errorCode: "already_exists",
          };
          expect(resolved.status).toBe(200);
          expect(resolved.body).toMatchObject(duplicateMatch);
          expect(await db.select().from(watchedEpisodesTable).where(historyFilter)).toEqual(existingEpisodes);
          expect(await db.select().from(watchedTitlesTable).where(parentHistoryFilter)).toEqual(existingParents);

          const confirmed = await supertest(app).post(`/api/imports/${importId}/confirm`).set("x-test-user", USER_A);
          expect(confirmed.status).toBe(200);
          expect(confirmed.body.status).toBe("confirmed");
          expect(confirmed.body.summary).toMatchObject({ selected: 0, applied: 0, duplicates: 1, skipped: 1 });
          expect(confirmed.body.items).toHaveLength(1);
          expect(confirmed.body.items[0]).toMatchObject(duplicateMatch);
          // Compare complete rows, not only counts: confirmation must preserve
          // the original episode and parent history, leaving the other show alone.
          expect(await db.select().from(watchedEpisodesTable).where(historyFilter)).toEqual(existingEpisodes);
          expect(await db.select().from(watchedTitlesTable).where(parentHistoryFilter)).toEqual(existingParents);
          expect(await db.select().from(watchlistTable).where(and(
            eq(watchlistTable.userId, USER_A),
            inArray(watchlistTable.titleId, regionalTitleIds),
          ))).toEqual([]);
          return;
        }
        const otherEpisodeFilter = and(
          eq(watchedEpisodesTable.userId, USER_B),
          inArray(watchedEpisodesTable.titleId, regionalTitleIds),
        );
        const otherParentFilter = and(
          eq(watchedTitlesTable.userId, USER_B),
          inArray(watchedTitlesTable.titleId, regionalTitleIds),
        );
        // Seed only the other account after preview, so PATCH must perform
        // its own account-scoped duplicate check for this exact episode.
        const otherEpisodes = otherAccountWatched
          ? await db.insert(watchedEpisodesTable).values({
            userId: USER_B,
            titleId: chosenCandidate.titleId,
            episodeId: chosenEpisode.id,
          }).returning()
          : [];
        const otherParents = otherAccountWatched
          ? await db.insert(watchedTitlesTable).values({
            userId: USER_B,
            titleId: chosenCandidate.titleId,
          }).returning()
          : [];
        const resolved = await supertest(app)
          .patch(`/api/imports/${importId}/items/${item.id}`)
          .set("x-test-user", USER_A)
          .send({ titleId: chosenCandidate.titleId });
        expect(resolved.status).toBe(200);
        const resolvedMatch = {
          id: item.id,
          kind: "watched_episode",
          classification: "matched",
          titleId: chosenCandidate.titleId,
          episodeId: chosenEpisode.id,
          selected: true,
          errorCode: null,
        };
        expect(resolved.body).toMatchObject(resolvedMatch);
        // Reviewing a candidate changes only the import, not watch history.
        expect(await db.select().from(watchedEpisodesTable).where(historyFilter)).toEqual(previousEpisodes);
        expect(await db.select().from(watchedTitlesTable).where(parentHistoryFilter)).toEqual(previousParents);
        if (otherAccountWatched) {
          expect(await db.select().from(watchedEpisodesTable).where(otherEpisodeFilter)).toEqual(otherEpisodes);
          expect(await db.select().from(watchedTitlesTable).where(otherParentFilter)).toEqual(otherParents);
        }

        const confirmed = await supertest(app).post(`/api/imports/${importId}/confirm`).set("x-test-user", USER_A);
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.status).toBe("confirmed");
        expect(confirmed.body.summary).toMatchObject({ selected: 1, applied: 1, duplicates: 0, skipped: 0 });
        expect(confirmed.body.items).toHaveLength(1);
        expect(confirmed.body.items[0]).toMatchObject(resolvedMatch);
        const watched = await db.select().from(watchedEpisodesTable).where(historyFilter);
        expect(watched).toHaveLength(differentEpisodeWatched ? 2 : 1);
        expect(watched.filter((row) => row.episodeId === chosenEpisode.id)).toHaveLength(1);
        expect(watched.every((row) => row.userId === USER_A && row.titleId === chosenCandidate.titleId)).toBe(true);
        expect(watched).toEqual(expect.arrayContaining(previousEpisodes));
        const parents = await db.select().from(watchedTitlesTable).where(parentHistoryFilter);
        expect(parents.map((row) => row.titleId)).toEqual([chosenCandidate.titleId]);
        expect(parents).toMatchObject([{ userId: USER_A, titleId: chosenCandidate.titleId }]);
        if (otherAccountWatched) {
          expect(await db.select().from(watchedEpisodesTable).where(otherEpisodeFilter)).toEqual(otherEpisodes);
          expect(await db.select().from(watchedTitlesTable).where(otherParentFilter)).toEqual(otherParents);
        }
        if (differentEpisodeWatched) {
          expect(parents).toEqual(previousParents);
          const reconfirmed = await supertest(app).post(`/api/imports/${importId}/confirm`).set("x-test-user", USER_A);
          expect(reconfirmed.status).toBe(200);
          expect(reconfirmed.body).toEqual(confirmed.body);
          expect(await db.select().from(watchedEpisodesTable).where(historyFilter)).toEqual(watched);
          expect(await db.select().from(watchedTitlesTable).where(parentHistoryFilter)).toEqual(previousParents);
          expect(await db.select().from(watchlistTable).where(and(
            eq(watchlistTable.userId, USER_A),
            inArray(watchlistTable.titleId, regionalTitleIds),
          ))).toEqual([]);
        }
        return;
      }

      const content = [
        "kind,title,type,year,season,episode",
        "watchlist,地域限定タイトル,tv,2020,,",
        "watchlist,共通タイトル,tv,2020,,",
        "watched_episode,地域限定タイトル,tv,2020,2,3",
        "watched_episode,共通タイトル,tv,2020,2,3",
      ].join("\n");
      const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
        source: "generic",
        fileName: "refreshed-regional-titles.csv",
        content,
      });
      expect(created.status).toBe(201);
      importId = created.body.id;
      expect(created.body.summary.matched).toBe(2);
      expect(created.body.summary.ambiguous).toBe(2);
      expect(created.body.items[0]).toMatchObject({ classification: "matched", titleId: primaryId, selected: true });
      expect(created.body.items[1]).toMatchObject({
        classification: "ambiguous",
        titleId: null,
        selected: false,
        errorCode: "multiple_titles",
      });
      expect(created.body.items[1].candidates.map((candidate: { titleId: number }) => candidate.titleId).sort((a: number, b: number) => a - b))
        .toEqual([primaryId, secondaryId].sort((a, b) => a - b));
      expect(created.body.items[2]).toMatchObject({
        kind: "watched_episode",
        classification: "matched",
        titleId: primaryId,
        episodeId: regionalEpisode.id,
        selected: true,
      });
      const ambiguousEpisode = {
        kind: "watched_episode",
        classification: "ambiguous",
        titleId: null,
        episodeId: null,
        selected: false,
        errorCode: "multiple_titles",
      };
      expect(created.body.items[3]).toMatchObject(ambiguousEpisode);
      expect(created.body.items[3].candidates.map((candidate: { titleId: number }) => candidate.titleId).sort((a: number, b: number) => a - b))
        .toEqual([primaryId, secondaryId].sort((a, b) => a - b));
      const previewHistory = await db.select().from(watchedEpisodesTable).where(and(
        eq(watchedEpisodesTable.userId, USER_A),
        inArray(watchedEpisodesTable.titleId, [primaryId, secondaryId]),
      ));
      expect(previewHistory).toHaveLength(0);

      let savedResult = created.body;
      if (confirmBeforeRefresh) {
        const completed = await supertest(app).post(`/api/imports/${importId}/confirm`).set("x-test-user", USER_A);
        expect(completed.status).toBe(200);
        expect(completed.body.id).toBe(importId);
        expect(completed.body.status).toBe("confirmed");
        expect(completed.body.confirmedAt).toEqual(expect.any(String));
        expect(Number.isFinite(Date.parse(completed.body.confirmedAt))).toBe(true);
        expect(completed.body.summary).toMatchObject({ selected: 2, applied: 2, skipped: 2, ambiguous: 2 });
        completed.body.items.sort((a: { rowNumber: number }, b: { rowNumber: number }) => a.rowNumber - b.rowNumber);
        expect(completed.body.items).toEqual(created.body.items);
        expect(completed.body.items[2]).toMatchObject({ titleId: primaryId, episodeId: regionalEpisode.id });
        savedResult = completed.body;
      }

      const regionalAlias = aliases.find((alias) => alias.titleId === primaryId && alias.alias === "地域限定タイトル")!;
      if (preserveEditorial) {
        // Mirror an explicit admin preservation, retaining the provider citation
        // while marking this alias as editorial rather than legacy metadata.
        await db.update(titleAliasesTable).set({
          isEditorial: true,
          sourceName: "Admin editorial",
          updatedAt: new Date(),
        }).where(eq(titleAliasesTable.id, regionalAlias.id));
      }

      // Withdraw TVMaze's original regional name. Editorial preservation or a
      // second provider can keep it on the original title; otherwise it is
      // removed or assigned elsewhere.
      // Saved previews must retain the title IDs selected before refresh.
      const changedFixtures: SourceItem[] = [
        { ...fixtures[0], aliases: [
          { alias: "地域限定タイトル改訂", language: "ja", sourceName: "JA Wikipedia", sourceUrl: "https://ja.wikipedia.org/wiki/地域限定タイトル改訂" },
          fixtures[0].aliases![1],
        ] },
        { ...fixtures[1], aliases: [
          ...fixtures[1].aliases!,
          ...(removeAlias || retainProvider ? [] : [fixtures[0].aliases![0]]),
        ] },
      ];
      const changed = await runCatalogSync({ dryRun: false, allowPartial: true }, changedFixtures);
      expect(changed?.succeeded).toBe(2);
      expect(changed?.failures).toEqual([]);
      const movedAlias = await db.select().from(titleAliasesTable).where(eq(titleAliasesTable.alias, "地域限定タイトル"));
      const expectedAliasOwners = preserveEditorial || retainProvider ? [primaryId] : removeAlias ? [] : [secondaryId];
      expect(movedAlias.filter((alias) => [primaryId, secondaryId].includes(alias.titleId)).map((alias) => alias.titleId))
        .toEqual(expectedAliasOwners);
      if (preserveEditorial) {
        expect(movedAlias.find((alias) => alias.id === regionalAlias.id)).toMatchObject({
          titleId: primaryId,
          alias: regionalAlias.alias,
          language: "ja",
          isEditorial: true,
          sourceName: "Admin editorial",
          sourceUrl: regionalAlias.sourceUrl,
        });
      }
      if (retainProvider) {
        const remainingAlias = movedAlias.find((alias) => alias.titleId === primaryId);
        expect(remainingAlias).toMatchObject({
          id: aliases.find((alias) => alias.titleId === primaryId && alias.alias === "地域限定タイトル")!.id,
          alias: "地域限定タイトル",
          language: "ja",
          isEditorial: false,
          providerSources: ["wikipedia"],
          providerCitations: { wikipedia: {
            sourceName: fixtures[0].aliases![0].sourceName,
            sourceUrl: fixtures[0].aliases![0].sourceUrl,
          } },
        });
        expect(remainingAlias!.providerCitations).not.toHaveProperty("tvmaze");
      }
      const updatedTitles = await db.select().from(titlesTable).where(inArray(titlesTable.id, [primaryId, secondaryId]));
      expect(updatedTitles.find((title) => title.id === primaryId)!.altTitles.includes("地域限定タイトル")).toBe(preserveEditorial || retainProvider);
      expect(updatedTitles.find((title) => title.id === primaryId)!.altTitles).toContain("地域限定タイトル改訂");
      expect(updatedTitles.filter((title) => title.altTitles.includes("地域限定タイトル")).map((title) => title.id))
        .toEqual(expectedAliasOwners);
      const persistedPreview = await supertest(app).get(`/api/imports/${importId}`).set("x-test-user", USER_A);
      expect(persistedPreview.status).toBe(200);
      // Database reads do not guarantee the original CSV row order.
      persistedPreview.body.items.sort((a: { rowNumber: number }, b: { rowNumber: number }) => a.rowNumber - b.rowNumber);
      expect(persistedPreview.body.items[0]).toMatchObject({ classification: "matched", titleId: primaryId, selected: true });
      expect(persistedPreview.body.items[2]).toMatchObject({ classification: "matched", titleId: primaryId, episodeId: regionalEpisode.id, selected: true });
      expect(persistedPreview.body.items[3]).toMatchObject(ambiguousEpisode);
      if (confirmBeforeRefresh) expect(persistedPreview.body).toEqual(savedResult);

      if (freshImport) {
        // Different content creates a new job for the same user instead of
        // reusing the fingerprint (and saved matches) of the reviewed import.
        const fresh = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
          source: "generic",
          fileName: preserveEditorial ? "editorial-regional-name.csv" : removeAlias ? "removed-regional-name.csv" : retainProvider ? "supported-regional-name.csv" : "current-regional-owner.csv",
          content: "kind,title,type,year\nwatchlist,地域限定タイトル,tv,2020",
        });
        expect(fresh.status).toBe(201);
        freshImportId = fresh.body.id;
        expect(freshImportId).not.toBe(importId);
        const isUnmatched = removeAlias && !preserveEditorial;
        expect(fresh.body.summary).toMatchObject({ matched: isUnmatched ? 0 : 1, ambiguous: 0, unmatched: isUnmatched ? 1 : 0 });
        expect(fresh.body.items).toHaveLength(1);
        const expectedMatch = isUnmatched
          ? { classification: "unmatched", titleId: null, episodeId: null, selected: false, errorCode: "title_not_found", candidates: [] }
          : { classification: "matched", titleId: preserveEditorial || retainProvider ? primaryId : secondaryId, selected: true };
        expect(fresh.body.items[0]).toMatchObject({ kind: "watchlist", ...expectedMatch });

        const freshPreview = await supertest(app).get(`/api/imports/${freshImportId}`).set("x-test-user", USER_A);
        expect(freshPreview.status).toBe(200);
        expect(freshPreview.body.items[0]).toMatchObject(expectedMatch);

        const confirmed = await supertest(app).post(`/api/imports/${freshImportId}/confirm`).set("x-test-user", USER_A);
        expect(confirmed.status).toBe(200);
        expect(confirmed.body.status).toBe("confirmed");
        expect(confirmed.body.summary).toMatchObject({ selected: isUnmatched ? 0 : 1, applied: isUnmatched ? 0 : 1, skipped: isUnmatched ? 1 : 0 });
        expect(confirmed.body.items[0]).toMatchObject(expectedMatch);
        const tracked = await db.select().from(watchlistTable).where(and(
          eq(watchlistTable.userId, USER_A),
          inArray(watchlistTable.titleId, [primaryId, secondaryId]),
        ));
        expect(tracked.map((row) => row.titleId)).toEqual(expectedAliasOwners);
        const watched = await db.select().from(watchedEpisodesTable).where(and(
          eq(watchedEpisodesTable.userId, USER_A),
          inArray(watchedEpisodesTable.titleId, [primaryId, secondaryId]),
        ));
        expect(watched).toEqual([]);
        const watchedTitles = await db.select().from(watchedTitlesTable).where(and(
          eq(watchedTitlesTable.userId, USER_A),
          inArray(watchedTitlesTable.titleId, [primaryId, secondaryId]),
        ));
        expect(watchedTitles).toEqual([]);
        const earlierPreview = await supertest(app).get(`/api/imports/${importId}`).set("x-test-user", USER_A);
        expect(earlierPreview.status).toBe(200);
        earlierPreview.body.items.sort((a: { rowNumber: number }, b: { rowNumber: number }) => a.rowNumber - b.rowNumber);
        expect(earlierPreview.body.status).toBe("ready");
        expect(earlierPreview.body.items).toEqual(persistedPreview.body.items);
        return;
      }

      // The same user/source/content fingerprint must reuse the saved job,
      // even though a new match would now point to the secondary title.
      const repeat = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
        source: "generic",
        fileName: "renamed-regional-titles.csv",
        content,
      });
      expect(repeat.status).toBe(200);
      expect(repeat.body.id).toBe(importId);
      repeat.body.items.sort((a: { rowNumber: number }, b: { rowNumber: number }) => a.rowNumber - b.rowNumber);
      expect(repeat.body).toEqual(persistedPreview.body);
      expect(repeat.body).toEqual(savedResult);
      if (confirmBeforeRefresh) {
        expect(repeat.body.status).toBe("confirmed");
        expect(repeat.body.confirmedAt).toBe(savedResult.confirmedAt);
        expect(repeat.body.summary).toEqual(savedResult.summary);
      }
      expect(repeat.body.items[0].titleId).toBe(primaryId);
      expect(repeat.body.items[2]).toMatchObject({ titleId: primaryId, episodeId: regionalEpisode.id });

      const confirmed = await supertest(app).post(`/api/imports/${repeat.body.id}/confirm`).set("x-test-user", USER_A);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe("confirmed");
      confirmed.body.items.sort((a: { rowNumber: number }, b: { rowNumber: number }) => a.rowNumber - b.rowNumber);
      if (confirmBeforeRefresh) expect(confirmed.body).toEqual(savedResult);
      expect(confirmed.body.summary).toMatchObject({ selected: 2, applied: 2, skipped: 2, ambiguous: 2 });
      expect(confirmed.body.items[0]).toMatchObject({ classification: "matched", titleId: primaryId });
      expect(confirmed.body.items[2]).toMatchObject({ classification: "matched", titleId: primaryId, episodeId: regionalEpisode.id });
      expect(confirmed.body.items[3]).toMatchObject(ambiguousEpisode);
      const reconfirmed = await supertest(app).post(`/api/imports/${repeat.body.id}/confirm`).set("x-test-user", USER_A);
      expect(reconfirmed.status).toBe(200);
      reconfirmed.body.items.sort((a: { rowNumber: number }, b: { rowNumber: number }) => a.rowNumber - b.rowNumber);
      expect(reconfirmed.body).toEqual(confirmed.body);
      const tracked = await db.select().from(watchlistTable).where(and(
        eq(watchlistTable.userId, USER_A),
        inArray(watchlistTable.titleId, [primaryId, secondaryId]),
      ));
      expect(tracked.map((row) => row.titleId)).toEqual([primaryId]);
      const watched = await db.select().from(watchedEpisodesTable).where(and(
        eq(watchedEpisodesTable.userId, USER_A),
        inArray(watchedEpisodesTable.titleId, [primaryId, secondaryId]),
      ));
      expect(watched).toHaveLength(1);
      expect(watched[0]).toMatchObject({ titleId: primaryId, episodeId: regionalEpisode.id });
      const parents = await db.select().from(watchedTitlesTable).where(and(
        eq(watchedTitlesTable.userId, USER_A),
        inArray(watchedTitlesTable.titleId, [primaryId, secondaryId]),
      ));
      expect(parents.map((row) => row.titleId)).toEqual([primaryId]);
    } finally {
      vi.unstubAllGlobals();
      await db.delete(rateLimitHitsTable).where(inArray(rateLimitHitsTable.key, [
        `import_create:${USER_A}`,
        `import_confirm:${USER_A}`,
      ]));
      if (freshImportId !== undefined) await db.delete(importsTable).where(eq(importsTable.id, freshImportId));
      if (importId !== undefined) await db.delete(importsTable).where(eq(importsTable.id, importId));
      if (regionalTitleIds.length) await db.delete(watchedEpisodesTable).where(and(
        inArray(watchedEpisodesTable.userId, [USER_A, USER_B]),
        inArray(watchedEpisodesTable.titleId, regionalTitleIds),
      ));
      if (regionalTitleIds.length) await db.delete(watchedTitlesTable).where(and(
        inArray(watchedTitlesTable.userId, [USER_A, USER_B]),
        inArray(watchedTitlesTable.titleId, regionalTitleIds),
      ));
      await db.delete(titlesTable).where(inArray(titlesTable.imdbId, ["tt9990091", "tt9990092"]));
      await db.delete(integrationHealthTable);
      if (healthSnapshot.length) await db.insert(integrationHealthTable).values(healthSnapshot);
    }
  });

  it("rejects an unoffered real show without resolving or importing an ambiguous episode", async () => {
    const fixtureIds = (await db.insert(titlesTable).values([
      { name: "__import_unoffered_shared_show__", type: "tv", year: 2020 },
      { name: "__import_unoffered_shared_show__", type: "tv", year: 2020 },
      { name: "__import_unoffered_other_show__", type: "tv", year: 2020 },
    ]).returning({ id: titlesTable.id })).map((row) => row.id);
    const [firstId, secondId, unofferedId] = fixtureIds;
    let importId: number | undefined;
    try {
      // The unoffered show exists and has the exact episode too: only
      // candidate validation should prevent selecting it.
      await db.insert(episodesTable).values(fixtureIds.map((titleId) => ({
        titleId, seasonNumber: 2, episodeNumber: 3, name: "Fixture episode",
      })));
      const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
        source: "generic",
        fileName: "unoffered-episode.csv",
        content: "kind,title,type,year,season,episode\nwatched_episode,__import_unoffered_shared_show__,tv,2020,2,3",
      });
      expect(created.status).toBe(201);
      importId = created.body.id;
      expect(created.body.items).toHaveLength(1);
      const item = created.body.items[0];
      expect(item).toMatchObject({
        kind: "watched_episode",
        classification: "ambiguous",
        titleId: null,
        episodeId: null,
        selected: false,
        errorCode: "multiple_titles",
      });
      expect(item.candidates.map((candidate: { titleId: number }) => candidate.titleId).sort((a: number, b: number) => a - b))
        .toEqual([firstId, secondId].sort((a, b) => a - b));
      const [storedBefore] = await db.select().from(importItemsTable).where(eq(importItemsTable.id, item.id));

      const rejected = await supertest(app)
        .patch(`/api/imports/${importId}/items/${item.id}`)
        .set("x-test-user", USER_A)
        .send({ titleId: unofferedId });
      expect(rejected.status).toBe(400);
      expect(rejected.body).toEqual({ error: "titleId is not an offered candidate" });
      const [storedAfter] = await db.select().from(importItemsTable).where(eq(importItemsTable.id, item.id));
      expect(storedAfter).toEqual(storedBefore);
      const preview = await supertest(app).get(`/api/imports/${importId}`).set("x-test-user", USER_A);
      expect(preview.status).toBe(200);
      expect(preview.body.status).toBe("ready");
      expect(preview.body.items).toEqual([item]);
      expect(preview.body.summary).toEqual(created.body.summary);

      const confirmed = await supertest(app).post(`/api/imports/${importId}/confirm`).set("x-test-user", USER_A);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe("confirmed");
      expect(confirmed.body.summary).toMatchObject({ selected: 0, applied: 0, skipped: 1, ambiguous: 1 });
      expect(confirmed.body.items).toEqual([item]);
      expect(await db.select().from(watchedEpisodesTable).where(and(
        eq(watchedEpisodesTable.userId, USER_A),
        inArray(watchedEpisodesTable.titleId, fixtureIds),
      ))).toEqual([]);
      expect(await db.select().from(watchedTitlesTable).where(and(
        eq(watchedTitlesTable.userId, USER_A),
        inArray(watchedTitlesTable.titleId, fixtureIds),
      ))).toEqual([]);
    } finally {
      if (importId !== undefined) await db.delete(importsTable).where(eq(importsTable.id, importId));
      await db.delete(watchedEpisodesTable).where(and(eq(watchedEpisodesTable.userId, USER_A), inArray(watchedEpisodesTable.titleId, fixtureIds)));
      await db.delete(watchedTitlesTable).where(and(eq(watchedTitlesTable.userId, USER_A), inArray(watchedTitlesTable.titleId, fixtureIds)));
      await db.delete(episodesTable).where(inArray(episodesTable.titleId, fixtureIds));
      await db.delete(titlesTable).where(inArray(titlesTable.id, fixtureIds));
    }
  });

  it("rejects an offered show without the exact episode and keeps a refreshed shared regional alias ambiguous", async () => {
    await db.delete(rateLimitHitsTable).where(inArray(rateLimitHitsTable.key, [
      `import_create:${USER_A}`,
      `import_confirm:${USER_A}`,
    ]));
    const fixtures: SourceItem[] = [990093, 990094].map((tvmazeId, index) => ({
      key: `test:import-asymmetric-${index}`,
      source: "tvmaze",
      type: "tv",
      name: `__import_asymmetric_show_${index}__`,
      tvmazeId,
      expectedTitle: `__import_asymmetric_show_${index}__`,
      expectedYear: 2020,
      expectedImdbId: `tt999009${index + 3}`,
      aliases: [{
        alias: "非対称の共通タイトル",
        language: "ja",
        sourceName: "JA Wikipedia",
        sourceUrl: "https://ja.wikipedia.org/wiki/非対称の共通タイトル",
      }],
      popularity: 0,
    }));
    const imdbIds = fixtures.map((fixture) => fixture.expectedImdbId!);
    const healthSnapshot = await db.select().from(integrationHealthTable);
    let importId: number | undefined;
    let titleIds: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const fixture = fixtures.find((item) => String(input).includes(`/shows/${item.tvmazeId}?`));
      if (!fixture) throw new Error(`Unexpected catalog request: ${input}`);
      return new Response(JSON.stringify({
        id: fixture.tvmazeId,
        name: fixture.name,
        type: "Scripted",
        genres: ["Drama"],
        premiered: "2020-01-01",
        status: "Ended",
        summary: "<p>Fixture</p>",
        image: null,
        externals: { imdb: fixture.expectedImdbId },
        _embedded: {
          cast: [],
          // Both shows have episodes, but only the first contains S2E3.
          episodes: [{ season: 2, number: fixture === fixtures[0] ? 3 : 4, name: "Fixture episode", airdate: "2020-02-03" }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    try {
      const initial = await runCatalogSync({ dryRun: false, allowPartial: true }, fixtures.map((fixture) => ({ ...fixture, aliases: [] })));
      expect(initial?.succeeded).toBe(2);
      expect(initial?.failures).toEqual([]);
      const refreshed = await runCatalogSync({ dryRun: false, allowPartial: true }, fixtures);
      expect(refreshed?.succeeded).toBe(2);
      expect(refreshed?.failures).toEqual([]);

      const titles = await db.select().from(titlesTable).where(inArray(titlesTable.imdbId, imdbIds));
      expect(titles).toHaveLength(2);
      titleIds = titles.map((title) => title.id).sort((a, b) => a - b);
      const aliases = await db.select().from(titleAliasesTable).where(and(
        inArray(titleAliasesTable.titleId, titleIds),
        eq(titleAliasesTable.alias, "非対称の共通タイトル"),
      ));
      expect(aliases.map((alias) => alias.titleId).sort((a, b) => a - b)).toEqual(titleIds);
      const matchingEpisodes = await db.select().from(episodesTable).where(and(
        inArray(episodesTable.titleId, titleIds),
        eq(episodesTable.seasonNumber, 2),
        eq(episodesTable.episodeNumber, 3),
      ));
      expect(matchingEpisodes).toHaveLength(1);
      expect(matchingEpisodes[0].titleId).toBe(titles.find((title) => title.imdbId === imdbIds[0])!.id);

      const ambiguousEpisode = {
        kind: "watched_episode",
        classification: "ambiguous",
        titleId: null,
        episodeId: null,
        selected: false,
        errorCode: "multiple_titles",
      };
      const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
        source: "generic",
        fileName: "asymmetric-regional-episode.csv",
        content: "kind,title,type,year,season,episode\nwatched_episode,非対称の共通タイトル,tv,2020,2,3",
      });
      expect(created.status).toBe(201);
      importId = created.body.id;
      expect(created.body.summary).toMatchObject({ matched: 0, ambiguous: 1 });
      expect(created.body.items).toHaveLength(1);
      expect(created.body.items[0]).toMatchObject(ambiguousEpisode);
      expect(created.body.items[0].candidates.map((candidate: { titleId: number }) => candidate.titleId).sort((a: number, b: number) => a - b))
        .toEqual(titleIds);

      const item = created.body.items[0];
      const showWithoutExactEpisode = titles.find((title) => title.imdbId === imdbIds[1])!;
      const rejected = await supertest(app)
        .patch(`/api/imports/${importId}/items/${item.id}`)
        .set("x-test-user", USER_A)
        .send({ titleId: showWithoutExactEpisode.id });
      expect(rejected.status).toBe(400);
      expect(rejected.body).toEqual({ error: "Candidate does not contain the exact episode" });

      const preview = await supertest(app).get(`/api/imports/${importId}`).set("x-test-user", USER_A);
      expect(preview.status).toBe(200);
      expect(preview.body.status).toBe("ready");
      expect(preview.body.summary).toEqual(created.body.summary);
      expect(preview.body.items).toEqual([item]);

      const confirmed = await supertest(app).post(`/api/imports/${importId}/confirm`).set("x-test-user", USER_A);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe("confirmed");
      expect(confirmed.body.summary).toMatchObject({ selected: 0, applied: 0, skipped: 1, ambiguous: 1 });
      expect(confirmed.body.items).toEqual([item]);
      const watched = await db.select().from(watchedEpisodesTable).where(and(
        eq(watchedEpisodesTable.userId, USER_A),
        inArray(watchedEpisodesTable.titleId, titleIds),
      ));
      expect(watched).toHaveLength(0);
      const watchedTitles = await db.select().from(watchedTitlesTable).where(and(
        eq(watchedTitlesTable.userId, USER_A),
        inArray(watchedTitlesTable.titleId, titleIds),
      ));
      expect(watchedTitles).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      await db.delete(rateLimitHitsTable).where(inArray(rateLimitHitsTable.key, [
        `import_create:${USER_A}`,
        `import_confirm:${USER_A}`,
      ]));
      if (importId !== undefined) await db.delete(importsTable).where(eq(importsTable.id, importId));
      if (titleIds.length) await db.delete(watchedEpisodesTable).where(and(
        eq(watchedEpisodesTable.userId, USER_A),
        inArray(watchedEpisodesTable.titleId, titleIds),
      ));
      if (titleIds.length) await db.delete(watchedTitlesTable).where(and(
        eq(watchedTitlesTable.userId, USER_A),
        inArray(watchedTitlesTable.titleId, titleIds),
      ));
      await db.delete(titlesTable).where(inArray(titlesTable.imdbId, imdbIds));
      await db.delete(integrationHealthTable);
      if (healthSnapshot.length) await db.insert(integrationHealthTable).values(healthSnapshot);
    }
  });

  it("rolls back prior tracking writes when any selected item fails during confirmation", async () => {
    const content = [
      "kind,title,type,year",
      "watchlist,__import_rollback_valid__,movie,2021",
      "watchlist,__import_rollback_broken__,movie,2022",
    ].join("\n");
    const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
      source: "generic", fileName: "rollback.csv", content,
    });
    expect(created.status).toBe(201);
    // Foreign-key SET NULL makes the second prevalidated item fail its
    // not-null tracking insert after the first row has been attempted.
    await db.delete(titlesTable).where(eq(titlesTable.id, rollbackBrokenId));
    cleanupTitleIds = cleanupTitleIds.filter((id) => id !== rollbackBrokenId);
    const failed = await supertest(app).post(`/api/imports/${created.body.id}/confirm`).set("x-test-user", USER_A);
    expect(failed.status).toBe(500);
    const rows = await db.select().from(watchlistTable).where(and(eq(watchlistTable.userId, USER_A), eq(watchlistTable.titleId, rollbackValidId)));
    expect(rows).toHaveLength(0);
    const job = await supertest(app).get(`/api/imports/${created.body.id}`).set("x-test-user", USER_A);
    expect(job.body.status).toBe("ready");
  });

  it("reports actual confirmation conflicts rather than counting preview selection as applied", async () => {
    const content = "kind,title,type,year\nwatchlist,__import_alt_canonical__,movie,2020";
    const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
      source: "generic", fileName: "actual-conflict.csv", content,
    });
    expect(created.status).toBe(201);
    await db.insert(watchlistTable).values({ userId: USER_A, titleId: altTitleId }).onConflictDoNothing();
    const confirmed = await supertest(app).post(`/api/imports/${created.body.id}/confirm`).set("x-test-user", USER_A);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.summary).toMatchObject({ selected: 1, applied: 0, duplicates: 1, skipped: 0 });
  });

  it("accepts a 2 MiB decoded import even when JSON unicode escaping expands its transport body", async () => {
    const prefix = "kind,title\\nwatched_movie,";
    const decodedContentLength = 2 * 1024 * 1024;
    const raw = `{"source":"generic","fileName":"escaped.csv","content":"${prefix}${"\\u0061".repeat(decodedContentLength - prefix.length)}"}`;
    const response = await supertest(app)
      .post("/api/imports")
      .set("x-test-user", USER_A)
      .set("Content-Type", "application/json")
      .send(raw);
    // The title exceeds the per-row title limit, so the resulting preview is
    // invalid; 201 proves route-local JSON parsing accepted the >12 MiB wire body.
    expect(response.status).toBe(201);
    expect(response.body.summary.invalid).toBe(1);
  });

  it("never logs a malformed import request body", async () => {
    (logger.error as any).mockClear();
    const marker = "RAW_IMPORT_CONTENT_MUST_NOT_APPEAR";
    const response = await supertest(app)
      .post("/api/imports")
      .set("x-test-user", USER_A)
      .set("Content-Type", "application/json")
      .send(`{"source":"generic","content":"${marker}"`);
    expect(response.status).toBe(400);
    expect(JSON.stringify((logger.error as any).mock.calls)).not.toContain(marker);
  });

  it("maps body-parser size errors to a safe 413 response", async () => {
    (logger.error as any).mockClear();
    const marker = "OVERSIZED_REQUEST_CONTENT_MUST_NOT_APPEAR";
    const response = await supertest(app)
      .post("/api/not-import")
      .set("Content-Type", "application/json")
      .send({ content: `${marker}${"x".repeat(1024 * 1024)}` });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "Request body too large" });
    expect(JSON.stringify((logger.error as any).mock.calls)).not.toContain(marker);
  });

  it("authenticates and rate-limits before buffering/parsing the import body", async () => {
    const oversizedMalformed = `{"content":"${"x".repeat(1024 * 1024 + 1)}`;
    const unauthenticated = await supertest(app)
      .post("/api/imports")
      .set("Content-Type", "application/json")
      .send(oversizedMalformed);
    // Route-local JSON parsing has not run: authentication rejects first.
    expect(unauthenticated.status).toBe(401);

    await db.delete(rateLimitHitsTable).where(eq(rateLimitHitsTable.key, `import_create:${USER_A}`));
    for (let index = 0; index < 10; index += 1) {
      const response = await supertest(app).post("/api/imports").set("x-test-user", USER_A).set("Content-Type", "application/json").send("{");
      expect(response.status).toBe(400);
    }
    const blocked = await supertest(app).post("/api/imports").set("x-test-user", USER_A).set("Content-Type", "application/json").send("{");
    // If parser buffering happened before the limiter this would be a 400.
    expect(blocked.status).toBe(429);
  });

  it("completes concurrent resolve and confirm work with a bounded connection pool", async () => {
    await db.delete(rateLimitHitsTable).where(eq(rateLimitHitsTable.key, `import_create:${USER_A}`));
    const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
      source: "generic",
      fileName: "bounded-pool-race.csv",
      content: "kind,title,type,year\nwatched_movie,__import_ambiguous_title__,movie,2023",
    });
    expect(created.status).toBe(201);
    const item = created.body.items[0];
    const heldClients = await Promise.all(Array.from(
      { length: Math.max(0, (pool.options.max ?? 10) - 1) },
      () => pool.connect(),
    ));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Leave exactly one client for the PATCH transaction. Before this fix,
      // that transaction held it then queried through global db, requiring an
      // unavailable second client and starving the queued confirmation.
      const resolving = new Promise<supertest.Response>((resolve, reject) => {
        supertest(app)
          .patch(`/api/imports/${created.body.id}/items/${item.id}`)
          .set("x-test-user", USER_A)
          .send({ titleId: ambiguousTitleIds[0] })
          .end((error, response) => error ? reject(error) : resolve(response));
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      const confirming = new Promise<supertest.Response>((resolve, reject) => {
        supertest(app)
          .post(`/api/imports/${created.body.id}/confirm`)
          .set("x-test-user", USER_A)
          .end((error, response) => error ? reject(error) : resolve(response));
      });
      const completed = await Promise.race([
        Promise.all([resolving, confirming]),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("bounded-pool resolve/confirm timed out")), 2_000);
        }),
      ]);
      expect(completed[0].status).toBe(200);
      expect(completed[1].status).toBe(200);
    } finally {
      if (timeout) clearTimeout(timeout);
      heldClients.forEach((client) => client.release());
    }
  });

  it("previews and confirms a near-limit import with bounded catalog queries and intra-file duplicates", async () => {
    await db.delete(rateLimitHitsTable).where(eq(rateLimitHitsTable.key, `import_create:${USER_A}`));
    const content = [
      "kind,title,type,year",
      ...Array.from({ length: 4_900 }, () => "watched_movie,__import_large_batch__,movie,2025"),
    ].join("\n");
    const selectSpy = vi.spyOn(db, "select");
    let created: supertest.Response;
    try {
      created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
        source: "generic", fileName: "near-limit.csv", content,
      });
    } finally {
      selectSpy.mockRestore();
    }
    expect(created!.status).toBe(201);
    // One catalog projection plus bounded user-tracking lookups replaces the
    // old per-row catalog and duplicate reads (which exceeded 10,000 queries).
    expect(selectSpy.mock.calls.length).toBeLessThanOrEqual(10);
    expect(created!.body.summary).toMatchObject({ matched: 1, duplicate: 4_899 });
    const confirmed = await supertest(app).post(`/api/imports/${created!.body.id}/confirm`).set("x-test-user", USER_A);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.summary).toMatchObject({ selected: 1, applied: 1, duplicates: 4_899 });
    const writes = await db.select().from(watchedTitlesTable).where(and(
      eq(watchedTitlesTable.userId, USER_A),
      eq(watchedTitlesTable.titleId, largeBatchTitleId),
    ));
    expect(writes).toHaveLength(1);
  });
});
