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
  await db.delete(importsTable).where(eq(importsTable.userId, USER_A));
  await db.delete(watchedEpisodesTable).where(eq(watchedEpisodesTable.userId, USER_A));
  await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.userId, USER_A));
  await db.delete(watchlistTable).where(eq(watchlistTable.userId, USER_A));
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

  it("matches a regional alias added by a catalog refresh while leaving a shared alias for manual review", async () => {
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
        _embedded: { cast: [], episodes: [] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    try {
      // Seed the canonical titles first, then add their sourced aliases in a refresh.
      const initial = await runCatalogSync({ dryRun: false, allowPartial: true }, fixtures.map((item) => ({ ...item, aliases: [] })));
      expect(initial?.failures).toEqual([]);
      const refreshed = await runCatalogSync({ dryRun: false, allowPartial: true }, fixtures);
      expect(refreshed?.succeeded).toBe(2);
      expect(refreshed?.failures).toEqual([]);

      const titles = await db.select().from(titlesTable).where(inArray(titlesTable.imdbId, ["tt9990091", "tt9990092"]));
      expect(titles).toHaveLength(2);
      const primaryId = titles.find((title) => title.imdbId === "tt9990091")!.id;
      const secondaryId = titles.find((title) => title.imdbId === "tt9990092")!.id;
      const aliases = await db.select().from(titleAliasesTable).where(inArray(titleAliasesTable.titleId, [primaryId, secondaryId]));
      expect(aliases.find((alias) => alias.titleId === primaryId && alias.alias === "地域限定タイトル")).toMatchObject({
        language: "ja",
        isEditorial: false,
      });
      expect(aliases.filter((alias) => alias.alias === "共通タイトル")).toHaveLength(2);

      const created = await supertest(app).post("/api/imports").set("x-test-user", USER_A).send({
        source: "generic",
        fileName: "refreshed-regional-titles.csv",
        content: "kind,title,type,year\nwatchlist,地域限定タイトル,tv,2020\nwatchlist,共通タイトル,tv,2020",
      });
      expect(created.status).toBe(201);
      importId = created.body.id;
      expect(created.body.items[0]).toMatchObject({ classification: "matched", titleId: primaryId, selected: true });
      expect(created.body.items[1]).toMatchObject({
        classification: "ambiguous",
        titleId: null,
        selected: false,
        errorCode: "multiple_titles",
      });
      expect(created.body.items[1].candidates.map((candidate: { titleId: number }) => candidate.titleId).sort((a: number, b: number) => a - b))
        .toEqual([primaryId, secondaryId].sort((a, b) => a - b));

      const confirmed = await supertest(app).post(`/api/imports/${importId}/confirm`).set("x-test-user", USER_A);
      expect(confirmed.status).toBe(200);
      const tracked = await db.select().from(watchlistTable).where(and(
        eq(watchlistTable.userId, USER_A),
        inArray(watchlistTable.titleId, [primaryId, secondaryId]),
      ));
      expect(tracked.map((row) => row.titleId)).toEqual([primaryId]);
    } finally {
      vi.unstubAllGlobals();
      if (importId !== undefined) await db.delete(importsTable).where(eq(importsTable.id, importId));
      await db.delete(titlesTable).where(inArray(titlesTable.imdbId, ["tt9990091", "tt9990092"]));
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