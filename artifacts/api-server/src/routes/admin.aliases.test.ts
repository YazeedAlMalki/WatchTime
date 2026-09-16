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
      collision: true,
      collisionTitleCount: 2,
    });
  });

  it("edits an alias without changing either catalog identity", async () => {
    const [row] = await db.select().from(titleAliasesTable)
      .where(eq(titleAliasesTable.titleId, createdTitleIds[0]));
    const response = await request(app)
      .patch(`/api/admin/content-aliases/${row.id}`)
      .send({ alias: "Corrected Local Title", language: "en", sourceUrl: "https://example.test/corrected" });
    expect(response.status).toBe(200);
    const titles = await db.select().from(titlesTable).where(inArray(titlesTable.id, createdTitleIds));
    expect(titles.map((title) => title.imdbId).sort()).toEqual(["tt-alias-test-1", "tt-alias-test-2"]);
    expect(titles.find((title) => title.id === createdTitleIds[0])?.altTitles).toEqual(["Corrected Local Title"]);
    expect(titles.find((title) => title.id === createdTitleIds[1])?.altTitles).toEqual([]);
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
        collision: true,
        collisionTitleCount: 2,
      }),
      expect.objectContaining({
        titleId: createdTitleIds[1],
        collision: true,
        collisionTitleCount: 2,
      }),
    ]));
  });
});
