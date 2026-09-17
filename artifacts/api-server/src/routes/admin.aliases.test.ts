import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  providerMappingsTable,
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
  it("shows provenance and collisions", async () => {
    const response = await request(app).get("/api/admin/content-aliases?q=Shared");
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
  });

  it("filters aliases by provider or editorial ownership", async () => {
    await db.insert(titleAliasesTable).values({
      titleId: createdTitleIds[0],
      alias: "Provider Local Title",
      normalizedAlias: "providerlocaltitle",
      language: "en",
      sourceName: "Provider catalog",
      sourceUrl: "https://example.test/provider",
      isEditorial: false,
    });

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
      .get("/api/admin/content-aliases?ownership=unknown");
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
    const titles = await db.select().from(titlesTable).where(inArray(titlesTable.id, createdTitleIds));
    expect(titles.map((title) => title.imdbId).sort()).toEqual(["tt-alias-test-1", "tt-alias-test-2"]);
    expect(titles.find((title) => title.id === createdTitleIds[0])?.altTitles).toEqual(["Corrected Local Title"]);
    expect(titles.find((title) => title.id === createdTitleIds[1])?.altTitles).toEqual([]);
  });

  it("rejects a stale correction without leaving collision badges behind", async () => {
    const [row] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const expectedUpdatedAt = row.updatedAt.toISOString();

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
      error:
        "This alternate title changed while you were editing. Refresh the list and review the newer correction before saving.",
    });

    const [unchanged] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.id, row.id));
    expect(unchanged).toMatchObject({
      alias: "First Admin Correction",
      language: "en",
      sourceUrl: "https://example.test/first-correction",
    });

    const collisionReport = await request(app)
      .get("/api/admin/content-aliases?q=First Admin Correction");
    expect(collisionReport.status).toBe(200);
    expect(collisionReport.body).toEqual([
      expect.objectContaining({
        alias: "First Admin Correction",
        collision: false,
        collisionTitleCount: 1,
      }),
    ]);
  });

  it("keeps an editorial correction and catalog identities intact after a provider refresh", async () => {
    const sourceItem: SourceItem = {
      key: "movie:alias-refresh-test",
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

    await runCatalogSync({ dryRun: false, allowPartial: false }, [sourceItem]);
    const [alias] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const edit = await request(app)
      .patch(`/api/admin/content-aliases/${alias.id}`)
      .send({
        alias: "Corrected Local Title",
        language: "en",
        sourceUrl: "https://example.test/corrected",
        expectedUpdatedAt: alias.updatedAt.toISOString(),
      });
    expect(edit.status).toBe(200);

    const mappingsBefore = await db.select().from(providerMappingsTable)
      .where(eq(providerMappingsTable.titleId, createdTitleIds[0]));
    await runCatalogSync({ dryRun: false, allowPartial: false }, [sourceItem]);

    const titles = await db.select().from(titlesTable)
      .where(inArray(titlesTable.id, createdTitleIds));
    const mappingsAfter = await db.select().from(providerMappingsTable)
      .where(eq(providerMappingsTable.titleId, createdTitleIds[0]));
    const refreshedAliases = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    expect(titles.map((title) => title.id).sort()).toEqual([...createdTitleIds].sort());
    expect(titles.map((title) => title.imdbId).sort()).toEqual(["tt-alias-test-1", "tt-alias-test-2"]);
    expect(mappingsAfter.map(({ provider, externalId, titleId }) => ({ provider, externalId, titleId })))
      .toEqual(mappingsBefore.map(({ provider, externalId, titleId }) => ({ provider, externalId, titleId })));
    expect(refreshedAliases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        alias: "Corrected Local Title",
        sourceName: "Admin editorial",
        isEditorial: true,
      }),
      expect.objectContaining({
        alias: "Shared Local Title",
        sourceName: "Provider catalog",
        isEditorial: false,
      }),
    ]));
    expect(titles.find((title) => title.id === createdTitleIds[0])?.altTitles)
      .toEqual(expect.arrayContaining(["Corrected Local Title", "Shared Local Title"]));

    const collisionReport = await request(app).get("/api/admin/content-aliases?q=Shared");
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
