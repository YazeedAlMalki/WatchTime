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
  useCreateSafetyContribution,
  useCreateSafetyReport,
  getGetSeasonQueryKey,
  getGetTitleSafetyQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PosterCard } from "@/components/ui/poster-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldAlert, ShieldCheck, Play, Plus, Check, Star, Users, ChevronDown, ChevronUp, AlertCircle, Bookmark, Tv, ShoppingCart, Download } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Show } from "@clerk/react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

const SEVERITY_OPTIONS = ["none", "mild", "moderate", "severe"] as const;
const REPORT_REASONS = [
  { value: "wrong_title", label: "Wrong title / mismatch" },
  { value: "incorrect_info", label: "Incorrect information" },
  { value: "outdated_info", label: "Outdated information" },
  { value: "broken_source", label: "Broken source link" },
  { value: "incorrect_episode", label: "Wrong episode level" },
  { value: "other", label: "Other" },
] as const;

export default function TitleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const titleId = parseInt(id, 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [expandedSeason, setExpandedSeason] = useState<number | undefined>(undefined);

  // Contribution dialog state
  const [showContribute, setShowContribute] = useState(false);
  const [contribCategory, setContribCategory] = useState("");
  const [contribSeverity, setContribSeverity] = useState<string>("");
  const [contribDescription, setContribDescription] = useState("");
  const [contribSeason, setContribSeason] = useState("");
  const [contribEpisode, setContribEpisode] = useState("");

  // Report dialog state
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSource, setReportSource] = useState("");
  const [reportDetails, setReportDetails] = useState("");

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
  const createContribution = useCreateSafetyContribution();
  const createReport = useCreateSafetyReport();

  const invalidateTitle = () => queryClient.invalidateQueries({ queryKey: ["/api/titles", titleId] });
  const invalidateSeason = (s: number) => queryClient.invalidateQueries({ queryKey: getGetSeasonQueryKey(titleId, s) });
  const invalidateSafety = () => queryClient.invalidateQueries({ queryKey: getGetTitleSafetyQueryKey({ titleId }) });

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

  const handleContribute = () => {
    if (!contribCategory || !contribSeverity) return;
    createContribution.mutate({
      id: titleId,
      data: {
        category: contribCategory,
        severity: contribSeverity as any,
        description: contribDescription || null,
        seasonNumber: contribSeason ? parseInt(contribSeason, 10) : null,
        episodeNumber: contribEpisode ? parseInt(contribEpisode, 10) : null,
      },
    }, {
      onSuccess: () => {
        setShowContribute(false);
        setContribCategory(""); setContribSeverity(""); setContribDescription(""); setContribSeason(""); setContribEpisode("");
        invalidateSafety();
        toast({ title: "Contribution submitted", description: "Your safety note is pending admin review. Thank you!" });
      },
      onError: (err: any) => {
        const status = err?.response?.status;
        const msg =
          status === 429 ? "You've reached the daily contribution limit. Try again tomorrow." :
          status === 403 ? "You need to watch at least 5 titles or episodes before contributing." :
          "Failed to submit. Please try again.";
        toast({ title: status === 429 ? "Too many requests" : "Could not submit", description: msg, variant: "destructive" });
      },
    });
  };

  const handleReport = () => {
    if (!reportReason) return;
    createReport.mutate({
      id: titleId,
      data: {
        reason: reportReason as any,
        sourceName: reportSource || null,
        details: reportDetails || null,
      },
    }, {
      onSuccess: () => {
        setShowReport(false);
        setReportReason(""); setReportSource(""); setReportDetails("");
        toast({ title: "Report submitted", description: "The admin team will review your report shortly." });
      },
      onError: (err: any) => {
        const is429 = err?.response?.status === 429;
        toast({
          title: is429 ? "Too many requests" : "Could not submit report",
          description: is429
            ? "You've submitted too many reports recently. Please wait before trying again."
            : "Please try again.",
          variant: "destructive",
        });
      },
    });
  };

  const streamProviders = title.providers?.filter(p => p.kind === "stream") ?? [];
  const rentProviders = title.providers?.filter(p => p.kind === "rent") ?? [];
  const buyProviders = title.providers?.filter(p => p.kind === "buy") ?? [];

  return (
    <div className="flex flex-col pb-24 bg-background">
      {/* Hero Backdrop */}
      <div className="relative w-full h-[40vh] sm:h-[60vh] md:h-[70vh] bg-secondary flex-shrink-0">
        {title.backdropUrl ? (
          <img src={title.backdropUrl} alt="" className="w-full h-full object-cover opacity-60" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-secondary via-secondary to-background" />
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

          {/* Where to Watch */}
          {title.providers && title.providers.length > 0 && (
            <div className="mt-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Where to Watch</h3>
              <div className="flex flex-col gap-3">
                {streamProviders.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      <Tv className="w-3.5 h-3.5" /> Stream
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {streamProviders.map(p => (
                        <div key={p.name} className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 rounded-lg shadow-sm">
                          {p.logoUrl && <img src={p.logoUrl} alt={p.name} className="w-5 h-5 rounded" />}
                          <span className="text-sm font-medium">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {rentProviders.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      <ShoppingCart className="w-3.5 h-3.5" /> Rent
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {rentProviders.map(p => (
                        <div key={p.name} className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 rounded-lg shadow-sm">
                          {p.logoUrl && <img src={p.logoUrl} alt={p.name} className="w-5 h-5 rounded" />}
                          <span className="text-sm font-medium">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {buyProviders.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      <Download className="w-3.5 h-3.5" /> Buy
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {buyProviders.map(p => (
                        <div key={p.name} className="flex items-center gap-2 bg-card border border-border px-3 py-1.5 rounded-lg shadow-sm">
                          {p.logoUrl && <img src={p.logoUrl} alt={p.name} className="w-5 h-5 rounded" />}
                          <span className="text-sm font-medium">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-8 mt-16 grid lg:grid-cols-[1fr_350px] gap-12">
        {/* Main Content Area */}
        <div className="flex flex-col gap-12">

          {/* Content Safety Section */}
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
                  <Button variant="outline" size="sm" className="rounded-full shadow-sm text-xs" onClick={() => setShowReport(true)}>
                    Report issue
                  </Button>
                  <Button variant="default" size="sm" className="rounded-full shadow-sm text-xs bg-primary text-primary-foreground" onClick={() => setShowContribute(true)}>
                    Contribute
                  </Button>
                </div>
              </Show>
            </div>

            {safetyLoading ? (
              <div className="h-40 flex items-center justify-center"><div className="w-6 h-6 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>
            ) : safety ? (
              <div className="flex flex-col gap-8">
                {/* Summary Chips */}
                {safety.summary.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {safety.summary.map(s => (
                      <div key={s.category} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
                        s.severity === "none" ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-900 dark:text-green-400" :
                        s.severity === "mild" ? "bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-950/30 dark:border-yellow-900 dark:text-yellow-400" :
                        s.severity === "moderate" ? "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-900 dark:text-orange-400" :
                        "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400"
                      }`}>
                        <span className="font-semibold text-sm capitalize">{s.category}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                        <span className="text-xs font-bold uppercase tracking-wider">{s.severity}</span>
                      </div>
                    ))}
                  </div>
                )}

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
                      {source.status === "provider_unavailable" ? (
                        <div className="flex flex-col gap-1 text-muted-foreground text-sm p-4 bg-secondary/30 rounded-xl">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            <span>No integration configured for this source.</span>
                          </div>
                          <span className="text-xs pl-6 text-muted-foreground/70">Data will appear here when connected.</span>
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
                      {source.url && source.status !== "provider_unavailable" && (
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

      {/* Contribute Safety Dialog */}
      <Dialog open={showContribute} onOpenChange={setShowContribute}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Contribute Safety Info</DialogTitle>
            <DialogDescription>
              Add a content-safety note for <strong>{title.name}</strong>. Your contribution is anonymous and goes to admin review before appearing publicly.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cat">Category <span className="text-destructive">*</span></Label>
              <Input id="cat" placeholder="e.g. Violence, Language, Sex, Drugs, Triggers…" value={contribCategory} onChange={e => setContribCategory(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sev">Severity <span className="text-destructive">*</span></Label>
              <Select value={contribSeverity} onValueChange={setContribSeverity}>
                <SelectTrigger id="sev"><SelectValue placeholder="Select severity" /></SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="desc">Description</Label>
              <Textarea id="desc" placeholder="Brief description of the content (optional)…" value={contribDescription} onChange={e => setContribDescription(e.target.value)} rows={3} />
            </div>
            {!isMovie && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cs">Season (optional)</Label>
                  <Input id="cs" type="number" min={1} placeholder="e.g. 2" value={contribSeason} onChange={e => setContribSeason(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ce">Episode (optional)</Label>
                  <Input id="ce" type="number" min={1} placeholder="e.g. 5" value={contribEpisode} onChange={e => setContribEpisode(e.target.value)} />
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">You must have watched ≥5 titles or episodes to contribute. Your identity is never attached to published contributions.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowContribute(false)}>Cancel</Button>
            <Button onClick={handleContribute} disabled={!contribCategory || !contribSeverity || createContribution.isPending}>
              {createContribution.isPending ? "Submitting…" : "Submit for review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Issue Dialog */}
      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report Safety Data Issue</DialogTitle>
            <DialogDescription>
              Flag incorrect, outdated, or missing safety information for <strong>{title.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rr">Reason <span className="text-destructive">*</span></Label>
              <Select value={reportReason} onValueChange={setReportReason}>
                <SelectTrigger id="rr"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {REPORT_REASONS.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rs">Source (optional)</Label>
              <Input id="rs" placeholder="e.g. Common Sense Media" value={reportSource} onChange={e => setReportSource(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rd">Details (optional)</Label>
              <Textarea id="rd" placeholder="Describe the issue…" value={reportDetails} onChange={e => setReportDetails(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReport(false)}>Cancel</Button>
            <Button onClick={handleReport} disabled={!reportReason || createReport.isPending}>
              {createReport.isPending ? "Submitting…" : "Submit report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
