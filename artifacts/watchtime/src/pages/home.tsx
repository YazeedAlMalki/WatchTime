import React from "react";
import { useGetMyRecommendations, useGetMyRecentActivity, useGetMyShows, useGetMyWatchlist, useMarkEpisodeWatched } from "@workspace/api-client-react";
import { PosterCard } from "@/components/ui/poster-card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Play, Clock, Sparkles, ChevronRight, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

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
                    <img src={show.nextEpisode.stillUrl} alt={show.nextEpisode.name} className="w-full h-full object-cover" />
                  ) : show.title.backdropUrl ? (
                    <img src={show.title.backdropUrl} alt={show.title.name} className="w-full h-full object-cover opacity-50" />
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
                          { onSuccess: () => queryClient.invalidateQueries() }
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
