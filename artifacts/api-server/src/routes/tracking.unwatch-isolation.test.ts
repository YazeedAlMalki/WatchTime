import { randomUUID } from "node:crypto";
import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Only the authentication boundary is mocked: each request explicitly selects
// its account, while all tracking reads and writes use the real database.
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
const accountIds = [`unwatch-a-${fixtureId}`, `unwatch-b-${fixtureId}`];
let titleId: number | undefined;
let episodeIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values(accountIds.map((id) => ({
    id, email: `${id}@example.test`,
  })));
  const [title] = await db.insert(titlesTable).values({
    name: `__unwatch_isolation_${fixtureId}__`, type: "tv",
  }).returning({ id: titlesTable.id });
  titleId = title.id;
  episodeIds = (await db.insert(episodesTable).values([1, 2, 3].map((episodeNumber) => ({
    titleId: title.id, seasonNumber: 1, episodeNumber, name: `Episode ${episodeNumber}`,
  }))).returning({ id: episodesTable.id, episodeNumber: episodesTable.episodeNumber }))
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
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

describe("episode unwatch account isolation", () => {
  it("removes only the initiating account's episode and preserves the other account's progress and history", async () => {
    for (const userId of accountIds) {
      for (const episodeId of episodeIds.slice(0, 2)) {
        const watched = await supertest(app)
          .post(`/api/episodes/${episodeId}/watched`)
          .set("x-test-user-id", userId)
          .send({});
        expect(watched.status).toBe(200);
      }
    }

    const before = await Promise.all(accountIds.map(readAccount));
    for (const account of before) {
      expect(account.shows).toEqual([
        expect.objectContaining({
          title: expect.objectContaining({ id: titleId }),
          watchedEpisodes: 2,
          totalEpisodes: 3,
          nextEpisode: expect.objectContaining({ id: episodeIds[2] }),
        }),
      ]);
      expect(account.recent).toHaveLength(2);
      expect(account.recent).toEqual(expect.arrayContaining(
        ["S1E1", "S1E2"].map((episodeLabel) => expect.objectContaining({
          titleId, kind: "episode", episodeLabel,
        })),
      ));
    }
    const rowsBefore = await db.select().from(watchedEpisodesTable)
      .where(eq(watchedEpisodesTable.titleId, titleId!));
    expect(rowsBefore).toHaveLength(4);

    const unwatch = await supertest(app)
      .delete(`/api/episodes/${episodeIds[1]}/watched`)
      .set("x-test-user-id", accountIds[0]);
    expect(unwatch.status).toBe(200);
    expect(unwatch.body).toEqual({ ok: true });

    const [initiatorAfter, otherAfter] = await Promise.all(accountIds.map(readAccount));
    expect(initiatorAfter.shows).toEqual([
      expect.objectContaining({
        title: expect.objectContaining({ id: titleId }),
        watchedEpisodes: 1,
        totalEpisodes: 3,
        nextEpisode: expect.objectContaining({ id: episodeIds[1] }),
      }),
    ]);
    expect(initiatorAfter.recent).toEqual(
      before[0].recent.filter((item: { episodeLabel: string }) => item.episodeLabel === "S1E1"),
    );
    // Compare full responses, including activity timestamps, not just counts.
    expect(otherAfter).toEqual(before[1]);

    const rowsAfter = await db.select().from(watchedEpisodesTable)
      .where(eq(watchedEpisodesTable.titleId, titleId!));
    const expectedRows = rowsBefore.filter((row) => !(
      row.userId === accountIds[0] && row.episodeId === episodeIds[1]
    ));
    expect(rowsAfter).toHaveLength(3);
    expect(rowsAfter).toEqual(expect.arrayContaining(expectedRows));
  });
});

describe("movie unwatch account isolation", () => {
  const movieAccountIds = [`movie-unwatch-a-${fixtureId}`, `movie-unwatch-b-${fixtureId}`];
  let movieId: number | undefined;

  beforeAll(async () => {
    await db.insert(usersTable).values(movieAccountIds.map((id) => ({
      id, email: `${id}@example.test`,
    })));
    const [movie] = await db.insert(titlesTable).values({
      name: `__movie_unwatch_isolation_${fixtureId}__`, type: "movie",
    }).returning({ id: titlesTable.id });
    movieId = movie.id;
  });

  afterAll(async () => {
    await db.delete(watchedTitlesTable).where(inArray(watchedTitlesTable.userId, movieAccountIds));
    if (movieId !== undefined) {
      await db.delete(titlesTable).where(eq(titlesTable.id, movieId));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, movieAccountIds));
  });

  async function readMovieAccount(userId: string) {
    const [movies, recent] = await Promise.all([
      supertest(app).get("/api/me/movies").set("x-test-user-id", userId),
      supertest(app).get("/api/me/recent").set("x-test-user-id", userId),
    ]);
    expect(movies.status).toBe(200);
    expect(recent.status).toBe(200);
    return { movies: movies.body, recent: recent.body };
  }

  it("removes only the initiating account's movie and preserves the other account's row and history", async () => {
    for (const userId of movieAccountIds) {
      const watched = await supertest(app)
        .post(`/api/titles/${movieId}/watched`)
        .set("x-test-user-id", userId)
        .send({});
      expect(watched.status).toBe(200);
      expect(watched.body).toEqual({ ok: true });
    }

    const before = await Promise.all(movieAccountIds.map(readMovieAccount));
    for (const account of before) {
      expect(account.movies).toEqual([
        expect.objectContaining({ id: movieId, type: "movie" }),
      ]);
      expect(account.recent).toEqual([
        expect.objectContaining({ titleId: movieId, kind: "movie" }),
      ]);
    }
    const rowsBefore = await db.select().from(watchedTitlesTable)
      .where(eq(watchedTitlesTable.titleId, movieId!));
    expect(rowsBefore).toHaveLength(2);
    expect(rowsBefore.map((row) => row.userId).sort()).toEqual([...movieAccountIds].sort());

    const unwatch = await supertest(app)
      .delete(`/api/titles/${movieId}/watched`)
      .set("x-test-user-id", movieAccountIds[0]);
    expect(unwatch.status).toBe(200);
    expect(unwatch.body).toEqual({ ok: true });

    const [initiatorAfter, otherAfter] = await Promise.all(movieAccountIds.map(readMovieAccount));
    expect(initiatorAfter).toEqual({ movies: [], recent: [] });
    // Full equality also protects the other account's activity timestamps.
    expect(otherAfter).toEqual(before[1]);

    const rowsAfter = await db.select().from(watchedTitlesTable)
      .where(eq(watchedTitlesTable.titleId, movieId!));
    expect(rowsAfter).toEqual(rowsBefore.filter((row) => row.userId === movieAccountIds[1]));
  });
});
