import { readFileSync } from "node:fs";
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
import { and, asc, eq, inArray, sql } from "drizzle-orm";

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

describe("title-level safety records migration", () => {
  it("breaks equal refresh timestamps by ID and leaves other sources and scoped records untouched", async () => {
    const migration = readFileSync(
      new URL(
        "../../../../lib/db/drizzle/0000_protect_title_level_safety_records.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim());
    expect(statements).toHaveLength(2);

    await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`
        CREATE TEMP TABLE safety_records (
          id integer PRIMARY KEY,
          title_id integer NOT NULL,
          season_number integer,
          episode_number integer,
          source_name text NOT NULL,
          status text NOT NULL,
          updated_at timestamp NOT NULL
        ) ON COMMIT DROP
      `),
      );
      await tx.execute(
        sql.raw(`
        INSERT INTO safety_records (id, title_id, season_number, episode_number, source_name, status, updated_at)
        VALUES
          (1, 42, NULL, NULL, 'Wikidata', 'available', '2024-01-01T00:00:00Z'),
          (2, 42, NULL, NULL, 'Wikidata', 'provider_unavailable', '2025-01-01T00:00:00Z'),
          (3, 42, NULL, NULL, 'Wikidata', 'available', '2025-01-01T00:00:00Z'),
          (4, 42, NULL, NULL, 'Does the Dog Die?', 'available', '2024-06-01T00:00:00Z'),
          (5, 42, NULL, NULL, 'WatchTime Community', 'available', '2024-07-01T00:00:00Z'),
          (6, 42, 1, NULL, 'Wikidata', 'available', '2024-01-01T00:00:00Z'),
          (7, 42, 1, NULL, 'Wikidata', 'provider_unavailable', '2025-01-01T00:00:00Z'),
          (8, 42, 1, 1, 'Wikidata', 'available', '2024-01-01T00:00:00Z'),
          (9, 42, 1, 1, 'Wikidata', 'provider_unavailable', '2025-01-01T00:00:00Z')
      `),
      );

      await tx.execute(sql.raw(statements[0]));
      await tx.execute(sql.raw(statements[1]));

      const { rows } = await tx.execute(sql`
        SELECT id, season_number, episode_number, source_name, status
        FROM safety_records
        ORDER BY id
      `);
      expect(rows).toEqual([
        {
          id: 3,
          season_number: null,
          episode_number: null,
          source_name: "Wikidata",
          status: "available",
        },
        {
          id: 4,
          season_number: null,
          episode_number: null,
          source_name: "Does the Dog Die?",
          status: "available",
        },
        {
          id: 5,
          season_number: null,
          episode_number: null,
          source_name: "WatchTime Community",
          status: "available",
        },
        {
          id: 6,
          season_number: 1,
          episode_number: null,
          source_name: "Wikidata",
          status: "available",
        },
        {
          id: 7,
          season_number: 1,
          episode_number: null,
          source_name: "Wikidata",
          status: "provider_unavailable",
        },
        {
          id: 8,
          season_number: 1,
          episode_number: 1,
          source_name: "Wikidata",
          status: "available",
        },
        {
          id: 9,
          season_number: 1,
          episode_number: 1,
          source_name: "Wikidata",
          status: "provider_unavailable",
        },
      ]);

      await tx.execute(
        sql.raw(`
        INSERT INTO safety_records (id, title_id, season_number, episode_number, source_name, status, updated_at)
        VALUES
          (10, 42, 1, NULL, 'Wikidata', 'available', '2026-01-01T00:00:00Z'),
          (11, 42, 1, 1, 'Wikidata', 'available', '2026-01-01T00:00:00Z')
      `),
      );
      const scopedDuplicates = await tx.execute(sql`
        SELECT season_number, episode_number, count(*)::int AS count
        FROM safety_records
        WHERE season_number = 1
        GROUP BY season_number, episode_number
        ORDER BY episode_number NULLS FIRST
      `);
      expect(scopedDuplicates.rows).toEqual([
        { season_number: 1, episode_number: null, count: 3 },
        { season_number: 1, episode_number: 1, count: 3 },
      ]);
    });
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

  it("removes duplicate title-level rows when a successful refresh has no classifications", async () => {
    const [title] = await db.insert(titlesTable).values({
      type: "movie",
      name: "__wikidata_empty_classifications_test__",
      year: 2020,
      imdbId: "tt7654321",
      popularity: 0,
    }).returning();

    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw("DROP INDEX safety_records_title_source_unique_idx"));

        const officialRows = await tx.insert(safetyRecordsTable).values([
          {
            titleId: title.id,
            sourceName: WIKIDATA_PROVIDER,
            tier: 2,
            isCommunity: false,
            url: "https://www.wikidata.org/wiki/Q51",
            status: "available",
            items: [{
              category: "MPAA",
              label: "PG",
              score: null,
              maxScore: null,
              description: "US rating · Wikidata property P1657",
            }],
            updatedAt: new Date("2024-01-01T00:00:00.000Z"),
          },
          {
            titleId: title.id,
            sourceName: WIKIDATA_PROVIDER,
            tier: 2,
            isCommunity: false,
            url: "https://www.wikidata.org/wiki/Q52",
            status: "available",
            items: [{
              category: "MPAA",
              label: "PG-13",
              score: null,
              maxScore: null,
              description: "US rating · Wikidata property P1657",
            }],
            updatedAt: new Date("2025-01-01T00:00:00.000Z"),
          },
        ]).returning();

        const [communityRow, otherProviderRow, seasonRow, episodeRow] = await tx.insert(safetyRecordsTable).values([
          {
            titleId: title.id,
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
            titleId: title.id,
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
          {
            titleId: title.id,
            seasonNumber: 1,
            sourceName: WIKIDATA_PROVIDER,
            tier: 2,
            isCommunity: false,
            url: "https://www.wikidata.org/wiki/Q53-season",
            status: "available",
            items: [{
              category: "MPAA",
              label: "PG",
              score: null,
              maxScore: null,
              description: "season rating",
            }],
            updatedAt: new Date("2024-02-01T00:00:00.000Z"),
          },
          {
            titleId: title.id,
            seasonNumber: 1,
            episodeNumber: 1,
            sourceName: WIKIDATA_PROVIDER,
            tier: 2,
            isCommunity: false,
            url: "https://www.wikidata.org/wiki/Q53-episode",
            status: "available",
            items: [{
              category: "MPAA",
              label: "G",
              score: null,
              maxScore: null,
              description: "episode rating",
            }],
            updatedAt: new Date("2024-03-01T00:00:00.000Z"),
          },
        ]).returning();
        const untouchedRows = [communityRow, otherProviderRow, seasonRow, episodeRow];

        await expect(refreshWikidataTitle(title.id, {
          queryByImdbId: async () => ({
            itemId: "Q54",
            itemUrl: "https://www.wikidata.org/wiki/Q54",
            imdbId: "tt7654321",
            classifications: [],
          }),
        }, tx)).resolves.toMatchObject({
          ok: true,
          externalId: "Q54",
          classifications: 0,
        });

        const records = await tx.select().from(safetyRecordsTable)
          .where(eq(safetyRecordsTable.titleId, title.id));
        const remainingOfficialRows = records.filter((record) =>
          record.sourceName === WIKIDATA_PROVIDER &&
          record.seasonNumber === null &&
          record.episodeNumber === null,
        );
        expect(remainingOfficialRows).toEqual([officialRows[1]]);
        expect(remainingOfficialRows[0]).toMatchObject({
          url: "https://www.wikidata.org/wiki/Q52",
          items: [{ category: "MPAA", label: "PG-13" }],
        });
        expect(records).toEqual(expect.arrayContaining(untouchedRows));

        await tx.execute(sql.raw(`
          CREATE UNIQUE INDEX safety_records_title_source_unique_idx
          ON safety_records (title_id, source_name)
          WHERE season_number IS NULL AND episode_number IS NULL
        `));
      });
    } finally {
      await db.delete(titlesTable).where(eq(titlesTable.id, title.id));
    }
  });

  it("does not create a title-level Wikidata row when an empty refresh has no existing row", async () => {
    const [title] = await db.insert(titlesTable).values({
      type: "movie",
      name: "__wikidata_no_existing_empty_classifications_test__",
      year: 2020,
      imdbId: "tt7654322",
      popularity: 0,
    }).returning();

    try {
      const initialRows = await db.insert(safetyRecordsTable).values([
        {
          titleId: title.id,
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
          titleId: title.id,
          sourceName: "Does the Dog Die?",
          tier: 2,
          isCommunity: false,
          status: "available",
          items: [{
            category: "animal harm",
            label: "animal harm",
            score: 2,
            maxScore: 3,
            description: "provider data",
          }],
        },
        {
          titleId: title.id,
          seasonNumber: 1,
          sourceName: WIKIDATA_PROVIDER,
          tier: 2,
          isCommunity: false,
          status: "available",
          items: [{
            category: "MPAA",
            label: "PG",
            score: null,
            maxScore: null,
            description: "season rating",
          }],
        },
        {
          titleId: title.id,
          seasonNumber: 1,
          episodeNumber: 1,
          sourceName: WIKIDATA_PROVIDER,
          tier: 2,
          isCommunity: false,
          status: "available",
          items: [{
            category: "MPAA",
            label: "G",
            score: null,
            maxScore: null,
            description: "episode rating",
          }],
        },
      ]).returning();

      expect(initialRows.filter((record) =>
        record.sourceName === WIKIDATA_PROVIDER &&
        record.seasonNumber === null &&
        record.episodeNumber === null,
      )).toHaveLength(0);

      await expect(refreshWikidataTitle(title.id, {
        queryByImdbId: async () => ({
          itemId: "Q55",
          itemUrl: "https://www.wikidata.org/wiki/Q55",
          imdbId: "tt7654322",
          classifications: [],
        }),
      })).resolves.toMatchObject({
        ok: true,
        externalId: "Q55",
        classifications: 0,
      });

      const records = await db.select().from(safetyRecordsTable)
        .where(eq(safetyRecordsTable.titleId, title.id))
        .orderBy(asc(safetyRecordsTable.id));
      expect(records.filter((record) =>
        record.sourceName === WIKIDATA_PROVIDER &&
        record.seasonNumber === null &&
        record.episodeNumber === null,
      )).toHaveLength(0);
      expect(records).toEqual([...initialRows].sort((a, b) => a.id - b.id));
    } finally {
      await db.delete(titlesTable).where(eq(titlesTable.id, title.id));
    }
  });

  it("refreshes classifications and removes duplicate title-level rows without changing other ratings", async () => {
    const [title] = await db.insert(titlesTable).values({
      type: "movie",
      name: "__wikidata_classified_duplicates_test__",
      year: 2020,
      imdbId: "tt7654322",
      popularity: 0,
    }).returning();

    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw("DROP INDEX safety_records_title_source_unique_idx"));

        const officialRows = await tx.insert(safetyRecordsTable).values([
          {
            titleId: title.id,
            sourceName: WIKIDATA_PROVIDER,
            tier: 2,
            isCommunity: false,
            url: "https://www.wikidata.org/wiki/Q51",
            status: "available",
            items: [{ category: "MPAA", label: "PG", score: null, maxScore: null, description: "old rating" }],
            updatedAt: new Date("2024-01-01T00:00:00.000Z"),
          },
          {
            titleId: title.id,
            sourceName: WIKIDATA_PROVIDER,
            tier: 2,
            isCommunity: false,
            url: "https://www.wikidata.org/wiki/Q52",
            status: "available",
            items: [{ category: "MPAA", label: "PG-13", score: null, maxScore: null, description: "old rating" }],
            updatedAt: new Date("2025-01-01T00:00:00.000Z"),
          },
        ]).returning();

        const untouchedRows = await tx.insert(safetyRecordsTable).values([
          {
            titleId: title.id,
            sourceName: "WatchTime Community",
            tier: 3,
            isCommunity: true,
            status: "available",
            items: [{ category: "violence", label: "violence", score: null, maxScore: null, description: "community note" }],
          },
          {
            titleId: title.id,
            sourceName: "Does the Dog Die?",
            tier: 2,
            status: "available",
            items: [{ category: "animal harm", label: "animal harm", score: 2, maxScore: 3, description: "provider data" }],
          },
          {
            titleId: title.id,
            seasonNumber: 1,
            sourceName: WIKIDATA_PROVIDER,
            tier: 2,
            isCommunity: false,
            url: "https://www.wikidata.org/wiki/Q53-season",
            status: "available",
            items: [{ category: "MPAA", label: "PG", score: null, maxScore: null, description: "season rating" }],
          },
          {
            titleId: title.id,
            seasonNumber: 1,
            episodeNumber: 1,
            sourceName: WIKIDATA_PROVIDER,
            tier: 2,
            isCommunity: false,
            url: "https://www.wikidata.org/wiki/Q53-episode",
            status: "available",
            items: [{ category: "MPAA", label: "G", score: null, maxScore: null, description: "episode rating" }],
          },
        ]).returning();

        await expect(refreshWikidataTitle(title.id, {
          queryByImdbId: async () => ({
            itemId: "Q54",
            itemUrl: "https://www.wikidata.org/wiki/Q54",
            imdbId: "tt7654322",
            classifications: [
              { property: "P1657", propertyName: "MPAA", label: "R", valueId: "Q123" },
              { property: "P3216", propertyName: "ClassInd", label: "16", valueId: "16" },
            ],
          }),
        }, tx)).resolves.toMatchObject({
          ok: true,
          externalId: "Q54",
          classifications: 2,
        });

        const records = await tx.select().from(safetyRecordsTable)
          .where(eq(safetyRecordsTable.titleId, title.id));
        const remainingOfficialRows = records.filter((record) =>
          record.sourceName === WIKIDATA_PROVIDER &&
          record.seasonNumber === null &&
          record.episodeNumber === null,
        );
        expect(remainingOfficialRows).toHaveLength(1);
        expect(remainingOfficialRows[0]).toMatchObject({
          id: officialRows[1].id,
          url: "https://www.wikidata.org/wiki/Q54",
          items: [
            {
              category: "MPAA",
              label: "R",
              score: null,
              maxScore: null,
              description: "US rating · Wikidata property P1657",
            },
            {
              category: "ClassInd",
              label: "16",
              score: null,
              maxScore: null,
              description: "BR rating · Wikidata property P3216",
            },
          ],
        });
        expect(records).toEqual(expect.arrayContaining(untouchedRows));

        await tx.execute(sql.raw(`
          CREATE UNIQUE INDEX safety_records_title_source_unique_idx
          ON safety_records (title_id, source_name)
          WHERE season_number IS NULL AND episode_number IS NULL
        `));
      });
    } finally {
      await db.delete(titlesTable).where(eq(titlesTable.id, title.id));
    }
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

  it("accumulates persisted refresh outcomes and keeps the latest error state", async () => {
    const previousRows = await db.select().from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    await db.delete(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));

    const failingClient = {
      queryByImdbId: async () => {
        throw new WikidataError("Wikidata endpoint unavailable", "unavailable");
      },
    };
    try {
      await refreshWikidataTitle(titleId, failingClient);
      await refreshWikidataTitle(titleId, failingClient);

      let [health] = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      expect(health).toMatchObject({
        refreshAttempts: 2,
        successfulRefreshes: 0,
        successRatePercent: 0,
        lastError: "Wikidata endpoint unavailable",
      });

      await refreshWikidataTitle(titleId, {
        queryByImdbId: async () => matchedItem,
      });
      [health] = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      expect(health).toMatchObject({
        refreshAttempts: 3,
        successfulRefreshes: 1,
        lastError: null,
      });
      expect(health.successRatePercent).toBeCloseTo((1 / 3) * 100);

      await refreshWikidataTitle(titleId, {
        queryByImdbId: async () => {
          throw new WikidataError("Latest provider error", "unavailable");
        },
      });
      [health] = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      expect(health).toMatchObject({
        refreshAttempts: 4,
        successfulRefreshes: 1,
        lastError: "Latest provider error",
      });
      expect(health.successRatePercent).toBeCloseTo(25);

      await db.update(integrationHealthTable)
        .set({ refreshAttempts: 2_000_000_000, successfulRefreshes: 1_000_000_000 })
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      await refreshWikidataTitle(titleId, failingClient);
      [health] = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      expect(health.refreshAttempts).toBe(1_000_000_001);
      expect(health.successfulRefreshes).toBe(500_000_000);
      expect(health.successRatePercent).toBeCloseTo((500_000_000 / 1_000_000_001) * 100);
    } finally {
      await db.delete(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      if (previousRows.length > 0) {
        await db.insert(integrationHealthTable).values(previousRows);
      }
    }
  });

  it("keeps the newer refresh status when an older query fails after it finishes", async () => {
    const previousRows = await db.select().from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    await db.delete(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));

    const olderStartedAt = new Date("2026-10-05T10:00:00.000Z");
    const newerStartedAt = new Date("2026-10-05T10:00:01.000Z");
    let signalOlderQueryStarted!: () => void;
    const olderQueryStarted = new Promise<void>((resolve) => {
      signalOlderQueryStarted = resolve;
    });
    let rejectOlderQuery!: (error: Error) => void;
    const olderQuery = new Promise<WikidataItem>((_resolve, reject) => {
      rejectOlderQuery = reject;
    });
    let olderRefresh: ReturnType<typeof refreshWikidataTitle> | undefined;
    let olderRefreshCompleted = false;

    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(olderStartedAt);
      olderRefresh = refreshWikidataTitle(titleId, {
        queryByImdbId: async () => {
          signalOlderQueryStarted();
          return olderQuery;
        },
      });
      await olderQueryStarted;

      vi.setSystemTime(newerStartedAt);
      await expect(refreshWikidataTitle(titleId, {
        queryByImdbId: async () => matchedItem,
      })).resolves.toMatchObject({ ok: true });

      rejectOlderQuery(new WikidataError("Older Wikidata request failed", "unavailable"));
      await expect(olderRefresh).resolves.toMatchObject({ ok: false, status: "error" });
      olderRefreshCompleted = true;

      const [health] = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      expect(health).toMatchObject({
        status: "healthy",
        lastSyncAt: newerStartedAt,
        lastSuccessAt: newerStartedAt,
        lastError: null,
        refreshAttempts: 2,
        successfulRefreshes: 1,
      });
    } finally {
      if (olderRefresh && !olderRefreshCompleted) {
        rejectOlderQuery(new Error("Cleaning up incomplete out-of-order refresh test"));
        await olderRefresh.catch(() => undefined);
      }
      vi.useRealTimers();
      await db.delete(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      if (previousRows.length > 0) {
        await db.insert(integrationHealthTable).values(previousRows);
      }
    }
  });

  it("retains every outcome when successful and failed title refreshes overlap", async () => {
    const previousRows = await db.select().from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    await db.delete(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));

    const successfulRefreshes = 8;
    const failedRefreshes = 8;
    const totalRefreshes = successfulRefreshes + failedRefreshes;
    let startedQueries = 0;
    let releaseQueries!: () => void;
    const allQueriesStarted = new Promise<void>((resolve) => {
      releaseQueries = resolve;
    });
    const makeClient = (succeeds: boolean) => ({
      queryByImdbId: async () => {
        startedQueries += 1;
        if (startedQueries === totalRefreshes) releaseQueries();
        await allQueriesStarted;
        if (!succeeds) {
          throw new WikidataError("Concurrent Wikidata failure", "unavailable");
        }
        return matchedItem;
      },
    });

    try {
      const settled = await Promise.allSettled([
        ...Array.from({ length: successfulRefreshes }, () =>
          refreshWikidataTitle(titleId, makeClient(true))),
        ...Array.from({ length: failedRefreshes }, () =>
          refreshWikidataTitle(titleId, makeClient(false))),
      ]);
      const results = settled.map((outcome) => {
        if (outcome.status === "rejected") throw outcome.reason;
        return outcome.value;
      });

      expect(results.filter((result) => result.ok)).toHaveLength(successfulRefreshes);
      expect(results.filter((result) => !result.ok)).toHaveLength(failedRefreshes);

      const healthRows = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      expect(healthRows).toHaveLength(1);
      const [health] = healthRows;
      expect(health).toMatchObject({
        refreshAttempts: totalRefreshes,
        successfulRefreshes,
      });
      expect(health.successRatePercent).toBeCloseTo(
        (successfulRefreshes / totalRefreshes) * 100,
      );
    } finally {
      await db.delete(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      if (previousRows.length > 0) {
        await db.insert(integrationHealthTable).values(previousRows);
      }
    }
  });

  it("continues counting from persisted nullable-counter health rows", async () => {
    const previousRows = await db.select().from(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    await db.delete(integrationHealthTable)
      .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
    try {
      await db.insert(integrationHealthTable).values({
        provider: WIKIDATA_PROVIDER,
        status: "failing",
        successRatePercent: 0,
        refreshAttempts: null,
        successfulRefreshes: null,
        lastError: "Previous failure",
      });

      await refreshWikidataTitle(titleId, {
        queryByImdbId: async () => matchedItem,
      });
      const [health] = await db.select().from(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      expect(health).toMatchObject({
        refreshAttempts: 1,
        successfulRefreshes: 1,
        successRatePercent: 100,
        lastError: null,
      });
    } finally {
      await db.delete(integrationHealthTable)
        .where(eq(integrationHealthTable.provider, WIKIDATA_PROVIDER));
      if (previousRows.length > 0) {
        await db.insert(integrationHealthTable).values(previousRows);
      }
    }
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
