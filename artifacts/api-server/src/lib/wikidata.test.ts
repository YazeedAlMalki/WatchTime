import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  WIKIDATA_PROVIDER,
  WikidataError,
  createWikidataClient,
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
import { and, eq } from "drizzle-orm";

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

  it("is repeatable and preserves community and other-provider records", async () => {
    await db.insert(safetyRecordsTable).values([
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
    expect(records.filter((record) => record.sourceName === WIKIDATA_PROVIDER)).toHaveLength(1);
    expect(records.find((record) => record.sourceName === WIKIDATA_PROVIDER)?.items[0]).toMatchObject({
      category: "MPAA",
      label: "PG-13",
      score: null,
      maxScore: null,
    });
    expect(records.find((record) => record.sourceName === "WatchTime Community")).toBeDefined();
    expect(records.find((record) => record.sourceName === "Does the Dog Die?")).toBeDefined();
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