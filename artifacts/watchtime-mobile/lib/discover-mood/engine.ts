import { AGE_RANK, CONTENT_KEYS, MOOD_KEYS, type Filters, type Movie, type Session, type StoreState } from "./types";

export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type Failure = "age" | "region" | "provider" | "access" | "language" | "runtime" | "watched" | "dismissed" | "poorHistory" | "feedbackSimilar" | `c:${string}` | `must:${string}`;
const NEAR_ALLOWED: Failure[] = ["runtime", "provider", "access", "language", "region"];
const MUST_MATCH_DISTANCE = 34;

function moodDistance(a: Movie, b: Movie): number {
  return MOOD_KEYS.reduce((total, key) => total + Math.abs(a.mood[key] - b.mood[key]), 0) / MOOD_KEYS.length;
}

function isSimilar(a: Movie, b: Movie, threshold: number): boolean {
  const sharedGenre = a.genres.some((genre) => b.genres.includes(genre));
  return moodDistance(a, b) <= threshold && sharedGenre;
}

export function evaluate(
  movie: Movie,
  filters: Filters,
  viewed: StoreState["viewed"],
  dismissed: string[] = [],
  feedback: Session["feedback"] = {},
  movies: Movie[] = [],
): Failure[] {
  const fails: Failure[] = [];
  const maxAge = filters.maxAgeRating === "any" ? Number.POSITIVE_INFINITY : AGE_RANK[filters.maxAgeRating];
  if (AGE_RANK[movie.ageRating] > maxAge) fails.push("age");

  CONTENT_KEYS.forEach((key) => {
    if (movie.content[key] > filters.limits[key]) fails.push(`c:${key}`);
  });

  const inRegion = movie.availability.filter((item) => item.region === filters.region);
  if (!inRegion.length) fails.push("region");
  if (filters.providers.length && !inRegion.some((item) => filters.providers.includes(item.provider))) {
    fails.push("provider");
  }
  if (!inRegion.some((item) => filters.accessTypes.includes(item.kind))) fails.push("access");

  if (filters.languages.length) {
    const audio = movie.languages.some((language) => filters.languages.includes(language));
    const subs = filters.acceptSubs && movie.subtitleLanguages.some((language) => filters.languages.includes(language));
    const dub = !filters.originalAudioOnly && filters.acceptDub &&
      inRegion.some((item) => item.dubs.some((language) => filters.languages.includes(language)));
    if (!(filters.originalAudioOnly ? audio || subs : audio || subs || dub)) fails.push("language");
  }
  if (filters.requireArabicSubtitles && !movie.subtitleLanguages.includes("ar")) fails.push("language");
  if (filters.requireArabicDubbing && !inRegion.some((item) => item.dubs.includes("ar"))) fails.push("language");

  if (filters.maxRuntime < 240 && movie.runtimeMinutes > filters.maxRuntime) fails.push("runtime");
  const history = viewed[movie.id];
  if (
    filters.hideWatched &&
    history?.watched &&
    !(filters.includeComfortRewatches && (history.rating ?? 0) >= 4)
  ) fails.push("watched");
  if (filters.hideDismissed && dismissed.includes(movie.id)) fails.push("dismissed");

  if (filters.avoidPoorMatches) {
    const poorMatches = movies.filter((candidate) => (viewed[candidate.id]?.rating ?? 5) <= 2);
    if (poorMatches.some((candidate) => candidate.id !== movie.id && isSimilar(movie, candidate, 22))) {
      fails.push("poorHistory");
    }
  }

  const hideSimilarTo = Object.entries(feedback)
    .filter(([, tags]) => tags.includes("hideSimilar"))
    .map(([id]) => movies.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Movie => !!candidate && candidate.id !== movie.id);
  if (hideSimilarTo.some((candidate) => isSimilar(movie, candidate, 22))) fails.push("feedbackSimilar");

  MOOD_KEYS.forEach((key) => {
    if (filters.active[key] && filters.importance[key] === 3 &&
      Math.abs(movie.mood[key] - filters.targets[key]) > MUST_MATCH_DISTANCE) {
      fails.push(`must:${key}`);
    }
  });
  return fails;
}

function historyBonus(movie: Movie, filters: Filters, viewed: StoreState["viewed"], movies: Movie[]): number {
  if (!filters.includeHighlyRated) return 0;
  const highlyRated = movies.filter((candidate) => (viewed[candidate.id]?.rating ?? 0) >= 4);
  if (!highlyRated.length) return 0;
  return Math.min(5, Math.max(...highlyRated.map((candidate) => Math.max(0, 1 - moodDistance(movie, candidate) / 65) * 5)));
}

function feedbackPenalty(movie: Movie, feedback: Session["feedback"], movies: Movie[]): number {
  let penalty = 0;
  for (const [id, tags] of Object.entries(feedback)) {
    const source = movies.find((candidate) => candidate.id === id);
    if (!source || source.id === movie.id) continue;
    if (tags.includes("tooIntense") && movie.mood.intensity >= source.mood.intensity - 15) penalty += 7;
    if (tags.includes("tooSlow") && movie.mood.pace <= source.mood.pace + 15) penalty += 7;
    if (tags.includes("tooSad") && movie.mood.hopefulness <= source.mood.hopefulness + 15) penalty += 7;
    if (tags.includes("wrongMood") && isSimilar(movie, source, 24)) penalty += 8;
  }
  return Math.min(24, penalty);
}

function contextBonus(movie: Movie, filters: Filters): number {
  switch (filters.context) {
    case "date":
      return movie.genres.includes("romance") || movie.bestFor.includes("partner") ? 3 : 0;
    case "family":
    case "children":
      return movie.mood.violence <= 25 && movie.mood.disturbing <= 25 && movie.mood.feelGood >= 50 ? 4 : 0;
    case "friends":
      return movie.mood.humour >= 60 || movie.bestFor.includes("friends") ? 3 : 0;
    default:
      return 0;
  }
}

export function score(
  movie: Movie,
  filters: Filters,
  state: Pick<StoreState, "viewed" | "saved" | "session">,
  movies: Movie[],
): number {
  const keys = MOOD_KEYS.filter((key) => filters.active[key]);
  const weights = keys.map((key) => filters.importance[key] === 1 ? 0.6 : filters.importance[key] === 2 ? 1.2 : 2.1);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const weightedDistance = keys.reduce((sum, key, i) =>
    sum + Math.abs(movie.mood[key] - filters.targets[key]) * weights[i], 0);
  const moodFit = weightTotal ? 100 - weightedDistance / weightTotal : 68;
  const unseenBonus = state.viewed[movie.id]?.watched ? 0 : 2;
  const savedBonus = state.saved.includes(movie.id) ? 2 : 0;
  const personalization = historyBonus(movie, filters, state.viewed, movies);
  const feedback = feedbackPenalty(movie, state.session.feedback, movies);
  return Math.round(Math.max(0, Math.min(100, moodFit + unseenBonus + savedBonus + personalization + contextBonus(movie, filters) - feedback)));
}

export interface Ranked {
  movie: Movie;
  score: number;
}
export interface Near extends Ranked {
  fails: Failure[];
}

function seededOrder(id: string, seed: number): number {
  let hash = seed | 0;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function compareBySort(a: Ranked, b: Ranked, sort: Session["sort"], viewed: StoreState["viewed"], seed: number) {
  switch (sort) {
    case "shortest":
      return a.movie.runtimeMinutes - b.movie.runtimeMinutes || b.score - a.score;
    case "newest":
      return b.movie.year - a.movie.year || b.score - a.score;
    case "rated":
      return (viewed[b.movie.id]?.rating ?? 0) - (viewed[a.movie.id]?.rating ?? 0) || b.score - a.score;
    case "surprise":
      return seededOrder(a.movie.id, seed) - seededOrder(b.movie.id, seed);
    default:
      return b.score - a.score;
  }
}

function diversify(items: Ranked[], viewed: StoreState["viewed"]): Ranked[] {
  const remaining = [...items];
  const result: Ranked[] = [];
  const genres = new Map<string, number>();
  const countries = new Map<string, number>();
  const directors = new Map<string, number>();
  const decades = new Map<number, number>();
  while (remaining.length) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    remaining.forEach((item, index) => {
      const movie = item.movie;
      const decade = Math.floor(movie.year / 10) * 10;
      const diversityPenalty =
        (genres.get(movie.genres[0] ?? "") ?? 0) * 1.5 +
        (countries.get(movie.country) ?? 0) * 1.2 +
        (directors.get(movie.director) ?? 0) * 2.4 +
        (decades.get(decade) ?? 0) * 1.1;
      const stable = item.score - diversityPenalty;
      if (stable > bestValue) {
        bestValue = stable;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    result.push(next);
    const movie = next.movie;
    genres.set(movie.genres[0] ?? "", (genres.get(movie.genres[0] ?? "") ?? 0) + 1);
    countries.set(movie.country, (countries.get(movie.country) ?? 0) + 1);
    directors.set(movie.director, (directors.get(movie.director) ?? 0) + 1);
    const decade = Math.floor(movie.year / 10) * 10;
    decades.set(decade, (decades.get(decade) ?? 0) + 1);
  }
  return result;
}

export function classify(movies: Movie[], filters: Filters, state: Pick<StoreState, "viewed" | "dismissed" | "saved" | "session">) {
  const results: Ranked[] = [];
  const near: Near[] = [];
  for (const movie of movies) {
    const fails = evaluate(movie, filters, state.viewed, state.dismissed, state.session.feedback, movies);
    const item = { movie, score: score(movie, filters, state, movies) };
    if (!fails.length) results.push(item);
    else if (fails.length <= 2 && fails.every((failure) => NEAR_ALLOWED.includes(failure))) {
      near.push({ ...item, fails });
    }
  }
  const sorted = results.sort((a, b) => compareBySort(a, b, state.session.sort, state.viewed, state.session.seed));
  const diversified = state.session.sort === "match" ? diversify(sorted, state.viewed) : sorted;
  near.sort((a, b) => compareBySort(a, b, state.session.sort, state.viewed, state.session.seed));
  return { results: diversified, near };
}

export function countFailures(movies: Movie[], filters: Filters, state: Pick<StoreState, "viewed" | "dismissed" | "session">) {
  const counts = new Map<string, number>();
  movies.forEach((movie) => {
    evaluate(movie, filters, state.viewed, state.dismissed, state.session.feedback, movies).forEach((failure) => {
      counts.set(failure, (counts.get(failure) ?? 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function comfortList(movies: Movie[], filters: Filters, state: Pick<StoreState, "viewed" | "dismissed">): Movie[] {
  return movies.filter((movie) => {
    const history = state.viewed[movie.id];
    if (!history?.watched || (history.rating ?? 0) < 4 || movie.mood.feelGood < 60) return false;
    if (filters.hideDismissed && state.dismissed.includes(movie.id)) return false;
    return !evaluate(movie, { ...filters, hideWatched: false, includeComfortRewatches: true, avoidPoorMatches: false }, state.viewed, state.dismissed)
      .some((failure) => failure === "age" || failure.startsWith("c:"));
  });
}

export function buildReasons(movie: Movie, filters: Filters, state: Pick<StoreState, "viewed" | "saved" | "session">, t: Translate, movies: Movie[]): string[] {
  const reasons: string[] = [];
  const keys = MOOD_KEYS.filter((key) => filters.active[key]).sort(
    (a, b) => Math.abs(movie.mood[a] - filters.targets[a]) - Math.abs(movie.mood[b] - filters.targets[b]),
  );
  keys.slice(0, 2).forEach((key) =>
    reasons.push(t("r.mood", { label: t(`mood.${key}`), film: movie.mood[key], target: filters.targets[key] })),
  );
  if (!keys.length) reasons.push(t("r.noMood"));
  if (filters.maxRuntime < 240 && movie.runtimeMinutes <= filters.maxRuntime) {
    reasons.push(t("r.runtime", { n: movie.runtimeMinutes, max: filters.maxRuntime }));
  }
  if (filters.maxAgeRating !== "any" && AGE_RANK[movie.ageRating] <= AGE_RANK[filters.maxAgeRating]) {
    reasons.push(t("r.age", { age: movie.ageRating }));
  }

  const contentReason = CONTENT_KEYS.filter((key) => filters.limits[key] < 4)
    .filter((key) => movie.content[key] <= filters.limits[key])
    .map((key) => t("r.content", { label: t(`content.${key}`), level: t(`level.${movie.content[key]}`), max: t(`level.${filters.limits[key]}`) }));
  reasons.push(...contentReason);
  const available = movie.availability.filter((item) => item.region === filters.region);
  const selected = available.find((item) =>
    filters.accessTypes.includes(item.kind) && (!filters.providers.length || filters.providers.includes(item.provider)),
  );
  if (selected) reasons.push(t("r.avail", { provider: selected.provider, region: t(`region.${filters.region}`) }));

  if (filters.languages.length) {
    const audio = movie.languages.filter((language) => filters.languages.includes(language));
    const subs = filters.acceptSubs ? movie.subtitleLanguages.filter((language) => filters.languages.includes(language)) : [];
    const dubs = !filters.originalAudioOnly && filters.acceptDub
      ? available.flatMap((item) => item.dubs).filter((language) => filters.languages.includes(language))
      : [];
    if (audio.length) reasons.push(t("r.audio", { lang: audio.map((language) => t(`lang.${language}`)).join(", ") }));
    else if (subs.length) reasons.push(t("r.subs", { lang: subs.map((language) => t(`lang.${language}`)).join(", ") }));
    else if (dubs.length) reasons.push(t("r.dub"));
  }
  if (filters.requireArabicSubtitles && movie.subtitleLanguages.includes("ar")) reasons.push(t("r.arSubs"));
  if (filters.requireArabicDubbing && available.some((item) => item.dubs.includes("ar"))) reasons.push(t("r.arDub"));
  if (filters.context !== "solo" && contextBonus(movie, filters) > 0) reasons.push(t("r.context", { context: t(`ctx.${filters.context}`) }));
  if (filters.includeHighlyRated && historyBonus(movie, filters, state.viewed, movies) >= 2) reasons.push(t("r.history"));
  if (!state.viewed[movie.id]?.watched) reasons.push(t("r.unwatched"));
  if (state.saved.includes(movie.id)) reasons.push(t("r.saved"));
  return reasons.slice(0, 5);
}