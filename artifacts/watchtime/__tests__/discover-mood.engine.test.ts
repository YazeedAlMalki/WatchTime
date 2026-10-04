import { describe, expect, it } from "vitest";
import { MOVIES } from "../src/pages/discover-mood/data";
import { classify, evaluate } from "../src/pages/discover-mood/engine";
import { defaultFilters } from "../src/pages/discover-mood/store";
import type { Movie, StoreState } from "../src/pages/discover-mood/types";

const session: StoreState["session"] = {
  started: true,
  ranAt: 1,
  seed: 10,
  sort: "match",
  feedback: {},
};
const emptyState = {
  viewed: {},
  dismissed: [],
  saved: [],
  session,
} satisfies Pick<StoreState, "viewed" | "dismissed" | "saved" | "session">;

describe("Discover by Mood recommendation rules", () => {
  it("ships a varied demo catalogue with at least 40 films", () => {
    expect(MOVIES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(MOVIES.map((movie) => movie.country)).size).toBeGreaterThan(10);
    expect(new Set(MOVIES.flatMap((movie) => movie.genres)).size).toBeGreaterThan(8);
    expect(new Set(MOVIES.map((movie) => movie.year)).size).toBeGreaterThan(20);
  });

  it("keeps watching context as a ranking hint, not an age or content limit", () => {
    const movie: Movie = {
      ...MOVIES[0],
      availability: [{ region: "SA", provider: "Netflix", kind: "stream", dubs: [] }],
      ageRating: "R",
      content: { ...MOVIES[0].content, violence: 4, gore: 3 },
    };
    const filters = { ...defaultFilters(), context: "family" as const };
    expect(evaluate(movie, filters, {}, [], {}, [movie])).toEqual([]);
  });

  it("enforces explicit age and content boundaries even in a family context", () => {
    const movie = { ...MOVIES[0], ageRating: "R", content: { ...MOVIES[0].content, violence: 3 } };
    const defaults = defaultFilters();
    const filters = {
      ...defaults,
      context: "family" as const,
      maxAgeRating: "PG",
      limits: { ...defaults.limits, violence: 1 },
    };
    const failures = evaluate(movie, filters, {}, [], {}, [movie]);
    expect(failures).toContain("age");
    expect(failures).toContain("c:violence");
  });

  it("treats access type, selected services, and language as hard availability filters", () => {
    const movie: Movie = {
      ...MOVIES[0],
      availability: [{ region: "SA", provider: "Netflix", kind: "stream", dubs: [] }],
      languages: ["en"],
      subtitleLanguages: [],
    };
    const filters = {
      ...defaultFilters(),
      accessTypes: ["rent"] as ("stream" | "rent" | "buy")[],
      providers: ["Shahid"],
      languages: ["ar"],
    };
    const failures = evaluate(movie, filters, {}, [], {}, [movie]);
    expect(failures).toContain("access");
    expect(failures).toContain("provider");
    expect(failures).toContain("language");
  });

  it("excludes films too far from a must-match mood target", () => {
    const defaults = defaultFilters();
    const filters = {
      ...defaults,
      targets: { ...defaults.targets, intensity: 0 },
      active: { ...defaults.active, intensity: true },
      importance: { ...defaults.importance, intensity: 3 as const },
    };
    expect(evaluate(MOVIES[8], filters, {}, [], {}, MOVIES)).toContain("must:intensity");
  });

  it("limits similar-film feedback to the active discovery session", () => {
    const source = MOVIES[0];
    const similar = { ...source, id: "session-similar", title: "Session Similar" };
    const feedback = { [source.id]: ["hideSimilar"] };
    const failures = evaluate(similar, defaultFilters(), {}, [], feedback, [source, similar]);
    expect(failures).toContain("feedbackSimilar");
    expect(evaluate(similar, defaultFilters(), {}, [], {}, [source, similar])).not.toContain("feedbackSimilar");
  });

  it("does not let near matches bypass age or content boundaries", () => {
    const movie = { ...MOVIES[0], ageRating: "R", content: { ...MOVIES[0].content, gore: 4 } };
    const defaults = defaultFilters();
    const filters = {
      ...defaults,
      maxAgeRating: "PG",
      limits: { ...defaults.limits, gore: 0 },
      context: "family" as const,
    };
    expect(classify([movie], filters, emptyState).near).toHaveLength(0);
  });

  it("honors shortest and newest sorts instead of applying mood diversification", () => {
    const saStreaming = [{ region: "SA" as const, provider: "Netflix", kind: "stream" as const, dubs: [] }];
    const longer = { ...MOVIES[0], availability: saStreaming, runtimeMinutes: 130, year: 2010 };
    const shorter = { ...MOVIES[1], availability: saStreaming, runtimeMinutes: 80, year: 2024 };
    const filters = defaultFilters();
    const shortest = classify(
      [longer, shorter],
      filters,
      { ...emptyState, session: { ...session, sort: "shortest" } },
    ).results;
    expect(shortest.map((item) => item.movie.id)).toEqual([shorter.id, longer.id]);

    const newest = classify(
      [longer, shorter],
      filters,
      { ...emptyState, session: { ...session, sort: "newest" } },
    ).results;
    expect(newest.map((item) => item.movie.id)).toEqual([shorter.id, longer.id]);
  });
});