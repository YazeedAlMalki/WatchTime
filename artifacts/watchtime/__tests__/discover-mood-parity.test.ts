import { describe, expect, it } from "vitest";
import {
  MOVIES as webMovies,
  PRESETS as webPresets,
} from "../src/pages/discover-mood/data";
import {
  buildReasons as webBuildReasons,
  classify as webClassify,
  comfortList as webComfortList,
  countFailures as webCountFailures,
} from "../src/pages/discover-mood/engine";
import {
  getT as getWebT,
  moodTranslations as webTranslations,
} from "../src/pages/discover-mood/i18n";
import { defaultFilters } from "../src/pages/discover-mood/store";
import type { Filters as WebFilters, Movie as WebMovie, StoreState } from "../src/pages/discover-mood/types";
import {
  MOVIES as mobileMovies,
  PRESETS as mobilePresets,
} from "../../watchtime-mobile/lib/discover-mood/data";
import {
  buildReasons as mobileBuildReasons,
  classify as mobileClassify,
  comfortList as mobileComfortList,
  countFailures as mobileCountFailures,
} from "../../watchtime-mobile/lib/discover-mood/engine";
import {
  getT as getMobileT,
  moodTranslations as mobileTranslations,
} from "../../watchtime-mobile/lib/discover-mood/i18n";
import type { Movie as MobileMovie } from "../../watchtime-mobile/lib/discover-mood/types";

const sorts: StoreState["session"]["sort"][] = ["match", "shortest", "newest", "rated", "surprise"];

describe("WatchTime web and mobile mood parity", () => {
  it("keeps the movie catalogue and presets identical", () => {
    expect(mobileMovies).toEqual(webMovies);
    expect(mobilePresets).toEqual(webPresets);
  });

  it("keeps English and Arabic translations identical", () => {
    expect(mobileTranslations).toEqual(webTranslations);
    for (const lang of ["en", "ar"] as const) {
      const web = getWebT(lang);
      const mobile = getMobileT(lang);
      expect(mobile.dir).toBe(web.dir);
      expect(mobile.t("title")).toBe(web.t("title"));
      expect(mobile.t("results.heading", { n: 3 })).toBe(web.t("results.heading", { n: 3 }));
      expect(mobile.t("missing.translation")).toBe(web.t("missing.translation"));
    }
  });

  it("ranks, filters, and explains the same films for representative user settings", () => {
    const base = defaultFilters();
    const scenarios: WebFilters[] = [
      base,
      {
        ...base,
        context: "family",
        maxAgeRating: "PG",
        limits: { ...base.limits, violence: 1, gore: 0 },
      },
      {
        ...base,
        targets: { ...base.targets, intensity: 20, feelGood: 80 },
        active: { ...base.active, intensity: true, feelGood: true },
        importance: { ...base.importance, intensity: 3 },
      },
      {
        ...base,
        languages: ["ar", "en"],
        acceptSubs: true,
        acceptDub: true,
        requireArabicSubtitles: true,
        region: "AE",
        accessTypes: ["stream", "rent"],
      },
      {
        ...base,
        maxRuntime: 100,
        includeHighlyRated: true,
        includeComfortRewatches: true,
        hideWatched: true,
        hideDismissed: true,
        avoidPoorMatches: true,
      },
    ];
    const viewed: StoreState["viewed"] = {
      m01: { lastViewedAt: 1, watched: true, rating: 5, feedback: [] },
      m02: { lastViewedAt: 2, watched: false, rating: 2, feedback: [] },
    };
    const stateBase = {
      viewed,
      dismissed: ["m03"],
      saved: ["m04"],
      session: {
        started: true,
        ranAt: 1,
        seed: 8462,
        sort: "match" as const,
        feedback: { m05: ["tooIntense", "hideSimilar"], m06: ["tooSlow", "tooSad"] },
      },
    } satisfies Pick<StoreState, "viewed" | "dismissed" | "saved" | "session">;

    for (const filters of scenarios) {
      for (const sort of sorts) {
        const state = { ...stateBase, session: { ...stateBase.session, sort } };
        const webResults = webClassify(webMovies, filters, state);
        const mobileResults = mobileClassify(mobileMovies, filters, state);
        expect(mobileResults).toEqual(webResults);
        expect(mobileCountFailures(mobileMovies, filters, state)).toEqual(
          webCountFailures(webMovies, filters, state),
        );
        expect(mobileComfortList(mobileMovies, filters, state)).toEqual(
          webComfortList(webMovies, filters, state),
        );

        const webTranslate = getWebT("en").t;
        const mobileTranslate = getMobileT("en").t;
        for (const movie of webResults.results.slice(0, 5).map((item) => item.movie)) {
          const mobileMovie = mobileMovies.find((candidate) => candidate.id === movie.id)!;
          expect(
            mobileBuildReasons(mobileMovie, filters, state, mobileTranslate, mobileMovies),
          ).toEqual(webBuildReasons(movie, filters, state, webTranslate, webMovies));
        }
      }
    }
  });

  it("keeps movie domain types structurally aligned", () => {
    const webMovie: WebMovie = webMovies[0];
    const mobileMovie: MobileMovie = webMovie;
    const sameMovie: WebMovie = mobileMovie;
    expect(sameMovie).toEqual(webMovie);
  });
});
