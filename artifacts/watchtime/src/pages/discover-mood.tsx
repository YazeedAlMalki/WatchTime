import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, CircleHelp, RotateCcw, SearchX, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "./discover-mood/components/Shell";
import { FilterPanel } from "./discover-mood/components/FilterPanel";
import { MovieCard } from "./discover-mood/components/MovieCard";
import { MovieDetail } from "./discover-mood/components/MovieDetail";
import { Shell } from "./discover-mood/components/Shell";
import { MOVIES, PRESETS } from "./discover-mood/data";
import { buildReasons, classify, countFailures } from "./discover-mood/engine";
import { useT } from "./discover-mood/i18n";
import { actions, useStore } from "./discover-mood/store";
import { CONTENT_KEYS, MOOD_KEYS, type ContentKey } from "./discover-mood/types";

const PAGE = 8;
type Stage = "start" | "tune" | "results";

export default function DiscoverMoodPage() {
  const { t } = useT();
  const state = useStore();
  const [stage, setStage] = useState<Stage>(state.session.started ? "results" : "start");
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("movie"));
  const [limit, setLimit] = useState(PAGE);
  const filters = state.filters;
  const ranked = useMemo(
    () => classify(MOVIES, filters, state),
    [filters, state.viewed, state.dismissed, state.saved, state.session],
  );
  const moodKeys = MOOD_KEYS.filter((key) => filters.active[key]);
  const selectedPreset = PRESETS.find((preset) => preset.id === filters.preset);
  const summary = [
    ...moodKeys.slice(0, 3).map((key) => `${t(`mood.${key}`)} ${filters.targets[key]}`),
    filters.maxRuntime < 240 ? t("runtime.custom.value", { n: filters.maxRuntime }) : "",
    filters.languages.map((language) => t(`lang.${language}`)).join(", "),
    filters.requireArabicSubtitles ? t("language.arSubs") : "",
    filters.requireArabicDubbing ? t("language.arDub") : "",
  ].filter(Boolean).join(" · ");

  const suggestions: { id: string; label: string; run: () => void }[] = [];
  if (filters.maxRuntime < 240) {
    const next = Math.min(240, filters.maxRuntime + 30);
    suggestions.push({
      id: "runtime",
      label: next === 240 ? t("act.runtimeAny") : t("act.runtime", { n: next }),
      run: () => actions.patchFilters({ maxRuntime: next }),
    });
  }
  if (filters.accessTypes.length < 3) {
    suggestions.push({ id: "access-types", label: t("none.relaxAccess"), run: () => actions.patchFilters({ accessTypes: ["stream", "rent", "buy"] }) });
  }
  if (filters.providers.length) {
    suggestions.push({ id: "providers", label: t("none.moreProviders"), run: () => actions.patchFilters({ providers: [] }) });
  }
  if (filters.languages.length || filters.requireArabicSubtitles || filters.requireArabicDubbing) {
    suggestions.push({
      id: "language",
      label: t("act.languages"),
      run: () => actions.patchFilters({ languages: [], requireArabicSubtitles: false, requireArabicDubbing: false, originalAudioOnly: false }),
    });
  }
  if (filters.hideWatched) suggestions.push({ id: "watched", label: t("act.watched"), run: () => actions.patchFilters({ hideWatched: false, includeComfortRewatches: true }) });
  if (filters.hideDismissed) suggestions.push({ id: "dismissed", label: t("hist.dismissed"), run: () => actions.patchFilters({ hideDismissed: false }) });
  const poorRatedIds = Object.entries(state.viewed)
    .filter(([, viewed]) => (viewed.rating ?? 0) <= 2)
    .map(([id]) => id);
  if (filters.avoidPoorMatches && poorRatedIds.length) {
    suggestions.push({ id: "poor-history", label: t("none.allowPoor"), run: () => actions.patchFilters({ avoidPoorMatches: false }) });
  }
  const feedbackSimilarIds = Object.entries(state.session.feedback)
    .filter(([, tags]) => tags.includes("hideSimilar"))
    .map(([id]) => id);
  if (feedbackSimilarIds.length) {
    suggestions.push({
      id: "feedback-similar",
      label: t("none.showSimilar"),
      run: () => feedbackSimilarIds.forEach((id) => actions.toggleFeedback(id, "hideSimilar")),
    });
  }
  const strictMood = MOOD_KEYS.find((key) => filters.active[key] && filters.importance[key] === 3);
  if (strictMood) {
    suggestions.push({ id: "must-match", label: t("importance.important"), run: () => actions.setImportance(strictMood, 2) });
  }
  const strictContent = CONTENT_KEYS.find((key) => filters.limits[key] < 4);
  if (strictContent) {
    const key: ContentKey = strictContent;
    const nextLevel = Math.min(4, filters.limits[key] + 1);
    suggestions.push({
      id: "content",
      label: t("none.relaxContent", { level: t(`level.${nextLevel}`), label: t(`content.${key}`) }),
      run: () => actions.setLimit(key, nextLevel),
    });
  }

  const showResults = () => {
    actions.startSession();
    setStage("results");
    setLimit(PAGE);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const activeFilters: { id: string; label: string; remove: () => void }[] = [];
  if (moodKeys.length) activeFilters.push({ id: "moods", label: `${t("sec.moods")} (${moodKeys.length})`, remove: actions.resetMoods });
  if (filters.maxRuntime < 240) activeFilters.push({ id: "runtime", label: t("runtime.custom.value", { n: filters.maxRuntime }), remove: () => actions.patchFilters({ maxRuntime: 240 }) });
  if (filters.context !== "solo") activeFilters.push({ id: "context", label: t(`ctx.${filters.context}`), remove: () => actions.patchFilters({ context: "solo" }) });
  if (filters.languages.length) activeFilters.push({ id: "language", label: filters.languages.map((language) => t(`lang.${language}`)).join(", "), remove: () => actions.patchFilters({ languages: [] }) });
  if (filters.requireArabicSubtitles) activeFilters.push({ id: "arabic-subs", label: t("language.arSubs"), remove: () => actions.patchFilters({ requireArabicSubtitles: false }) });
  if (filters.requireArabicDubbing) activeFilters.push({ id: "arabic-dub", label: t("language.arDub"), remove: () => actions.patchFilters({ requireArabicDubbing: false }) });
  if (filters.originalAudioOnly) activeFilters.push({ id: "original-audio", label: t("language.original"), remove: () => actions.patchFilters({ originalAudioOnly: false }) });
  if (filters.providers.length) activeFilters.push({ id: "providers", label: filters.providers.join(", "), remove: () => actions.patchFilters({ providers: [] }) });
  filters.accessTypes.forEach((type) =>
    activeFilters.push({
      id: `access-${type}`,
      label: t(`availability.${type === "stream" ? "subscription" : type}`),
      remove: () => actions.patchFilters({ accessTypes: filters.accessTypes.filter((item) => item !== type) }),
    }),
  );
  if (filters.maxAgeRating !== "any") activeFilters.push({ id: "age", label: `${t("age.title")}: ${t(`age.${filters.maxAgeRating}`)}`, remove: () => actions.patchFilters({ maxAgeRating: "any" }) });
  CONTENT_KEYS.filter((key) => filters.limits[key] < 4).forEach((key) =>
    activeFilters.push({ id: `content-${key}`, label: `${t(`content.${key}`)}: ${t(`level.${filters.limits[key]}`)}`, remove: () => actions.setLimit(key, 4) }),
  );
  if (filters.hideWatched) activeFilters.push({ id: "watched", label: t("hideWatched"), remove: () => actions.patchFilters({ hideWatched: false }) });
  if (filters.avoidPoorMatches) activeFilters.push({ id: "poor", label: t("hist.poor"), remove: () => actions.patchFilters({ avoidPoorMatches: false }) });
  if (Object.values(state.session.feedback).some((tags) => tags.includes("hideSimilar"))) {
    activeFilters.push({
      id: "session-feedback",
      label: t("feedback.hideSimilar"),
      remove: () => Object.entries(state.session.feedback)
        .filter(([, tags]) => tags.includes("hideSimilar"))
        .forEach(([id]) => actions.toggleFeedback(id, "hideSimilar")),
    });
  }

  const failures = useMemo(
    () => countFailures(MOVIES, filters, state),
    [filters, state.viewed, state.dismissed, state.session],
  );
  const restrictions = [
    { key: "runtime", ids: ["runtime"] },
    { key: "providers", ids: ["provider"] },
    { key: "access", ids: ["access", "region"] },
    { key: "language", ids: ["language"] },
    { key: "content", ids: CONTENT_KEYS.map((key) => `c:${key}`) },
    { key: "age", ids: ["age"] },
    { key: "history", ids: ["watched", "dismissed", "poorHistory", "feedbackSimilar"] },
    { key: "must", ids: MOOD_KEYS.map((key) => `must:${key}`) },
  ].map(({ key, ids }) => ({
    key,
    count: failures.filter(([failure]) => ids.includes(failure)).reduce((sum, [, count]) => sum + count, 0),
  })).filter((item) => item.count > 0);
  const shown = ranked.results.slice(0, limit);

  return (
    <Shell
      current="discover"
      heading={stage === "start" ? t("header.start") : stage === "tune" ? t("header.tune") : t("title")}
      description={stage === "start" ? t("subtitle") : t("demoShort")}
    >
      {stage === "start" && (
        <section className="mx-auto max-w-5xl" data-testid="screen-start">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("step.mood")}</h2>
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full px-3 py-2 text-sm text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="button-how-it-works">
                <CircleHelp className="h-4 w-4" aria-hidden /> {t("how")}
              </summary>
              <p className="absolute end-0 z-20 mt-2 w-[min(90vw,28rem)] rounded-xl border border-border bg-popover p-4 text-sm text-popover-foreground shadow-xl">
                {t("how.body")}
              </p>
            </details>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="grid-presets">
            {PRESETS.map((preset) => {
              const selected = filters.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => actions.applyPreset(preset.id)}
                  data-testid={`button-preset-${preset.id}`}
                  className={`min-h-28 rounded-2xl border p-4 text-start transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    selected ? "border-primary bg-primary/10 shadow-[0_12px_36px_-28px_hsl(var(--primary))]" : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 font-display text-lg font-semibold">
                    <span>{t(`p.${preset.id}`)}</span>
                    {selected && <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{t(`p.${preset.id}.d`)}</span>
                </button>
              );
            })}
          </div>
          {selectedPreset && (
            <div className="mt-5 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5" data-testid="panel-preset-confirmation">
              <p className="font-medium" role="status">{t("preset.confirm", { name: t(`p.${selectedPreset.id}`) })}</p>
              <div className="mt-4 flex flex-wrap gap-2 sm:mt-0">
                <Button className="rounded-full" onClick={showResults} data-testid="button-find-my-movie">
                  {t("preset.find")} <ArrowRight className="ms-2 h-4 w-4" aria-hidden />
                </Button>
                <Button variant="outline" className="rounded-full" onClick={() => setStage("tune")} data-testid="button-fine-tune">
                  {t("preset.tune")}
                </Button>
              </div>
            </div>
          )}
          {!selectedPreset && <p className="mt-5 text-sm text-muted-foreground">{t("results.start")}</p>}
        </section>
      )}

      {stage === "tune" && (
        <div className="mx-auto max-w-4xl" data-testid="screen-tune">
          <Button variant="ghost" className="mb-4 rounded-full" onClick={() => setStage("start")} data-testid="button-back-to-moods">
            <ArrowLeft className="me-2 h-4 w-4" aria-hidden /> {t("t.back")}
          </Button>
          <FilterPanel />
          <div className="sticky bottom-3 z-20 mt-6 flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
            <span className="text-sm font-medium" aria-live="polite" data-testid="text-live-match-count">
              {t("t.count", { n: ranked.results.length })}
            </span>
            <Button className="rounded-full" onClick={showResults} data-testid="button-show-matches">
              {t("t.show")} <ArrowRight className="ms-2 h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {stage === "results" && (
        <section data-testid="screen-results">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold" data-testid="text-results-count" aria-live="polite">
                {t("results.heading", { n: ranked.results.length })}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground" data-testid="text-results-summary">
                {summary || t("results.hardNote")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="select-results-sort" className="text-sm text-muted-foreground">{t("sort.label")}</label>
              <select
                id="select-results-sort"
                value={state.session.sort}
                onChange={(event) => actions.setSort(event.target.value as typeof state.session.sort)}
                className="h-10 rounded-full border border-border bg-card px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="select-results-sort"
              >
                {(["match", "shortest", "newest", "rated", "surprise"] as const).map((sort) => (
                  <option key={sort} value={sort}>{t(`sort.${sort}`)}</option>
                ))}
              </select>
              <Button variant="outline" className="rounded-full" onClick={() => setStage("tune")} data-testid="button-refine">
                {t("t.refine")}
              </Button>
              <Button
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  actions.resetForNewSession();
                  setStage("start");
                  setLimit(PAGE);
                }}
                data-testid="button-new-session"
              >
                <RotateCcw className="me-2 h-4 w-4" aria-hidden /> {t("t.reset")}
              </Button>
            </div>
          </div>

          {activeFilters.length > 0 && (
            <div className="mb-5" data-testid="list-active-filters">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("t.selected")}</p>
              <div className="flex flex-wrap gap-2">
                {activeFilters.map((filter) => (
                  <Chip
                    key={filter.id}
                    testId={`chip-active-filter-${filter.id}`}
                    on
                    onClick={filter.remove}
                    aria-label={t("t.remove", { label: filter.label })}
                  >
                    {filter.label} <span className="ms-1" aria-hidden>×</span>
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {ranked.results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-5 sm:p-7" data-testid="empty-no-results">
              <div className="text-center">
                <SearchX className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
                <h3 className="text-xl font-semibold">{t("none.headline")}</h3>
                <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{t("none.body")}</p>
                <p className="mx-auto mt-2 max-w-xl text-sm text-primary" data-testid="text-safety-unchanged">{t("none.safety")}</p>
              </div>
              {restrictions.length > 0 && (
                <div className="mx-auto mt-6 max-w-2xl" data-testid="list-result-restrictions">
                  <h4 className="mb-2 text-sm font-semibold">{t("none.restrictions")}</h4>
                  <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    {restrictions.map((item) => (
                      <li key={item.key} className="rounded-lg bg-secondary/50 px-3 py-2">
                        {t(`none.${item.key}`, { n: item.count })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mx-auto mt-6 max-w-2xl">
                <p className="mb-2 text-sm font-medium">{t("none.actions")}</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <Button key={suggestion.id} variant="outline" className="rounded-full" onClick={suggestion.run} data-testid={`button-action-${suggestion.id}`}>
                      {suggestion.label}
                    </Button>
                  ))}
                  {ranked.near.length > 0 && (
                    <Link href="/movie-ideas?tab=near&saved=1" className="inline-flex min-h-10 items-center rounded-full border border-border px-4 text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="link-saved-near-matches">
                      {t("none.browseSaved")}
                    </Link>
                  )}
                  {suggestions.length === 0 && ranked.near.length === 0 && <p className="mt-2 w-full text-sm text-muted-foreground">{t("act.none")}</p>}
                </div>
                {suggestions.some((suggestion) => suggestion.id === "content") && (
                  <p className="mt-3 text-xs text-muted-foreground">{t("none.relaxNotice")}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="list-results">
              {shown.map((item) => (
                <MovieCard
                  key={item.movie.id}
                  movie={item.movie}
                  score={item.score}
                  reasons={buildReasons(item.movie, filters, state, t, MOVIES)}
                  onOpen={setOpenId}
                />
              ))}
              {ranked.results.length > PAGE && (
                <Button
                  variant="outline"
                  className="justify-self-center rounded-full xl:col-span-2"
                  onClick={() => setLimit(limit >= ranked.results.length ? PAGE : limit + PAGE)}
                  data-testid="button-show-more"
                >
                  {limit >= ranked.results.length ? t("results.showLess") : t("results.showMore")}
                </Button>
              )}
            </div>
          )}

          {ranked.near.length > 0 && (
            <div className="mt-10" data-testid="section-near">
              <h3 className="text-lg font-semibold">{t("near.title")}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{t("near.d")}</p>
              <div className="grid gap-4 xl:grid-cols-2">
                {ranked.near.slice(0, 4).map((item) => (
                  <MovieCard
                    key={item.movie.id}
                    movie={item.movie}
                    score={item.score}
                    note={t("near.blocked", { list: item.fails.map((failure) => t(`fail.${failure}`)).join(", ") })}
                    onOpen={setOpenId}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <MovieDetail movieId={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />
    </Shell>
  );
}