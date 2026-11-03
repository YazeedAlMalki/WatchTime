import { randomUUID } from "node:crypto";
import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock only authentication; tracking reads and writes use the real database.
vi.mock("../middlewares/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.get("x-test-user-id");
    if (!userId) return res.sendStatus(401);
    req.userId = userId;
    next();
  },
  requireAdmin: (_req: any, res: any) => res.sendStatus(403),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

import trackingRouter from "./tracking";
import {
  db, episodesTable, titlesTable, usersTable, watchedEpisodesTable, watchedTitlesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const app = express();
app.use(express.json());
app.use("/api", trackingRouter);

const fixtureId = randomUUID();
const accountIds = [`previous-a-${fixtureId}`, `previous-b-${fixtureId}`];
let titleId: number | undefined;
let episodeIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values(accountIds.map((id) => ({
    id, email: `${id}@example.test`,
  })));
  const [title] = await db.insert(titlesTable).values({
    name: `__previous_isolation_${fixtureId}__`, type: "tv",
  }).returning({ id: titlesTable.id });
  titleId = title.id;
  episodeIds = (await db.insert(episodesTable).values([
    [1, 1], [1, 2], [1, 3], [2, 1], [2, 2],
  ].map(([seasonNumber, episodeNumber]) => ({
    titleId: title.id, seasonNumber, episodeNumber,
    name: `Episode S${seasonNumber}E${episodeNumber}`,
  }))).returning({
    id: episodesTable.id,
    seasonNumber: episodesTable.seasonNumber,
    episodeNumber: episodesTable.episodeNumber,
  }))
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
    .map((episode) => episode.id);
});

afterAll(async () => {
  await db.delete(watchedEpisodesTable).where(inArray(watchedEpisodesTable.userId, accountIds));
  await db.delete(watchedTitlesTable).where(inArray(watchedTitlesTable.userId, accountIds));
  if (titleId !== undefined) {
    await db.delete(episodesTable).where(eq(episodesTable.titleId, titleId));
    await db.delete(titlesTable).where(eq(titlesTable.id, titleId));
  }
  await db.delete(usersTable).where(inArray(usersTable.id, accountIds));
});

async function readAccount(userId: string) {
  const [shows, recent] = await Promise.all([
    supertest(app).get("/api/me/shows").set("x-test-user-id", userId),
    supertest(app).get("/api/me/recent").set("x-test-user-id", userId),
  ]);
  expect(shows.status).toBe(200);
  expect(recent.status).toBe(200);
  return { shows: shows.body, recent: recent.body };
}

describe("includePrevious account isolation", () => {
  it("adds earlier episodes only to the initiating account without changing another account's progress or history", async () => {
    // Different starting progress, with the bulk target already watched by B.
    const initialEpisodes = [[episodeIds[1]], [episodeIds[0], episodeIds[3]]];
    for (const [index, userId] of accountIds.entries()) {
      for (const episodeId of initialEpisodes[index]) {
        const watched = await supertest(app)
          .post(`/api/episodes/${episodeId}/watched`)
          .set("x-test-user-id", userId)
          .send({});
        expect(watched.status).toBe(200);
      }
    }

    const before = await Promise.all(accountIds.map(readAccount));
    for (const [index, account] of before.entries()) {
      expect(account.shows).toEqual([
        expect.objectContaining({
          title: expect.objectContaining({ id: titleId }),
          watchedEpisodes: initialEpisodes[index].length,
          totalEpisodes: 5,
          nextEpisode: expect.objectContaining({ id: episodeIds[index] }),
        }),
      ]);
      expect(account.recent).toHaveLength(initialEpisodes[index].length);
    }
    expect(before[1].recent).toEqual(expect.arrayContaining(
      ["S1E1", "S2E1"].map((episodeLabel) => expect.objectContaining({
        titleId, kind: "episode", episodeLabel,
      })),
    ));
    const rowsBefore = await db.select().from(watchedEpisodesTable)
      .where(eq(watchedEpisodesTable.titleId, titleId!))
      .orderBy(watchedEpisodesTable.id);
    expect(rowsBefore).toHaveLength(3);

    const watched = await supertest(app)
      .post(`/api/episodes/${episodeIds[3]}/watched`)
      .set("x-test-user-id", accountIds[0])
      .send({ includePrevious: true });
    expect(watched.status).toBe(200);
    expect(watched.body).toEqual({ ok: true });

    const [initiatorAfter, otherAfter] = await Promise.all(accountIds.map(readAccount));
    expect(initiatorAfter.shows).toEqual([
      expect.objectContaining({
        title: expect.objectContaining({ id: titleId }),
        watchedEpisodes: 4,
        totalEpisodes: 5,
        nextEpisode: expect.objectContaining({ id: episodeIds[4] }),
      }),
    ]);
    expect(initiatorAfter.recent).toHaveLength(4);
    expect(initiatorAfter.recent).toEqual(expect.arrayContaining(
      ["S1E1", "S1E2", "S1E3", "S2E1"].map((episodeLabel) => expect.objectContaining({
        titleId, kind: "episode", episodeLabel,
      })),
    ));
    // Full response equality also protects activity timestamps and next episode.
    expect(otherAfter).toEqual(before[1]);

    const rowsAfter = await db.select().from(watchedEpisodesTable)
      .where(eq(watchedEpisodesTable.titleId, titleId!))
      .orderBy(watchedEpisodesTable.id);
    expect(rowsAfter).toHaveLength(6);
    expect(rowsAfter.filter((row) => row.userId === accountIds[1])).toEqual(
      rowsBefore.filter((row) => row.userId === accountIds[1]),
    );
    const initiatorRows = rowsAfter.filter((row) => row.userId === accountIds[0]);
    expect(initiatorRows.map((row) => row.episodeId).sort((a, b) => a - b)).toEqual(
      episodeIds.slice(0, 4).sort((a, b) => a - b),
    );
    // The already-watched episode must keep its original row and timestamp.
    expect(initiatorRows).toEqual(expect.arrayContaining(
      rowsBefore.filter((row) => row.userId === accountIds[0]),
    ));
  });
});
