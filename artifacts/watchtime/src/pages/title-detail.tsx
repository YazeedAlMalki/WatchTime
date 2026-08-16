import React, { useState } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetTitle, 
  useGetTitleSafety, 
  useGetSeason, 
  useGetSimilarTitles,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useMarkTitleWatched,
  useUnmarkTitleWatched,
  useMarkEpisodeWatched,
  useUnmarkEpisodeWatched,
  getGetSeasonQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PosterCard } from "@/components/ui/poster-card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ShieldCheck, Play, Plus, Check, Star, Users, Info, ChevronDown, ChevronUp, AlertCircle, Bookmark } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Show } from "@clerk/react";
import { Checkbox } from "@/components/ui/checkbox";

export default function TitleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const titleId = parseInt(id, 10);
  const queryClient = useQueryClient();

  const [expandedSeason, setExpandedSeason] = useState<number | undefined>(undefined);
  
  const { data: title, isLoading: titleLoading } = useGetTitle(titleId);
  const { data: safety, isLoading: safetyLoading } = useGetTitleSafety({ titleId, seasonNumber: expandedSeason });
  const { data: seasonDetail } = useGetSeason(titleId, expandedSeason || 0, { query: { enabled: !!expandedSeason, queryKey: getGetSeasonQueryKey(titleId, expandedSeason || 0) } });
  const { data: similar } = useGetSimilarTitles(titleId);

  const addWatchlist = useAddToWatchlist();
  const removeWatchlist = useRemoveFromWatchlist();
  const markWatched = useMarkTitleWatched();
  const unmarkWatched = useUnmarkTitleWatched();
  const markEpWatched = useMarkEpisodeWatched();
  const unmarkEpWatched = useUnmarkEpisodeWatched();

  const invalidateTitle = () => queryClient.invalidateQueries({ queryKey: ["/api/titles", titleId] });
  const invalidateSeason = (s: number) => queryClient.invalidateQueries({ queryKey: ["/api/titles", titleId, "seasons", s] });

  if (titleLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>;
  }

  if (!title) return <div>Not found</div>;

  const isMovie = title.type === "movie";

  const handleWatchlist = () => {
    if (title.inWatchlist) removeWatchlist.mutate({ id: titleId }, { onSuccess: invalidateTitle });
    else addWatchlist.mutate({ id: titleId }, { onSuccess: invalidateTitle });
  };

  const handleWatched = () => {
    if (title.watched) unmarkWatched.mutate({ id: titleId }, { onSuccess: invalidateTitle });
    else markWatched.mutate({ id: titleId }, { onSuccess: invalidateTitle });
  };

  return (
    <div className="flex flex-col pb-24 bg-background">
      {/* Hero Backdrop */}
      <div className="relative w-full h-[40vh] sm:h-[60vh] md:h-[70vh] bg-secondary flex-shrink-0">
        {title.backdropUrl ? (
          <img src={title.backdropUrl} alt="" className="w-full h-full object-cover opacity-60" />
        ) : (
          <div className="w-full h-full bg-secondary" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      </div>

      <div className="container mx-auto px-4 sm:px-8 relative -mt-32 sm:-mt-64 z-10 flex flex-col md:flex-row gap-8 items-start">
        {/* Poster & Actions */}
        <div className="w-40 sm:w-64 flex-shrink-0 flex flex-col gap-4">
          <div className="aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border-4 border-background bg-card">
            {title.posterUrl ? (
              <img src={title.posterUrl} alt={title.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-secondary flex items-center justify-center p-4 text-center text-muted-foreground font-display">No Poster</div>
            )}
          </div>

          <Show when="signed-in">
            <div className="flex flex-col gap-2">
              <Button 
                variant={title.inWatchlist ? "secondary" : "default"} 
                className="w-full justify-start rounded-xl font-medium shadow-sm"
                onClick={handleWatchlist}
                disabled={addWatchlist.isPending || removeWatchlist.isPending}
              >
                {title.inWatchlist ? <Check className="mr-2 w-4 h-4" /> : <Plus className="mr-2 w-4 h-4" />}
                {title.inWatchlist ? "In Watchlist" : "Watchlist"}
              </Button>
              
              {isMovie && (
                <Button 
                  variant={title.watched ? "default" : "outline"} 
                  className={`w-full justify-start rounded-xl font-medium shadow-sm ${title.watched ? "bg-green-600 text-white hover:bg-green-700 border-transparent" : "bg-card"}`}
                  onClick={handleWatched}
                  disabled={markWatched.isPending || unmarkWatched.isPending}
                >
                  {title.watched ? <Check className="mr-2 w-4 h-4" /> : <Play className="mr-2 w-4 h-4" />}
                  {title.watched ? "Watched" : "Mark Watched"}
                </Button>
              )}
            </div>
          </Show>
        </div>

        {/* Meta & Summary */}
        <div className="flex-1 flex flex-col gap-6 pt-4 sm:pt-20">
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl sm:text-5xl font-display font-bold text-foreground leading-tight">{title.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-muted-foreground">
              {title.year && <span>{title.year}</span>}
              <span className="uppercase tracking-wider px-2 py-0.5 rounded bg-secondary/50 text-foreground">{title.type}</span>
              {title.runtimeMinutes && <span>{title.runtimeMinutes} min</span>}
              {title.genres?.length > 0 && <span>{title.genres.join(", ")}</span>}
            </div>
          </div>

          <div className="flex items-center gap-6">
            {title.imdbRating && (
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                <span className="font-bold text-lg">{title.imdbRating.toFixed(1)}</span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">IMDb</span>
              </div>
            )}
            {title.rottenTomatoesScore && (
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center text-[10px] font-bold">RT</div>
                <span className="font-bold text-lg">{title.rottenTomatoesScore}%</span>
              </div>
            )}
          </div>

          <p className="text-lg text-foreground/80 leading-relaxed max-w-3xl">
            {title.overview || "No overview available."}
          </p>

          {/* Providers */}
          {title.providers && title.providers.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Where to Watch</h3>
              <div className="flex flex-wrap gap-4">
                {title.providers.filter(p => p.kind === 'stream').map(p => (
                  <div key={p.name} className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 rounded-lg shadow-sm">
                    {p.logoUrl && <img src={p.logoUrl} alt={p.name} className="w-6 h-6 rounded" />}
                    <span className="text-sm font-medium">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-8 mt-16 grid lg:grid-cols-[1fr_350px] gap-12">
        {/* Main Content Area */}
        <div className="flex flex-col gap-12">
          
          {/* Content Safety Section - CRITICAL FEATURE */}
          <section className="bg-card border border-border rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-orange-500 to-primary" />
            
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-xl text-primary">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-display font-bold">Content Safety</h2>
                  {safety?.level && (
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {safety.level}-level analysis
                    </span>
                  )}
                </div>
              </div>
              <Show when="signed-in">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="rounded-full shadow-sm text-xs">Report issue</Button>
                  <Button variant="default" size="sm" className="rounded-full shadow-sm text-xs bg-primary text-primary-foreground">Contribute</Button>
                </div>
              </Show>
            </div>

            {safetyLoading ? (
              <div className="h-40 flex items-center justify-center"><div className="w-6 h-6 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>
            ) : safety ? (
              <div className="flex flex-col gap-8">
                {/* Summary Chips */}
                <div className="flex flex-wrap gap-3">
                  {safety.summary.map(s => (
                    <div key={s.category} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
                      s.severity === 'none' ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-900 dark:text-green-400' :
                      s.severity === 'mild' ? 'bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-950/30 dark:border-yellow-900 dark:text-yellow-400' :
                      s.severity === 'moderate' ? 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-900 dark:text-orange-400' :
                      'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400'
                    }`}>
                      <span className="font-semibold text-sm capitalize">{s.category}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                      <span className="text-xs font-bold uppercase tracking-wider">{s.severity}</span>
                    </div>
                  ))}
                </div>

                {/* Sources */}
                <div className="grid sm:grid-cols-2 gap-4">
                  {safety.sources.map(source => (
                    <div key={source.sourceName} className="border border-border rounded-2xl p-4 bg-background">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">{source.sourceName}</span>
                          {source.isCommunity && <span className="bg-primary/10 text-primary text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">Community</span>}
                        </div>
                        {source.ageRecommendation && (
                          <span className="px-2 py-1 rounded bg-secondary text-secondary-foreground text-xs font-bold shadow-sm">{source.ageRecommendation}</span>
                        )}
                      </div>
                      
                      {source.status === 'provider_unavailable' ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm p-4 bg-secondary/30 rounded-xl">
                          <AlertCircle className="w-4 h-4" />
                          <span>Data unavailable from this provider.</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {source.items.map((item, idx) => (
                            <div key={idx} className="flex flex-col gap-1">
                              <div className="flex justify-between items-start">
                                <span className="text-sm font-medium text-foreground">{item.label}</span>
                                {item.score !== undefined && item.maxScore && (
                                  <span className="text-xs font-bold text-muted-foreground">{item.score}/{item.maxScore}</span>
                                )}
                              </div>
                              {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {source.url && (
                        <a href={source.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline mt-4 inline-block font-medium">View source →</a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center p-8 text-muted-foreground">No safety data available.</div>
            )}
          </section>

          {/* Seasons & Episodes */}
          {!isMovie && title.seasons && title.seasons.length > 0 && (
            <section>
              <h2 className="text-2xl font-display font-bold mb-6">Episodes</h2>
              <Accordion 
                type="single" 
                collapsible 
                className="w-full bg-card border border-border rounded-2xl overflow-hidden shadow-sm"
                onValueChange={(val) => setExpandedSeason(val ? parseInt(val, 10) : undefined)}
              >
                {title.seasons.map(season => (
                  <AccordionItem key={season.seasonNumber} value={season.seasonNumber.toString()} className="border-border px-4">
                    <AccordionTrigger className="hover:no-underline py-4">
                      <div className="flex items-center gap-4">
                        <span className="font-display font-bold text-lg text-foreground">{season.name}</span>
                        <span className="text-sm text-muted-foreground font-medium bg-secondary px-2 py-0.5 rounded-md">{season.episodeCount} Episodes</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-6">
                      {expandedSeason === season.seasonNumber && seasonDetail ? (
                        <div className="flex flex-col gap-3">
                          {seasonDetail.episodes.map(ep => (
                            <div key={ep.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary/40 transition-colors group">
                              <Show when="signed-in">
                                <Checkbox 
                                  checked={ep.watched || false}
                                  onCheckedChange={(checked) => {
                                    if (checked) markEpWatched.mutate({ episodeId: ep.id, data: { includePrevious: false } }, { onSuccess: () => invalidateSeason(season.seasonNumber) });
                                    else unmarkEpWatched.mutate({ episodeId: ep.id }, { onSuccess: () => invalidateSeason(season.seasonNumber) });
                                  }}
                                  className="w-5 h-5 rounded-full border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                />
                              </Show>
                              <div className="flex-1 flex flex-col min-w-0">
                                <span className="font-semibold text-foreground text-sm truncate">{ep.episodeNumber}. {ep.name}</span>
                                {ep.airDate && <span className="text-xs text-muted-foreground">{new Date(ep.airDate).toLocaleDateString()}</span>}
                              </div>
                              {ep.stillUrl && (
                                <img src={ep.stillUrl} alt="" className="w-24 aspect-video object-cover rounded-md shadow-sm opacity-80 group-hover:opacity-100 transition-opacity" />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="h-20 flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-8">
          {/* Cast */}
          {title.cast && title.cast.length > 0 && (
            <section className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-display font-bold mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-muted-foreground" /> Top Cast
              </h2>
              <div className="flex flex-col gap-4">
                {title.cast.slice(0, 5).map(member => (
                  <div key={member.name} className="flex items-center gap-3">
                    {member.photoUrl ? (
                      <img src={member.photoUrl} alt={member.name} className="w-10 h-10 rounded-full object-cover bg-secondary" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">{member.name.charAt(0)}</div>
                    )}
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm text-foreground">{member.name}</span>
                      <span className="text-xs text-muted-foreground">{member.character}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Similar */}
          {similar && similar.length > 0 && (
            <section>
              <h2 className="text-xl font-display font-bold mb-4">You might also like</h2>
              <div className="grid grid-cols-2 gap-4">
                {similar.slice(0, 4).map(sim => (
                  <PosterCard key={sim.id} title={sim} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
