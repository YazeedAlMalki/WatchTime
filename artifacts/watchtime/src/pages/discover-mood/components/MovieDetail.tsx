import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Share2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MOVIES, MOVIE_BY_ID } from "../data";
import { buildReasons, classify } from "../engine";
import { useT } from "../i18n";
import { actions, useStore } from "../store";
import { CONTENT_KEYS, MOOD_KEYS } from "../types";
import { Chip } from "./Shell";
import { MoodBar } from "./MoodBar";

const FEEDBACK = ["tooIntense", "tooSlow", "tooSad", "wrongMood", "hideSimilar"] as const;

export function MovieDetail({
  movieId,
  onClose,
  onOpen,
}: {
  movieId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, lang } = useT();
  const state = useStore();
  const { filters, saved, viewed, session, dismissed } = state;
  const movie = movieId ? MOVIE_BY_ID[movieId] : undefined;
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => {
    if (movieId) actions.markViewed(movieId);
    setShareStatus("");
  }, [movieId]);

  const similar = useMemo(() => {
    if (!movie) return [];
    const { results } = classify(MOVIES, filters, state);
    const keys = MOOD_KEYS.filter((key) => filters.active[key]);
    const compareKeys: Array<(typeof MOOD_KEYS)[number]> = keys.length ? [...keys] : [...MOOD_KEYS];
    return results
      .filter((item) => item.movie.id !== movie.id)
      .map((item) => ({
        movie: item.movie,
        distance: compareKeys.reduce<number>((sum, key) => sum + Math.abs(item.movie.mood[key] - movie.mood[key]), 0) / compareKeys.length,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
      .map((item) => item.movie);
  }, [movie, filters, state.viewed, state.saved, state.dismissed, session]);

  if (!movie) return null;
  const history = viewed[movie.id];
  const isSaved = saved.includes(movie.id);
  const activeFeedback = session.feedback[movie.id] ?? [];
  const reasons = buildReasons(movie, filters, state, t, MOVIES);
  const availableHere = movie.availability.filter((item) => item.region === filters.region);
  const summary = lang === "ar"
    ? t("movie.summaryAr", {
        genre: t(`g.${movie.genres[0] ?? "drama"}`),
        mood: t(`mood.${movie.mood.feelGood >= 50 ? "high.feelGood" : "low.feelGood"}`),
      })
    : movie.summary;

  const feedbackMessage = activeFeedback.includes("hideSimilar")
    ? t("feedback.applied.similar")
    : activeFeedback.includes("tooIntense")
      ? t("feedback.applied.intensity")
      : activeFeedback.includes("tooSlow")
        ? t("feedback.applied.pace")
        : activeFeedback.includes("tooSad")
          ? t("feedback.applied.sad")
          : activeFeedback.includes("wrongMood")
            ? t("feedback.applied.mood")
            : "";
  const activeMovieId = movie.id;
  const activeMovieTitle = movie.title;

  async function shareMovie() {
    const url = new URL(window.location.href);
    url.searchParams.set("movie", activeMovieId);
    try {
      if (navigator.share) {
        await navigator.share({ title: activeMovieTitle, url: url.toString() });
          setShareStatus(t("d.shareSent"));
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url.toString());
        setShareStatus(t("d.shareCopied"));
      } else {
        setShareStatus(t("d.shareFailed"));
      }
    } catch {
      setShareStatus(t("d.shareFailed"));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl" data-testid={`dialog-movie-${movie.id}`}>
        <DialogHeader className="text-start">
          <div className="-mx-6 -mt-6 mb-2">
            <div className="relative overflow-hidden">
              <img src={movie.backdropUrl} alt="" className="aspect-[2/1] w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/15 to-transparent" />
              <img
                src={movie.posterUrl}
                alt={movie.title}
                className="absolute bottom-3 start-4 h-28 w-20 rounded-lg border border-white/20 object-cover shadow-xl sm:start-6 sm:h-36 sm:w-24"
              />
            </div>
          </div>
          <DialogTitle className="ps-24 text-2xl sm:ps-32" data-testid="text-detail-title">{movie.title}</DialogTitle>
          <DialogDescription className="ps-24 sm:ps-32">
            {movie.originalTitle && movie.originalTitle !== movie.title ? `${movie.originalTitle} · ` : ""}
            {movie.year} · {t("min", { n: movie.runtimeMinutes })} · {movie.ageRating} · {t(`region.${filters.region}`)} · {movie.country}
          </DialogDescription>
        </DialogHeader>

        <div role="note" data-testid="text-detail-demo-disclaimer" className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>{t("d.demoWarn")}</span>
        </div>

        <section>
          <h4 className="mb-1 text-sm font-semibold">{t("d.summary")}</h4>
          <p className="text-sm text-foreground/85" data-testid="text-detail-summary">{summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">{lang === "ar" ? t("d.editorialNote") : ""}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("d.director")}: {movie.director} · {t("d.cast")}: {movie.cast.join(", ")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{t("d.trailerNote")}</p>
        </section>

        <section>
          <h4 className="mb-1 text-sm font-semibold">{t("d.bestFor")}</h4>
          <div className="flex flex-wrap gap-1.5" data-testid="list-best-for">
            {movie.bestFor.map((item) => (
              <span key={item} className="rounded-full bg-secondary px-2.5 py-1 text-xs">{t(`tag.${item}`)}</span>
            ))}
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold">{t("d.content")}</h4>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[28rem] text-start text-xs">
              <thead className="bg-secondary/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t("d.content")}</th>
                  <th className="px-3 py-2 font-semibold">{t("d.level")}</th>
                  <th className="px-3 py-2 font-semibold">{t("d.notes")}</th>
                </tr>
              </thead>
              <tbody>
                {CONTENT_KEYS.map((key) => (
                  <tr key={key} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 font-medium">{t(`content.${key}`)}</th>
                    <td className="px-3 py-2">{t(`level.${movie.content[key]}`)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t("d.contentNotes")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("content.help")}</p>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold">{t("d.moodProfile")}</h4>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {MOOD_KEYS.map((key) => (
              <MoodBar key={key} testId={`bar-detail-mood-${key}`} label={t(`mood.${key}`)} value={movie.mood[key]} target={filters.active[key] ? filters.targets[key] : undefined} />
            ))}
          </div>
        </section>

        <section className="text-sm">
          <h4 className="mb-1 text-sm font-semibold">{t("d.avail")}</h4>
          <p className="text-xs text-muted-foreground">
            {t("d.audio")}: {movie.languages.map((language) => t(`lang.${language}`)).join(", ")} · {t("d.subs")}:{" "}
            {movie.subtitleLanguages.map((language) => t(`lang.${language}`)).join(", ")}
          </p>
          <ul className="mt-2 space-y-1" data-testid="list-availability">
            {availableHere.length === 0 && <li className="text-muted-foreground">{t("d.avail.none")}</li>}
            {availableHere.map((item, index) => (
              <li key={`${item.provider}-${index}`}>
                {t(`region.${item.region}`)}: {item.provider} · {t(`kind.${item.kind}`)}
                {item.dubs.length > 0 && ` · ${t("d.dubs")}: ${item.dubs.map((language) => t(`lang.${language}`)).join(", ")}`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("availability.region", { region: t(`region.${filters.region}`) })}</p>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold">{t("d.why")}</h4>
          <ul className="list-disc space-y-1 ps-5 text-sm text-foreground/85" data-testid="list-detail-reasons">
            {reasons.map((reason, index) => <li key={index}>{reason}</li>)}
          </ul>
        </section>

        {similar.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">{t("d.similar")}</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {similar.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onOpen(candidate.id)}
                  className="flex items-center gap-3 rounded-xl border border-border p-2 text-start hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid={`button-similar-${candidate.id}`}
                >
                  <img src={candidate.posterUrl} alt={candidate.title} className="h-16 w-11 rounded object-cover" />
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium">{candidate.title}</span>
                    <span className="text-xs text-muted-foreground">{candidate.year} · {t("min", { n: candidate.runtimeMinutes })}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3 rounded-xl border border-border bg-secondary/30 p-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={isSaved ? "secondary" : "outline"} className="rounded-full" onClick={() => actions.toggleSaved(movie.id)} data-testid="button-detail-save">
              {isSaved ? t("saved") : t("save")}
            </Button>
            <Button size="sm" variant={history?.watched ? "secondary" : "outline"} className="rounded-full" onClick={() => actions.setWatched(movie.id, !history?.watched)} data-testid="button-detail-watched">
              {history?.watched ? t("unwatch") : t("watched")}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={shareMovie} data-testid="button-detail-share">
              <Share2 className="h-4 w-4" aria-hidden /> {t("d.share")}
            </Button>
            {dismissed.includes(movie.id) ? (
              <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground" onClick={() => actions.restore(movie.id)} data-testid="button-detail-restore">
                {t("i.restore")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-muted-foreground"
                onClick={() => {
                  actions.dismiss(movie.id);
                  onClose();
                }}
                data-testid="button-detail-dismiss"
              >
                {t("dismiss")}
              </Button>
            )}
          </div>
          {shareStatus && <p role="status" className="text-xs text-muted-foreground" data-testid="text-share-status">{shareStatus}</p>}
          <div>
            <p className="mb-1 text-sm font-semibold">{t("d.rate")}</p>
            <div className="flex items-center gap-1" role="group" aria-label={t("d.rate")}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  aria-label={t("fav", { n: rating })}
                  aria-pressed={(history?.rating ?? 0) >= rating}
                  onClick={() => actions.setRating(movie.id, rating)}
                  data-testid={`button-rate-${rating}`}
                  className="rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Star className={`h-6 w-6 ${(history?.rating ?? 0) >= rating ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                </button>
              ))}
              {history?.rating !== undefined && <Button size="sm" variant="ghost" onClick={() => actions.setRating(movie.id, undefined)} data-testid="button-rate-clear">{t("d.rate.clear")}</Button>}
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold">{t("d.feedback")}</p>
            <div className="flex flex-wrap gap-1.5">
              {FEEDBACK.map((tag) => (
                <Chip key={tag} testId={`chip-feedback-${tag}`} on={activeFeedback.includes(tag)} onClick={() => actions.toggleFeedback(movie.id, tag)}>
                  {t(`feedback.${tag}`)}
                </Chip>
              ))}
            </div>
            {feedbackMessage && <p className="mt-2 text-xs text-muted-foreground" role="status" data-testid="text-feedback-effect">{feedbackMessage}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{t("hist.note")}</p>
          </div>
        </section>

        <Button variant="outline" className="rounded-full" onClick={onClose} data-testid="button-detail-close">{t("d.close")}</Button>
      </DialogContent>
    </Dialog>
  );
}