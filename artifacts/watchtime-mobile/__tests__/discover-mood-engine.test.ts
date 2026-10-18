import { MOVIES } from "../lib/discover-mood/data";
import { classify, evaluate } from "../lib/discover-mood/engine";
import { defaultFilters } from "../lib/discover-mood/store";
import { getT } from "../lib/discover-mood/i18n";
import type { Movie, StoreState } from "../lib/discover-mood/types";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const emptyState = {
  viewed: {},
  dismissed: [],
  saved: [],
  session: {
    started: true,
    ranAt: 1,
    seed: 1,
    sort: "match" as const,
    feedback: {},
  },
} satisfies Pick<StoreState, "viewed" | "dismissed" | "saved" | "session">;

describe("WatchTime Mobile mood discovery", () => {
  it("keeps age and content failures out of no-results recovery near matches", () => {
    const convenienceOnly: Movie = {
      ...MOVIES[0],
      ageRating: "PG",
      runtimeMinutes: 130,
      content: { ...MOVIES[0].content, gore: 0 },
      availability: [{ region: "SA", provider: "Netflix", kind: "stream", dubs: [] }],
    };
    const ageViolation: Movie = { ...convenienceOnly, id: "age-violation", ageRating: "R" };
    const contentViolation: Movie = {
      ...convenienceOnly,
      id: "content-violation",
      content: { ...convenienceOnly.content, gore: 4 },
    };
    const filters = {
      ...defaultFilters(),
      maxRuntime: 90,
      maxAgeRating: "PG",
      providers: ["Shahid"],
      limits: { ...defaultFilters().limits, gore: 0 },
    };

    const { results, near } = classify(
      [convenienceOnly, ageViolation, contentViolation],
      filters,
      emptyState,
    );

    expect(results).toHaveLength(0);
    expect(near.map((item) => item.movie.id)).toContain(convenienceOnly.id);
    expect(near.map((item) => item.movie.id)).not.toContain(ageViolation.id);
    expect(near.map((item) => item.movie.id)).not.toContain(contentViolation.id);
    expect(evaluate(ageViolation, filters, {}, [], {}, [ageViolation])).toContain("age");
    expect(evaluate(contentViolation, filters, {}, [], {}, [contentViolation])).toContain("c:gore");
  });

  it("provides English LTR and Arabic RTL copy", () => {
    expect(getT("en").dir).toBe("ltr");
    expect(getT("en").t("title")).toBe("Discover by Mood");
    expect(getT("ar").dir).toBe("rtl");
    expect(getT("ar").t("title")).toBe("اكتشف حسب المزاج");
    expect(getT("ar").t("results.heading", { n: 3 })).toContain("3");
  });
});
