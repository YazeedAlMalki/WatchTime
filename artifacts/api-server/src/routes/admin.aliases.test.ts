import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, titleAliasesTable, titlesTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

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
});