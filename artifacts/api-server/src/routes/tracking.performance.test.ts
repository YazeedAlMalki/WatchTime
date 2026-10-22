/**
 * Repeatable large-library regression check against the real PostgreSQL database.
 * Run: pnpm --filter @workspace/api-server exec vitest run src/routes/tracking.performance.test.ts
 *
 * Latency is reported (not asserted against a CI-machine-dependent wall-clock
 * threshold). Query count, returned rows, alias rows scanned and JSON size are
 * asserted.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";

const USER_ID = "test-large-library-performance";
const SHOW_COUNT = 400;
const EPISODES_PER_SHOW = 200;
const PAGE_SIZE = 20;
const PROGRESS_LEVELS = [0, 20, 100, 180, EPISODES_PER_SHOW];

vi.mock("../middlewares/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = USER_ID; next(); },
  requireAdmin: (_req: any, res: any) => res.status(403).end(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("pino-http", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("@clerk/express", () => ({ clerkMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk",
  clerkProxyMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getClerkProxyHost: () => null,
}));

import supertest from "supertest";
import trackingRouter from "./tracking";
import {
  db, pool, usersTable, titlesTable, titleAliasesTable, episodesTable,
  watchedTitlesTable, watchedEpisodesTable, watchlistTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

const app = express();
app.use("/api", trackingRouter);

let titleIds: number[] = [];
const ALIASES_PER_SHOW = 9;

async function removeFixture() {
  // Also removes leftovers if a previous benchmark process was interrupted.
  const rows = await db.select({ id: titlesTable.id }).from(titlesTable)
    .where(like(titlesTable.name, "\\_\\_large\\_library\\_%"));
  const ids = rows.map((row) => row.id);
  await db.delete(watchedEpisodesTable).where(eq(watchedEpisodesTable.userId, USER_ID));
  await db.delete(watchedTitlesTable).where(eq(watchedTitlesTable.userId, USER_ID));
  await db.delete(watchlistTable).where(eq(watchlistTable.userId, USER_ID));
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    await db.delete(episodesTable).where(inArray(episodesTable.titleId, batch));
    await db.delete(titlesTable).where(inArray(titlesTable.id, batch));
  }
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
}

beforeAll(async () => {
  await removeFixture();
  await db.insert(usersTable).values({
    id: USER_ID, email: "large-library-performance@example.test", isAdmin: false,
  }).onConflictDoNothing();
  const titles = await db.insert(titlesTable).values(
    Array.from({ length: SHOW_COUNT }, (_, i) => ({
      name: `__large_library_${i}__`, type: "tv" as const, popularity: 0,
    })),
  ).returning({ id: titlesTable.id });
  titleIds = titles.map((row) => row.id);

  const aliases = titleIds.flatMap((titleId) => [
    { titleId, alias: "needle", normalizedAlias: "needle", sourceName: "performance-fixture" },
    ...Array.from({ length: ALIASES_PER_SHOW - 1 }, (_, i) => {
      const alias = `Needle alternate ${titleId}-${i}`;
      return {
        titleId, alias, normalizedAlias: alias.toLowerCase(), sourceName: "performance-fixture",
      };
    }),
  ]);
  for (let i = 0; i < aliases.length; i += 1000) {
    await db.insert(titleAliasesTable).values(aliases.slice(i, i + 1000));
  }

  await db.insert(watchedTitlesTable).values(titleIds.map((titleId) => ({ userId: USER_ID, titleId })));
  const movies = await db.insert(titlesTable).values(
    Array.from({ length: 200 }, (_, i) => ({ name: `__large_library_movie_${i}__`, type: "movie" as const })),
  ).returning({ id: titlesTable.id });
  const movieIds = movies.map((row) => row.id);
  await db.insert(watchedTitlesTable).values(movieIds.map((titleId) => ({ userId: USER_ID, titleId })));
  await db.insert(watchlistTable).values([...titleIds, ...movieIds].map((titleId) => ({ userId: USER_ID, titleId })));

  // Every fifth show is new, barely started, halfway, nearly done, or
  // caught up. Keep the insert chunks below PostgreSQL's parameter limit.
  for (let start = 0; start < titleIds.length; start += 20) {
    const batch = titleIds.slice(start, start + 20);
    const episodes = await db.insert(episodesTable).values(batch.flatMap((titleId) =>
      Array.from({ length: EPISODES_PER_SHOW }, (_, e) => ({
        titleId, seasonNumber: Math.floor(e / 20) + 1,
        episodeNumber: e % 20 + 1, name: `Episode ${e + 1}`,
      })),
    )).returning({ id: episodesTable.id, titleId: episodesTable.titleId });
    const watched = episodes.flatMap((episode, index) => {
      const showIndex = start + Math.floor(index / EPISODES_PER_SHOW);
      const watchedCount = PROGRESS_LEVELS[showIndex % 5];
      return index % EPISODES_PER_SHOW < watchedCount
        ? [{ userId: USER_ID, titleId: episode.titleId, episodeId: episode.id }]
        : [];
    });
    for (let i = 0; i < watched.length; i += 1000) {
      await db.insert(watchedEpisodesTable).values(watched.slice(i, i + 1000));
    }
  }
  // Prevent stale planner statistics from favoring a full scan of a newly
  // seeded table instead of the production indexes.
  await pool.query("ANALYZE titles, title_aliases, episodes, watched_titles, watched_episodes, watchlist");
}, 120_000);

afterAll(async () => {
  await removeFixture();
}, 120_000);

type QuerySample = { sql: string; rows: number; values: unknown[] };

async function measuredPageFor(path: string, limit: number, boundary?: { beforeId?: number; before?: string }) {
  const samples: QuerySample[] = [];
  const originalQuery = pool.query.bind(pool);
  const querySpy = vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
    const statement = args[0] as string | { text: string; values?: unknown[] };
    const result = (originalQuery as (...args: unknown[]) => Promise<{ rows: unknown[] }>)(...args);
    return result.then((value) => {
      const text = typeof statement === "string" ? statement : statement.text;
      if (/^\s*(select|with)\b/i.test(text)) {
        samples.push({ sql: text, rows: value.rows.length, values: typeof statement === "string" ? (args[1] as unknown[] ?? []) : (statement.values ?? []) });
      }
      return value;
    });
  }) as typeof pool.query);
  try {
    const start = performance.now();
    const response = await supertest(app).get(path).query({ limit, ...boundary });
    return { response, samples, milliseconds: performance.now() - start };
  } finally {
    querySpy.mockRestore();
  }
}

const measuredPage = (limit: number, offset: number) =>
  measuredPageFor("/api/me/shows", limit,
    offset === 0 ? undefined : { beforeId: offset === SHOW_COUNT ? titleIds[0] : titleIds[SHOW_COUNT - offset] });

describe("large personal library", () => {
  it("keeps alternate-title search work bounded with multiple matching aliases per show", async () => {
    // Keep the query shape and page behavior representative of the API search
    // while using multiple matching aliases for every tracked show.
    const searched = await measuredPageFor(
      "/api/me/shows?q=needle", PAGE_SIZE, undefined,
    );
    expect(searched.response.status).toBe(200);
    expect(searched.response.body).toHaveLength(PAGE_SIZE);
    expect(searched.samples.length).toBeGreaterThanOrEqual(1);
    expect(searched.samples.length).toBeLessThanOrEqual(2);
    expect(searched.samples.every((sample) => sample.rows <= PAGE_SIZE)).toBe(true);
    expect(Buffer.byteLength(searched.response.text)).toBeLessThan(PAGE_SIZE * 1000);
    expect(searched.response.body.map((show: any) => show.title.id))
      .toEqual(titleIds.slice(-PAGE_SIZE).reverse());
    expect(searched.response.body.every((show: any) => show.matchedAlternateTitle === "needle"))
      .toBe(true);

    const searchQuery = searched.samples.find((sample) => sample.sql.includes("title_aliases"));
    expect(searchQuery).toBeDefined();
    const explained = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${searchQuery!.sql}`,
      searchQuery!.values,
    );
    const plan = explained.rows[0]["QUERY PLAN"][0] as {
      "Execution Time": number;
      Plan: Record<string, unknown>;
    };
    const aliasNodes: Record<string, unknown>[] = [];
    const aliasIndexes: string[] = [];
    const walk = (node: Record<string, unknown>) => {
      if (node["Relation Name"] === "title_aliases") aliasNodes.push(node);
      if (typeof node["Index Name"] === "string" && String(node["Index Name"]).startsWith("title_aliases_")) {
        aliasIndexes.push(node["Index Name"] as string);
      }
      for (const child of (node.Plans ?? []) as Record<string, unknown>[]) walk(child);
    };
    walk(plan.Plan);
    const aliasRowsScanned = aliasNodes.reduce((total, node) => {
      const rows = Number(node["Actual Rows"] ?? 0);
      const removed = Number(node["Rows Removed by Filter"] ?? 0);
      const loops = Number(node["Actual Loops"] ?? 0);
      return total + (rows + removed) * loops;
    }, 0);
    expect(aliasIndexes.some((name) =>
      name === "title_aliases_title_idx" || name === "title_aliases_title_normalized_idx",
    )).toBe(true);
    // Both the match predicate and the selected display alias may read aliases;
    // their work should scale with the returned page, not the whole collection.
    expect(aliasRowsScanned).toBeGreaterThan(0);
    expect(aliasRowsScanned).toBeLessThanOrEqual(4 * PAGE_SIZE * ALIASES_PER_SHOW);
    process.stdout.write(`Alternate-title benchmark (${SHOW_COUNT} tracked shows, ${SHOW_COUNT * ALIASES_PER_SHOW} matching aliases): ${JSON.stringify({ milliseconds: Math.round(searched.milliseconds), responseBytes: Buffer.byteLength(searched.response.text), aliasRowsScanned, aliasIndexes: [...new Set(aliasIndexes)], planMs: plan["Execution Time"] })}\n`);
  }, 120_000);

  it("keeps in-progress discovery bounded on first and later ID pages", async () => {
    const measurements: Array<{ offset: number; milliseconds: number; bytes: number }> = [];
    const expected = titleIds.flatMap((id, index) =>
      [1, 2, 3].includes(index % 5) ? [id] : []).reverse();
    let laterQuery: QuerySample | undefined;

    for (const offset of [0, 160, 320]) {
      const boundary = offset === 0 ? undefined : { beforeId: titleIds[SHOW_COUNT - offset] };
      const { response, samples, milliseconds } = await measuredPageFor(
        "/api/me/shows/in-progress", PAGE_SIZE, boundary,
      );
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(PAGE_SIZE);
      expect(samples.length).toBeGreaterThanOrEqual(1);
      expect(samples.length).toBeLessThanOrEqual(2);
      expect(samples.every((sample) => sample.rows <= PAGE_SIZE)).toBe(true);
      const bytes = Buffer.byteLength(response.text);
      expect(bytes).toBeLessThan(PAGE_SIZE * 1000);
      const expectedPage = expected.filter((id) => boundary === undefined || id < boundary.beforeId).slice(0, PAGE_SIZE);
      expect(response.body.map((show: any) => show.title.id)).toEqual(expectedPage);
      expect(response.body.every((show: any) =>
        PROGRESS_LEVELS.slice(1, -1).includes(show.watchedEpisodes) &&
        show.totalEpisodes === EPISODES_PER_SHOW &&
        show.nextEpisode !== null)).toBe(true);
      measurements.push({ offset, milliseconds: Math.round(milliseconds), bytes });
      if (offset === 320) laterQuery = samples[0];
    }

    expect(laterQuery).toBeDefined();
    const explained = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${laterQuery!.sql}`, laterQuery!.values,
    );
    const plan = explained.rows[0]["QUERY PLAN"][0] as { "Execution Time": number; Plan: Record<string, unknown> };
    const indexes: string[] = [];
    const walk = (node: Record<string, unknown>) => {
      if (typeof node["Index Name"] === "string") indexes.push(node["Index Name"]);
      for (const child of (node.Plans ?? []) as Record<string, unknown>[]) walk(child);
    };
    walk(plan.Plan);
    expect(indexes).toContain("watched_episodes_user_episode_idx");
    expect(indexes).toContain("episodes_title_order_idx");
    process.stdout.write(`In-progress benchmark (${SHOW_COUNT} shows, ${SHOW_COUNT * EPISODES_PER_SHOW} episodes, ${SHOW_COUNT / 5 * PROGRESS_LEVELS.reduce((sum, count) => sum + count, 0)} watched): ${JSON.stringify({ measurements, laterPlanMs: plan["Execution Time"], indexes: [...new Set(indexes)] })}\n`);
  }, 120_000);

  it("keeps My Shows queries and payloads bounded while reporting mixed-progress latency", async () => {
    const measurements: Array<{ offset: number; milliseconds: number; bytes: number }> = [];
    let mainQuery: QuerySample | undefined;
    // ID-desc pages contain a mix of progress levels (including the
    // NOT EXISTS next-episode lookup) rather than grouping by progress.
    for (const offset of [0, 160, 320]) {
      const { response, samples, milliseconds } = await measuredPage(PAGE_SIZE, offset);
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(PAGE_SIZE);
      expect(samples.length).toBeGreaterThanOrEqual(1);
      expect(samples.length).toBeLessThanOrEqual(2);
      expect(samples.every((sample) => sample.rows <= PAGE_SIZE)).toBe(true);
      expect(Buffer.byteLength(response.text)).toBeLessThan(PAGE_SIZE * 1000);
      measurements.push({ offset, milliseconds: Math.round(milliseconds), bytes: Buffer.byteLength(response.text) });
      expect(response.body.map((show: any) => show.title.id))
        .toEqual(titleIds.slice(SHOW_COUNT - offset - PAGE_SIZE, SHOW_COUNT - offset).reverse());
      for (const count of PROGRESS_LEVELS) {
        expect(response.body.filter((show: any) => show.watchedEpisodes === count)).toHaveLength(4);
      }
      expect(response.body.every((show: any) =>
        (show.nextEpisode === null) === (show.watchedEpisodes === EPISODES_PER_SHOW))).toBe(true);
      if (offset === 160) mainQuery = samples[0];
    }
    const largerPage = await measuredPage(50, 160);
    expect(largerPage.response.status).toBe(200);
    expect(largerPage.response.body).toHaveLength(50);
    expect(largerPage.samples.length).toBeLessThanOrEqual(2);
    expect(largerPage.samples.every((sample) => sample.rows <= 50)).toBe(true);
    expect(Buffer.byteLength(largerPage.response.text)).toBeLessThan(50 * 1000);
    const empty = await measuredPage(PAGE_SIZE, SHOW_COUNT);
    expect(empty.response.status).toBe(200);
    expect(empty.response.body).toEqual([]);
    expect(empty.samples.length).toBe(1);
    expect(empty.samples[0].rows).toBe(0);

    // Inspect the real SQL emitted by the route with the same bind values.
    // These index names already exist in the schema; no additional composite
    // index is justified unless this plan changes on the seeded distribution.
    expect(mainQuery).toBeDefined();
    const explained = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${mainQuery!.sql}`, mainQuery!.values,
    );
    const plan = explained.rows[0]["QUERY PLAN"][0] as {
      "Execution Time": number;
      Plan: Record<string, unknown>;
    };
    const indexes: string[] = [];
    const walk = (node: Record<string, unknown>) => {
      if (typeof node["Index Name"] === "string") indexes.push(node["Index Name"]);
      for (const child of (node.Plans ?? []) as Record<string, unknown>[]) walk(child);
    };
    walk(plan.Plan);
    // The planner may correctly choose a sequential scan for watched counts
    // when this one fixture owns most rows in the development database.
    expect(indexes).toContain("episodes_title_order_idx");
    expect(indexes).toContain("watched_episodes_user_episode_idx");
    process.stdout.write(`My Shows benchmark (${SHOW_COUNT} shows, 200 movies, ${SHOW_COUNT * EPISODES_PER_SHOW} episodes, ${SHOW_COUNT / 5 * PROGRESS_LEVELS.reduce((sum, count) => sum + count, 0)} watched): ${JSON.stringify({ measurements, planMs: plan["Execution Time"], indexes: [...new Set(indexes)] })}\n`);
  }, 120_000);

  it("bounds movie and watchlist reads independently of collection size", async () => {
    for (const path of ["/api/me/movies", "/api/me/watchlist"]) {
      const first = await supertest(app).get(path).query({ limit: PAGE_SIZE });
      expect(first.status).toBe(200);
      const second = await supertest(app).get(path).query({
        limit: PAGE_SIZE, before: first.body.at(-1).collectionCursor,
      });
      expect(second.status).toBe(200);
      const { response, samples } = await measuredPageFor(path, PAGE_SIZE, {
        before: second.body.at(-1).collectionCursor,
      });
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(PAGE_SIZE);
      expect(samples).toHaveLength(1);
      expect(samples[0].rows).toBeLessThanOrEqual(PAGE_SIZE);
      expect(Buffer.byteLength(response.text)).toBeLessThan(PAGE_SIZE * 1000);
    }
  });
});