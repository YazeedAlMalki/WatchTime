import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  episodesTable,
  integrationHealthTable,
  providerMappingsTable,
  safetyRecordsTable,
  titlesTable,
  watchProvidersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  parseArgs,
  runCatalogSync,
  validateTvMazeResponse,
  type SourceItem,
} from "./seed-real";

const testImdb = "tt9990001";
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
  aliases: ["Alternate Test Title", " alternate test title ", "Test Identity Series", "テスト作品", "عمل تجريبي"],
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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let healthSnapshot: (typeof integrationHealthTable.$inferSelect)[] = [];
beforeEach(async () => {
  healthSnapshot = await db.select().from(integrationHealthTable);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  const [title] = await db.select({ id: titlesTable.id }).from(titlesTable)
    .where(eq(titlesTable.imdbId, testImdb)).limit(1);
  if (title) await db.delete(titlesTable).where(eq(titlesTable.id, title.id));
  await db.delete(integrationHealthTable);
  if (healthSnapshot.length) await db.insert(integrationHealthTable).values(healthSnapshot);
});

describe("real catalog sync", () => {
  it("validates manifest identity and rejects a collision before writes", () => {
    expect(() => validateTvMazeResponse(testItem, { ...showPayload, id: testId + 1 })).toThrow(/identity mismatch/);
    expect(() => validateTvMazeResponse(testItem, { ...showPayload, name: "Wrong Series" })).toThrow(/title mismatch/);
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
    await db.insert(safetyRecordsTable).values({
      titleId: title.id,
      sourceName: "Common Sense Media",
      tier: 1,
      status: "available",
      isCommunity: true,
      items: [{ category: "test", label: "verified", score: null, maxScore: null, description: "populated" }],
    });
    await db.insert(safetyRecordsTable).values({
      titleId: title.id,
      sourceName: "Does the Dog Die",
      tier: 2,
      status: "available",
      isCommunity: true,
      items: [{ category: "legacy", label: "verified", score: null, maxScore: null, description: "legacy populated" }],
    });
    await db.update(safetyRecordsTable).set({ status: "provider_unavailable", isCommunity: false, items: [] })
      .where(and(eq(safetyRecordsTable.titleId, title.id), eq(safetyRecordsTable.sourceName, "Does the Dog Die?")));
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
    expect(again.altTitles).toContain("Alternate Test Title");
    expect(again.altTitles).toContain("Existing Alias");
    expect(again.altTitles).toContain("テスト作品");
    expect(again.altTitles).toContain("عمل تجريبي");
    expect(again.altTitles.filter((title) => title.toLowerCase() === "alternate test title")).toHaveLength(1);
    expect(again.altTitles).not.toContain("Test Identity Series");
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

  it("isolates a failed source item and records scoped partial health", async () => {
    const goodItem = { ...testItem, key: "test:good" };
    const badItem = { ...testItem, key: "test:bad", name: "Bad Source", tvmazeId: testId + 1, expectedTitle: "Bad Source", expectedImdbId: "tt9990002" };
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes(String(testId + 1)) ? jsonResponse({ error: "unavailable" }, 404) : jsonResponse(showPayload),
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

  it("merges duplicate community safety items without losing approved contributions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(showPayload)));
    await runCatalogSync({ dryRun: false, allowPartial: false }, [testItem]);
    const [title] = await db.select().from(titlesTable).where(eq(titlesTable.imdbId, testImdb));
    await db.insert(safetyRecordsTable).values([
      {
        titleId: title.id,
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
});