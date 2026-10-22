import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  integrationHealthTable,
  pool,
  providerMappingsTable,
  safetyRecordsTable,
  titlesTable,
} from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

vi.mock("../middlewares/auth", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.userId = "test-admin";
    next();
  },
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "test-admin";
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import app from "../app";

const titleIds: number[] = [];
const integrationHealthIds: number[] = [];

afterEach(async () => {
  if (titleIds.length) {
    await db.delete(titlesTable).where(inArray(titlesTable.id, titleIds.splice(0)));
  }
  if (integrationHealthIds.length) {
    await db.delete(integrationHealthTable)
      .where(inArray(integrationHealthTable.id, integrationHealthIds.splice(0)));
  }
});

async function markMalformedTimestamp(recordIds: number[]) {
  await db.update(safetyRecordsTable)
    .set({ updatedAt: sql`'infinity'::timestamp` })
    .where(inArray(safetyRecordsTable.id, recordIds));
}

describe("admin Content review timestamp filter", () => {
  it("returns only titles whose selected regional rating has a malformed refresh timestamp", async () => {
    const fixturePrefix = "timestamp-filter-fixture-20260929";
    const titles = await db.insert(titlesTable).values([
      { name: `${fixturePrefix}-us-broken`, type: "movie", popularity: 3 },
      { name: `${fixturePrefix}-gb-broken`, type: "movie", popularity: 2 },
      { name: `${fixturePrefix}-us-healthy`, type: "movie", popularity: 1 },
    ]).returning({ id: titlesTable.id });
    titleIds.push(...titles.map(({ id }) => id));
    const earlierTitles = await db.insert(titlesTable).values(
      Array.from({ length: 51 }, (_, index) => ({
        name: `${fixturePrefix}-earlier-${index}`,
        type: "movie" as const,
        popularity: 1000 - index,
      })),
    ).returning({ id: titlesTable.id });
    titleIds.push(...earlierTitles.map(({ id }) => id));

    const records = await db.insert(safetyRecordsTable).values([
      {
        titleId: titles[0].id,
        sourceName: "Wikidata",
        status: "available",
        isCommunity: false,
        url: "https://www.wikidata.org/wiki/QUSBroken",
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        items: [{ category: "MPAA", label: "PG-13", score: null, maxScore: null, description: null }],
      },
      {
        titleId: titles[1].id,
        sourceName: "Wikidata",
        status: "available",
        isCommunity: false,
        url: "https://www.wikidata.org/wiki/QGBBroken",
        updatedAt: new Date("2026-09-02T00:00:00.000Z"),
        items: [{ category: "BBFC", label: "12A", score: null, maxScore: null, description: null }],
      },
      {
        titleId: titles[2].id,
        sourceName: "Wikidata",
        status: "available",
        isCommunity: false,
        url: "https://www.wikidata.org/wiki/QUSHealthy",
        updatedAt: new Date("2026-09-03T00:00:00.000Z"),
        items: [{ category: "MPAA", label: "PG", score: null, maxScore: null, description: null }],
      },
    ]).returning({ id: safetyRecordsTable.id });
    await markMalformedTimestamp([records[0].id, records[1].id]);

    const usResponse = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true`)
      .expect(200);
    expect(usResponse.body.map((item: any) => item.name)).toEqual([`${fixturePrefix}-us-broken`]);
    expect(usResponse.body[0].selectedRating).toMatchObject({ region: "US", refreshTimestampMalformed: true });

    const providerFilteredResponse = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true&malformedRefreshTimestampProvider=Wikidata`)
      .expect(200);
    expect(providerFilteredResponse.body.map((item: any) => item.name)).toEqual([`${fixturePrefix}-us-broken`]);
    const unmatchedProviderResponse = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true&malformedRefreshTimestampProvider=Another+Provider`)
      .expect(200);
    expect(unmatchedProviderResponse.body).toEqual([]);

    const gbResponse = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=GB&malformedRefreshTimestamp=true`)
      .expect(200);
    expect(gbResponse.body.map((item: any) => item.name)).toEqual([`${fixturePrefix}-gb-broken`]);
    expect(gbResponse.body[0].selectedRating).toMatchObject({ region: "GB", refreshTimestampMalformed: true });
    const unfilteredResponse = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=US`)
      .expect(200);
    expect(unfilteredResponse.body).toHaveLength(50);
    expect(unfilteredResponse.body.some((item: any) =>
      item.name === `${fixturePrefix}-us-broken` || item.name === `${fixturePrefix}-us-healthy`,
    )).toBe(false);
  });

  it("matches finite out-of-range timestamps and preserves resolver ordering at the JavaScript date limit", async () => {
    const fixturePrefix = "timestamp-date-range-fixture";
    const titles = await db.insert(titlesTable).values([
      { name: `${fixturePrefix}-far-outside`, type: "movie", popularity: 6 },
      { name: `${fixturePrefix}-valid-competitor`, type: "movie", popularity: 5 },
      { name: `${fixturePrefix}-malformed-tie`, type: "movie", popularity: 4 },
      { name: `${fixturePrefix}-at-limit`, type: "movie", popularity: 3 },
      { name: `${fixturePrefix}-beyond-limit`, type: "movie", popularity: 2 },
      { name: `${fixturePrefix}-submillisecond-limit`, type: "movie", popularity: 1 },
    ]).returning({ id: titlesTable.id });
    titleIds.push(...titles.map(({ id }) => id));
    const rating = (titleId: number, timestamp: string, label = "PG-13", tier = 1) => ({
      titleId,
      sourceName: "Wikidata",
      status: "available" as const,
      isCommunity: false,
      tier,
      url: "https://www.wikidata.org/wiki/Qtimestamp-date-range",
      updatedAt: sql`${timestamp}::timestamp`,
      items: [{ category: "MPAA", label, score: null, maxScore: null, description: null }],
    });
    const rollback = new Error("Rollback legacy duplicate-rating fixtures");
    try {
      await db.transaction(async (tx) => {
        // Keep legacy duplicate rows and the index change inside a rollback-only transaction.
        await tx.execute(sql`DROP INDEX safety_records_title_source_unique_idx`);
        const records = await tx.insert(safetyRecordsTable).values([
          rating(titles[0].id, "294276-12-31 23:59:59.999999"),
          rating(titles[1].id, "294276-12-31 23:59:59.999999"),
          rating(titles[1].id, "2026-10-01 00:00:00", "PG", 3),
          rating(titles[2].id, "294276-12-31 23:59:59.999999", "PG-13", 2),
          rating(titles[2].id, "infinity", "R", 1),
          rating(titles[3].id, "275760-09-13 00:00:00"),
          rating(titles[4].id, "275760-09-13 00:00:00.001"),
          rating(titles[5].id, "275760-09-13 00:00:00.000999"),
        ]).returning({ id: safetyRecordsTable.id });
        const selectSpy = vi.spyOn(db, "select").mockImplementation(tx.select.bind(tx));
        const executeSpy = vi.spyOn(db, "execute").mockImplementation(tx.execute.bind(tx));
        try {
          const unfiltered = await request(app)
            .get(`/api/admin/content?q=${fixturePrefix}&region=US`).expect(200);
          const filtered = await request(app)
            .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true`).expect(200);
          expect(filtered.body.map((item: { id: number }) => item.id))
            .toEqual([titles[0].id, titles[2].id, titles[4].id]);
          expect(filtered.body).toEqual(unfiltered.body.filter(
            (item: { selectedRating: { refreshTimestampMalformed: boolean } }) =>
              item.selectedRating.refreshTimestampMalformed,
          ));
          expect(filtered.body[1].selectedRating).toMatchObject({
            recordId: records[4].id, label: "R", lastRefreshedAt: null, refreshTimestampMalformed: true,
          });
          expect(unfiltered.body.find((item: { id: number }) => item.id === titles[1].id).selectedRating)
            .toMatchObject({ recordId: records[2].id, label: "PG", refreshTimestampMalformed: false });
        } finally {
          selectSpy.mockRestore();
          executeSpy.mockRestore();
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  it("continues through malformed-timestamp matches beyond the first 50 results", async () => {
    const fixturePrefix = "timestamp-pagination-fixture-20261004";
    const titles = await db.insert(titlesTable).values(
      Array.from({ length: 602 }, (_, index) => ({
        name: `${fixturePrefix}-${String(index + 1).padStart(3, "0")}`,
        type: "movie" as const,
        popularity: 100 - index,
      })),
    ).returning({ id: titlesTable.id });
    titleIds.push(...titles.map(({ id }) => id));
    const records = await db.insert(safetyRecordsTable).values(
      titles.map(({ id }) => ({
        titleId: id,
        sourceName: "Wikidata",
        status: "available" as const,
        isCommunity: false,
        url: `https://www.wikidata.org/wiki/Q${id}`,
        updatedAt: new Date("2026-10-01T00:00:00.000Z"),
        items: [{ category: "MPAA", label: "PG-13", score: null, maxScore: null, description: null }],
      })),
    ).returning({ id: safetyRecordsTable.id });
    await markMalformedTimestamp(records.map(({ id }) => id));

    const firstPage = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true&offset=0`)
      .expect(200);
    expect(firstPage.body).toHaveLength(51);
    expect(firstPage.body.slice(0, 50).map((item: any) => item.name)).toEqual(
      titles.slice(0, 50).map((_, index) => `${fixturePrefix}-${String(index + 1).padStart(3, "0")}`),
    );
    expect(firstPage.body[50].name).toBe(`${fixturePrefix}-051`);
    const laterPage = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true&offset=550`)
      .expect(200);
    expect(laterPage.body).toHaveLength(51);
    expect(laterPage.body.slice(0, 50).map((item: any) => item.name)).toEqual(
      titles.slice(550, 600).map((_, index) => `${fixturePrefix}-${String(551 + index).padStart(3, "0")}`),
    );
    expect(laterPage.body[50].name).toBe(`${fixturePrefix}-601`);
    expect(laterPage.body.every((item: any) =>
      item.selectedRating.region === "US" && item.selectedRating.refreshTimestampMalformed,
    )).toBe(true);
    const lastPage = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true&offset=600`)
      .expect(200);
    expect(lastPage.body.map((item: any) => item.name)).toEqual([`${fixturePrefix}-601`, `${fixturePrefix}-602`]);
  });

  it("reviews a provider's malformed ratings across regions with result-based pagination", async () => {
    const fixturePrefix = "timestamp-all-regions-fixture-20261018";
    const titles = await db.insert(titlesTable).values(
      Array.from({ length: 26 }, (_, index) => ({
        name: `${fixturePrefix}-${String(index + 1).padStart(2, "0")}`,
        type: "movie" as const,
        popularity: 100 - index,
      })),
    ).returning({ id: titlesTable.id });
    titleIds.push(...titles.map(({ id }) => id));
    const records = await db.insert(safetyRecordsTable).values(
      titles.map(({ id }) => ({
        titleId: id,
        sourceName: "Timestamp Fixture Provider",
        status: "available" as const,
        isCommunity: false,
        url: `https://provider.example/ratings/${id}`,
        updatedAt: new Date("2026-10-01T00:00:00.000Z"),
        items: [
          { category: "MPAA", label: "PG-13", score: null, maxScore: null, description: null },
          { category: "BBFC", label: "12A", score: null, maxScore: null, description: null },
        ],
      })),
    ).returning({ id: safetyRecordsTable.id });
    await markMalformedTimestamp(records.map(({ id }) => id));
    const firstPage = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&malformedRefreshTimestamp=true&malformedRefreshTimestampProvider=Timestamp+Fixture+Provider&malformedRefreshTimestampAllRegions=true&offset=0`)
      .expect(200);
    expect(firstPage.body).toHaveLength(51);
    expect(firstPage.body.slice(0, 50).every((item: any) =>
      item.selectedRating.refreshTimestampMalformed &&
      item.selectedRating.sourceName === "Timestamp Fixture Provider" &&
      ["GB", "US"].includes(item.selectedRating.region),
    )).toBe(true);
    expect(new Set(firstPage.body.slice(0, 50).map(
      (item: any) => item.selectedRating.region,
    ))).toEqual(new Set(["GB", "US"]));
    const secondPage = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&malformedRefreshTimestamp=true&malformedRefreshTimestampProvider=Timestamp+Fixture+Provider&malformedRefreshTimestampAllRegions=true&offset=50`)
      .expect(200);
    expect(secondPage.body).toHaveLength(2);
    expect(secondPage.body.map((item: any) => item.selectedRating.region)).toEqual(["GB", "US"]);
    expect(secondPage.body.map((item: any) => item.name)).toEqual([`${fixturePrefix}-26`, `${fixturePrefix}-26`]);
  });

  it("counts malformed provider rows that cannot be assigned to a supported region", async () => {
    const fixturePrefix = "timestamp-unclassified-fixture-20261021";
    const provider = `${fixturePrefix} Provider`;
    const titles = await db.insert(titlesTable).values([
      { name: `${fixturePrefix}-classified`, type: "movie", popularity: 2 },
      { name: `${fixturePrefix}-unclassified`, type: "movie", popularity: 1 },
    ]).returning({ id: titlesTable.id });
    titleIds.push(...titles.map(({ id }) => id));

    const [health] = await db.insert(integrationHealthTable).values({
      provider,
      status: "healthy",
    }).returning({ id: integrationHealthTable.id });
    integrationHealthIds.push(health.id);

    const records = await db.insert(safetyRecordsTable).values([
      {
        titleId: titles[0].id,
        sourceName: provider,
        status: "available",
        isCommunity: false,
        url: `https://provider.example/ratings/${titles[0].id}`,
        updatedAt: new Date("2026-10-01T00:00:00.000Z"),
        items: [{ category: "MPAA", label: "PG-13", score: null, maxScore: null, description: null }],
      },
      {
        titleId: titles[1].id,
        sourceName: provider,
        status: "available",
        isCommunity: false,
        url: `https://provider.example/ratings/${titles[1].id}`,
        updatedAt: new Date("2026-10-01T00:00:00.000Z"),
        items: [{ category: "UNSUPPORTED_SYSTEM", label: "12", score: null, maxScore: null, description: null }],
      },
    ]).returning({ id: safetyRecordsTable.id });
    await markMalformedTimestamp(records.map(({ id }) => id));

    const alerts = await request(app).get("/api/admin/integrations").expect(200);
    expect(alerts.body.find((row: any) => row.provider === provider))
      .toMatchObject({ malformedRefreshTimestampCount: 2 });

    const review = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&malformedRefreshTimestamp=true&malformedRefreshTimestampProvider=${encodeURIComponent(provider)}&malformedRefreshTimestampAllRegions=true`)
      .expect(200);
    expect(review.body.map((item: any) => item.name))
      .toEqual([`${fixturePrefix}-classified`]);
    expect(review.body[0].selectedRating)
      .toMatchObject({ region: "US", refreshTimestampMalformed: true });
  });

  it("loads mappings only for malformed-timestamp results and preserves mapping values", async () => {
    const fixturePrefix = "timestamp-mapping-filter-fixture-20261018";
    const candidateCount = 251;
    const titles = await db.insert(titlesTable).values(
      Array.from({ length: candidateCount }, (_, index) => ({
        name: `${fixturePrefix}-${String(index + 1).padStart(3, "0")}`,
        type: "movie" as const,
        popularity: candidateCount - index,
      })),
    ).returning({ id: titlesTable.id });
    titleIds.push(...titles.map(({ id }) => id));
    const [record] = await db.insert(safetyRecordsTable).values({
      titleId: titles[candidateCount - 1].id,
      sourceName: "Wikidata",
      status: "available",
      isCommunity: false,
      url: "https://www.wikidata.org/wiki/Qtimestamp-mapping",
      updatedAt: new Date("2026-10-01T00:00:00.000Z"),
      items: [{ category: "MPAA", label: "PG-13", score: null, maxScore: null, description: null }],
    }).returning({ id: safetyRecordsTable.id });
    await markMalformedTimestamp([record.id]);
    const refreshedAt = new Date("2026-10-12T03:04:05.000Z");
    await db.insert(providerMappingsTable).values([
      { titleId: titles[0].id, provider: "IMDb", externalId: "excluded-candidate" },
      {
        titleId: titles[candidateCount - 1].id, provider: "IMDb", externalId: "matching-title",
        status: "mapped", lastRefreshedAt: refreshedAt,
      },
    ]);
    const querySpy = vi.spyOn(pool, "query");
    let response: request.Response;
    let providerMappingReads: unknown[][] = [];
    try {
      response = await request(app)
        .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true`)
        .expect(200);
      providerMappingReads = (querySpy.mock.calls as unknown[][]).filter(([query]) => {
        const statement = typeof query === "string" ? query : (query as { text?: string } | null)?.text;
        return statement?.includes("provider_mappings");
      });
    } finally {
      querySpy.mockRestore();
    }
    expect(providerMappingReads).toHaveLength(1);
    expect(providerMappingReads[0][1]).toEqual([titles[candidateCount - 1].id]);
    expect(response!.body).toEqual([{
      id: titles[candidateCount - 1].id,
      name: `${fixturePrefix}-${String(candidateCount).padStart(3, "0")}`,
      type: "movie",
      tmdbId: null,
      imdbId: null,
      mappings: [{
        provider: "IMDb", externalId: "matching-title", status: "mapped",
        lastRefreshedAt: refreshedAt.toISOString(),
      }],
      selectedRating: {
        region: "US", countryName: "United States", system: "MPAA", label: "PG-13",
        sourceName: "Wikidata", recordId: record.id, lastRefreshedAt: null,
        sourceUrl: "https://www.wikidata.org/wiki/Qtimestamp-mapping", refreshTimestampMalformed: true,
      },
    }]);
  });

  it("finds a late malformed-timestamp match in a large catalog", async () => {
    const fixturePrefix = "timestamp-large-catalog-fixture-20261004";
    const candidateCount = 2_000;
    const titles = await db.insert(titlesTable).values(
      Array.from({ length: candidateCount }, (_, index) => ({
        name: `${fixturePrefix}-${String(index + 1).padStart(4, "0")}`,
        type: "movie" as const,
        popularity: 10,
      })),
    ).returning({ id: titlesTable.id });
    titleIds.push(...titles.map(({ id }) => id));
    const [record] = await db.insert(safetyRecordsTable).values({
      titleId: titles[titles.length - 1].id,
      sourceName: "Wikidata",
      status: "available",
      isCommunity: false,
      url: "https://www.wikidata.org/wiki/Qlarge-catalog",
      updatedAt: new Date("2026-10-01T00:00:00.000Z"),
      items: [{ category: "MPAA", label: "PG-13", score: null, maxScore: null, description: null }],
    }).returning({ id: safetyRecordsTable.id });
    await markMalformedTimestamp([record.id]);
    const startedAt = performance.now();
    const response = await request(app)
      .get(`/api/admin/content?q=${fixturePrefix}&region=US&malformedRefreshTimestamp=true`)
      .expect(200);
    const elapsedMs = performance.now() - startedAt;
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      name: `${fixturePrefix}-${String(candidateCount).padStart(4, "0")}`,
      selectedRating: { region: "US", refreshTimestampMalformed: true },
    });
    expect(elapsedMs).toBeLessThan(10_000);
    if (process.env.REPORT_CONTENT_REVIEW_TIMING === "1") {
      console.info(`Large-catalog malformed-timestamp request: ${elapsedMs.toFixed(1)}ms`);
    }
  });

  it("rejects invalid filter query values", async () => {
    await request(app).get("/api/admin/content?malformedRefreshTimestamp=sometimes").expect(400);
    await request(app).get("/api/admin/content?malformedRefreshTimestamp=true&offset=-1").expect(400);
    await request(app)
      .get("/api/admin/content?malformedRefreshTimestamp=true&malformedRefreshTimestampAllRegions=true")
      .expect(400);
  });
});
