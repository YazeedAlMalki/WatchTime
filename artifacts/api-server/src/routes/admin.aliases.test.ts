import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  providerMappingsTable,
  safetyRecordsTable,
  titleAliasesTable,
  titlesTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { runCatalogSync, type SourceItem } from "../seed-real";

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
      sourceUrl: "https://www.wikidata.org/wiki/Q123",
    });
  });

  it("shows provenance and collisions", async () => {
    const response = await request(app).get("/api/admin/content-aliases?q=Shared");
    const providerResponse = await request(app)
      .get("/api/admin/content-aliases?ownership=provider");
    expect(providerResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({
      alias: "Shared Local Title",
      sourceName: "Editorial test",
      language: "en",
      isEditorial: true,
      collision: true,
      collisionTitleCount: 2,
    });
    expect(providerResponse.body.every((alias: { isEditorial: boolean }) => !alias.isEditorial)).toBe(true);

    const editorialResponse = await request(app)
      .get("/api/admin/content-aliases?ownership=editorial");
    expect(editorialResponse.status).toBe(200);
    expect(editorialResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "Shared Local Title",
          sourceName: "Editorial test",
          isEditorial: true,
        }),
      ]),
    );
    expect(editorialResponse.body.every((alias: { isEditorial: boolean }) => alias.isEditorial)).toBe(true);
  });

  it("rejects an unknown alias ownership filter", async () => {
    const response = await request(app).get("/api/admin/content-aliases?ownership=unknown");
    expect(response.status).toBe(400);
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
        expectedUpdatedAt,
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

    const collisionReport = await request(app).get("/api/admin/content-aliases?q=Newer");
    expect(collisionReport.status).toBe(200);
    expect(collisionReport.body).toEqual([
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
        expectedUpdatedAt,
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
      key: "movie:stale-removal-refresh-test",
      source: "wikipedia",
      type: "movie",
      name: "Alias Test One",
      imdbId: "tt-alias-test-1",
      aliases: [{
        alias: "Shared Local Title",
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

    const correctionReport = await request(app)
      .get("/api/admin/content-aliases")
      .query({ q: "Newer Admin Correction" });
    expect(correctionReport.status).toBe(200);
    expect(correctionReport.body).toEqual([
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
    expect(collisionReport.body).toHaveLength(2);
    expect(collisionReport.body).toEqual(expect.arrayContaining([
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

  it("removes withdrawn provider aliases without removing an editorial correction", async () => {
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
    expect(title.altTitles).toEqual(["Shared Local Title", "Corrected Provider Title"]);
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
    expect(withdrawnReport.body).toEqual([]);
    const correctionReport = await request(app).get("/api/admin/content-aliases?q=Corrected");
    expect(correctionReport.status).toBe(200);
    expect(correctionReport.body).toEqual([
      expect.objectContaining({
        titleId: createdTitleIds[0],
        alias: "Corrected Provider Title",
        isEditorial: true,
      }),
    ]);
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
});
