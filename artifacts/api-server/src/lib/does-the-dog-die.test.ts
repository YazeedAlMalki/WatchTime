import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DoesTheDogDieError,
  createDoesTheDogDieClient,
  normalizeDoesTheDogDieSafetyItems,
  normalizeDoesTheDogDieTopicStats,
  refreshDoesTheDogDieBatch,
  refreshDoesTheDogDieTitle,
  resolveDoesTheDogDieMatch,
  type CatalogTitleForDoesTheDogDie,
  type DoesTheDogDieItem,
} from "./does-the-dog-die";
import {
  db,
  integrationHealthTable,
  providerMappingsTable,
  safetyRecordsTable,
  titlesTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

const movie: CatalogTitleForDoesTheDogDie = {
  id: 1,
  type: "movie",
  name: "Old Yeller",
  altTitles: [],
  year: 1957,
  imdbId: "tt0050798",
};

const item = (overrides: Partial<DoesTheDogDieItem> = {}): DoesTheDogDieItem => ({
  id: 10752,
  name: "Old Yeller",
  releaseYear: 1957,
  imdbId: "tt0050798",
  itemTypeName: "Movie",
  ...overrides,
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Does the Dog Die adapter", () => {
  it("prefers an exact IMDb match over name/year candidates", () => {
    const match = resolveDoesTheDogDieMatch(movie, [
      item({ id: 1, name: "Old Yeller (Remake)", imdbId: "tt0050798" }),
      item({ id: 2, imdbId: "tt9999999" }),
    ]);
    expect(match.id).toBe(1);
  });

  it("uses a unique guarded name/year fallback when IMDb is missing", () => {
    const title = { ...movie, imdbId: null };
    expect(resolveDoesTheDogDieMatch(title, [
      item({ id: 77, imdbId: null }),
    ]).id).toBe(77);
  });

  it("refuses ambiguous and wrong-type fallback matches", () => {
    const title = { ...movie, imdbId: null };
    expect(() => resolveDoesTheDogDieMatch(title, [
      item({ id: 1, imdbId: null }),
      item({ id: 2, imdbId: null }),
    ])).toThrow(/ambiguous/i);
    expect(() => resolveDoesTheDogDieMatch(title, [
      item({ id: 3, imdbId: null, itemTypeName: "TV Show" }),
    ])).toThrow(/no .* match/i);
  });

  it("refuses a same-name result from the wrong year", () => {
    expect(() => resolveDoesTheDogDieMatch({ ...movie, imdbId: null }, [
      item({ releaseYear: 1937, imdbId: null }),
    ])).toThrow(/no .* match/i);
  });

  it("normalizes provider topic statistics without losing vote counts", () => {
    const stats = normalizeDoesTheDogDieTopicStats([{
      topicItemId: 395866,
      yesSum: 57,
      noSum: 3,
      numComments: 7,
      topicId: 153,
      topicName: "a dog dies",
      itemId: 10752,
    }]);
    expect(normalizeDoesTheDogDieSafetyItems(stats)).toEqual([{
      category: "a dog dies",
      label: "a dog dies",
      score: 57,
      maxScore: 60,
      description: "57 yes / 3 no votes; 7 comments",
    }]);
  });

  it("sends the documented API key header and fetches search then details", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> | undefined }> = [];
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: init?.headers as Record<string, string> | undefined });
      return url.includes("/items/10752")
        ? jsonResponse({
            ...item(),
            topicItemStats: [{
              topicItemId: 1,
              yesSum: 1,
              noSum: 0,
              numComments: 0,
              topicId: 2,
              topicName: "a dog dies",
              itemId: 10752,
            }],
          })
        : jsonResponse([item()]);
    });
    const client = createDoesTheDogDieClient({
      apiKey: "test-key",
      baseUrl: "https://provider.test/api/v3",
      fetchFn,
    });

    expect((await client.searchItems("Old Yeller"))[0].id).toBe(10752);
    expect((await client.getItem(10752)).topicItemStats?.[0].yesSum).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://provider.test/api/v3/items?q=Old%20Yeller");
    expect(new Headers(calls[0].headers).get("X-API-KEY")).toBe("test-key");
  });

  it("keeps credentials and commercial-tier checks server-side", async () => {
    const fetchFn = vi.fn();
    await expect(createDoesTheDogDieClient({ fetchFn }).searchItems("x"))
      .rejects.toMatchObject({ code: "missing_credentials" });
    await expect(createDoesTheDogDieClient({
      apiKey: "test-key",
      commercialUse: true,
      apiTier: "free",
      fetchFn,
    }).searchItems("x")).rejects.toMatchObject({ code: "commercial_restriction" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("turns provider authentication and rate-limit responses into actionable errors", async () => {
    for (const [status, code] of [[401, "authentication"], [429, "rate_limited"]] as const) {
      const client = createDoesTheDogDieClient({
        apiKey: "test-key",
        fetchFn: async () => jsonResponse({ error: "provider error" }, status),
      });
      await expect(client.searchItems("x")).rejects.toMatchObject({ code });
    }
  });

  it("rejects malformed topic statistics instead of fabricating safety items", () => {
    expect(() => normalizeDoesTheDogDieTopicStats([{
      topicName: "a dog dies",
      yesSum: "57",
      noSum: 3,
      numComments: 7,
    }])).toThrow(DoesTheDogDieError);
  });
});

describe("Does the Dog Die refresh persistence", () => {
  const provider = "Does the Dog Die?";
  let titleId: number;
  let healthBefore: typeof integrationHealthTable.$inferSelect | undefined;

  beforeAll(async () => {
    [healthBefore] = await db
      .select()
      .from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, provider));
    const [title] = await db.insert(titlesTable).values({
      type: "movie",
      name: "__ddd_refresh_test__",
      year: 1957,
      imdbId: "tt0050798",
      popularity: 0,
    }).returning();
    titleId = title.id;
    await db.insert(providerMappingsTable).values({
      titleId,
      provider,
      externalId: "old-provider-id",
      status: "mapped",
      lastRefreshedAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    await db.insert(safetyRecordsTable).values({
      titleId,
      sourceName: provider,
      tier: 2,
      status: "available",
      items: [{
        category: "old topic",
        label: "old topic",
        score: 1,
        maxScore: 1,
        description: "previously verified",
      }],
    });
  });

  afterAll(async () => {
    await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
    await db.delete(integrationHealthTable).where(eq(integrationHealthTable.provider, provider));
    if (healthBefore) await db.insert(integrationHealthTable).values(healthBefore);
  });

  it("persists the matched provider record and mapping on success", async () => {
    const client = {
      searchItems: async () => [item({ id: 10752 })],
      getItem: async () => ({
        ...item({ id: 10752 }),
        topicItemStats: [{
          topicItemId: 395866,
          yesSum: 57,
          noSum: 3,
          numComments: 7,
          topicId: 153,
          topicName: "a dog dies",
          itemId: 10752,
        }],
      }),
    };
    const result = await refreshDoesTheDogDieTitle(titleId, client);
    expect(result).toMatchObject({ ok: true, externalId: "10752", items: 1 });

    const [mapping] = await db.select().from(providerMappingsTable).where(and(
      eq(providerMappingsTable.titleId, titleId),
      eq(providerMappingsTable.provider, provider),
    ));
    const [record] = await db.select().from(safetyRecordsTable).where(and(
      eq(safetyRecordsTable.titleId, titleId),
      eq(safetyRecordsTable.sourceName, provider),
    ));
    expect(mapping).toMatchObject({ externalId: "10752", status: "mapped" });
    expect(record).toMatchObject({
      status: "available",
      url: "https://www.doesthedogdie.com/media/10752",
    });
    expect(record.items[0]).toMatchObject({ label: "a dog dies", score: 57, maxScore: 60 });
  });

  it("preserves a known-good mapping and safety record after a rate-limit failure", async () => {
    const result = await refreshDoesTheDogDieTitle(titleId, {
      searchItems: async () => {
        throw new DoesTheDogDieError("rate limited", "rate_limited", 429);
      },
      getItem: async () => {
        throw new Error("should not fetch details");
      },
    });
    expect(result).toMatchObject({ ok: false, status: "error" });

    const [mapping] = await db.select().from(providerMappingsTable).where(and(
      eq(providerMappingsTable.titleId, titleId),
      eq(providerMappingsTable.provider, provider),
    ));
    const [record] = await db.select().from(safetyRecordsTable).where(and(
      eq(safetyRecordsTable.titleId, titleId),
      eq(safetyRecordsTable.sourceName, provider),
    ));
    expect(mapping).toMatchObject({ externalId: "10752", status: "mapped" });
    expect(record.items[0]).toMatchObject({ label: "a dog dies", score: 57 });
  });
});

describe("Does the Dog Die batch refresh pagination", () => {
  let createdTitleIds: number[] = [];

  beforeAll(async () => {
    const titles = await db.insert(titlesTable).values(
      [1, 2, 3, 4].map((index) => ({
        type: "movie" as const,
        name: `__ddd_batch_resume_test_${index}__`,
        year: null,
        imdbId: null,
        popularity: 0,
      })),
    ).returning({ id: titlesTable.id });
    createdTitleIds = titles.map((title) => title.id).sort((left, right) => left - right);
  });

  afterAll(async () => {
    await db.delete(titlesTable).where(inArray(titlesTable.id, createdTitleIds));
  });

  it("resumes on adjacent title batches without overlap and returns an empty end batch", async () => {
    const catalog = await db
      .select({ id: titlesTable.id })
      .from(titlesTable)
      .orderBy(asc(titlesTable.id));
    const firstOffset = catalog.findIndex((title) => title.id === createdTitleIds[0]);
    expect(firstOffset).toBeGreaterThanOrEqual(0);

    const refreshTitle = async (titleId: number) => ({
      ok: true as const,
      titleId,
      titleName: `catalog-title-${titleId}`,
      externalId: `provider-title-${titleId}`,
      items: 0,
    });

    const firstBatch = await refreshDoesTheDogDieBatch({
      limit: 2,
      offset: firstOffset,
      refreshTitle,
      delayMs: 0,
    });
    const secondBatch = await refreshDoesTheDogDieBatch({
      limit: 2,
      offset: firstOffset + firstBatch.processed,
      refreshTitle,
      delayMs: 0,
    });
    const endOffset = catalog.length + 1_000;
    const endBatch = await refreshDoesTheDogDieBatch({
      limit: 2,
      offset: endOffset,
      refreshTitle,
      delayMs: 0,
    });

    const firstIds = firstBatch.results.map((result) => result.titleId);
    const secondIds = secondBatch.results.map((result) => result.titleId);
    expect(firstBatch).toMatchObject({
      offset: firstOffset,
      limit: 2,
      processed: 2,
    });
    expect(secondBatch).toMatchObject({
      offset: firstOffset + 2,
      limit: 2,
      processed: 2,
    });
    expect(firstIds).toEqual(createdTitleIds.slice(0, 2));
    expect(secondIds).toEqual(createdTitleIds.slice(2, 4));
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    expect(endBatch).toEqual({
      offset: endOffset,
      limit: 2,
      processed: 0,
      results: [],
    });
  });
});