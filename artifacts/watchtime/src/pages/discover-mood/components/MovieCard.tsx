import { Bookmark, BookmarkCheck, Check, EyeOff, Info, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "../i18n";
import { actions, useStore } from "../store";
import { MOOD_KEYS, type Movie } from "../types";

export function MovieCard({
  movie,
  score,
  reasons,
  note,
  restore,
  onOpen,
}: {
  movie: Movie;
  score?: number;
  reasons?: string[];
  note?: string;
  restore?: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useT();
  const { saved, savedContext, viewed, dismissed, filters, lang } = useStore();
  const isSaved = saved.includes(movie.id);
  const watched = !!viewed[movie.id]?.watched;
  const source = savedContext[movie.id];
  const savedDate = source ? new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-US", { dateStyle: "medium" }).format(new Date(source.savedAt)) : "";
  const savedFrom = source
    ? source.preset
      ? t("ideas.saved.context", { preset: t(`p.${source.preset}`), date: savedDate })
      : t("ideas.saved.custom", { date: savedDate })
    : "";
  const availability = movie.availability.find((item) => item.region === filters.region);
  const language = movie.languages[0] ?? "en";
  const moodKeys = MOOD_KEYS.filter((key) => filters.active[key]).sort(
    (a, b) => Math.abs(movie.mood[a] - filters.targets[a]) - Math.abs(movie.mood[b] - filters.targets[b]),
  );
  const tagKeys = (moodKeys.length ? moodKeys : [...MOOD_KEYS].sort((a, b) =>
    Math.abs(movie.mood[b] - 50) - Math.abs(movie.mood[a] - 50),
  )).slice(0, 3);
  const cardSummary = lang === "ar"
    ? t("movie.summaryAr", {
        genre: t(`g.${movie.genres[0] ?? "drama"}`),
        mood: t(`mood.${(tagKeys[0] && movie.mood[tagKeys[0]] >= 50) ? `high.${tagKeys[0]}` : `low.${tagKeys[0] ?? "feelGood"}`}`),
      })
    : movie.summary;
  return (
    <article
      data-testid={`card-movie-${movie.id}`}
      className="flex gap-4 rounded-2xl border border-border bg-card p-3 sm:p-4"
    >
      <button
        type="button"
        onClick={() => onOpen(movie.id)}
        aria-label={`${t("view")}: ${movie.title}`}
        data-testid={`button-open-poster-${movie.id}`}
        className="h-fit w-24 shrink-0 overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-28"
      >
        <img src={movie.posterUrl} alt={movie.title} className="aspect-[2/3] w-full object-cover" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="line-clamp-2 break-words text-lg font-semibold" data-testid={`text-title-${movie.id}`}>
              {movie.title}
            </h3>
            <p className="text-xs text-muted-foreground">
              {movie.year} · {t("min", { n: movie.runtimeMinutes })} · {t("results.original", { lang: t(`lang.${language}`) })} ·{" "}
              <span className="rounded bg-secondary px-1.5 py-0.5">{movie.ageRating}</span>
            </p>
            <p className="mt-1 text-xs font-medium text-primary" data-testid={`text-provider-${movie.id}`}>
              {availability
                ? t("results.provider", { region: t(`region.${availability.region}`), provider: availability.provider, kind: t(`kind.${availability.kind}`) })
                : t("d.avail.none")}
            </p>
          </div>
          {score !== undefined && (
            <span
              data-testid={`text-score-${movie.id}`}
              className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
            >
              {t("match", { n: score })}
            </span>
          )}
        </div>
        {note && (
          <p className="text-xs text-amber-200/90" data-testid={`text-note-${movie.id}`}>
            {note}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5" data-testid={`list-mood-tags-${movie.id}`}>
          {tagKeys.map((key) => (
            <span key={key} className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground/85">
              {t(`mood.${movie.mood[key] >= 50 ? "high" : "low"}.${key}`)}
            </span>
          ))}
        </div>
        <p className="line-clamp-2 text-sm text-foreground/80">{cardSummary}</p>
        {savedFrom && <p className="text-xs text-muted-foreground" data-testid={`text-saved-context-${movie.id}`}>{savedFrom}</p>}
        {reasons && reasons.length > 0 && (
          <details className="group text-sm" data-testid={`details-why-${movie.id}`}>
            <summary className="cursor-pointer text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {t("why")}
            </summary>
            <ul className="mt-1.5 list-disc space-y-1 ps-5 text-foreground/80">
              {reasons.map((r, i) => (
                <li key={i} data-testid={`text-reason-${movie.id}-${i}`}>
                  {r}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="secondary" className="gap-1.5 rounded-full" onClick={() => onOpen(movie.id)} data-testid={`button-details-${movie.id}`}>
            <Info className="h-4 w-4" aria-hidden /> {t("view")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-full"
            aria-pressed={isSaved}
            onClick={() => actions.toggleSaved(movie.id)}
            data-testid={`button-save-${movie.id}`}
          >
            {isSaved ? <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
            {isSaved ? t("saved") : t("save")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-full"
            aria-pressed={watched}
            onClick={() => actions.setWatched(movie.id, !watched)}
            data-testid={`button-watched-${movie.id}`}
          >
            <Check className="h-4 w-4" aria-hidden /> {watched ? t("unwatch") : t("watched")}
          </Button>
          {restore || dismissed.includes(movie.id) ? (
            <Button size="sm" variant="ghost" className="gap-1.5 rounded-full" onClick={() => actions.restore(movie.id)} data-testid={`button-restore-${movie.id}`}>
              <Undo2 className="h-4 w-4" aria-hidden /> {t("i.restore")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="gap-1.5 rounded-full text-muted-foreground" onClick={() => actions.dismiss(movie.id)} data-testid={`button-dismiss-${movie.id}`}>
              <EyeOff className="h-4 w-4" aria-hidden /> {t("dismiss")}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
