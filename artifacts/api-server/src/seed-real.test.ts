import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  catalogSyncItemsTable,
  catalogSyncRunsTable,
  db,
  episodesTable,
  integrationHealthTable,
  pool,
  providerMappingsTable,
  safetyRecordsTable,
  titlesTable,
  titleAliasesTable,
  watchProvidersTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  parseArgs,
  isCatalogSyncCli,
  runCatalogSync,
  sourceItems,
  TVMAZE_MANIFEST,
  validateTvMazeResponse,
  type SourceItem,
} from "./seed-real";
import {
  scheduleCatalogRefresh,
  startCatalogRefresh,
} from "./lib/catalog-refresh";

const testImdb = "tt9990001";
const wikipediaSuccessImdb = "tt9990003";
const wikipediaFailureImdb = "tt9990004";
const testId = 990001;
const testItem: SourceItem = {
  key: "test:identity",
  source: "tvmaze",
  type: "tv",
  name: "Test Identity Series",
  tvmazeId: testId,
  expectedTitle: "Test Identity Series",
  expectedYear: 2020,
  expectedImdbId: testImdb,
  aliases: [
    { alias: "Alternate Test Title", language: "en", sourceName: "Test catalog", sourceUrl: "https://example.test/en" },
    { alias: " alternate test title ", language: "en", sourceName: "Duplicate test catalog", sourceUrl: "https://example.test/duplicate" },
    { alias: "Test Identity Series", language: "en", sourceName: "Test catalog", sourceUrl: "https://example.test/canonical" },
    { alias: "テスト作品", language: "ja", sourceName: "JA Wikipedia", sourceUrl: "https://ja.wikipedia.org/wiki/テスト" },
    { alias: "عمل تجريبي", language: "ar", sourceName: "AR Wikipedia", sourceUrl: "https://ar.wikipedia.org/wiki/عمل_تجريبي" },
  ],
  popularity: 0,
};
const showPayload = {
  id: testId,
  name: testItem.name,
  type: "Scripted",
  genres: ["Drama"],
  premiered: "2020-01-01",
  status: "Ended",
  summary: "<p>A sourced test summary.</p>",
  image: { medium: "https://example.test/poster.jpg" },
  externals: { imdb: testImdb },
  _embedded: {
    cast: [{ person: { name: "Test Actor" }, character: { name: "Lead" } }],
    episodes: [{
      season: 1,
      number: 1,
      name: "Pilot",
      summary: "<p>Episode summary</p>",
      runtime: 42,
      airdate: "2020-01-01",
    }],
  },
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const catalogRunIds: number[] = [];
const scheduledTimers: NodeJS.Timeout[] = [];

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function waitForCatalogRun(
  runId: number,
  predicate: (run: typeof catalogSyncRunsTable.$inferSelect) => boolean,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [run] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, runId));
    if (run && predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Catalog refresh run ${runId} did not reach the expected state`);
}

let healthSnapshot: (typeof integrationHealthTable.$inferSelect)[] = [];
beforeEach(async () => {
  healthSnapshot = await db.select().from(integrationHealthTable);
});

afterEach(async () => {
  for (const timer of scheduledTimers.splice(0)) clearTimeout(timer);
  if (catalogRunIds.length) {
    await db.delete(catalogSyncRunsTable).where(inArray(catalogSyncRunsTable.id, catalogRunIds.splice(0)));
  }
  vi.unstubAllGlobals();
  const testTitles = await db.select({ id: titlesTable.id }).from(titlesTable)
    .where(inArray(titlesTable.imdbId, [testImdb, wikipediaSuccessImdb, wikipediaFailureImdb]));
  if (testTitles.length) {
    await db.delete(titlesTable).where(inArray(titlesTable.id, testTitles.map(({ id }) => id)));
  }
  await db.delete(integrationHealthTable);
  if (healthSnapshot.length) await db.insert(integrationHealthTable).values(healthSnapshot);
});

describe("real catalog sync", () => {
  it("never treats the bundled API server entry as the catalog CLI", () => {
    expect(isCatalogSyncCli(
      "/workspace/artifacts/api-server/dist/index.mjs",
      "file:///workspace/artifacts/api-server/dist/index.mjs",
    )).toBe(false);
    expect(isCatalogSyncCli(
      "/workspace/artifacts/api-server/src/seed-real.ts",
      "file:///workspace/artifacts/api-server/src/seed-real.ts",
    )).toBe(true);
  });
  it("includes sourced original-language aliases for the remaining popular anime", () => {
    const aliases = new Map(TVMAZE_MANIFEST.map((entry) => [entry.name, entry.aliases ?? []]));
    expect(aliases.get("Cowboy Bebop")?.map((source) => source.alias)).toContain("カウボーイビバップ");
    expect(aliases.get("Neon Genesis Evangelion")?.map((source) => source.alias)).toContain("新世紀エヴァンゲリオン");
    expect(aliases.get("Sailor Moon")?.map((source) => source.alias)).toContain("美少女戦士セーラームーン");
    expect(aliases.get("Pokémon")?.map((source) => source.alias)).toContain("ポケットモンスター");
    expect(aliases.get("Code Geass")?.map((source) => source.alias)).toContain("コードギアス 反逆のルルーシュ");
  });

  it("keeps verifiable provenance on each curated alias", () => {
    const aliases = new Map(TVMAZE_MANIFEST.map((entry) => [entry.name, entry.aliases ?? []]));
    expect(aliases.get("Attack on Titan")?.find((source) => source.alias === "進撃の巨人")).toMatchObject({
      language: "ja",
      sourceName: "JA Wikipedia",
      sourceUrl: expect.stringContaining("ja.wikipedia.org/wiki/"),
    });
    expect(aliases.get("Breaking Bad")?.find((source) => source.alias === "اختلال ضال")).toMatchObject({
      language: "ar",
      sourceName: "AR Wikipedia",
      sourceUrl: expect.stringContaining("ar.wikipedia.org/wiki/"),
    });
    expect(aliases.get("The Staircase")?.find((source) => source.alias === "Soupçons")).toEqual({
      alias: "Soupçons",
      language: "fr",
      sourceName: "TVMaze",
      sourceUrl: "https://www.tvmaze.com/shows/13645",
    });
  });

  it("validates manifest identity and rejects a collision before writes", () => {
    expect(() => validateTvMazeResponse(testItem, { ...showPayload, id: testId + 1 })).toThrow(/identity mismatch/);
    expect(() => validateTvMazeResponse(testItem, { ...showPayload, name: "Wrong Series" })).toThrow(/title mismatch/);
  });

  it("backfills only a provider supported by the alias citation or a single title mapping", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO pg_temp");
      await client.query(`
        CREATE TEMP TABLE provider_mappings (title_id integer, provider text);
        CREATE TEMP TABLE title_aliases (
          title_id integer,
          alias text,
          source_name text NOT NULL,
          source_url text,
          is_editorial boolean NOT NULL
        );
        INSERT INTO provider_mappings (title_id, provider) VALUES
          (1, 'TVMaze'),
          (2, 'Wikipedia'),
          (3, 'TVMaze'),
          (3, 'Wikipedia');
        INSERT INTO title_aliases (title_id, alias, source_name, source_url, is_editorial) VALUES
          (1, 'TVMaze-only mapping', 'Legacy catalog', 'https://source.test/tvmaze', false),
          (2, 'Wikipedia-only mapping', 'Legacy catalog', 'https://source.test/wikipedia', false),
          (3, 'TVMaze citation', 'TVMaze', 'https://www.tvmaze.com/shows/3', false),
          (3, 'Wikipedia citation', 'EN Wikipedia', 'https://en.wikipedia.org/wiki/Three', false),
          (3, 'Ambiguous citation', 'Legacy catalog', 'https://source.test/ambiguous', false),
          (3, 'Conflicting citations', 'TVMaze', 'https://en.wikipedia.org/wiki/Three', false);
      `);
      const migration = await readFile(
        new URL("../../../lib/db/drizzle/0004_track_alias_provider_ownership.sql", import.meta.url),
        "utf8",
      );
      await client.query(migration);
      const { rows } = await client.query(
        "SELECT alias, provider_sources FROM title_aliases ORDER BY alias",
      );
      expect(rows).toEqual([
        { alias: "Ambiguous citation", provider_sources: [] },
        { alias: "Conflicting citations", provider_sources: [] },
        { alias: "TVMaze citation", provider_sources: ["tvmaze"] },
        { alias: "TVMaze-only mapping", provider_sources: ["tvmaze"] },
        { alias: "Wikipedia citation", provider_sources: ["wikipedia"] },
        { alias: "Wikipedia-only mapping", provider_sources: ["wikipedia"] },
      ]);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("is repeatable, preserves providers, alternate titles, and episode identity", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(showPayload));
    vi.stubGlobal("fetch", fetchMock);
    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);
    const [title] = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    expect(title).toBeTruthy();
    await db.insert(watchProvidersTable).values({
      titleId: title.id,
      name: "Existing Provider",
      kind: "stream",
    });
    await db.update(titlesTable).set({
      overview: "Richer existing overview",
      runtimeMinutes: 120,
      altTitles: ["Existing Alias"],
    })
      .where(eq(titlesTable.id, title.id));
    await db.update(safetyRecordsTable).set({
      tier: 1,
      status: "available",
      isCommunity: true,
      items: [{ category: "test", label: "verified", score: null, maxScore: null, description: "populated" }],
    }).where(and(
      eq(safetyRecordsTable.titleId, title.id),
      eq(safetyRecordsTable.sourceName, "Common Sense Media"),
    ));
    await db.update(safetyRecordsTable).set({
      status: "available",
      isCommunity: true,
      items: [{ category: "legacy", label: "verified", score: null, maxScore: null, description: "legacy populated" }],
    }).where(and(
      eq(safetyRecordsTable.titleId, title.id),
      eq(safetyRecordsTable.sourceName, "Does the Dog Die?"),
    ));
    fetchMock.mockImplementationOnce(async () => jsonResponse({
      ...showPayload,
      summary: null,
      image: null,
      _embedded: { ...showPayload._embedded, episodes: [{ ...showPayload._embedded.episodes[0], summary: null, runtime: null }] },
    }));

    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);
    const [again] = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    const episodes = await db.select().from(episodesTable).where(eq(episodesTable.titleId, again.id));
    const mappings = await db.select().from(providerMappingsTable).where(eq(providerMappingsTable.titleId, again.id));
    const providers = await db.select().from(watchProvidersTable).where(eq(watchProvidersTable.titleId, again.id));
    const aliases = await db.select().from(titleAliasesTable).where(eq(titleAliasesTable.titleId, again.id));
    expect(again.altTitles).toContain("Alternate Test Title");
    expect(again.altTitles).toContain("Existing Alias");
    expect(again.altTitles).toContain("テスト作品");
    expect(again.altTitles).toContain("عمل تجريبي");
    expect(again.altTitles.filter((title) => title.toLowerCase() === "alternate test title")).toHaveLength(1);
    expect(again.altTitles).not.toContain("Test Identity Series");
    expect(aliases.find((alias) => alias.alias === "Existing Alias")).toMatchObject({
      sourceName: "Existing catalog metadata",
      isEditorial: true,
    });
    expect(aliases.find((alias) => alias.alias === "عمل تجريبي")).toMatchObject({
      language: "ar",
      sourceName: "AR Wikipedia",
      sourceUrl: "https://ar.wikipedia.org/wiki/عمل_تجريبي",
    });
    expect(aliases.find((alias) => alias.alias === "テスト作品")).toMatchObject({
      language: "ja",
      sourceName: "JA Wikipedia",
      sourceUrl: "https://ja.wikipedia.org/wiki/テスト",
    });
    expect(again.overview).toBe("Richer existing overview");
    expect(again.runtimeMinutes).toBe(120);
    const safety = await db.select().from(safetyRecordsTable).where(and(
      eq(safetyRecordsTable.titleId, again.id),
      eq(safetyRecordsTable.sourceName, "Common Sense Media"),
    ));
    expect(safety).toHaveLength(1);
    expect(safety[0].status).toBe("available");
    expect(safety[0].isCommunity).toBe(true);
    const canonicalSafety = await db.select().from(safetyRecordsTable).where(and(
      eq(safetyRecordsTable.titleId, again.id),
      eq(safetyRecordsTable.sourceName, "Does the Dog Die?"),
    ));
    expect(canonicalSafety).toHaveLength(1);
    expect(canonicalSafety[0].status).toBe("available");
    expect(canonicalSafety[0].isCommunity).toBe(true);
    expect(episodes).toHaveLength(1);
    expect(mappings.filter((mapping) => mapping.provider === "TVMaze")).toHaveLength(1);
    expect(providers).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([
      runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]),
      runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]),
    ]);
    const concurrentTitles = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    const concurrentEpisodes = await db.select().from(episodesTable).where(eq(episodesTable.titleId, again.id));
    expect(concurrentTitles).toHaveLength(1);
    expect(concurrentEpisodes).toHaveLength(1);
  });

  it("withdraws only aliases owned by the refreshing provider", async () => {
    const wikipediaItem: SourceItem = {
      key: "movie:shared-title-alias-test",
      source: "wikipedia",
      type: "movie",
      name: testItem.name,
      imdbId: testImdb,
      wikiPage: "Test Identity Series",
      aliases: [
        {
          alias: "Alternate Test Title",
          language: "en",
          sourceName: "EN Wikipedia",
          sourceUrl: "https://en.wikipedia.org/wiki/Test_Identity_Series",
        },
        {
          alias: "Wikipedia Confirmed Title",
          language: "fr",
          sourceName: "FR Wikipedia",
          sourceUrl: "https://fr.wikipedia.org/wiki/Test_Identity_Series",
        },
      ],
      popularity: 0,
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("wikipedia.org")) {
        return jsonResponse({ extract: "A sourced test summary." });
      }
      return jsonResponse(showPayload);
    }));

    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem, wikipediaItem]);
    const [title] = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    let aliases = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, title.id));
    expect(aliases.find((alias) => alias.alias === "Alternate Test Title")?.providerSources)
      .toEqual(["tvmaze", "wikipedia"]);
    expect(aliases.find((alias) => alias.alias === "Wikipedia Confirmed Title")?.providerSources)
      .toEqual(["wikipedia"]);

    await runCatalogSync({ dryRun: false, allowPartial: false }, [
      { ...testItem, aliases: [] },
    ]);

    aliases = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, title.id));
    expect(aliases.find((alias) => alias.alias === "Alternate Test Title"))
      .toMatchObject({
        providerSources: ["wikipedia"],
        providerCitations: {
          wikipedia: {
            sourceName: "EN Wikipedia",
            sourceUrl: "https://en.wikipedia.org/wiki/Test_Identity_Series",
          },
        },
        sourceName: "EN Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/Test_Identity_Series",
        isEditorial: false,
      });
    expect(aliases.find((alias) => alias.alias === "Wikipedia Confirmed Title"))
      .toMatchObject({
        sourceName: "FR Wikipedia",
        providerSources: ["wikipedia"],
        isEditorial: false,
      });
    expect(aliases.some((alias) => alias.alias === "テスト作品")).toBe(false);
  });

  it("does not withdraw an uncertain legacy alias on provider refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(showPayload)));
    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);
    const [title] = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    const uncertainAlias = "Historical Title With Unknown Owner";
    await db.insert(titleAliasesTable).values({
      titleId: title.id,
      alias: uncertainAlias,
      normalizedAlias: "historicaltitlewithunknownowner",
      language: "en",
      sourceName: "Legacy catalog",
      sourceUrl: "https://source.test/legacy-title",
      providerSources: [],
      providerCitations: {},
      isEditorial: false,
    });

    await runCatalogSync({ dryRun: false, allowPartial: false }, [
      { ...testItem, aliases: [] },
    ]);

    const [preservedAlias] = await db.select().from(titleAliasesTable).where(and(
      eq(titleAliasesTable.titleId, title.id),
      eq(titleAliasesTable.normalizedAlias, "historicaltitlewithunknownowner"),
    ));
    const [refreshedTitle] = await db.select().from(titlesTable).where(eq(titlesTable.id, title.id));
    expect(preservedAlias).toMatchObject({
      alias: uncertainAlias,
      providerSources: [],
      isEditorial: false,
    });
    expect(refreshedTitle.altTitles).toContain(uncertainAlias);
  });

  it("does not withdraw aliases when a refresh fails, but withdraws them after a successful refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(showPayload)));
    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);
    const [titleBeforeFailure] = await db.select().from(titlesTable)
      .where(eq(titlesTable.imdbId, testImdb));
    const aliasesBeforeFailure = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, titleBeforeFailure.id))
      .orderBy(titleAliasesTable.id);
    const itemWithWithdrawnAliases = { ...testItem, aliases: [] };

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, 404)));
    const failedRefresh = await runCatalogSync(
      { dryRun: false, allowPartial: true },
      [itemWithWithdrawnAliases],
    );

    const [titleAfterFailure] = await db.select().from(titlesTable)
      .where(eq(titlesTable.id, titleBeforeFailure.id));
    const aliasesAfterFailure = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, titleBeforeFailure.id))
      .orderBy(titleAliasesTable.id);
    expect(failedRefresh?.failures).toHaveLength(1);
    expect(titleAfterFailure.altTitles).toEqual(titleBeforeFailure.altTitles);
    expect(aliasesAfterFailure).toEqual(aliasesBeforeFailure);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(showPayload)));
    const successfulRefresh = await runCatalogSync(
      { dryRun: false, allowPartial: true },
      [itemWithWithdrawnAliases],
    );

    const [titleAfterSuccess] = await db.select().from(titlesTable)
      .where(eq(titlesTable.id, titleBeforeFailure.id));
    const aliasesAfterSuccess = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, titleBeforeFailure.id));
    expect(successfulRefresh?.failures).toHaveLength(0);
    expect(titleAfterSuccess.altTitles).toEqual([]);
    expect(aliasesAfterSuccess).toHaveLength(0);
  });

  it("isolates a failed source item and records scoped partial health", async () => {
    const goodItem = { ...testItem, key: "test:good" };
    const badItem = { ...testItem, key: "test:bad", name: "Bad Source", tvmazeId: testId + 1, expectedTitle: "Bad Source", expectedImdbId: "tt9990002" };
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes(String(testId + 1))
        ? jsonResponse({ error: "unavailable" }, 404)
        : jsonResponse(showPayload),
    );
    vi.stubGlobal("fetch", fetchMock);
    await runCatalogSync({ dryRun: false, allowPartial: true }, [goodItem, badItem]);
    const [health] = await db.select().from(integrationHealthTable).where(eq(integrationHealthTable.provider, "TVMaze"));
    expect(health.status).toBe("degraded");
    expect(health.mappedTitles).toBeGreaterThanOrEqual(healthSnapshot.find((row) => row.provider === "TVMaze")?.mappedTitles ?? 0);
    expect(health.missingMappings).toBe(0);
    const [good] = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    expect(good).toBeTruthy();
  });

  it("accumulates TVMaze and Wikipedia attempts and successes across mixed refreshes", async () => {
    const failedTvItem: SourceItem = {
      ...testItem,
      key: "test:failed-tv",
      name: "Failed Test Identity Series",
      tvmazeId: testId + 1,
      expectedTitle: "Failed Test Identity Series",
      expectedImdbId: "tt9990002",
    };
    const wikipediaSuccessItem: SourceItem = {
      key: "movie:successful-health-count-test",
      source: "wikipedia",
      type: "movie",
      name: "Successful Health Count Test",
      imdbId: wikipediaSuccessImdb,
      wikiPage: "Successful Health Count Test",
      popularity: 0,
    };
    const wikipediaFailureItem: SourceItem = {
      ...wikipediaSuccessItem,
      key: "movie:failed-health-count-test",
      name: "Failed Health Count Test",
      imdbId: wikipediaFailureImdb,
      wikiPage: "Failed Health Count Test",
    };

    await db.delete(integrationHealthTable)
      .where(inArray(integrationHealthTable.provider, ["TVMaze", "Wikipedia"]));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("wikipedia.org")) {
        return url.includes("Failed%20Health")
          ? jsonResponse({ extract: "" })
          : jsonResponse({ extract: "A sourced test summary." });
      }
      return jsonResponse(showPayload);
    }));

    const items = [testItem, failedTvItem, wikipediaSuccessItem, wikipediaFailureItem];
    await runCatalogSync({ dryRun: false, allowPartial: true }, items);

    for (const provider of ["TVMaze", "Wikipedia"]) {
      const [health] = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, provider));
      expect(health).toMatchObject({
        status: "degraded",
        refreshAttempts: 2,
        successfulRefreshes: 1,
      });
      expect(health.successRatePercent).toBeCloseTo(50);
    }

    await runCatalogSync({ dryRun: false, allowPartial: true }, items);

    for (const provider of ["TVMaze", "Wikipedia"]) {
      const [health] = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, provider));
      expect(health).toMatchObject({
        status: "degraded",
        refreshAttempts: 4,
        successfulRefreshes: 2,
      });
      expect(health.successRatePercent).toBeCloseTo(50);
    }
  });

  it("leaves live safety integration health unchanged", async () => {
    await db.delete(integrationHealthTable).where(eq(integrationHealthTable.provider, "Does the Dog Die?"));
    const expected = {
      provider: "Does the Dog Die?",
      status: "healthy",
      lastSyncAt: new Date("2024-01-02T03:04:05.000Z"),
      lastSuccessAt: new Date("2024-01-02T03:04:05.000Z"),
      lastError: null,
      successRatePercent: 100,
      mappedTitles: 42,
      missingMappings: 0,
    } as const;
    await db.insert(integrationHealthTable).values(expected);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(showPayload)));
    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);
    const [actual] = await db.select().from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, "Does the Dog Die?"));
    expect(actual).toMatchObject(expected);
  });

  it("merges duplicate season-level community safety items without losing approved contributions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(showPayload)));
    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);
    const [title] = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    await db.insert(safetyRecordsTable).values([
      {
        titleId: title.id,
        seasonNumber: 1,
        sourceName: "WatchTime Community",
        tier: 3,
        isCommunity: true,
        status: "available",
        items: [{
          contributionId: 101,
          category: "Violence",
          label: "Fight",
          score: null,
          maxScore: null,
          description: "First approved contribution",
        } as any],
      },
      {
        titleId: title.id,
        seasonNumber: 1,
        sourceName: "WatchTime Community",
        tier: 3,
        isCommunity: true,
        status: "available",
        items: [{
          contributionId: 202,
          category: "Language",
          label: "Strong language",
          score: null,
          maxScore: null,
          description: "Second approved contribution",
        } as any],
      },
    ]);

    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);

    const rows = await db.select().from(safetyRecordsTable).where(eq(safetyRecordsTable.titleId, title.id));
    const community = rows.filter((row) => row.sourceName === "WatchTime Community");
    expect(community).toHaveLength(1);
    expect((community[0].items as Array<{ contributionId?: number }>).map((item) => item.contributionId).sort())
      .toEqual([101, 202]);
  });

  it("persists a large child collection with bounded existing-row reads", async () => {
    const episodes = Array.from({ length: 100 }, (_, index) => ({
      season: Math.floor(index / 10) + 1,
      number: (index % 10) + 1,
      name: `Episode ${index + 1}`,
      summary: `<p>Summary ${index + 1}</p>`,
      runtime: 42,
      airdate: "2020-01-01",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ...showPayload,
      _embedded: { ...showPayload._embedded, episodes },
    })));
    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);
    const [title] = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    const persisted = await db.select().from(episodesTable).where(eq(episodesTable.titleId, title.id));
    expect(persisted).toHaveLength(100);
  });

  it("rejects unknown, missing, negative, and fractional CLI arguments", () => {
    const original = process.argv;
    process.argv = ["node", "seed-real", "--limit", "2"];
    expect(parseArgs().limit).toBe(2);
    process.argv = ["node", "seed-real", "--limit", "1.5"];
    expect(() => parseArgs()).toThrow(/non-negative integer/);
    process.argv = ["node", "seed-real", "--type"];
    expect(() => parseArgs()).toThrow(/requires a value/);
    process.argv = ["node", "seed-real", "--unknown"];
    expect(() => parseArgs()).toThrow(/Unknown argument/);
    process.argv = original;
  });

  it("allows only one catalog writer during scheduled and manual overlap", async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await fetchGate;
      return jsonResponse(showPayload);
    });

    vi.stubGlobal("fetch", fetchMock);

    const scheduledId = await startCatalogRefresh("scheduled", [testItem]);
    catalogRunIds.push(scheduledId);
    await waitForCatalogRun(scheduledId, () => fetchMock.mock.calls.length === 1);

    const manualId = await startCatalogRefresh("manual", [testItem]);
    catalogRunIds.push(manualId);
    const skipped = await waitForCatalogRun(manualId, (run) => run.status === "skipped");
    expect(skipped.error).toMatch(/already running/i);

    releaseFetch();
    await waitForCatalogRun(scheduledId, (run) => run.status === "succeeded");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const writtenTitles = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    expect(writtenTitles).toHaveLength(1);
  });

  it("marks a restart-interrupted run and its unfinished item as retryable failures", async () => {
    const retryableItem = sourceItems[0];
    const [run] = await db.insert(catalogSyncRunsTable).values({
      trigger: "scheduled",
      status: "running",
      totalItems: 1,
      startedAt: new Date(),
    }).returning();
    catalogRunIds.push(run.id);
    await db.insert(catalogSyncItemsTable).values({
      runId: run.id,
      itemKey: retryableItem.key,
      title: retryableItem.name,
      provider: "TVMaze",
      status: "running",
      startedAt: new Date(),
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await scheduleCatalogRefresh();
    const timer = setTimeoutSpy.mock.results.at(-1)?.value as NodeJS.Timeout | undefined;
    if (timer) scheduledTimers.push(timer);

    const [recoveredRun] = await db.select().from(catalogSyncRunsTable)
      .where(eq(catalogSyncRunsTable.id, run.id));
    const [recoveredItem] = await db.select().from(catalogSyncItemsTable)
      .where(eq(catalogSyncItemsTable.runId, run.id));
    expect(recoveredRun).toMatchObject({
      status: "failed",
      error: "Catalog refresh was interrupted by a server restart",
    });
    expect(recoveredRun.finishedAt).toBeInstanceOf(Date);
    expect(recoveredItem).toMatchObject({
      status: "failed",
      itemKey: retryableItem.key,
      error: "Catalog refresh was interrupted by a server restart",
    });
    expect(sourceItems.some((item) => item.key === recoveredItem.itemKey)).toBe(true);
  });

  it("keeps the next scheduled run one week after an immediate completed run", async () => {
    const now = new Date();
    const [run] = await db.insert(catalogSyncRunsTable).values({
      trigger: "manual",
      status: "succeeded",
      createdAt: now,
      startedAt: now,
      finishedAt: now,
    }).returning();
    catalogRunIds.push(run.id);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await scheduleCatalogRefresh();

    const delay = Number(setTimeoutSpy.mock.calls.at(-1)?.[1]);
    const timer = setTimeoutSpy.mock.results.at(-1)?.value as NodeJS.Timeout | undefined;
    if (timer) scheduledTimers.push(timer);
    expect(delay).toBeGreaterThan(WEEK_MS - 2_000);
    expect(delay).toBeLessThanOrEqual(WEEK_MS);
  });

  it("keeps only one pending refresh when scheduling is initialized twice", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      await scheduleCatalogRefresh(WEEK_MS);
      const first = setTimeoutSpy.mock.results.at(-1)?.value as NodeJS.Timeout;
      scheduledTimers.push(first);

      await scheduleCatalogRefresh(WEEK_MS);
      const second = setTimeoutSpy.mock.results.at(-1)?.value as NodeJS.Timeout;
      scheduledTimers.push(second);
      expect(second).not.toBe(first);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(first);
      expect(clearTimeoutSpy).not.toHaveBeenCalledWith(second);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not replace a newer schedule when an older scheduled run finishes", async () => {
    const originalItems = [...sourceItems];
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    const fetchMock = vi.fn(async () => {
      await fetchGate;
      return jsonResponse(showPayload);
    });
    vi.stubGlobal("fetch", fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const [previous] = await db.select({ id: catalogSyncRunsTable.id })
      .from(catalogSyncRunsTable).orderBy(desc(catalogSyncRunsTable.id)).limit(1);

    try {
      // Use one known item so the scheduled callback runs a real, gated sync.
      sourceItems.splice(0, sourceItems.length, testItem);
      await scheduleCatalogRefresh(WEEK_MS);
      const firstIndex = setTimeoutSpy.mock.calls.findLastIndex(([, delay]) => delay === WEEK_MS);
      const first = setTimeoutSpy.mock.results[firstIndex]?.value as NodeJS.Timeout;
      const fireFirst = setTimeoutSpy.mock.calls[firstIndex]?.[0] as () => void;
      scheduledTimers.push(first);
      fireFirst();

      // The replacement is installed while the previous scheduled start is pending.
      await scheduleCatalogRefresh(WEEK_MS / 2);
      const secondIndex = setTimeoutSpy.mock.calls.findLastIndex(([, delay]) => delay === WEEK_MS / 2);
      const second = setTimeoutSpy.mock.results[secondIndex]?.value as NodeJS.Timeout;
      scheduledTimers.push(second);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(first);

      let runId = 0;
      await vi.waitFor(async () => {
        const [run] = await db.select({ id: catalogSyncRunsTable.id })
          .from(catalogSyncRunsTable).orderBy(desc(catalogSyncRunsTable.id)).limit(1);
        expect(run?.id).toBeGreaterThan(previous?.id ?? 0);
        runId = run.id;
      });
      catalogRunIds.push(runId);
      await waitForCatalogRun(runId, () => fetchMock.mock.calls.length === 1);
      releaseFetch();
      await waitForCatalogRun(runId, (run) => run.status === "succeeded");
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(setTimeoutSpy.mock.calls.filter(([, delay]) => delay === WEEK_MS)).toHaveLength(1);
      expect(clearTimeoutSpy).not.toHaveBeenCalledWith(second);
    } finally {
      releaseFetch();
      sourceItems.splice(0, sourceItems.length, ...originalItems);
      vi.restoreAllMocks();
    }
  });

  it.each([0, 1])(
    "keeps exactly one pending refresh when simultaneous starts finish in order %i",
    async (firstToFinish) => {
      const now = new Date();
      const [run] = await db.insert(catalogSyncRunsTable).values({
        trigger: "manual",
        status: "succeeded",
        createdAt: now,
        finishedAt: now,
      }).returning();
      catalogRunIds.push(run.id);

      const originalConnect = pool.connect.bind(pool);
      const releases: Array<() => void> = [];
      let bothEntered!: () => void;
      const bothPending = new Promise<void>((resolve) => { bothEntered = resolve; });
      vi.spyOn(pool, "connect").mockImplementation(((callback?: Parameters<typeof pool.connect>[0]) => {
        if (callback) return originalConnect(callback);
        // Only pause the two recovery connections; Drizzle also uses this
        // pool for the queries that follow once either start is released.
        if (releases.length >= 2) return originalConnect();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        releases.push(release);
        if (releases.length === 2) bothEntered();
        return gate.then(() => originalConnect());
      }) as typeof pool.connect);
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const starts = [scheduleCatalogRefresh(), scheduleCatalogRefresh()];
      const refreshTimers = () => setTimeoutSpy.mock.calls.flatMap(([, delay], index) =>
        Number(delay) > WEEK_MS - 2_000
          ? [setTimeoutSpy.mock.results[index]?.value as NodeJS.Timeout]
          : []);

      try {
        await bothPending;
        expect(refreshTimers()).toHaveLength(0);

        releases[firstToFinish]();
        await starts[firstToFinish];
        expect(refreshTimers()).toHaveLength(1);

        releases[1 - firstToFinish]();
        await Promise.all(starts);
        const [older, newer] = refreshTimers();
        expect(refreshTimers()).toHaveLength(2);
        expect(newer).not.toBe(older);
        expect(clearTimeoutSpy).toHaveBeenCalledWith(older);
        expect(clearTimeoutSpy).not.toHaveBeenCalledWith(newer);
      } finally {
        releases.forEach((release) => release());
        await Promise.allSettled(starts);
        scheduledTimers.push(...refreshTimers());
        vi.restoreAllMocks();
      }
    },
  );

  it("does not immediately retry a failed or skipped attempt after restart", async () => {
    const now = new Date();
    const [run] = await db.insert(catalogSyncRunsTable).values({
      trigger: "scheduled",
      status: "failed",
      totalItems: 1,
      createdAt: now,
      finishedAt: now,
    }).returning();
    catalogRunIds.push(run.id);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await scheduleCatalogRefresh();

    const delay = Number(setTimeoutSpy.mock.calls.at(-1)?.[1]);
    const timer = setTimeoutSpy.mock.results.at(-1)?.value as NodeJS.Timeout | undefined;
    if (timer) scheduledTimers.push(timer);
    expect(delay).toBeGreaterThan(WEEK_MS - 2_000);
    expect(delay).toBeLessThanOrEqual(WEEK_MS);
  });
});
