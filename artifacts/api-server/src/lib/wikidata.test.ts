import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  WIKIDATA_PROVIDER,
  WikidataError,
  createWikidataClient,
  refreshWikidataBatch,
  refreshWikidataTitle,
  type WikidataItem,
} from "./wikidata";
import {
  db,
  integrationHealthTable,
  providerMappingsTable,
  safetyRecordsTable,
  titlesTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/sparql-results+json" },
  });
}

const matchedItem: WikidataItem = {
  itemId: "Q42",
  itemUrl: "https://www.wikidata.org/wiki/Q42",
  imdbId: "tt1234567",
  classifications: [{
    property: "P1657",
    propertyName: "MPAA",
    label: "PG-13",
    valueId: "Q123",
  }],
};

describe("Wikidata SPARQL adapter", () => {
  it("queries the official endpoint by exact IMDb ID and keeps classification labels unscored", async () => {
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const query = decodeURIComponent(new URL(String(input)).searchParams.get("query") ?? "");
      expect(query).toContain('VALUES ?imdbId { "tt1234567" }');
      expect(query).toContain("?item wdt:P345 ?imdbId");
      expect(query).toContain("OPTIONAL { ?item wdt:P3156 ?P3156 . }");
      expect(query).toContain("OPTIONAL { ?item wdt:P3216 ?P3216 . }");
      return jsonResponse({
        head: { vars: ["item", "imdbId", "P1657", "P1657Label"] },
        results: {
          bindings: [{
            item: { type: "uri", value: "https://www.wikidata.org/entity/Q42" },
            imdbId: { type: "literal", value: "tt1234567" },
            P1657: { type: "uri", value: "http://www.wikidata.org/entity/Q123" },
            P1657Label: { "xml:lang": "en", type: "literal", value: "PG-13" },
          }],
        },
      });
    });
    const result = await createWikidataClient({
      fetchFn,
      retries: 0,
      endpoint: "https://query.wikidata.org/sparql",
    }).queryByImdbId("TT1234567");

    expect(result).toEqual(matchedItem);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const init = fetchFn.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  });

  it("parses Australia and Brazil classifications as independent sourced values", async () => {
    const client = createWikidataClient({
      retries: 0,
      fetchFn: async () => jsonResponse({
        results: {
          bindings: [{
            item: { value: "https://www.wikidata.org/entity/Q42" },
            imdbId: { value: "tt1234567" },
            P3156: { value: "https://www.wikidata.org/entity/Q100" },
            P3156Label: { value: "M" },
            P3216: { value: "14" },
            P3216Label: { value: "14" },
          }],
        },
      }),
    });

    await expect(client.queryByImdbId("tt1234567")).resolves.toMatchObject({
      classifications: [
        {
          property: "P3156",
          propertyName: "Australian Classification",
          label: "M",
          valueId: "Q100",
        },
        {
          property: "P3216",
          propertyName: "ClassInd",
          label: "14",
          valueId: "14",
        },
      ],
    });
  });

  it("rejects a response whose IMDb identity does not exactly match", async () => {
    const client = createWikidataClient({
      retries: 0,
      fetchFn: async () => jsonResponse({
        results: {
          bindings: [{
            item: { value: "https://www.wikidata.org/entity/Q42" },
            imdbId: { value: "tt7654321" },
          }],
        },
      }),
    });
    await expect(client.queryByImdbId("tt1234567"))
      .rejects.toMatchObject({ code: "missing_mapping" });
  });

  it("retries rate limits with a bounded number of attempts", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({
        results: {
          bindings: [{
            item: { value: "https://www.wikidata.org/entity/Q42" },
            imdbId: { value: "tt1234567" },
          }],
        },
      }));
    const result = await createWikidataClient({
      fetchFn,
      retries: 1,
      retryDelayMs: 0,
    }).queryByImdbId("tt1234567");
    expect(result.itemId).toBe("Q42");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("Wikidata refresh persistence", () => {
  let titleId: number;
  let healthBefore: typeof integrationHealthTable.$inferSelect | undefined;

  beforeAll(async () => {
    [healthBefore] = await db.select()
      .from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    const [title] = await db.insert(titlesTable).values({
      type: "movie",
      name: "__wikidata_refresh_test__",
      year: 2020,
      imdbId: "tt1234567",
      popularity: 0,
    }).returning();
    titleId = title.id;
  });

  afterAll(async () => {
    await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
    await db.delete(integrationHealthTable).where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    if (healthBefore) await db.insert(integrationHealthTable).values(healthBefore);
  });

  it("is repeatable, preserves provider scope, and protects record granularity", async () => {
    await db.insert(safetyRecordsTable).values([
      {
        titleId,
        sourceName: WIKIDATA_PROVIDER,
        tier: 2,
        isCommunity: false,
        url: "https://www.wikidata.org/wiki/Q41",
        status: "available",
        items: [{
          category: "MPAA",
          label: "PG",
          score: null,
          maxScore: null,
          description: "US rating · Wikidata property P1657",
        }],
        updatedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
      {
        titleId,
        seasonNumber: 1,
        sourceName: WIKIDATA_PROVIDER,
        tier: 2,
        isCommunity: false,
        url: "https://www.wikidata.org/wiki/Q43-season",
        status: "available",
        items: [{
          category: "MPAA",
          label: "PG-13",
          score: null,
          maxScore: null,
          description: "US rating · Wikidata property P1657",
        }],
        updatedAt: new Date("2020-01-02T00:00:00.000Z"),
      },
      {
        titleId,
        seasonNumber: 1,
        episodeNumber: 1,
        sourceName: WIKIDATA_PROVIDER,
        tier: 2,
        isCommunity: false,
        url: "https://www.wikidata.org/wiki/Q43-episode",
        status: "available",
        items: [{
          category: "MPAA",
          label: "G",
          score: null,
          maxScore: null,
          description: "US rating · Wikidata property P1657",
        }],
        updatedAt: new Date("2020-01-03T00:00:00.000Z"),
      },
      {
        titleId,
        sourceName: "WatchTime Community",
        tier: 3,
        isCommunity: true,
        status: "available",
        items: [{
          category: "violence",
          label: "violence",
          score: null,
          maxScore: null,
          description: "community note",
          severity: "moderate",
        }],
      },
      {
        titleId,
        sourceName: "Does the Dog Die?",
        tier: 2,
        status: "available",
        items: [{
          category: "animal harm",
          label: "animal harm",
          score: 2,
          maxScore: 3,
          description: "richer provider data",
        }],
      },
    ]);
    const client = { queryByImdbId: async () => matchedItem };

    await expect(refreshWikidataTitle(titleId, client)).resolves.toMatchObject({
      ok: true,
      externalId: "Q42",
      classifications: 1,
    });
    await expect(refreshWikidataTitle(titleId, client)).resolves.toMatchObject({
      ok: true,
      externalId: "Q42",
      classifications: 1,
    });

    const records = await db.select().from(safetyRecordsTable).where(eq(safetyRecordsTable.titleId, titleId));
    expect(records.filter((record) =>
      record.sourceName === WIKIDATA_PROVIDER &&
      record.seasonNumber === null &&
      record.episodeNumber === null,
    )).toHaveLength(1);
    expect(records.find((record) => record.sourceName === WIKIDATA_PROVIDER)?.items[0]).toMatchObject({
      category: "MPAA",
      label: "PG-13",
      score: null,
      maxScore: null,
    });
    expect(records.find((record) => record.sourceName === "WatchTime Community")).toBeDefined();
    expect(records.find((record) => record.sourceName === "Does the Dog Die?")).toBeDefined();
    expect(records.filter((record) =>
      record.sourceName === WIKIDATA_PROVIDER &&
      record.seasonNumber === 1 &&
      record.episodeNumber === null,
    )).toHaveLength(1);
    expect(records.filter((record) =>
      record.sourceName === WIKIDATA_PROVIDER &&
      record.seasonNumber === 1 &&
      record.episodeNumber === 1,
    )).toHaveLength(1);

    await expect(db.insert(safetyRecordsTable).values({
      titleId,
      sourceName: WIKIDATA_PROVIDER,
      tier: 2,
      isCommunity: false,
      status: "available",
      items: [],
    })).rejects.toThrow();

    await db.insert(safetyRecordsTable).values([
      {
        titleId,
        seasonNumber: 2,
        sourceName: WIKIDATA_PROVIDER,
        tier: 2,
        isCommunity: false,
        status: "available",
        items: [],
      },
      {
        titleId,
        seasonNumber: 2,
        sourceName: WIKIDATA_PROVIDER,
        tier: 2,
        isCommunity: false,
        status: "available",
        items: [],
      },
      {
        titleId,
        seasonNumber: 2,
        episodeNumber: 1,
        sourceName: WIKIDATA_PROVIDER,
        tier: 2,
        isCommunity: false,
        status: "available",
        items: [],
      },
      {
        titleId,
        seasonNumber: 2,
        episodeNumber: 1,
        sourceName: WIKIDATA_PROVIDER,
        tier: 2,
        isCommunity: false,
        status: "available",
        items: [],
      },
    ]);
  });

  it("does not replace a verified mapping or safety record when the provider fails", async () => {
    const [mapping] = await db.insert(providerMappingsTable).values({
      titleId,
      provider: WIKIDATA_PROVIDER,
      externalId: "Q42",
      status: "mapped",
      lastRefreshedAt: new Date("2020-01-01T00:00:00.000Z"),
    }).returning();
    const before = await db.select().from(safetyRecordsTable).where(and(
      eq(safetyRecordsTable.titleId, titleId),
      eq(safetyRecordsTable.sourceName, WIKIDATA_PROVIDER),
    ));
    const result = await refreshWikidataTitle(titleId, {
      queryByImdbId: async () => {
        throw new WikidataError("endpoint unavailable", "unavailable");
      },
    });
    expect(result).toMatchObject({ ok: false, status: "error" });

    const [afterMapping] = await db.select().from(providerMappingsTable)
      .where(eq(providerMappingsTable.id, mapping.id));
    const after = await db.select().from(safetyRecordsTable).where(and(
      eq(safetyRecordsTable.titleId, titleId),
      eq(safetyRecordsTable.sourceName, WIKIDATA_PROVIDER),
    ));
    expect(afterMapping).toMatchObject({ externalId: "Q42", status: "mapped" });
    expect(after).toEqual(before);
  });
});

describe("Wikidata batch refresh pagination", () => {
  let createdTitleIds: number[] = [];
  let healthBefore: typeof integrationHealthTable.$inferSelect | undefined;

  beforeAll(async () => {
    [healthBefore] = await db.select()
      .from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    const titles = await db.insert(titlesTable).values(
      [1, 2, 3, 4].map((index) => ({
        type: "movie" as const,
        name: `__wikidata_batch_resume_test_${index}__`,
        year: null,
        imdbId: "tt1234567",
        popularity: 0,
      })),
    ).returning({ id: titlesTable.id });
    createdTitleIds = titles.map((title) => title.id).sort((left, right) => left - right);
  });

  afterAll(async () => {
    await db.delete(titlesTable).where(inArray(titlesTable.id, createdTitleIds));
    await db.delete(integrationHealthTable).where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    if (healthBefore) await db.insert(integrationHealthTable).values(healthBefore);
  });

  it("resumes adjacent batches without overlapping title IDs and skips the provider at catalog end", async () => {
    const catalog = await db.select({ id: titlesTable.id })
      .from(titlesTable)
      .orderBy(asc(titlesTable.id));
    const firstOffset = catalog.findIndex((title) => title.id === createdTitleIds[0]);
    expect(firstOffset).toBeGreaterThanOrEqual(0);

    const client = { queryByImdbId: vi.fn(async () => matchedItem) };
    const firstBatch = await refreshWikidataBatch({
      limit: 2,
      offset: firstOffset,
      client,
      delayMs: 0,
    });
    const secondBatch = await refreshWikidataBatch({
      limit: 2,
      offset: firstBatch.offset + firstBatch.processed,
      client,
      delayMs: 0,
    });
    const endOffset = catalog.length + 1_000;
    const callsBeforeEndBatch = client.queryByImdbId.mock.calls.length;
    const endBatch = await refreshWikidataBatch({
      limit: 2,
      offset: endOffset,
      client,
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
      offset: firstBatch.offset + firstBatch.processed,
      limit: 2,
      processed: 2,
    });
    expect(firstIds).toEqual(createdTitleIds.slice(0, 2));
    expect(secondIds).toEqual(createdTitleIds.slice(2, 4));
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    expect(client.queryByImdbId).toHaveBeenCalledTimes(4);
    expect(endBatch).toEqual({
      offset: endOffset,
      limit: 2,
      processed: 0,
      results: [],
    });
    expect(client.queryByImdbId).toHaveBeenCalledTimes(callsBeforeEndBatch);
  });
});
