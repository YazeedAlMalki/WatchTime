import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  safetyRecordsTable,
  titleAliasesTable,
  titlesTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray, lt, sql } from "drizzle-orm";
import { runCatalogSync, type SourceItem } from "../seed-real";
import { mockMalformedSafetyTimestamp } from "../test-utils/malformedSafetyTimestamp";

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

    const response = await request(app).get("/api/admin/content?q=Alias%20Test%20One");

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
      sourceUrl: "https://www.wikidata.org/wiki/Q123",
    });
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

    const restoreSelect = mockMalformedSafetyTimestamp(db, rating.id, malformedTimestamp);
    try {
      const adminResponse = await request(app)
        .get("/api/admin/content?q=Alias%20Test%20One")
        .expect(200);
      expect(adminResponse.body).toHaveLength(1);
      expect(adminResponse.body[0].selectedRating).toEqual({
        region: "US",
        countryName: "United States",
        system: "MPAA",
        label: "PG-13",
        sourceName: "Wikidata",
        recordId: rating.id,
        lastRefreshedAt: null,
        sourceUrl: "https://www.wikidata.org/wiki/Q123",
        refreshTimestampMalformed: true,
      });

      const publicResponse = await request(app)
        .get(`/api/safety?titleId=${createdTitleIds[0]}`)
        .expect(200);
      expect(publicResponse.body.preferredRating).toEqual({
        region: "US",
        countryName: "United States",
        system: "MPAA",
        label: "PG-13",
        sourceName: "Wikidata",
        recordId: rating.id,
        lastRefreshedAt: null,
        sourceUrl: "https://www.wikidata.org/wiki/Q123",
      });
      expect(publicResponse.body.preferredRating)
        .not.toHaveProperty("refreshTimestampMalformed");
    } finally {
      restoreSelect();
    }
  });

  it("shows provenance and collisions", async () => {
    const response = await request(app).get("/api/admin/content-aliases?q=Shared");
    const providerResponse = await request(app)
      .get("/api/admin/content-aliases?ownership=provider");
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
      .get("/api/admin/content-aliases?ownership=editorial");
    expect(editorialResponse.status).toBe(200);
    expect(editorialResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "Shared Local Title",
          sourceName: "Editorial test",
          isEditorial: true,
        }),
      ]),
    );
    expect(editorialResponse.body.items.every((alias: { isEditorial: boolean }) => alias.isEditorial)).toBe(true);
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
    const aliases = Array.from({ length: 205 }, (_, index) => ({
      titleId: createdTitleIds[0],
      alias: `Pagination marker ${String(index).padStart(3, "0")}`,
      normalizedAlias: `paginationmarker${String(index).padStart(3, "0")}`,
      sourceName: "Pagination test",
      isEditorial: index % 2 !== 0,
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

  it("continues by stable alias ID when matching aliases are added, removed, or renamed", async () => {
    const rows = await db.insert(titleAliasesTable).values(
      Array.from({ length: 4 }, (_, index) => ({
        titleId: createdTitleIds[0],
        alias: `Cursor Review ${String(index + 1).padStart(2, "0")}`,
        normalizedAlias: `cursorreview${String(index + 1).padStart(2, "0")}`,
        sourceName: "Cursor test",
        isEditorial: true,
      })),
    ).returning({ id: titleAliasesTable.id });

    const firstPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "Cursor Review", ownership: "editorial", limit: 2 })
      .expect(200);

    expect(firstPage.body.items.map((alias: { id: number }) => alias.id))
      .toEqual(rows.slice(0, 2).map((row) => row.id));
    expect(firstPage.body.nextAfterId).toBe(rows[1].id);

    await db.update(titleAliasesTable).set({
      alias: "Cursor Review Z first renamed",
      normalizedAlias: "cursorreviewzfirstrenamed",
    }).where(eq(titleAliasesTable.id, rows[0].id));
    await db.update(titleAliasesTable).set({
      alias: "Cursor Review A fourth renamed",
      normalizedAlias: "cursorreviewafourthrenamed",
    }).where(eq(titleAliasesTable.id, rows[3].id));
    await db.delete(titleAliasesTable).where(eq(titleAliasesTable.id, rows[2].id));
    const [inserted] = await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "Cursor Review 00 inserted during review",
      normalizedAlias: "cursorreview00insertedduringreview",
      sourceName: "Cursor test",
      isEditorial: true,
    }).returning({ id: titleAliasesTable.id });

    const secondPage = await request(app)
      .get("/api/admin/content-aliases")
      .query({
        q: "Cursor Review",
        ownership: "editorial",
        limit: 2,
        afterId: firstPage.body.nextAfterId,
      })
      .expect(200);

    expect(secondPage.body.total).toBe(4);
    expect(secondPage.body.items.map((alias: { id: number }) => alias.id))
      .toEqual([rows[3].id, inserted.id]);
    expect(secondPage.body.items[0].alias).toBe("Cursor Review A fourth renamed");
    expect(secondPage.body.nextAfterId).toBeNull();
    expect([
      ...firstPage.body.items.map((alias: { id: number }) => alias.id),
      ...secondPage.body.items.map((alias: { id: number }) => alias.id),
    ]).toEqual([rows[0].id, rows[1].id, rows[3].id, inserted.id]);
  });

  it("exports every matching alias with provenance and collision details", async () => {
    await db.insert(titleAliasesTable).values([
      ...Array.from({ length: 110 }, (_, index) => ({
        titleId: createdTitleIds[0],
        alias: `Export sample ${String(index).padStart(3, "0")}`,
        normalizedAlias: `exportsample${String(index).padStart(3, "0")}`,
        language: "en",
        sourceName: "Provider archive",
        sourceUrl: `https://example.test/provider/${index}`,
        isEditorial: false,
      })),
      {
        titleId: createdTitleIds[0],
        alias: 'Export, "shared" sample',
        normalizedAlias: "exportsharedsample",
        language: "fr",
        sourceName: "Editorial source",
        sourceUrl: "https://example.test/editorial",
        isEditorial: false,
      },
      {
        titleId: createdTitleIds[1],
        alias: 'Export, "shared" sample',
        normalizedAlias: "exportsharedsample",
        language: "fr",
        sourceName: "Editorial source",
        sourceUrl: "https://example.test/editorial",
        isEditorial: false,
      },
      {
        titleId: createdTitleIds[0],
        alias: '=HYPERLINK("https://example.test","Export sample")',
        normalizedAlias: "hyperlinkexportsample",
        language: "en",
        sourceName: "Provider archive",
        sourceUrl: "https://example.test/formula",
        isEditorial: false,
      },
    ]);

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

    const empty = await request(app)
      .get("/api/admin/content-aliases/export")
      .query({ q: "no export match", ownership: "editorial" })
      .expect(200);
    expect(empty.headers["x-export-count"]).toBe("0");
    expect(empty.text.split("\r\n")).toHaveLength(1);
    expect((await request(app)
      .get("/api/admin/content-aliases/export?ownership=unknown")).status).toBe(400);
  });

  it("rejects an unknown alias ownership filter", async () => {
    const response = await request(app).get("/api/admin/content-aliases?ownership=unknown");
    expect(response.status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?limit=0")).status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?limit=101")).status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?offset=-1")).status).toBe(400);
    expect((await request(app).get("/api/admin/content-aliases?afterId=0")).status).toBe(400);
  });

  it("locates an exact alias ID even if the shared filters do not match", async () => {
    const [row] = await db.select({ id: titleAliasesTable.id }).from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const response = await request(app).get("/api/admin/content-aliases")
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
        alias: "Shared Local Title",
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

  it("keeps provider aliases visible after ingest fails, then withdraws them on retry", async () => {
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

  it("migrates a legacy provider alias to provider ownership without losing its value", async () => {
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
});
