import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseImportContent } from "./import-parsers";

describe("watch-history import parsers", () => {
  it("normalizes generic CSV records and preserves valid timestamps", () => {
    const rows = parseImportContent(
      "generic",
      "watch-history.csv",
      [
        "kind,title,type,year,season,episode,watchedAt",
        'watched_movie,"Spider-Man, Homecoming",movie,2017,,,2018-01-01',
        "watched_episode,The Example Show,tv,2024,1,2,2024-01-02T12:00:00Z",
        "watchlist,Future Movie,movie,2025,,,",
      ].join("\n"),
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ record: { kind: "watched_movie", title: "Spider-Man, Homecoming", watchedAt: "2018-01-01T00:00:00.000Z" } });
    expect(rows[1]).toMatchObject({ record: { kind: "watched_episode", season: 1, episode: 2 } });
    expect(rows[2]).toMatchObject({ record: { kind: "watchlist", watchedAt: null } });
  });

  it("normalizes only documented Trakt collection nesting", () => {
    const rows = parseImportContent(
      "trakt",
      "trakt.json",
      JSON.stringify({
        movies: [{ movie: { title: "Arrival", year: 2016, ids: { imdb: "tt2543164" } }, watched_at: "2017-01-01" }],
        episodes: [{ show: { title: "A Show", year: 2024, ids: { tmdb: 42 } }, episode: { season: 1, number: 3 } }],
      }),
    );
    expect(rows[0]).toMatchObject({ record: { title: "Arrival", imdbId: "tt2543164", kind: "watched_movie" } });
    expect(rows[1]).toMatchObject({ record: { title: "A Show", tmdbId: 42, kind: "watched_episode", season: 1, episode: 3 } });
  });

  it("parses TV Time and Letterboxd documented fixtures, not ratings-only exports", () => {
    const tvTime = parseImportContent(
      "tvtime",
      "tvtime-history.csv",
      readFileSync(new URL("./fixtures/imports/tvtime-history.csv", import.meta.url), "utf8"),
    );
    expect(tvTime[0]).toMatchObject({ record: { kind: "watched_movie", imdbId: "tt1234567" } });
    expect(tvTime[1]).toMatchObject({ record: { kind: "watched_episode", type: "tv", season: 1, episode: 2 } });
    const diary = parseImportContent(
      "letterboxd",
      "diary.csv",
      readFileSync(new URL("./fixtures/imports/letterboxd-diary.csv", import.meta.url), "utf8"),
    );
    expect(diary[0]).toMatchObject({ record: { kind: "watched_movie", title: "Fixture Diary Film" } });
    const ratings = parseImportContent(
      "letterboxd",
      "ratings.csv",
      readFileSync(new URL("./fixtures/imports/letterboxd-ratings.csv", import.meta.url), "utf8"),
    );
    expect(ratings).toEqual([{ rowNumber: 1, errorCode: "unsupported_row" }]);
    const watched = parseImportContent(
      "letterboxd",
      "watched.csv",
      readFileSync(new URL("./fixtures/imports/letterboxd-watched.csv", import.meta.url), "utf8"),
    );
    expect(watched[0]).toMatchObject({ record: { kind: "watched_movie", title: "Fixture Watched Film" } });
  });

  it("returns safe row errors for malformed fields and dates", () => {
    const rows = parseImportContent(
      "generic",
      "invalid.csv",
      "kind,title,watchedAt\nwatched_movie,Good title,not-a-date\nwatched_episode,Missing episode,",
    );
    expect(rows).toEqual([
      { rowNumber: 1, errorCode: "invalid_date" },
      { rowNumber: 2, errorCode: "invalid_row" },
    ]);
    expect(parseImportContent("generic", "invalid-fields.csv", "kind,title,year,type,imdbId,tmdbId\nwatched_movie,Bad year,20xx,movie,,")).toEqual([
      { rowNumber: 1, errorCode: "invalid_row" },
    ]);
    expect(parseImportContent("generic", "invalid-id.csv", "kind,title,imdbId\nwatched_movie,Bad ID,not-an-imdb-id")).toEqual([
      { rowNumber: 1, errorCode: "invalid_row" },
    ]);
    expect(parseImportContent("generic", "calendar.csv", "kind,title,watchedAt\nwatched_movie,Impossible date,2024-02-31")).toEqual([
      { rowNumber: 1, errorCode: "invalid_date" },
    ]);
    expect(parseImportContent("generic", "special.csv", "kind,title,type,season,episode\nwatched_episode,Special,tv,0,1")).toMatchObject([
      { record: { season: 0, episode: 1 } },
    ]);
  });

  it("rejects malformed, empty, header-only, and arbitrary titled inputs", () => {
    expect(() => parseImportContent("generic", "broken.csv", 'kind,title\n"unclosed')).toThrow("Malformed CSV quoting");
    expect(() => parseImportContent("generic", "header-only.csv", "kind,title")).toThrow("at least one row");
    expect(() => parseImportContent("generic", "titled.csv", "title\nA title")).toThrow("kind, title");
    expect(() => parseImportContent("generic", "items.json", "[]")).toThrow("at least one item");
    expect(() => parseImportContent("generic", "items.json", '[{"kind":"watched_movie","title":"Valid"},3]')).toThrow("must all be objects");
    expect(() => parseImportContent("generic", "quote.csv", 'kind,title\nwatched_movie,un"quoted')).toThrow("Malformed CSV quoting");
    expect(() => parseImportContent("generic", "quote.csv", 'kind,title\nwatched_movie,"closed"x')).toThrow("Malformed CSV quoting");
    const body = `kind,title\n${Array.from({ length: 5001 }, () => "watched_movie,A title").join("\n")}`;
    expect(() => parseImportContent("generic", "many.csv", body)).toThrow("5,000");
  });
});