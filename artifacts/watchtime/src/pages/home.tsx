import React from "react";
import {
  getGetMyRecommendationsQueryKey,
  getGetMyRecentActivityQueryKey,
  getGetMyShowsQueryKey,
  useGetMyRecommendations,
  useGetMyRecentActivity,
  useGetMyShows,
  useGetMyWatchlist,
  useMarkEpisodeWatched,
} from "@workspace/api-client-react";
import { PosterCard } from "@/components/ui/poster-card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Play, Clock, Sparkles, ChevronRight, Check, Film, ArrowUpRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { OptimizedImage } from "@/components/ui/optimized-image";

export default function HomePage() {
  const { data: myShows, isLoading: showsLoading } = useGetMyShows();
  const { data: recentActivity, isLoading: recentLoading } = useGetMyRecentActivity();
  const { data: recommendations, isLoading: recLoading } = useGetMyRecommendations();
  const { data: watchlist, isLoading: watchLoading } = useGetMyWatchlist();

  const markWatched = useMarkEpisodeWatched();
  const queryClient = useQueryClient();

  const upNext = myShows?.filter(s => s.nextEpisode)?.slice(0, 4) || [];

  return (
    <div className="container mx-auto px-4 sm:px-8 py-8 flex flex-col gap-12">
      <header>
        <h1 className="text-3xl font-display font-bold text-foreground">Welcome back</h1>
        <p className="text-muted-foreground mt-1">Here's what you're watching.</p>
      </header>

      <Link
        href="/discover-mood"
        data-testid="link-discover-by-mood"
        className="group relative overflow-hidden rounded-3xl border border-primary/20 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.17),transparent_50%),linear-gradient(120deg,hsl(var(--card)),hsl(var(--background)))] p-6 sm:p-8 transition-all hover:border-primary/40 hover:shadow-[0_18px_60px_-35px_hsl(var(--primary)/0.5)]"
      >
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary">
              <Film className="h-3.5 w-3.5" />
              A better pick for tonight
            </div>
            <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">What do you feel like watching?</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Find a movie for your mood, your time, and what you want to avoid.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-transform group-hover:translate-x-1">
            Discover by mood <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
        <Sparkles aria-hidden="true" className="absolute -bottom-7 right-8 h-36 w-36 rotate-12 text-primary/5" />
      </Link>

      {/* Up Next */}
      {upNext.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-display font-bold flex items-center gap-2">
              <Play className="w-5 h-5 text-primary" /> Up Next
            </h2>
            <Link href="/my-shows">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                See all <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {upNext.map((show) => (
              <div key={show.title.id} className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col hover-elevate shadow-sm transition-all group">
                <div className="relative aspect-video w-full bg-secondary">
                  {show.nextEpisode?.stillUrl ? (
                    <OptimizedImage src={show.nextEpisode.stillUrl} alt={show.nextEpisode.name} className="w-full h-full object-cover" width={640} height={360} />
                  ) : show.title.backdropUrl ? (
                    <OptimizedImage src={show.title.backdropUrl} alt={show.title.name} className="w-full h-full object-cover opacity-50" width={640} height={360} />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col justify-end">
                    <span className="text-white font-bold font-display truncate shadow-sm">{show.title.name}</span>
                    <span className="text-white/80 text-xs font-medium">S{show.nextEpisode?.seasonNumber} E{show.nextEpisode?.episodeNumber} • {show.nextEpisode?.name}</span>
                  </div>
                </div>
                <div className="p-4 flex items-center justify-between bg-card">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground font-medium">Next to watch</span>
                  </div>
                  <Button 
                    size="sm" 
                    className="rounded-full gap-1 pl-3 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                    disabled={markWatched.isPending}
                    onClick={() => {
                      if (show.nextEpisode) {
                        markWatched.mutate(
                          { episodeId: show.nextEpisode.id, data: { includePrevious: true } },
                          {
                            onSuccess: () => Promise.all([
                              queryClient.invalidateQueries({ queryKey: getGetMyShowsQueryKey() }),
                              queryClient.invalidateQueries({ queryKey: getGetMyRecentActivityQueryKey() }),
                              queryClient.invalidateQueries({ queryKey: getGetMyRecommendationsQueryKey() }),
                            ]),
                          }
                        );
                      }
                    }}
                  >
                    <Check className="w-4 h-4" /> Watched
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Watchlist */}
      {watchlist && watchlist.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-display font-bold flex items-center gap-2">
              <Clock className="w-5 h-5 text-secondary-foreground" /> From Your Watchlist
            </h2>
            <Link href="/watchlist">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                See all <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {watchlist.slice(0, 6).map((title) => (
              <PosterCard key={title.id} title={title} />
            ))}
          </div>
        </section>
      )}

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <section className="bg-secondary/20 -mx-4 sm:-mx-8 px-4 sm:px-8 py-12 border-y border-border">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-display font-bold text-foreground">Recommended for You</h2>
          </div>
          
          <div className="flex flex-col gap-10">
            {recommendations.slice(0, 2).map((group, idx) => (
              <div key={idx}>
                <h3 className="text-lg font-medium text-foreground mb-4">{group.reason}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                  {group.titles.slice(0, 6).map((title) => (
                    <PosterCard key={title.id} title={title} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
