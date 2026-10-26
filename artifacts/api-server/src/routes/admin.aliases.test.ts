import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get as httpGet, request as httpRequest, ServerResponse } from "node:http";
import request from "supertest";
import {
  db,
  pool,
  safetyRecordsTable,
  titleAliasesTable,
  titlesTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray, lt, sql } from "drizzle-orm";
import { runCatalogSync, type SourceItem } from "../seed-real";
import {
  mockMalformedSafetyTimestamp,
  mockMalformedSafetyTimestampDuplicate,
  mockSafetyRecordQueryOrder,
} from "../test-utils/malformedSafetyTimestamp";

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

const createdTitleIds: number[] = [];

beforeEach(async () => {
  await db.insert(usersTable).values({
    id: "test-admin",
    email: "alias-admin@example.test",
    isAdmin: false,
  }).onConflictDoNothing();
  const titles = await db.insert(titlesTable).values([
    { type: "movie", name: "Alias Test One", year: 2020, imdbId: "tt-alias-test-1" },
    { type: "movie", name: "Alias Test Two", year: 2021, imdbId: "tt-alias-test-2" },
  ]).returning({ id: titlesTable.id });
  createdTitleIds.push(...titles.map((title) => title.id));
  await db.insert(titleAliasesTable).values([
    {
      titleId: titles[0].id,
      alias: "Shared Local Title",
      normalizedAlias: "sharedlocaltitle",
      language: "en",
      sourceName: "Editorial test",
      sourceUrl: "https://example.test/source-one",
      isEditorial: true,
    },
    {
      titleId: titles[1].id,
      alias: "Shared Local Title",
      normalizedAlias: "sharedlocaltitle",
      language: "en",
      sourceName: "Editorial test",
      sourceUrl: "https://example.test/source-two",
      isEditorial: true,
    },
  ]);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (createdTitleIds.length) {
    await db.delete(titlesTable).where(inArray(titlesTable.id, createdTitleIds.splice(0)));
  }
  await db.delete(usersTable).where(eq(usersTable.id, "test-admin"));
});

describe("admin title aliases", () => {
  it("shows the Wikidata record selected by the public rating resolver", async () => {
    const newerUpdatedAt = new Date("2026-02-01T00:00:00.000Z");
    const [newer] = await db.insert(safetyRecordsTable).values({
      titleId: createdTitleIds[0],
      sourceName: "Wikidata",
      tier: 2,
      isCommunity: false,
      status: "available",
      url: "https://www.wikidata.org/wiki/Q123",
      updatedAt: newerUpdatedAt,
      items: [{
        category: "MPAA",
        label: "PG-13",
        score: null,
        maxScore: null,
        description: "Newer official record",
      }],
    }).returning({ id: safetyRecordsTable.id });

    const response = await request(app)
      .get("/api/admin/content?q=Alias%20Test%20One")
      .expect(200);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].selectedRating).toEqual({
      region: "US",
      countryName: "United States",
      system: "MPAA",
      label: "PG-13",
      sourceName: "Wikidata",
      recordId: newer.id,
      lastRefreshedAt: newerUpdatedAt.toISOString(),
      refreshTimestampMalformed: false,
      hasLatestRatingLabelConflict: false,
      sourceUrl: "https://www.wikidata.org/wiki/Q123",
    });
  });

  it("keeps public and admin ratings on the higher-priority tier when refresh dates tie", async () => {
    const updatedAt = new Date("2026-02-01T00:00:00.000Z");
    const [lowerPriority] = await db.insert(safetyRecordsTable).values({
      titleId: createdTitleIds[0],
      sourceName: "Wikidata",
      tier: 2,
      isCommunity: false,
      status: "available",
      url: "https://example.test/lower-priority-rating",
      updatedAt,
      items: [{
        category: "MPAA",
        label: "PG",
        score: null,
        maxScore: null,
        description: "Lower-priority official rating",
      }],
    }).returning({ id: safetyRecordsTable.id });
    const higherPriorityId = lowerPriority.id + 1_000_000_000;

    const expectedRating = {
      region: "US",
      countryName: "United States",
      system: "MPAA",
      label: "PG-13",
      sourceName: "Wikidata",
      recordId: higherPriorityId,
      lastRefreshedAt: updatedAt.toISOString(),
      sourceUrl: "https://example.test/higher-priority-rating",
    };

    for (const order of ["forward", "reverse"] as const) {
      const restoreOrder = mockSafetyRecordQueryOrder(db, order, {
        sourceRecordId: lowerPriority.id,
        duplicateRecordId: higherPriorityId,
        overrides: {
          tier: 1,
          url: "https://example.test/higher-priority-rating",
          items: [{
            category: "MPAA",
            label: "PG-13",
            score: null,
            maxScore: null,
            description: "Higher-priority official rating",
          }],
        },
      });
      try {
        const adminResponse = await request(app)
          .get("/api/admin/content?q=Alias%20Test%20One")
          .expect(200);
        const publicResponse = await request(app)
          .get(`/api/safety?titleId=${createdTitleIds[0]}`)
          .expect(200);

        expect(adminResponse.body[0].selectedRating).toEqual({
          ...expectedRating,
          refreshTimestampMalformed: false,
        });
        expect(publicResponse.body.preferredRating).toEqual(expectedRating);
        expect({
          ...publicResponse.body.preferredRating,
          refreshTimestampMalformed: false,
        }).toEqual(adminResponse.body[0].selectedRating);
        expect(expectedRating.recordId).not.toBe(lowerPriority.id);
      } finally {
        restoreOrder();
      }
    }
  });

  it.each([
    ["conflicting", ["PG", "R"], true],
    ["matching", ["PG", "PG"], false],
  ] as const)("reports whether equally fresh official records have %s labels", async (_description, labels, hasConflict) => {
    const tiedUpdatedAt = new Date("2026-02-01T00:00:00.000Z");
    const [selectedRecord] = await db.insert(safetyRecordsTable).values({
      titleId: createdTitleIds[0],
      sourceName: "Wikidata",
      tier: 2,
      isCommunity: false,
      status: "available",
      updatedAt: tiedUpdatedAt,
      url: "https://www.wikidata.org/wiki/Q123",
      items: [{
        category: "MPAA",
        label: labels[0],
        score: null,
        maxScore: null,
        description: "Official rating",
      }],
    }).returning({ id: safetyRecordsTable.id });
    const restoreSelect = mockMalformedSafetyTimestampDuplicate(
      db,
      selectedRecord.id,
      tiedUpdatedAt,
      { label: labels[1], url: "https://www.wikidata.org/wiki/Q456" },
    );
    const expectedSelectedRating = {
      region: "US",
      countryName: "United States",
      system: "MPAA",
      label: labels[0] < labels[1] ? labels[0] : labels[1],
      sourceName: "Wikidata",
      recordId: selectedRecord.id,
      lastRefreshedAt: tiedUpdatedAt.toISOString(),
      sourceUrl: "https://www.wikidata.org/wiki/Q123",
    };

    try {
      const adminResponse = await request(app)
        .get("/api/admin/content?q=Alias%20Test%20One")
        .expect(200);
      expect(adminResponse.body[0].selectedRating).toEqual({
        ...expectedSelectedRating,
        refreshTimestampMalformed: false,
        hasLatestRatingLabelConflict: hasConflict,
      });

      const publicResponse = await request(app)
        .get(`/api/safety?titleId=${createdTitleIds[0]}`)
        .expect(200);
      expect(publicResponse.body.preferredRating).toEqual(expectedSelectedRating);
    } finally {
      restoreSelect();
    }
  });

  it.each([
    ["an invalid Date object", new Date(Number.NaN)],
    ["a malformed timestamp string", "not-a-timestamp"],
  ])("keeps public and admin rating responses available for %s", async (_description, malformedTimestamp) => {
    const [rating] = await db.insert(safetyRecordsTable).values({
      titleId: createdTitleIds[0],
      sourceName: "Wikidata",
      tier: 2,
      isCommunity: false,
      status: "available",
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      url: "https://www.wikidata.org/wiki/Q123",
      items: [{
        category: "MPAA",
        label: "PG-13",
        score: null,
        maxScore: null,
        description: "Official rating",
      }],
    }).returning({ id: safetyRecordsTable.id });

    // SQL ranks malformed candidates before the decoded-row mock is applied.
    // Keep the database fixture malformed as well as its simulated JS value.
    await db.execute(sql`
      update safety_records set updated_at = 'infinity'::timestamp
      where id = ${rating.id}
    `);
    const restoreSelect = mockMalformedSafetyTimestamp(db, rating.id, malformedTimestamp);

    const expectedRating = {
      region: "US",
      countryName: "United States",
      system: "MPAA",
      label: "PG-13",
      sourceName: "Wikidata",
      recordId: rating.id,
      lastRefreshedAt: null,
      sourceUrl: "https://www.wikidata.org/wiki/Q123",
    };
    try {
      const adminResponse = await request(app)
        .get("/api/admin/content?q=Alias%20Test%20One")
        .expect(200);
      expect(adminResponse.body).toHaveLength(1);
      expect(adminResponse.body[0].selectedRating).toEqual({
        ...expectedRating,
        refreshTimestampMalformed: true,
        hasLatestRatingLabelConflict: false,
      });

      const malformedFilterResponse = await request(app)
        .get("/api/admin/content?q=Alias%20Test%20One&malformedRefreshTimestamp=true")
        .expect(200);
      expect(malformedFilterResponse.body).toEqual([
        expect.objectContaining({
          id: createdTitleIds[0],
          selectedRating: expect.objectContaining({
            refreshTimestampMalformed: true,
          }),
        }),
      ]);

      const publicResponse = await request(app)
        .get(`/api/safety?titleId=${createdTitleIds[0]}`)
        .expect(200);

      expect(publicResponse.body.preferredRating).toEqual(expectedRating);
    } finally {
      restoreSelect();
    }
  });

  it("keeps malformed refresh reviews matched to the selected rating provider", async () => {
    const selectedProvider = "Selected Rating Provider";
    const unselectedProvider = "Unselected Duplicate Provider";
    const [rating] = await db.insert(safetyRecordsTable).values({
      titleId: createdTitleIds[0],
      sourceName: selectedProvider,
      tier: 2,
      isCommunity: false,
      status: "available",
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      url: "https://example.test/selected-rating",
      items: [{
        category: "MPAA",
        label: "PG-13",
        score: null,
        maxScore: null,
        description: "Selected provider rating",
      }],
    }).returning({ id: safetyRecordsTable.id });

    await db.execute(sql`
      update safety_records set updated_at = 'infinity'::timestamp
      where id = ${rating.id}
    `);
    const restoreSelect = mockMalformedSafetyTimestampDuplicate(
      db,
      rating.id,
      "not-a-timestamp",
      {
        label: "Duplicate provider rating",
        url: "https://example.test/unselected-duplicate",
        sourceName: unselectedProvider,
      },
    );

    try {
      const selectedProviderResponse = await request(app)
        .get(
          `/api/admin/content?q=Alias%20Test%20One&malformedRefreshTimestamp=true` +
          `&malformedRefreshTimestampProvider=${encodeURIComponent(selectedProvider)}`,
        )
        .expect(200);
      expect(selectedProviderResponse.body).toHaveLength(1);
      expect(selectedProviderResponse.body[0].selectedRating).toMatchObject({
        sourceName: selectedProvider,
        label: "PG-13",
        refreshTimestampMalformed: true,
      });

      const unselectedProviderResponse = await request(app)
        .get(
          `/api/admin/content?q=Alias%20Test%20One&malformedRefreshTimestamp=true` +
          `&malformedRefreshTimestampProvider=${encodeURIComponent(unselectedProvider)}`,
        )
        .expect(200);
      expect(unselectedProviderResponse.body).toEqual([]);
    } finally {
      restoreSelect();
    }
  });

  it("shows provenance and collisions", async () => {
    await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "Shared Local Provider Title",
      normalizedAlias: "sharedlocalprovidertitle",
      language: "en",
      sourceName: "TVMaze",
      sourceUrl: "https://example.test/provider-title",
      isEditorial: false,
    });

    const allAliasesResponse = await request(app)
      .get("/api/admin/content-aliases?q=Shared%20Local");
    const response = await request(app)
      .get("/api/admin/content-aliases?ownership=editorial&q=Shared%20Local%20Title")
      .expect(200);
    const providerResponse = await request(app)
      .get("/api/admin/content-aliases?ownership=provider");
    expect(allAliasesResponse.status).toBe(200);
    expect(allAliasesResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "Shared Local Provider Title",
          sourceName: "TVMaze",
          isEditorial: false,
        }),
        expect.objectContaining({
          alias: "Shared Local Title",
          sourceName: "Editorial test",
          isEditorial: true,
        }),
      ]),
    );
    expect(providerResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 2, limit: 50, offset: 0 });
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items[0]).toMatchObject({
      alias: "Shared Local Title",
      sourceName: "Editorial test",
      language: "en",
      isEditorial: true,
      collision: true,
      collisionTitleCount: 2,
    });
    expect(providerResponse.body.items.every((alias: { isEditorial: boolean }) => !alias.isEditorial)).toBe(true);

    const editorialResponse = await request(app)
      .get("/api/admin/content-aliases?ownership=editorial&q=Shared%20Local%20Title");
    expect(editorialResponse.status).toBe(200);
    expect(editorialResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "Shared Local Title",
          sourceName: "Editorial test",
          providerCitations: [],
          isEditorial: true,
        }),
      ]),
    );
    expect(editorialResponse.body.items.every((alias: { isEditorial: boolean }) => alias.isEditorial)).toBe(true);
  });

  it("looks up current collision counts independently of alias-list results", async () => {
    const response = await request(app)
      .post("/api/admin/content-alias-collisions")
      .send({
        aliases: [
          "Shared Local Title",
          "SHARED local title",
          "Unique local alias",
        ],
      })
      .expect(200);

    expect(response.body).toEqual([
      {
        alias: "Shared Local Title",
        collision: true,
        collisionTitleCount: 2,
      },
      {
        alias: "SHARED local title",
        collision: true,
        collisionTitleCount: 2,
      },
      {
        alias: "Unique local alias",
        collision: false,
        collisionTitleCount: 1,
      },
    ]);
    await request(app)
      .post("/api/admin/content-alias-collisions")
      .send({ aliases: ["   "] })
      .expect(400);

    await db
      .update(titleAliasesTable)
      .set({
        alias: "Different local title",
        normalizedAlias: "differentlocaltitle",
      })
      .where(eq(titleAliasesTable.titleId, createdTitleIds[1]));
    const refreshed = await request(app)
      .post("/api/admin/content-alias-collisions")
      .send({ aliases: ["Shared Local Title"] })
      .expect(200);
    expect(refreshed.body).toEqual([
      {
        alias: "Shared Local Title",
        collision: false,
        collisionTitleCount: 1,
      },
    ]);
  });

  it("finds aliases when accents or punctuation differ without changing their display spelling", async () => {
    const aliases = [
      {
        titleId: createdTitleIds[0],
        alias: "Amélie: L'été!",
        normalizedAlias: "amelielete",
        language: "fr",
        sourceName: "Editorial test",
        sourceUrl: "https://example.test/amelie",
        isEditorial: true,
      },
      {
        titleId: createdTitleIds[1],
        alias: "Spider-Man: No Way Home",
        normalizedAlias: "spidermannowayhome",
        language: "en",
        sourceName: "Editorial test",
        sourceUrl: "https://example.test/spider-man",
        isEditorial: true,
      },
    ];
    await db.insert(titleAliasesTable).values(aliases);

    const accentInsensitiveResponse = await request(app)
      .get("/api/admin/content-aliases?q=Amelie%20lete")
      .expect(200);
    const punctuationInsensitiveResponse = await request(app)
      .get("/api/admin/content-aliases?q=Spider%20Man%20No%20Way%20Home")
      .expect(200);

    expect(accentInsensitiveResponse.body.items).toEqual([
      expect.objectContaining({ alias: "Amélie: L'été!" }),
    ]);
    expect(punctuationInsensitiveResponse.body.items).toEqual([
      expect.objectContaining({ alias: "Spider-Man: No Way Home" }),
    ]);
  });

  it("shows the remaining provider citation after another provider withdraws a shared alias", async () => {
    const tvMazeCitation = {
      sourceName: "TVMaze",
      sourceUrl: "https://www.tvmaze.com/shows/990010",
    };
    const wikipediaCitation = {
      sourceName: "EN Wikipedia",
      sourceUrl: "https://en.wikipedia.org/wiki/Provider_Shared_Citation",
    };
    await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "Provider Shared Citation",
      normalizedAlias: "providersharedcitation",
      language: "en",
      sourceName: wikipediaCitation.sourceName,
      sourceUrl: wikipediaCitation.sourceUrl,
      providerSources: ["tvmaze", "wikipedia"],
      providerCitations: {
        tvmaze: tvMazeCitation,
        wikipedia: wikipediaCitation,
      },
      isEditorial: false,
    });
    const sharedReport = await request(app)
      .get("/api/admin/content-aliases?q=Provider%20Shared%20Citation")
      .expect(200);
    expect(sharedReport.body.items[0].providerCitations).toEqual([
      { provider: "tvmaze", ...tvMazeCitation },
      { provider: "wikipedia", ...wikipediaCitation },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      extract: "A sourced test summary.",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await runCatalogSync({
      dryRun: false,
      allowPartial: false,
    }, [{
      key: "movie:shared-alias-withdrawal-test",
      source: "wikipedia",
      type: "movie",
      name: "Alias Test One",
      imdbId: "tt-alias-test-1",
      aliases: [],
      popularity: 0,
      wikiPage: "Alias Test One",
    }]);

    const [priorAliasCount] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(titleAliasesTable).where(lt(
      titleAliasesTable.normalizedAlias,
      "providersharedcitation",
    ));
    const report = await request(app)
      .get(`/api/admin/content-aliases?offset=${priorAliasCount.count}&limit=1`)
      .expect(200);
    expect(report.body.items).toEqual([
      expect.objectContaining({
        alias: "Provider Shared Citation",
        sourceName: tvMazeCitation.sourceName,
        sourceUrl: tvMazeCitation.sourceUrl,
        providerCitations: [{
          provider: "tvmaze",
          ...tvMazeCitation,
        }],
        isEditorial: false,
      }),
    ]);
    const [remaining] = await db.select().from(titleAliasesTable).where(
      eq(titleAliasesTable.normalizedAlias, "providersharedcitation"),
    );
    expect(remaining.providerSources).toEqual(["tvmaze"]);
    expect(remaining.providerCitations).toEqual({ tvmaze: tvMazeCitation });
  });

  it("pages through every alias matching the active search and ownership filters", async () => {
    const aliases = Array.from({ length: 103 }, (_, index) => ({
      titleId: createdTitleIds[0],
      alias: `Pagination marker ${String(index).padStart(3, "0")}`,
      normalizedAlias: `paginationmarker${String(index).padStart(3, "0")}`,
      sourceName: "Provider pagination test",
      isEditorial: false,
    }));
    await db.insert(titleAliasesTable).values(aliases);

    const pages = await Promise.all([0, 40, 80].map((offset) =>
      request(app).get("/api/admin/content-aliases")
        .query({ q: "Pagination marker", ownership: "provider", limit: 40, offset }),
    ));

    expect(pages.map((page) => page.status)).toEqual([200, 200, 200]);
    expect(pages.map((page) => page.body.total)).toEqual([103, 103, 103]);
    expect(pages.map((page) => page.body.offset)).toEqual([0, 40, 80]);
    expect(pages.map((page) => page.body.limit)).toEqual([40, 40, 40]);
    expect(pages.map((page) => page.body.items.length)).toEqual([40, 40, 23]);
    expect(pages.every((page) => page.body.items.every(
      (alias: { isEditorial: boolean; alias: string }) =>
        !alias.isEditorial && alias.alias.includes("Pagination marker"),
    ))).toBe(true);
    const pageIds = pages.flatMap((page) => page.body.items.map((alias: { id: number }) => alias.id));
    expect(new Set(pageIds).size).toBe(103);
  });

  it("rejects alphabetical reviews larger than the snapshot ID limit", async () => {
    const aliases = Array.from({ length: 10_000 }, (_, index) => {
      const suffix = String(index).padStart(5, "0");
      return {
        titleId: createdTitleIds[0],
        alias: `Large Snapshot Review ${suffix}`,
        normalizedAlias: `largesnapshotreview${suffix}`,
        sourceName: "Snapshot size test",
        isEditorial: true,
      };
    });
    for (let index = 0; index < aliases.length; index += 1_000) {
      await db.insert(titleAliasesTable).values(aliases.slice(index, index + 1_000));
    }

    const maxSizeResponse = await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "Large Snapshot Review", ownership: "editorial", limit: 1 })
      .expect(200);
    expect(maxSizeResponse.body.total).toBe(10_000);
    expect(maxSizeResponse.body.nextCursor).toBeTruthy();

    await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "Large Snapshot Review 10000",
      normalizedAlias: "largesnapshotreview10000",
      sourceName: "Snapshot size test",
      isEditorial: true,
    });
    const response = await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "Large Snapshot Review", ownership: "editorial", limit: 1 })
      .expect(413);

    expect(response.body).toEqual({
      error: "This alias review matches more than 10,000 aliases. Narrow your search and try again.",
    });
  });

  it("keeps normalized-alias collision counts consistent across cursor pages", async () => {
    await db.insert(titleAliasesTable).values([
      {
        titleId: createdTitleIds[0],
        alias: "Cursor Collision Page",
        normalizedAlias: "cursorcollisionpage",
        sourceName: "Cursor collision test",
        isEditorial: true,
      },
      {
        titleId: createdTitleIds[1],
        alias: "Cursor Collision Page!",
        normalizedAlias: "cursorcollisionpage",
        sourceName: "Cursor collision test",
        isEditorial: true,
      },
    ]);

    const firstPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "cursorcollisionpage", ownership: "editorial", limit: 1 })
      .expect(200);
    const secondPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({
        q: "cursorcollisionpage",
        ownership: "editorial",
        limit: 1,
        cursor: firstPage.body.nextCursor,
      })
      .expect(200);

    expect([
      firstPage.body.items[0].collisionTitleCount,
      secondPage.body.items[0].collisionTitleCount,
    ]).toEqual([2, 2]);
    expect([
      firstPage.body.items[0].collision,
      secondPage.body.items[0].collision,
    ]).toEqual([true, true]);
    expect(firstPage.body.nextCursor).toBeTruthy();
    expect(secondPage.body.nextCursor).toBeNull();
  });

  it("continues through a stable alphabetical snapshot when aliases change between pages", async () => {
    const aliases = [
      "Snapshot Review Zulu",
      "Snapshot Review Alpha",
      "Snapshot Review Charlie",
      "Snapshot Review Bravo",
      "Snapshot Review Delta",
    ];
    const rows = await db.insert(titleAliasesTable).values(
      aliases.map((alias) => ({
        titleId: createdTitleIds[0],
        alias,
        normalizedAlias: alias.toLowerCase().replaceAll(" ", ""),
        sourceName: "Snapshot test",
        isEditorial: true,
      })),
    ).returning({ id: titleAliasesTable.id });

    const firstPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "Snapshot Review", ownership: "editorial", limit: 2 })
      .expect(200);
    expect(firstPage.body.items.map((alias: { id: number }) => alias.id))
      .toEqual([rows[1].id, rows[3].id]);
    expect(firstPage.body.items.map((alias: { alias: string }) => alias.alias))
      .toEqual(["Snapshot Review Alpha", "Snapshot Review Bravo"]);
    expect(firstPage.body.nextCursor).toMatch(/^[0-9a-f-]{36}:2:0$/i);
    await request(app)
      .get("/api/admin/content-aliases")
      .query({
        q: "Snapshot Review",
        ownership: "provider",
        limit: 2,
        cursor: firstPage.body.nextCursor,
      })
      .expect(400);
    await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "Snapshot Review", limit: 2, cursor: "not-a-snapshot" })
      .expect(400);

    await db.delete(titleAliasesTable).where(eq(titleAliasesTable.id, rows[2].id));
    await db.update(titleAliasesTable).set({
      alias: "Snapshot Review Aardvark",
      normalizedAlias: "snapshotreviewaardvark",
    }).where(eq(titleAliasesTable.id, rows[4].id));
    const [inserted] = await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "Snapshot Review A0 inserted",
      normalizedAlias: "snapshotreviewa0inserted",
      sourceName: "Snapshot test",
      isEditorial: true,
    }).returning({ id: titleAliasesTable.id });

    const secondPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({
        q: "Snapshot Review",
        ownership: "editorial",
        limit: 2,
        cursor: firstPage.body.nextCursor,
      })
      .expect(200);
    expect(secondPage.body.items.map((alias: { id: number }) => alias.id))
      .toEqual([rows[4].id]);
    expect(secondPage.body.items.map((alias: { alias: string }) => alias.alias))
      .toEqual(["Snapshot Review Aardvark"]);
    expect(secondPage.body.items.some((alias: { id: number }) => alias.id === inserted.id)).toBe(false);
    expect(secondPage.body.nextCursor).toMatch(/^[0-9a-f-]{36}:4:2$/i);
    expect(secondPage.body.previousCursor).toMatch(/^[0-9a-f-]{36}:0$/i);

    const thirdPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({
        q: "Snapshot Review",
        ownership: "editorial",
        limit: 2,
        cursor: secondPage.body.nextCursor,
      })
      .expect(200);
    expect(thirdPage.body.items.map((alias: { id: number }) => alias.id)).toEqual([rows[0].id]);
    expect(thirdPage.body.items.some((alias: { id: number }) => alias.id === inserted.id)).toBe(false);
    expect(thirdPage.body.nextCursor).toBeNull();
    expect(thirdPage.body.previousCursor).toMatch(/^[0-9a-f-]{36}:2$/i);

    const restoredSecondPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({
        q: "Snapshot Review",
        ownership: "editorial",
        limit: 2,
        cursor: thirdPage.body.previousCursor,
      })
      .expect(200);
    expect(restoredSecondPage.body.items.map((alias: { id: number }) => alias.id))
      .toEqual([rows[4].id]);
    expect(restoredSecondPage.body.items.map((alias: { alias: string }) => alias.alias))
      .toEqual(["Snapshot Review Aardvark"]);
    expect(restoredSecondPage.body.previousCursor).toMatch(/^[0-9a-f-]{36}:0$/i);

    const restoredFirstPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({
        q: "Snapshot Review",
        ownership: "editorial",
        limit: 2,
        cursor: restoredSecondPage.body.previousCursor,
      })
      .expect(200);
    expect(restoredFirstPage.body.items.map((alias: { id: number }) => alias.id))
      .toEqual([rows[1].id, rows[3].id]);
    expect(restoredFirstPage.body.items.map((alias: { alias: string }) => alias.alias))
      .toEqual(["Snapshot Review Alpha", "Snapshot Review Bravo"]);
    expect(restoredFirstPage.body.previousCursor).toBeNull();
    expect(new Set([
      ...firstPage.body.items.map((alias: { id: number }) => alias.id),
      ...secondPage.body.items.map((alias: { id: number }) => alias.id),
      ...thirdPage.body.items.map((alias: { id: number }) => alias.id),
    ]).size).toBe(4);
  });

  it("exports all matching alternate titles as safely escaped CSV", async () => {
    const exportRows = [
      ...Array.from({ length: 110 }, (_, index) => ({
        titleId: createdTitleIds[0],
        alias: `Export sample ${String(index).padStart(3, "0")}`,
        normalizedAlias: `exportsample${String(index).padStart(3, "0")}`,
        language: "en",
        sourceName: "Export source",
        sourceUrl: `https://example.test/export/${index}`,
        isEditorial: false,
      })),
      {
        titleId: createdTitleIds[0],
        alias: '=HYPERLINK("https://example.test","Export sample")',
        normalizedAlias: "exportsampleformula",
        language: "en",
        sourceName: "Export source",
        sourceUrl: null,
        isEditorial: false,
      },
      ...createdTitleIds.map((titleId) => ({
        titleId,
        alias: "Export, \"shared\" sample",
        normalizedAlias: "exportsharedsample",
        language: "fr",
        sourceName: "Editorial source",
        sourceUrl: "https://example.test/editorial",
        isEditorial: false,
      })),
    ];
    const insertedRows = await db.insert(titleAliasesTable).values(exportRows)
      .returning({ id: titleAliasesTable.id });
    await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "Export sample editorial exclusion",
      normalizedAlias: "exportsampleeditorialexclusion",
      sourceName: "Editorial test",
      isEditorial: true,
    });

    const response = await request(app)
      .get("/api/admin/content-aliases/export")
      .query({ q: "Export", ownership: "provider" })
      .expect(200);
    const lines = response.text.split("\r\n");

    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("alternate-title-review.csv");
    expect(response.headers["x-export-count"]).toBe("113");
    expect(lines).toHaveLength(114);
    expect(lines[0]).toContain('"Language","Source","Source URL","Ownership"');
    expect(lines[0]).toContain('"Collision","Collision title count","Last updated"');
    expect(lines.some((line) =>
      line.includes('"Export, ""shared"" sample"')
      && line.includes('"fr"')
      && line.includes('"Editorial source"')
      && line.includes('"https://example.test/editorial"')
      && line.includes('"Provider-owned"')
      && line.includes('"Yes","2"'),
    )).toBe(true);
    expect(lines.some((line) =>
      line.includes(`"'=HYPERLINK(""https://example.test"",""Export sample"")"`),
    )).toBe(true);
    expect(lines.slice(1).every((line) => line.includes('"Provider-owned"'))).toBe(true);
    expect(lines.slice(1).map((line) => Number(line.split(",", 1)[0].slice(1, -1))))
      .toEqual(insertedRows.map((row) => row.id));
    expect(lines.slice(1).every((line) => line.includes('"Provider-owned","No"'))).toBe(true);

    const empty = await request(app)
      .get("/api/admin/content-aliases/export")
      .query({ q: "no export match", ownership: "editorial" })
      .expect(200);
    expect(empty.headers["x-export-count"]).toBe("0");
    expect(empty.text.split("\r\n")).toHaveLength(1);
    expect((await request(app)
      .get("/api/admin/content-aliases/export?ownership=unknown")).status).toBe(400);
  });

  it("exports all active provider citations and excludes withdrawn or editorial provider citations", async () => {
    const providerCitations = {
      tvmaze: {
        sourceName: "TVMaze",
        sourceUrl: "https://www.tvmaze.com/shows/990020",
      },
      wikipedia: {
        sourceName: "EN Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/Citation_Export_Shared",
      },
    };
    await db.insert(titleAliasesTable).values([
      {
        titleId: createdTitleIds[0],
        alias: "Citation export sample shared",
        normalizedAlias: "citationexportsampleshared",
        language: "en",
        sourceName: providerCitations.tvmaze.sourceName,
        sourceUrl: providerCitations.tvmaze.sourceUrl,
        providerSources: ["tvmaze", "wikipedia"],
        providerCitations,
        isEditorial: false,
      },
      {
        titleId: createdTitleIds[0],
        alias: "Citation export sample withdrawn",
        normalizedAlias: "citationexportsamplewithdrawn",
        language: "en",
        sourceName: providerCitations.tvmaze.sourceName,
        sourceUrl: providerCitations.tvmaze.sourceUrl,
        providerSources: ["tvmaze"],
        providerCitations: {
          ...providerCitations,
          wikipedia: {
            sourceName: "Withdrawn Wikipedia citation",
            sourceUrl: "https://en.wikipedia.org/wiki/Withdrawn_Export_Citation",
          },
        },
        isEditorial: false,
      },
      {
        titleId: createdTitleIds[0],
        alias: "Citation export sample editorial",
        normalizedAlias: "citationexportsampleeditorial",
        language: "en",
        sourceName: "Admin editorial",
        sourceUrl: "https://example.test/editorial-citation",
        providerSources: ["tvmaze"],
        providerCitations,
        isEditorial: true,
      },
    ]);

    const response = await request(app)
      .get("/api/admin/content-aliases/export")
      .query({ q: "Citation export sample" })
      .expect(200);
    const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const sharedCitations = JSON.stringify([
      { provider: "tvmaze", ...providerCitations.tvmaze },
      { provider: "wikipedia", ...providerCitations.wikipedia },
    ]);

    expect(response.headers["x-export-count"]).toBe("3");
    expect(response.text).toContain('"Last updated","Provider citations"');
    expect(response.text).toContain(csvCell(sharedCitations));
    expect(response.text).toContain("Citation export sample withdrawn");
    expect(response.text).not.toContain("Withdrawn_Export_Citation");
    expect(response.text).toContain('"Admin editorial"');
    expect(response.text).toContain('"https://example.test/editorial-citation"');
    expect(response.text).toContain(csvCell("[]"));
  });

  it("exports editorial provenance and collisions outside the active filters", async () => {
    const sourceName = 'Editorial, "verified"\nsecond line';
    const [editorial] = await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "Unique CSV review alias",
      normalizedAlias: "uniquecsvreviewalias",
      language: "fr",
      sourceName,
      sourceUrl: "https://example.test/editorial-review",
      isEditorial: true,
    }).returning();
    await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[1],
      alias: "Different provider spelling",
      normalizedAlias: editorial.normalizedAlias,
      sourceName: "Provider test",
      isEditorial: false,
    });

    // Matching by title name must retain collision evidence from excluded rows.
    const response = await request(app)
      .get("/api/admin/content-aliases/export")
      .query({ q: "Alias Test One", ownership: "editorial" })
      .expect(200);

    expect(response.headers["x-export-count"]).toBe("2");
    expect(response.text).toContain([
      `"${editorial.id}"`,
      `"${editorial.titleId}"`,
      '"Alias Test One"',
      '"movie"',
      '"2020"',
      '"Unique CSV review alias"',
      '"fr"',
      '"Editorial, ""verified""\nsecond line"',
      '"https://example.test/editorial-review"',
      '"Editorial"',
      '"Yes"',
      '"Yes"',
      '"2"',
      `"${editorial.updatedAt.toISOString()}"`,
      '"[]"',
    ].join(","));
    expect(response.text).not.toContain("Different provider spelling");
    expect(response.text).not.toContain('"Provider-owned"');
  });

  it("protects formula prefixes in all exported text fields", async () => {
    const [alias] = await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: " \t=Formula CSV review",
      normalizedAlias: "formulacsvreview",
      language: "+en",
      sourceName: "-source",
      sourceUrl: "@source",
      isEditorial: true,
    }).returning();

    const response = await request(app)
      .get("/api/admin/content-aliases/export")
      .query({ q: "Formula CSV review", ownership: "editorial" })
      .expect(200);

    expect(response.headers["x-export-count"]).toBe("1");
    expect(response.text.split("\r\n")).toHaveLength(2);
    expect(response.text).toContain([
      `"${alias.id}"`, `"${alias.titleId}"`, '"Alias Test One"', '"movie"', '"2020"',
      "\"' \t=Formula CSV review\"", "\"'+en\"", "\"'-source\"", "\"'@source\"",
      '"Editorial"', '"Yes"', '"No"', '"1"', `"${alias.updatedAt.toISOString()}"`,
    ].join(","));
  });

  it("streams a large filtered export with every row ordered and collision counts intact", async () => {
    const largeExportAliases = [
      {
        titleId: createdTitleIds[0],
        alias: "Large streamed export shared collision",
        normalizedAlias: "largestreamedexportsharedcollision",
        language: "en",
        sourceName: "Large export test",
        sourceUrl: "https://example.test/large-export/first",
        isEditorial: true,
      },
      ...Array.from({ length: 1_000 }, (_, index) => ({
        titleId: createdTitleIds[0],
        alias: `Large streamed export ${String(index).padStart(4, "0")}`,
        normalizedAlias: `largestreamedexport${String(index).padStart(4, "0")}`,
        language: "en",
        sourceName: "Large export test",
        sourceUrl: `https://example.test/large-export/${index}`,
        isEditorial: true,
      })),
      {
        titleId: createdTitleIds[1],
        alias: "Large streamed export shared collision",
        normalizedAlias: "largestreamedexportsharedcollision",
        language: "en",
        sourceName: "Large export test",
        sourceUrl: "https://example.test/large-export/second",
        isEditorial: true,
      },
    ];
    await db.insert(titleAliasesTable).values(largeExportAliases);

    const response = await request(app)
      .get("/api/admin/content-aliases/export")
      .query({ q: "Large streamed export", ownership: "editorial" })
      .expect(200);
    const lines = response.text.split("\r\n");
    const dataRows = lines.slice(1);
    const exportedIds = dataRows.map((line) => Number(line.split(",", 1)[0].slice(1, -1)));
    const collisionRows = dataRows.filter((line) => line.split(",").slice(11, 13)
      .join(",") === '"Yes","2"');

    expect(response.headers["x-export-count"]).toBe("1002");
    expect(dataRows).toHaveLength(1002);
    expect(exportedIds.every((id, index) => index === 0 || exportedIds[index - 1] < id)).toBe(true);
    expect(collisionRows).toHaveLength(2);
  });

  it("stops loading export batches and removes backpressure listeners after client cancellation", async () => {
    await db.insert(titleAliasesTable).values(Array.from({ length: 1_001 }, (_, index) => ({
      titleId: createdTitleIds[0],
      alias: `Cancelled streamed export ${String(index).padStart(4, "0")}`,
      normalizedAlias: `cancelledstreamedexport${String(index).padStart(4, "0")}`,
      language: "en",
      sourceName: "Cancellation test",
      isEditorial: true,
    })));

    const batchQueries: string[] = [];
    const originalConnect = pool.connect.bind(pool);
    const connectSpy = vi.spyOn(pool, "connect").mockImplementation(((callback?: any) => {
      if (callback) return originalConnect(callback);
      return originalConnect().then((client) => {
        const originalQuery = client.query.bind(client) as (...args: any[]) => Promise<any>;
        const originalRelease = client.release.bind(client);
        client.query = ((...args: any[]) => {
          const statement = args[0] as string | { text?: string };
          const result = originalQuery(...args);
          return result.then((value: any) => {
            const queryText = typeof statement === "string" ? statement : statement.text ?? "";
            if (
              queryText.includes("title_aliases")
              && /\border by\b/i.test(queryText)
              && /\blimit\b/i.test(queryText)
            ) {
              batchQueries.push(queryText);
            }
            return value;
          });
        }) as typeof client.query;
        client.release = ((...args: any[]) => {
          client.query = originalQuery as typeof client.query;
          client.release = originalRelease as typeof client.release;
          return originalRelease(...args);
        }) as typeof client.release;
        return client;
      });
    }) as typeof pool.connect);

    const originalWrite = ServerResponse.prototype.write;
    let forcedBackpressure = false;
    let serverResponse: ServerResponse | undefined;
    let initialDrainListeners: Function[] = [];
    let initialCloseListeners: Function[] = [];
    let backpressureListenersObserved = false;
    let releaseBackpressure!: () => void;
    const backpressureStarted = new Promise<void>((resolve) => {
      releaseBackpressure = resolve;
    });
    let resolveServerClose!: () => void;
    const serverClosed = new Promise<void>((resolve) => {
      resolveServerClose = resolve;
    });
    const writeSpy = vi.spyOn(ServerResponse.prototype, "write").mockImplementation(function (
      this: ServerResponse,
      ...args: any[]
    ) {
      const chunk = args[0];
      if (
        !forcedBackpressure
        && typeof chunk === "string"
        && chunk.startsWith("\r\n")
        && chunk.includes("Cancelled streamed export 0000")
      ) {
        forcedBackpressure = true;
        serverResponse = this;
        initialDrainListeners = this.listeners("drain");
        initialCloseListeners = this.listeners("close");
        this.once("close", resolveServerClose);
        const result = originalWrite.apply(this, args as any);
        releaseBackpressure();
        return false;
      }
      return originalWrite.apply(this, args as any);
    } as any);

    const server = app.listen(0);
    let client: ReturnType<typeof httpRequest> | undefined;
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a local HTTP server address");
      client = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        path: "/api/admin/content-aliases/export?q=Cancelled%20streamed%20export",
        headers: { "accept-encoding": "identity" },
      });
      const clientClosed = new Promise<void>((resolve) => {
        client!.once("error", () => resolve());
        client!.once("response", (response) => {
          response.on("data", (chunk: Buffer) => {
            if (chunk.toString().includes("Cancelled streamed export 0000")) {
              backpressureListenersObserved =
                (serverResponse?.listenerCount("drain") ?? 0) > initialDrainListeners.length
                && (serverResponse?.listenerCount("close") ?? 0) > initialCloseListeners.length + 1;
              client!.destroy();
            }
          });
          response.once("aborted", resolve);
        });
      });
      client.end();

      await Promise.all([backpressureStarted, clientClosed, serverClosed]);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(forcedBackpressure).toBe(true);
      expect(backpressureListenersObserved).toBe(true);
      expect(batchQueries).toHaveLength(1);
      expect(serverResponse?.listeners("drain").every((listener) =>
        initialDrainListeners.includes(listener as (...args: any[]) => void),
      )).toBe(true);
      expect(serverResponse?.listeners("close").every((listener) =>
        initialCloseListeners.includes(listener as (...args: any[]) => void),
      )).toBe(true);
    } finally {
      client?.destroy();
      writeSpy.mockRestore();
      connectSpy.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps the export count and rows on one snapshot when aliases change during the download", async () => {
    const aliases = await db.insert(titleAliasesTable).values(
      Array.from({ length: 501 }, (_, index) => ({
        titleId: createdTitleIds[0],
        alias: `Mid-download export ${String(index).padStart(4, "0")}`,
        normalizedAlias: `middownloadexport${String(index).padStart(4, "0")}`,
        language: "en",
        sourceName: "Concurrent export test",
        sourceUrl: `https://example.test/${"p".repeat(600)}`,
        isEditorial: true,
      })),
    ).returning({ id: titleAliasesTable.id });

    let changedAliasesDuringExport = false;
    let exportCount: string | undefined;
    let csvText = "";
    let statusCode: number | undefined;
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");

      await new Promise<void>((resolve, reject) => {
        const exportRequest = httpGet({
          hostname: "127.0.0.1",
          port: address.port,
          path: "/api/admin/content-aliases/export?q=Mid-download%20export&ownership=editorial",
        }, (response) => {
          const chunks: Buffer[] = [];
          let mutationStarted = false;
          statusCode = response.statusCode;
          const countHeader = response.headers["x-export-count"];
          exportCount = Array.isArray(countHeader) ? countHeader[0] : countHeader;
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            if (mutationStarted) return;
            mutationStarted = true;
            response.pause();
            void (async () => {
              await db.delete(titleAliasesTable)
                .where(eq(titleAliasesTable.id, aliases[500].id));
              await db.insert(titleAliasesTable).values([
                {
                  titleId: createdTitleIds[0],
                  alias: "Mid-download export inserted first",
                  normalizedAlias: "middownloadexportinsertedfirst",
                  language: "en",
                  sourceName: "Concurrent export test",
                  isEditorial: true,
                },
                {
                  titleId: createdTitleIds[0],
                  alias: "Mid-download export inserted second",
                  normalizedAlias: "middownloadexportinsertedsecond",
                  language: "en",
                  sourceName: "Concurrent export test",
                  isEditorial: true,
                },
              ]);
              changedAliasesDuringExport = true;
              response.resume();
            })().catch((error) => {
              response.resume();
              reject(error);
            });
          });
          response.on("end", () => {
            csvText = Buffer.concat(chunks).toString("utf8");
            resolve();
          });
          response.on("error", reject);
        });
        exportRequest.on("error", reject);
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }

    const lines = csvText.split("\r\n");
    const exportedIds = lines.slice(1)
      .map((line) => Number(line.split(",", 1)[0].slice(1, -1)));
    expect(statusCode).toBe(200);
    expect(changedAliasesDuringExport).toBe(true);
    expect(exportCount).toBe("501");
    expect(exportedIds).toEqual(aliases.map(({ id }) => id));
    expect(lines).toHaveLength(502);
    expect(csvText).not.toContain("Mid-download export inserted");
  });

  it("rejects an unknown alias ownership filter", async () => {
    const response = await request(app).get("/api/admin/content-aliases?ownership=unknown");
    expect(response.status).toBe(400);
  });

  it("rejects invalid alias page parameters", async () => {
    expect((await request(app).get("/api/admin/content-aliases?limit=0")).status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?limit=101")).status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?offset=-1")).status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?cursor=invalid")).status).toBe(400);
  });

  it("locates an exact alias ID even if the shared filters do not match", async () => {
    const [row] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const response = await request(app)
      .get("/api/admin/content-aliases")
      .query({ id: row.id, q: "not this alias", ownership: "provider" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, limit: 1, offset: 0 });
    expect(response.body.items).toEqual([expect.objectContaining({
      id: row.id, alias: "Shared Local Title", isEditorial: true,
    })]);
    expect((await request(app).get("/api/admin/content-aliases?id=0")).status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?id=1.5")).status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?id=999999999")).body)
      .toMatchObject({ items: [], total: 0, limit: 1, offset: 0 });
  });

  it("edits an alias without changing either catalog identity", async () => {
    const [row] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const response = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "Corrected Local Title",
        language: "en",
        sourceUrl: "https://example.test/corrected",
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
    expect(response.status).toBe(200);
    const titles = await db.select().from(titlesTable)
      .where(inArray(titlesTable.id, createdTitleIds));
    expect(titles.map((title) => title.imdbId).sort())
      .toEqual(["tt-alias-test-1", "tt-alias-test-2"]);
    expect(titles.find((title) => title.id === createdTitleIds[0])?.altTitles)
      .toEqual(["Corrected Local Title"]);
    expect(titles.find((title) => title.id === createdTitleIds[1])?.altTitles)
      .toEqual([]);
  });

  it("rejects a stale correction without leaving collision badges behind", async () => {
    const [row] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const expectedUpdatedAt = row.updatedAt.toISOString();

    const correction = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "Newer Admin Correction",
        language: "fr",
        sourceUrl: "https://example.test/newer-correction",
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
    expect(correction.status).toBe(200);

    const staleEdit = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "Second Admin Correction",
        language: "fr",
        sourceUrl: "https://example.test/second-correction",
        expectedUpdatedAt,
      });
    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body).toEqual({
      code: "stale_alias",
      error:
        "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
      current: expect.objectContaining({
        id: row.id,
        titleId: createdTitleIds[0],
        alias: "Newer Admin Correction",
        language: "fr",
        sourceName: "Admin editorial",
        sourceUrl: "https://example.test/newer-correction",
        isEditorial: true,
        collision: false,
        collisionTitleCount: 1,
        updatedAt: expect.any(String),
      }),
    });
    expect(staleEdit.body.current.updatedAt).not.toBe(expectedUpdatedAt);

    const [unchanged] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, row.id));
    expect(unchanged).toMatchObject({
      alias: "Newer Admin Correction",
      language: "fr",
      sourceUrl: "https://example.test/newer-correction",
      isEditorial: true,
    });

    const collisionReport = await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "Newer Admin Correction" });
    expect(collisionReport.status).toBe(200);
    expect(collisionReport.body.items).toEqual([
      expect.objectContaining({
        id: row.id,
        titleId: createdTitleIds[0],
        alias: "Newer Admin Correction",
        collision: false,
        collisionTitleCount: 1,
      }),
    ]);
  });

  it("rejects a stale removal without deleting the newer correction", async () => {
    const [row] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const expectedUpdatedAt = row.updatedAt.toISOString();
    const correction = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "Newer Admin Correction",
        language: "fr",
        sourceUrl: "https://example.test/newer-correction",
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
    expect(correction.status).toBe(200);

    const staleRemoval = await request(app)
      .delete(`/api/admin/content-aliases/${row.id}`)
      .send({ expectedUpdatedAt });
    expect(staleRemoval.status).toBe(409);
    expect(staleRemoval.body).toEqual({
      error:
        "This alternate title changed while you were reviewing it. Refresh the list and review the newer correction before removing it.",
    });
    const [unchanged] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, row.id));
    expect(unchanged).toMatchObject({
      alias: "Newer Admin Correction",
      language: "fr",
      sourceUrl: "https://example.test/newer-correction",
      isEditorial: true,
    });
  });

  it.each([
    ["missing", {}],
    ["malformed", { expectedUpdatedAt: "not-a-timestamp" }],
  ])("rejects removal when the expected timestamp is %s", async (_timestampState, body) => {
    const [row] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));

    const response = await request(app)
      .delete(`/api/admin/content-aliases/${row.id}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "The alias timestamp is required to remove this alternate title",
    });
    const [unchanged] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, row.id));
    expect(unchanged).toEqual(row);
  });

  it("keeps an editorial casing correction when the provider refreshes the same normalized alias", async () => {
    const sourceUrl = "https://example.test/provider";
    const [providerAlias] = await db.update(titleAliasesTable).set({
      alias: "SHARED LOCAL TITLE",
      sourceName: "Provider catalog",
      sourceUrl,
      isEditorial: false,
      providerSources: ["wikipedia"],
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }).where(eq(titleAliasesTable.titleId, createdTitleIds[0])).returning();
    const correction = await request(app)
      .patch(`/api/admin/content-aliases/${providerAlias.id}`)
      .send({
        alias: "Shared Local Title",
        language: "en",
        // Even retaining the provider citation must not transfer an explicit
        // admin correction back to legacy provider ownership.
        sourceUrl,
        expectedUpdatedAt: providerAlias.updatedAt.toISOString(),
      })
      .expect(200);
    const [corrected] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, providerAlias.id));
    expect(corrected.alias).toBe("Shared Local Title");
    expect(corrected.isEditorial).toBe(true);
    expect(corrected.updatedAt.toISOString()).toBe(correction.body.updatedAt);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      extract: "Provider summary",
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const sourceItem: SourceItem = {
      key: "movie:editorial-casing-refresh-test",
      source: "wikipedia",
      type: "movie",
      name: "Alias Test One",
      imdbId: "tt-alias-test-1",
      wikiPage: "Alias Test One",
      popularity: 0,
      aliases: [{
        alias: "SHARED LOCAL TITLE",
        language: "fr",
        sourceName: "Provider catalog",
        sourceUrl,
      }],
    };
    for (let refresh = 0; refresh < 2; refresh++) {
      const result = await runCatalogSync({ dryRun: false, allowPartial: false }, [sourceItem]);
      expect(result?.failures).toEqual([]);
      const aliases = await db.select().from(titleAliasesTable)
        .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
      expect(aliases).toEqual([corrected]);
      const [title] = await db.select().from(titlesTable)
        .where(eq(titlesTable.id, createdTitleIds[0]));
      expect(title.altTitles).toEqual(["Shared Local Title"]);
    }
    const staleRemoval = await request(app)
      .delete(`/api/admin/content-aliases/${providerAlias.id}`)
      .send({ expectedUpdatedAt: providerAlias.updatedAt.toISOString() });
    expect(staleRemoval.status).toBe(409);
    const [afterRemoval] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, providerAlias.id));
    expect(afterRemoval).toEqual(corrected);
  });

  it("preserves a newer correction when a catalog refresh runs before stale removal", async () => {
    const [row] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const correction = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "Newer Admin Correction",
        language: "fr",
        sourceUrl: "https://example.test/newer-correction",
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
    expect(correction.status).toBe(200);

    const sourceItem: SourceItem = {
      key: "movie:legacy-alias-refresh-test",
      source: "wikipedia",
      type: "movie",
      name: "Alias Test One",
      imdbId: "tt-alias-test-1",
      aliases: [{
        alias: "SHARED LOCAL TITLE",
        language: "en",
        sourceName: "Provider catalog",
        sourceUrl: "https://example.test/provider",
      }],
      popularity: 0,
      wikiPage: "Alias Test One",
    };

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      extract: "Provider summary",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    let staleRemovalResponse: { status: number; body: unknown } = { status: 0, body: null };
    await runCatalogSync(
      { dryRun: false, allowPartial: false },
      [sourceItem],
      async (progress) => {
        // A succeeded callback runs after the catalog transaction commits, so
        // this confirms the old review is stale against the refreshed catalog.
        if (progress.status === "succeeded") {
          staleRemovalResponse = await request(app)
            .delete(`/api/admin/content-aliases/${row.id}`)
            .send({ expectedUpdatedAt: row.updatedAt.toISOString() });
        }
      },
    );

    expect(staleRemovalResponse.status).toBe(409);
    expect(staleRemovalResponse.body).toEqual({
      error:
        "This alternate title changed while you were reviewing it. Refresh the list and review the newer correction before removing it.",
    });

    const aliases = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]))
      .orderBy(titleAliasesTable.id);
    expect(aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: row.id,
        alias: "Newer Admin Correction",
        sourceName: "Admin editorial",
        sourceUrl: "https://example.test/newer-correction",
        isEditorial: true,
      }),
      expect.objectContaining({
        // This is a separate provider-owned alias, not the corrected row.
        // Its display casing comes from the provider response.
        alias: "SHARED LOCAL TITLE",
        sourceName: "Provider catalog",
        sourceUrl: "https://example.test/provider",
        isEditorial: false,
      }),
    ]));
    expect(aliases.find((alias) => alias.id === row.id)?.updatedAt.toISOString())
      .toBe(correction.body.updatedAt);

    const [title] = await db.select().from(titlesTable)
      .where(eq(titlesTable.id, createdTitleIds[0]));
    expect(title.imdbId).toBe("tt-alias-test-1");
    expect(title.altTitles).toEqual(aliases.map((alias) => alias.alias));

    const correctionReport = await request(app).get("/api/admin/content-aliases?q=Newer%20Admin%20Correction");
    expect(correctionReport.status).toBe(200);
    expect(correctionReport.body.items).toEqual([
      expect.objectContaining({
        id: row.id,
        titleId: createdTitleIds[0],
        alias: "Newer Admin Correction",
        isEditorial: true,
        collision: false,
        collisionTitleCount: 1,
      }),
    ]);

    const collisionReport = await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "Shared Local Title" });
    expect(collisionReport.status).toBe(200);
    expect(collisionReport.body.total).toBe(2);
    expect(collisionReport.body.items).toHaveLength(2);
    expect(collisionReport.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        titleId: createdTitleIds[0],
        isEditorial: false,
        collision: true,
        collisionTitleCount: 2,
      }),
      expect.objectContaining({
        titleId: createdTitleIds[1],
        isEditorial: true,
        collision: true,
        collisionTitleCount: 2,
      }),
    ]));
  });

  it("preserves editorial corrections and another provider's aliases during withdrawal", async () => {
    const sourceItem: SourceItem = {
      key: "movie:legacy-alias-refresh-test",
      source: "wikipedia",
      type: "movie",
      name: "Alias Test One",
      imdbId: "tt-alias-test-1",
      aliases: [
        {
          alias: "Provider Retained Title",
          language: "en",
          sourceName: "Provider catalog",
          sourceUrl: "https://example.test/provider",
        },
        {
          alias: "Provider Withdrawn Title",
          language: "en",
          sourceName: "Provider catalog",
          sourceUrl: "https://example.test/provider",
        },
      ],
      popularity: 0,
      wikiPage: "Alias Test One",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      extract: "Provider summary",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await runCatalogSync({ dryRun: false, allowPartial: false }, [sourceItem]);
    await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "TVMaze Confirmed Title",
      normalizedAlias: "tvmazeconfirmedtitle",
      language: "en",
      sourceName: "TVMaze",
      sourceUrl: "https://www.tvmaze.com/shows/990010",
      providerSources: ["tvmaze"],
      isEditorial: false,
    });
    const [providerAlias] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]))
      .then((aliases) => aliases.filter((alias) => alias.alias === "Provider Retained Title"));
    const edit = await request(app)
      .patch(`/api/admin/content-aliases/${providerAlias.id}`)
      .send({
        alias: "Corrected Provider Title",
        language: "en",
        sourceUrl: "https://example.test/editorial",
        expectedUpdatedAt: providerAlias.updatedAt.toISOString(),
      });
    expect(edit.status).toBe(200);

    await runCatalogSync({
      dryRun: false,
      allowPartial: false,
    }, [{ ...sourceItem, aliases: [] }]);

    const [title] = await db.select().from(titlesTable)
      .where(eq(titlesTable.id, createdTitleIds[0]));
    expect(title.altTitles).toEqual([
      "Shared Local Title",
      "Corrected Provider Title",
      "TVMaze Confirmed Title",
    ]);
    expect(await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0])))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          alias: "Corrected Provider Title",
          sourceName: "Admin editorial",
          isEditorial: true,
        }),
      ]));
    expect(title.altTitles).not.toContain("Provider Withdrawn Title");

    const withdrawnReport = await request(app).get("/api/admin/content-aliases?q=Withdrawn");
    expect(withdrawnReport.status).toBe(200);
    expect(withdrawnReport.body.items).toEqual([]);
    const correctionReport = await request(app).get("/api/admin/content-aliases?q=Corrected");
    expect(correctionReport.status).toBe(200);
    expect(correctionReport.body.items).toEqual([
      expect.objectContaining({
        titleId: createdTitleIds[0],
        alias: "Corrected Provider Title",
        isEditorial: true,
      }),
    ]);
    const otherProviderReport = await request(app).get("/api/admin/content-aliases?q=TVMaze%20Confirmed");
    expect(otherProviderReport.status).toBe(200);
    expect(otherProviderReport.body.items).toEqual([
      expect.objectContaining({
        titleId: createdTitleIds[0],
        alias: "TVMaze Confirmed Title",
        sourceName: "TVMaze",
        isEditorial: false,
      }),
    ]);
    const [otherProviderAlias] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]))
      .then((aliases) => aliases.filter((alias) => alias.alias === "TVMaze Confirmed Title"));
    expect(otherProviderAlias.providerSources).toEqual(["tvmaze"]);
  });

  it("migrates a legacy provider alias using the provider's display casing", async () => {
    const [legacyAlias] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    await db.update(titleAliasesTable).set({
      sourceName: "Provider catalog",
      sourceUrl: "https://example.test/provider",
      isEditorial: true,
    }).where(eq(titleAliasesTable.id, legacyAlias.id));

    const sourceItem: SourceItem = {
      key: "movie:legacy-alias-refresh-test",
      source: "wikipedia",
      type: "movie",
      name: "Alias Test One",
      imdbId: "tt-alias-test-1",
      aliases: [{
        alias: "SHARED LOCAL TITLE",
        language: "en",
        sourceName: "Provider catalog",
        sourceUrl: "https://example.test/provider",
      }],
      popularity: 0,
      wikiPage: "Alias Test One",
    };

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      extract: "Provider summary",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await runCatalogSync({ dryRun: false, allowPartial: false }, [sourceItem]);

    const [migrated] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, legacyAlias.id));
    expect(migrated).toMatchObject({
      alias: "SHARED LOCAL TITLE",
      sourceName: "Provider catalog",
      sourceUrl: "https://example.test/provider",
      isEditorial: false,
    });
  });

  it("keeps provider aliases visible after ingest fails, then withdraws them on retry", async () => {
    const sourceItem: SourceItem = {
      key: "tvmaze:alias-ingest-failure-test",
      source: "tvmaze",
      type: "tv",
      name: "Alias Test One",
      tvmazeId: 992001,
      expectedTitle: "Alias Test One",
      expectedYear: 2020,
      expectedImdbId: "tt-alias-test-1",
      aliases: [{
        alias: "Provider Alias Before Failed Refresh",
        language: "en",
        sourceName: "TVMaze",
        sourceUrl: "https://www.tvmaze.com/shows/992001",
      }],
      popularity: 0,
    };
    const showPayload = {
      id: 992001,
      name: "Alias Test One",
      type: "Scripted",
      genres: ["Drama"],
      premiered: "2020-01-01",
      status: "Ended",
      summary: "<p>Test summary</p>",
      externals: { imdb: "tt-alias-test-1" },
      _embedded: {
        cast: [],
        episodes: [{
          season: 1,
          number: 1,
          name: "Pilot",
          summary: "<p>Episode one</p>",
          runtime: 42,
          airdate: "2020-01-01",
        }],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(showPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    await runCatalogSync({ dryRun: false, allowPartial: true }, [sourceItem]);

    const [titleBeforeFailure] = await db.select().from(titlesTable)
      .where(eq(titlesTable.id, createdTitleIds[0]));
    const aliasesBeforeFailure = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, titleBeforeFailure.id))
      .orderBy(titleAliasesTable.id);
    const itemWithWithdrawnAlias = { ...sourceItem, aliases: [] };
    const malformedEpisodePayload = {
      ...showPayload,
      _embedded: {
        ...showPayload._embedded,
        episodes: [{
          season: 1,
          number: 2,
          name: "Episode 2",
          summary: "<p>Malformed runtime</p>",
          runtime: "not-an-integer",
          airdate: "2020-01-08",
        }],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(malformedEpisodePayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const failedRefresh = await runCatalogSync(
      { dryRun: false, allowPartial: true },
      [itemWithWithdrawnAlias],
    );
    expect(failedRefresh?.failures).toHaveLength(1);

    const [titleAfterFailure] = await db.select().from(titlesTable)
      .where(eq(titlesTable.id, titleBeforeFailure.id));
    const aliasesAfterFailure = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, titleBeforeFailure.id))
      .orderBy(titleAliasesTable.id);
    expect(aliasesAfterFailure).toEqual(aliasesBeforeFailure);
    expect(titleAfterFailure.altTitles).toEqual(titleBeforeFailure.altTitles);
    const visibleAlias = await request(app)
      .get("/api/admin/content-aliases?q=Provider%20Alias%20Before%20Failed%20Refresh");
    expect(visibleAlias.status).toBe(200);
    expect(visibleAlias.body.items).toEqual([
      expect.objectContaining({
        titleId: titleBeforeFailure.id,
        alias: "Provider Alias Before Failed Refresh",
        sourceName: "TVMaze",
        isEditorial: false,
      }),
    ]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(showPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const successfulRefresh = await runCatalogSync(
      { dryRun: false, allowPartial: true },
      [itemWithWithdrawnAlias],
    );
    expect(successfulRefresh?.failures).toHaveLength(0);
    const [titleAfterSuccess] = await db.select().from(titlesTable)
      .where(eq(titlesTable.id, titleBeforeFailure.id));
    expect(titleAfterSuccess.altTitles).toEqual(["Shared Local Title"]);
    const withdrawnAlias = await request(app)
      .get("/api/admin/content-aliases?q=Provider%20Alias%20Before%20Failed%20Refresh");
    expect(withdrawnAlias.status).toBe(200);
    expect(withdrawnAlias.body.items).toEqual([]);
  });
  it("prefers a valid rating over a malformed duplicate refresh record", async () => {
    const validUpdatedAt = new Date("2026-02-01T00:00:00.000Z");
    const [validRating] = await db.insert(safetyRecordsTable).values({
      titleId: createdTitleIds[0],
      sourceName: "Wikidata",
      tier: 2,
      isCommunity: false,
      status: "available",
      updatedAt: validUpdatedAt,
      url: "https://www.wikidata.org/wiki/Q123",
      items: [{
        category: "MPAA",
        label: "PG-13",
        score: null,
        maxScore: null,
        description: "Valid official rating",
      }],
    }).returning({ id: safetyRecordsTable.id });
    const restoreSelect = mockMalformedSafetyTimestampDuplicate(
      db,
      validRating.id,
      "not-a-timestamp",
      { label: "R", url: "https://www.wikidata.org/wiki/Q456" },
    );
    const expectedRating = {
      region: "US",
      countryName: "United States",
      system: "MPAA",
      label: "PG-13",
      sourceName: "Wikidata",
      recordId: validRating.id,
      lastRefreshedAt: validUpdatedAt.toISOString(),
      sourceUrl: "https://www.wikidata.org/wiki/Q123",
    };
    try {
      const adminResponse = await request(app)
        .get("/api/admin/content?q=Alias%20Test%20One")
        .expect(200);
      expect(adminResponse.body[0].selectedRating).toEqual({
        ...expectedRating,
        refreshTimestampMalformed: false,
        hasLatestRatingLabelConflict: false,
      });
      const malformedFilterResponse = await request(app)
        .get("/api/admin/content?q=Alias%20Test%20One&malformedRefreshTimestamp=true")
        .expect(200);
      expect(malformedFilterResponse.body).toEqual([]);

      const publicResponse = await request(app)
        .get(`/api/safety?titleId=${createdTitleIds[0]}`)
        .expect(200);
      expect(publicResponse.body.preferredRating).toEqual(expectedRating);
    } finally {
      restoreSelect();
    }
  });

  it("filters malformed timestamps using the rating selected for the requested region", async () => {
    const titleQuery = "Alias Test One";
    const rollback = new Error("Rollback regional timestamp fixtures");
    try {
      await db.transaction(async (tx) => {
        // A title can have distinct official regional ratings from one provider.
        // Keep the duplicate provider rows isolated to this rollback-only fixture.
        await tx.execute(sql`DROP INDEX safety_records_title_source_unique_idx`);
        const records = await tx.insert(safetyRecordsTable).values([
          {
            titleId: createdTitleIds[0],
            sourceName: "Wikidata",
            tier: 2,
            isCommunity: false,
            status: "available",
            url: "https://www.wikidata.org/wiki/Q-US-region",
            updatedAt: new Date("2026-02-01T00:00:00.000Z"),
            items: [{
              category: "MPAA",
              label: "PG-13",
              score: null,
              maxScore: null,
              description: "Valid US rating",
            }],
          },
          {
            titleId: createdTitleIds[0],
            sourceName: "Wikidata",
            tier: 2,
            isCommunity: false,
            status: "available",
            url: "https://www.wikidata.org/wiki/Q-GB-region",
            updatedAt: sql`'infinity'::timestamp`,
            items: [{
              category: "BBFC",
              label: "12A",
              score: null,
              maxScore: null,
              description: "Malformed GB rating",
            }],
          },
        ]).returning({ id: safetyRecordsTable.id });
        const selectSpy = vi.spyOn(db, "select").mockImplementation(tx.select.bind(tx));
        const executeSpy = vi.spyOn(db, "execute").mockImplementation(tx.execute.bind(tx));
        try {
          const usContent = await request(app)
            .get(`/api/admin/content?q=${encodeURIComponent(titleQuery)}&region=US`)
            .expect(200);
          expect(usContent.body).toHaveLength(1);
          expect(usContent.body[0].selectedRating).toMatchObject({
            region: "US",
            recordId: records[0].id,
            refreshTimestampMalformed: false,
          });

          const malformedUsContent = await request(app)
            .get(`/api/admin/content?q=${encodeURIComponent(titleQuery)}&region=US&malformedRefreshTimestamp=true`)
            .expect(200);
          expect(malformedUsContent.body).toEqual([]);

          const gbContent = await request(app)
            .get(`/api/admin/content?q=${encodeURIComponent(titleQuery)}&region=GB`)
            .expect(200);
          expect(gbContent.body).toHaveLength(1);
          expect(gbContent.body[0].selectedRating).toMatchObject({
            region: "GB",
            recordId: records[1].id,
            refreshTimestampMalformed: true,
          });

          const malformedGbContent = await request(app)
            .get(`/api/admin/content?q=${encodeURIComponent(titleQuery)}&region=GB&malformedRefreshTimestamp=true`)
            .expect(200);
          expect(malformedGbContent.body).toHaveLength(1);
          expect(malformedGbContent.body[0].selectedRating).toMatchObject({
            region: "GB",
            recordId: records[1].id,
            refreshTimestampMalformed: true,
          });
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
});
