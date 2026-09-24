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
    const titles = await db.select().from(titlesTable)
      .where(inArray(titlesTable.id, createdTitleIds));
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
    const olderUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
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
    await db.insert(safetyRecordsTable).values({
      titleId: createdTitleIds[0],
      sourceName: "Wikidata",
      tier: 2,
      isCommunity: false,
      status: "available",
      url: "https://www.wikidata.org/wiki/Q456",
      updatedAt: olderUpdatedAt,
      items: [{
        category: "MPAA",
        label: "PG",
        score: null,
        maxScore: null,
        description: "Older official record",
      }],
    });

    const response = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "Corrected Local Title",
        language: "en",
        sourceUrl: "https://example.test/corrected",
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });

    const refreshedAt = new Date("2026-03-01T00:00:00.000Z");
    const updatedAt = new Date("2026-02-01T00:00:00.000Z");
    const makeRecord = (label: string, tier: number, url: string) => ({
      titleId: createdTitleIds[0],
      sourceName: "Wikidata",
      tier,
      isCommunity: false,
      status: "available" as const,
      url,
      updatedAt,
      items: [{
        category: "MPAA",
        label,
        score: null,
        maxScore: null,
        description: "Equal-freshness tie-breaker",
      }],
    });
    const records = [
      makeRecord("AAA", 2, "https://example.test/a"),
      makeRecord("PG-13", 1, "https://example.test/z"),
      makeRecord("PG", 1, "https://example.test/z"),
      makeRecord("PG", 1, "https://example.test/a"),
    ];

    const readSelectedRatings = async () => {
      const [publicResponse, adminResponse] = await Promise.all([
        request(app).get(`/api/safety?titleId=${createdTitleIds[0]}`),
        request(app).get("/api/admin/content?q=Alias%20Test%20One"),
      ]);
      expect(publicResponse.status).toBe(200);
      expect(adminResponse.status).toBe(200);
      expect(adminResponse.body).toHaveLength(1);
      expect(publicResponse.body.preferredRating).toEqual(adminResponse.body[0].selectedRating);
      return publicResponse.body.preferredRating;
    };

    await db.insert(safetyRecordsTable).values(records);
    const firstSelected = await readSelectedRatings();
    expect(firstSelected).toEqual({
      region: "US",
      countryName: "United States",
      system: "MPAA",
      label: "PG",
      sourceName: "Wikidata",
      recordId: expect.any(Number),
      lastRefreshedAt: updatedAt.toISOString(),
      sourceUrl: "https://example.test/a",
    });

    await db.delete(safetyRecordsTable).where(eq(safetyRecordsTable.titleId, createdTitleIds[0]));
    await db.insert(safetyRecordsTable).values([...records].reverse());
    const secondSelected = await readSelectedRatings();

    expect(secondSelected).toEqual({
      ...firstSelected,
      recordId: expect.any(Number),
    });
    expect(secondSelected.recordId).not.toBe(firstSelected.recordId);
    expect(secondSelected.sourceUrl).toBe(firstSelected.sourceUrl);
    expect(secondSelected.lastRefreshedAt).toBe(firstSelected.lastRefreshedAt);
  });

  it("shows provenance and collisions", async () => {
    const response = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "Corrected Local Title",
        language: "en",
        sourceUrl: "https://example.test/corrected",
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });

    const refreshedAt = new Date("2026-03-01T00:00:00.000Z");
    const providerResponse = await request(app)
      .get("/api/admin/content-aliases?ownership=provider");
    expect(providerResponse.status).toBe(200);
    expect(providerResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "Provider Local Title",
          sourceName: "Provider catalog",
          isEditorial: false,
          titleId: createdTitleIds[0],
        }),
      ]),
    );
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
    const response = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "Corrected Local Title",
        language: "en",
        sourceUrl: "https://example.test/corrected",
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });

    const refreshedAt = new Date("2026-03-01T00:00:00.000Z");
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

    const refreshedAt = new Date("2026-03-01T00:00:00.000Z");
    expect(response.status).toBe(200);
    const titles = await db.select().from(titlesTable)
      .where(inArray(titlesTable.id, createdTitleIds));
    expect(titles.map((title) => title.imdbId).sort()).toEqual(["tt-alias-test-1", "tt-alias-test-2"]);
    expect(titles.find((title) => title.id === createdTitleIds[0])?.altTitles).toEqual(["Corrected Local Title"]);
    expect(titles.find((title) => title.id === createdTitleIds[1])?.altTitles).toEqual([]);
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

    const firstEdit = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({
        alias: "First Admin Correction",
        language: "en",
        sourceUrl: "https://example.test/first-correction",
        expectedUpdatedAt,
      });
    expect(firstEdit.status).toBe(200);

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
        alias: "First Admin Correction",
        language: "en",
        sourceName: "Admin editorial",
        sourceUrl: "https://example.test/first-correction",
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

  it("removes withdrawn provider aliases without removing an editorial correction", async () => {
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
    const edit = await request(app)
      .patch(`/api/admin/content-aliases/${providerAlias.id}`)
      .send({
        alias: "Corrected Provider Title",
        language: "en",
        sourceUrl: "https://example.test/editorial",
        expectedUpdatedAt: providerAlias.updatedAt.toISOString(),
      });
    const titles = await db.select().from(titlesTable)
      .where(inArray(titlesTable.id, createdTitleIds));
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

  it("removes withdrawn provider aliases without removing an editorial correction", async () => {
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

    const staleRemoval = await request(app)
      .delete(`/api/admin/content-aliases/${row.id}`)
      .send({ expectedUpdatedAt });
