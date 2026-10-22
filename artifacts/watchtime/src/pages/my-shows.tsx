import React, { useEffect, useState } from "react";
import {
  getMyMovies,
  getMyShows,
  getMyInProgressShows,
  mergeTrackedShows,
  getGetMyRecentActivityQueryKey,
  getGetMyRecommendationsQueryKey,
  getGetMyShowsQueryKey,
  getGetMyInProgressShowsQueryKey,
  getGetMyMoviesQueryKey,
  useGetMyRecentActivity,
  useMarkEpisodeWatched,
} from "@workspace/api-client-react";
import { PosterCard } from "@/components/ui/poster-card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { PlaySquare, Check, Clock, Search } from "lucide-react";
import { Link } from "wouter";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useUser } from "@clerk/react";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 24;

type ShowFilter = "all" | "up-next" | "caught-up";

export default function MyShowsPage() {
  const { isSignedIn } = useUser();
  const [showSearch, setShowSearch] = useState("");
  const [debouncedShowSearch, setDebouncedShowSearch] = useState("");
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedShowSearch(showSearch.trim()), 350);
    return () => clearTimeout(timeout);
  }, [showSearch]);

  const showQueryParams = {
    q: debouncedShowSearch || undefined,
    status: showFilter === "all" ? undefined : showFilter,
  };
  const showsQuery = useInfiniteQuery({
    queryKey: [...getGetMyShowsQueryKey(), "infinite", showQueryParams],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      getMyShows({ limit: PAGE_SIZE, beforeId: pageParam, ...showQueryParams }, { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.title.id : undefined,
  });
  const inProgressQuery = useInfiniteQuery({
    queryKey: [...getGetMyInProgressShowsQueryKey(), "infinite"],
    enabled: !!isSignedIn && showFilter === "all" && !debouncedShowSearch,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      getMyInProgressShows({ limit: PAGE_SIZE, beforeId: pageParam }, { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.title.id : undefined,
  });
  const moviesQuery = useInfiniteQuery({
    queryKey: [...getGetMyMoviesQueryKey(), "infinite"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getMyMovies({ limit: PAGE_SIZE, before: pageParam }, { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.collectionCursor : undefined,
  });
  const useMergedInProgress = showFilter === "all" && !debouncedShowSearch;
  const shows = useMergedInProgress
    ? mergeTrackedShows(showsQuery.data?.pages.flat() ?? [], inProgressQuery.data?.pages.flat() ?? [])
    : showsQuery.data?.pages.flat() ?? [];
  const filteredShows = shows.filter((show) =>
    showFilter === "all" ||
    (showFilter === "up-next" && show.nextEpisode !== null) ||
    (showFilter === "caught-up" && show.nextEpisode === null)
  );
  const hasShowCriteria = showFilter !== "all" || !!debouncedShowSearch;
  const movies = moviesQuery.data?.pages.flat() ?? [];
  const showsLoading = showsQuery.isLoading;
  const moviesLoading = moviesQuery.isLoading;
  const { data: history, isLoading: historyLoading } = useGetMyRecentActivity();
  const markWatched = useMarkEpisodeWatched();
  const queryClient = useQueryClient();

  const handleMarkWatched = (episodeId: number) => {
    markWatched.mutate(
      { episodeId, data: { includePrevious: true } },
      {
        onSuccess: () => Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetMyShowsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetMyInProgressShowsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetMyRecentActivityQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetMyRecommendationsQueryKey() }),
        ]),
      }
    );
  };

  return (
    <div className="container mx-auto px-4 sm:px-8 py-8 min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
          <PlaySquare className="w-8 h-8 text-primary" /> My Tracking
        </h1>
      </header>

      <Tabs defaultValue="shows" className="w-full">
        <TabsList className="mb-8 bg-secondary/50 p-1 rounded-xl">
          <TabsTrigger value="shows" className="rounded-lg px-6 data-[state=active]:bg-background data-[state=active]:shadow-sm">TV Shows</TabsTrigger>
          <TabsTrigger value="movies" className="rounded-lg px-6 data-[state=active]:bg-background data-[state=active]:shadow-sm">Movies</TabsTrigger>
          <TabsTrigger value="history" className="rounded-lg px-6 data-[state=active]:bg-background data-[state=active]:shadow-sm">History</TabsTrigger>
        </TabsList>

        <TabsContent value="shows" className="mt-0 outline-none">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="input-search-shows"
                aria-label="Search tracked shows"
                placeholder="Search my shows…"
                value={showSearch}
                onChange={(event) => setShowSearch(event.target.value)}
                maxLength={100}
                className="pl-9"
              />
            </div>
            <div role="group" aria-label="Filter shows by progress" className="flex flex-wrap gap-2">
              {([
                { key: "all", label: "All" },
                { key: "up-next", label: "Up Next" },
                { key: "caught-up", label: "Caught Up" },
              ] as const).map(({ key, label }) => (
                <Button
                  key={key}
                  type="button"
                  data-testid={`filter-shows-${key}`}
                  aria-pressed={showFilter === key}
                  variant={showFilter === key ? "secondary" : "outline"}
                  className="rounded-full"
                  onClick={() => setShowFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {showsLoading ? (
            <div className="flex flex-col gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-40 rounded-2xl bg-secondary/30 animate-pulse" />
              ))}
            </div>
          ) : filteredShows.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl">
              <p>{hasShowCriteria ? "No shows match your search and filters." : "You aren't tracking any shows yet."}</p>
              {hasShowCriteria ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-clear-show-filters"
                  className="mt-4 rounded-full"
                  onClick={() => {
                    setShowSearch("");
                    setShowFilter("all");
                  }}
                >
                  Clear search and filters
                </Button>
              ) : (
                <Link href="/browse"><Button variant="outline" className="mt-4 rounded-full">Find Shows</Button></Link>
              )}
              {useMergedInProgress && inProgressQuery.isError && (
                <p role="alert" className="mt-3">
                  Could not load in-progress shows. <Button variant="link" onClick={() => inProgressQuery.refetch()}>Retry</Button>
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {useMergedInProgress && (
                <>
                  <p className="text-sm text-muted-foreground">In-progress shows appear first, including titles beyond your loaded pages.</p>
                  {inProgressQuery.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      Could not load all in-progress shows. <Button variant="link" onClick={() => inProgressQuery.refetch()}>Retry</Button>
                    </p>
                  )}
                </>
              )}
              {filteredShows.map(show => {
                const progress = Math.round((show.watchedEpisodes / show.totalEpisodes) * 100) || 0;
                return (
                  <div key={show.title.id} className="flex flex-col sm:flex-row bg-card border border-border rounded-2xl overflow-hidden shadow-sm hover-elevate transition-all">
                    <Link href={`/title/${show.title.id}`} className="w-full sm:w-32 aspect-[2/3] sm:aspect-auto flex-shrink-0 bg-secondary">
                      {show.title.posterUrl && <OptimizedImage src={show.title.posterUrl} alt={show.title.name} className="w-full h-full object-cover" width={256} height={384} />}
                    </Link>
                    <div className="flex-1 p-6 flex flex-col justify-between gap-4">
                      <div>
                        <Link href={`/title/${show.title.id}`} className="font-display font-bold text-xl hover:text-primary transition-colors">{show.title.name}</Link>
                        <div className="flex items-center gap-4 mt-4">
                          <Progress value={progress} className="h-2 flex-1 bg-secondary" />
                          <span className="text-sm font-bold text-muted-foreground whitespace-nowrap">{show.watchedEpisodes} / {show.totalEpisodes}</span>
                        </div>
                      </div>
                      
                      {show.nextEpisode ? (
                        <div className="bg-secondary/30 rounded-xl p-4 flex items-center justify-between gap-4">
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Up Next</span>
                            <span className="font-semibold text-sm truncate">S{show.nextEpisode.seasonNumber} E{show.nextEpisode.episodeNumber} • {show.nextEpisode.name}</span>
                          </div>
                          <Button 
                            size="sm"
                            className="flex-shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                            disabled={markWatched.isPending}
                            onClick={() => handleMarkWatched(show.nextEpisode!.id)}
                          >
                            <Check className="w-4 h-4 mr-1" /> Watched
                          </Button>
                        </div>
                      ) : (
                        <div className="bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 rounded-xl p-4 flex items-center gap-2 font-medium text-sm">
                          <Check className="w-5 h-5" /> All caught up!
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
               {useMergedInProgress && inProgressQuery.hasNextPage && (
                 <Button
                   variant="outline"
                   className="self-center rounded-full px-8"
                   disabled={inProgressQuery.isFetchingNextPage}
                   onClick={() => inProgressQuery.fetchNextPage()}
                 >
                   {inProgressQuery.isFetchingNextPage ? "Loading more…" : "Load more in-progress shows"}
                 </Button>
               )}
              {showsQuery.hasNextPage && (
                <Button
                  variant="outline"
                  className="self-center rounded-full px-8"
                  disabled={showsQuery.isFetchingNextPage}
                  onClick={() => showsQuery.fetchNextPage()}
                >
                  {showsQuery.isFetchingNextPage ? "Loading more…" : showFilter === "all" ? "Load more shows" : `Load more ${showFilter === "up-next" ? "up-next" : "caught-up"} shows`}
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="movies" className="mt-0 outline-none">
          {moviesLoading ? (
             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-xl bg-secondary/30 animate-pulse" />
              ))}
            </div>
          ) : movies.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl">
              <p>You haven't marked any movies as watched.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {movies.map((movie) => (
                  <PosterCard key={movie.id} title={movie} />
                ))}
              </div>
              {moviesQuery.hasNextPage && (
                <Button
                  variant="outline"
                  className="self-center rounded-full px-8"
                  disabled={moviesQuery.isFetchingNextPage}
                  onClick={() => moviesQuery.fetchNextPage()}
                >
                  {moviesQuery.isFetchingNextPage ? "Loading more…" : "Load more movies"}
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-0 outline-none">
           {historyLoading ? (
            <div className="flex items-center justify-center py-20"><div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>
          ) : history?.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground border-2 border-dashed border-border rounded-3xl">
              <p>No recent activity.</p>
            </div>
          ) : (
            <div className="relative border-l-2 border-secondary ml-4 sm:ml-8 pl-6 sm:pl-10 py-4 flex flex-col gap-10">
              {history?.map((item, idx) => (
                <div key={idx} className="relative">
                  <div className="absolute -left-[31px] sm:-left-[47px] top-1 w-4 h-4 rounded-full bg-background border-2 border-primary" />
                  <div className="flex gap-4 items-start">
                    <Link href={`/title/${item.titleId}`} className="w-16 sm:w-24 aspect-[2/3] flex-shrink-0 rounded-lg overflow-hidden bg-secondary shadow-sm">
                      {item.posterUrl && <OptimizedImage src={item.posterUrl} alt={item.titleName} className="w-full h-full object-cover" width={192} height={288} />}
                    </Link>
                    <div className="flex flex-col py-1">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {new Date(item.watchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <Link href={`/title/${item.titleId}`} className="font-display font-bold text-lg hover:text-primary transition-colors">{item.titleName}</Link>
                      {item.kind === 'episode' && item.episodeLabel && (
                        <span className="text-sm font-medium text-foreground mt-1">{item.episodeLabel}</span>
                      )}
                      <span className="text-xs text-muted-foreground mt-1 bg-secondary/50 self-start px-2 py-0.5 rounded capitalize">{item.kind}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
