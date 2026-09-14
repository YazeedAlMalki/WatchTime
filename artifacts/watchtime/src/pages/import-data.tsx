import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadImportReport,
  getGetImportQueryKey,
  getGetMeQueryKey,
  getGetMyMoviesQueryKey,
  getGetMyRecommendationsQueryKey,
  getGetMyRecentActivityQueryKey,
  getGetMyShowsQueryKey,
  getGetMyWatchlistQueryKey,
  type ImportItem,
  type ImportJob,
  useConfirmImport,
  useCreateImport,
  useGetImport,
  useResolveImportItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { Link, useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Download,
  Loader2,
  LockKeyhole,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImportUpload } from "@/components/imports/import-upload";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ImportSource,
  type PreviewFilter,
  classifications,
  classificationClass,
  classificationLabel,
  currentSummary,
  downloadText,
  errorMessage,
  importIdFromSearch,
  importedTitle,
  kindLabel,
  matchName,
} from "@/components/imports/import-utils";

const importPreviewKeyPrefix = getGetImportQueryKey(0)[0].slice(0, -1);

function userImportQueryKey(importId: number, userId: string) {
  return [...getGetImportQueryKey(importId), userId] as const;
}

export default function ImportDataPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const importId = importIdFromSearch(search);
  const { isLoaded, isSignedIn, user } = useUser();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);
  const authenticatedUserId = isLoaded && isSignedIn ? user?.id ?? null : null;
  const authenticatedUserIdRef = useRef<string | null>(authenticatedUserId);
  authenticatedUserIdRef.current = authenticatedUserId;
  const importQuery = useGetImport(importId ?? 0, {
    query: {
      queryKey: userImportQueryKey(importId ?? 0, authenticatedUserId ?? "anonymous"),
      enabled: authenticatedUserId !== null && importId !== null,
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  const createImport = useCreateImport({ mutation: { mutationKey: ["createImport", authenticatedUserId] } });
  const resolveItem = useResolveImportItem({ mutation: { mutationKey: ["resolveImportItem", authenticatedUserId] } });
  const confirmImport = useConfirmImport({ mutation: { mutationKey: ["confirmImport", authenticatedUserId] } });

  const [source, setSource] = useState<ImportSource>("trakt");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [jobOwnerId, setJobOwnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PreviewFilter>("attention");
  const [resolvingItemId, setResolvingItemId] = useState<number | null>(null);
  const [downloadingReport, setDownloadingReport] = useState(false);

  useEffect(() => {
    if (authenticatedUserId && importQuery.data) {
      setJob(importQuery.data);
      setJobOwnerId(authenticatedUserId);
    }
  }, [authenticatedUserId, importQuery.data]);

  useEffect(() => {
    const purgeImportPreviews = () => {
      queryClient.removeQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith(importPreviewKeyPrefix),
      });
    };

    if (!authenticatedUserId) {
      setJob(null);
      setJobOwnerId(null);
      purgeImportPreviews();
      previousUserId.current = null;
      return;
    }
    if (previousUserId.current && previousUserId.current !== authenticatedUserId) {
      setJob(null);
      setJobOwnerId(null);
      purgeImportPreviews();
    }
    previousUserId.current = authenticatedUserId;
  }, [authenticatedUserId, queryClient]);

  const activeJob =
    authenticatedUserId && jobOwnerId === authenticatedUserId && job?.id === importId
      ? job
      : null;
  const summary = useMemo(() => (activeJob ? currentSummary(activeJob.items) : null), [activeJob]);
  const selectedCount = useMemo(
    () => activeJob?.items.filter((item) => item.classification === "matched" && item.selected).length ?? 0,
    [activeJob],
  );
  const completionCounts = useMemo(
    () => ({
      selected: activeJob?.summary.selected ?? 0,
      applied: activeJob?.summary.applied ?? 0,
      duplicates: activeJob?.summary.duplicates ?? 0,
      skipped: activeJob?.summary.skipped ?? 0,
    }),
    [activeJob],
  );
  const visibleItems = useMemo(() => {
    if (!activeJob) return [];
    switch (filter) {
      case "attention":
        return activeJob.items.filter((item) => item.classification === "ambiguous");
      case "selected":
        return activeJob.items.filter((item) => item.selected);
      case "skipped":
        return activeJob.items.filter((item) => !item.selected);
      default:
        return activeJob.items;
    }
  }, [activeJob, filter]);

  const updateItem = (updated: ImportItem) => {
    setJob((current) =>
      current
        ? { ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) }
        : current,
    );
    if (activeJob && authenticatedUserId) {
      queryClient.setQueryData<ImportJob>(userImportQueryKey(activeJob.id, authenticatedUserId), (current) =>
        current
          ? { ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) }
          : current,
      );
    }
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;

    setError(null);
    const fileName = file.name.trim();
    const lowerName = fileName.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".json")) {
      setError("Choose a .csv or .json export. ZIP archives and other proprietary archive formats are not supported.");
      return;
    }
    if (source === "trakt" && !lowerName.endsWith(".json")) {
      setError("Trakt imports require an individual JSON export object. Extract it locally rather than uploading a CSV or ZIP.");
      return;
    }
    if (source === "letterboxd" && !lowerName.endsWith(".csv")) {
      setError("Letterboxd imports require a compatible CSV file. Extract the CSV locally rather than uploading a JSON or ZIP archive.");
      return;
    }
    if (source === "letterboxd" && (lowerName.includes("ratings") || lowerName.includes("reviews"))) {
      setError("Ratings and reviews files are not watch history. Choose a watched, diary, or watchlist CSV instead.");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError("This file is larger than 2 MiB. Export a smaller history and try again.");
      return;
    }

    try {
      const content = await file.text();
      if (new TextEncoder().encode(content).byteLength > MAX_IMPORT_BYTES) {
        setError("This file is larger than 2 MiB after text encoding. Export a smaller history and try again.");
        return;
      }
      if (lowerName.endsWith(".json")) {
        try {
          const parsed = JSON.parse(content) as unknown;
          const rows = Array.isArray(parsed)
            ? parsed.length
            : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown[] }).items)
              ? (parsed as { items: unknown[] }).items.length
              : null;
          if (rows !== null && rows > MAX_IMPORT_ROWS) {
            setError("This export contains more than 5,000 rows. Export a smaller history and try again.");
            return;
          }
        } catch {
          // The server gives the canonical malformed-file error, without retaining the file text.
        }
      }

      setSelectedFileName(fileName);
      createImport.mutate(
        { data: { source, fileName, content } },
        {
          onSuccess: (createdJob) => {
            if (!authenticatedUserId || authenticatedUserIdRef.current !== authenticatedUserId) return;
            setJob(createdJob);
            setJobOwnerId(authenticatedUserId);
            queryClient.setQueryData(userImportQueryKey(createdJob.id, authenticatedUserId), createdJob);
            setFilter(createdJob.items.some((item) => item.classification === "ambiguous") ? "attention" : "all");
            setLocation(`/import-data?import=${createdJob.id}`);
          },
          onError: (mutationError) => setError(errorMessage(mutationError)),
        },
      );
    } catch {
      setError("We could not read this file. Please choose a UTF-8 CSV or JSON export.");
    }
  };

  const resolve = (item: ImportItem, resolution: { titleId: number } | { skip: true }) => {
    if (!activeJob || !authenticatedUserId) return;
    setError(null);
    setResolvingItemId(item.id);
    resolveItem.mutate(
      { id: activeJob.id, itemId: item.id, data: resolution },
      {
        onSuccess: (updatedItem) => {
          if (authenticatedUserIdRef.current === authenticatedUserId) updateItem(updatedItem);
        },
        onError: (mutationError) => setError(errorMessage(mutationError)),
        onSettled: () => setResolvingItemId(null),
      },
    );
  };

  const invalidateImportedData = () => {
    [
      getGetMeQueryKey(),
      getGetMyShowsQueryKey(),
      getGetMyMoviesQueryKey(),
      getGetMyRecentActivityQueryKey(),
      getGetMyWatchlistQueryKey(),
      getGetMyRecommendationsQueryKey(),
    ].forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
  };

  const confirm = () => {
    if (!activeJob || !authenticatedUserId) return;
    setError(null);
    confirmImport.mutate(
      { id: activeJob.id },
      {
        onSuccess: (confirmedJob) => {
          if (authenticatedUserIdRef.current !== authenticatedUserId) return;
          setJob(confirmedJob);
          setJobOwnerId(authenticatedUserId);
          queryClient.setQueryData(userImportQueryKey(confirmedJob.id, authenticatedUserId), confirmedJob);
          invalidateImportedData();
        },
        onError: (mutationError) => setError(errorMessage(mutationError)),
      },
    );
  };

  const downloadReport = async () => {
    const requestingUserId = authenticatedUserId;
    if (!activeJob || !requestingUserId) return;
    setError(null);
    setDownloadingReport(true);
    try {
      const report = await downloadImportReport(activeJob.id);
      if (authenticatedUserIdRef.current !== requestingUserId) return;
      downloadText(report, `watchtime-import-${activeJob.id}-report.csv`, "text/csv;charset=utf-8");
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    } finally {
      setDownloadingReport(false);
    }
  };

  if (!isLoaded) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isSignedIn) {
    return (
      <div className="container mx-auto flex min-h-screen max-w-xl items-center px-4 py-12">
        <section className="w-full rounded-3xl border border-border bg-card p-8 text-center shadow-lg">
          <LockKeyhole className="mx-auto mb-4 h-10 w-10 text-primary" />
          <h1 className="text-3xl font-bold">Import your watch history</h1>
          <p className="mt-3 text-muted-foreground">Sign in to keep your import private and preview every match before anything is added.</p>
          <Link href="/sign-in"><Button className="mt-6 rounded-full">Sign in to import</Button></Link>
        </section>
      </div>
    );
  }

  const isComplete = activeJob?.status === "confirmed";
  const isReady = activeJob?.status === "ready";
  return (
    <div className="container mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/profile" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
            <ChevronLeft className="h-4 w-4" /> Profile
          </Link>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary"><Upload className="h-7 w-7" /></div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Import data</h1>
              <p className="mt-1 text-muted-foreground">Bring your viewing history with you. Nothing changes until you confirm.</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Private import</span>
          <span className="mx-2 text-border">•</span>
          CSV or JSON only
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Import needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {importQuery.isError && importId && !activeJob && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>We couldn't open this import</AlertTitle>
          <AlertDescription>{errorMessage(importQuery.error)} It may no longer be available.</AlertDescription>
        </Alert>
      )}

      {!activeJob && (
        <ImportUpload
          source={source}
          onSourceChange={setSource}
          onFile={handleFile}
          isSubmitting={createImport.isPending}
          selectedFileName={selectedFileName}
        />
      )}

      {activeJob && isComplete && (
        <section className="rounded-3xl border border-emerald-500/25 bg-emerald-500/5 p-6 shadow-sm sm:p-10">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <div className="rounded-full bg-emerald-500/15 p-4 text-emerald-300"><CheckCircle2 className="h-10 w-10" /></div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">Import complete</p>
              <h2 className="mt-2 text-3xl font-bold">Your selected history is now in WatchTime.</h2>
              <p className="mt-2 text-muted-foreground">{completionCounts.applied} record{completionCounts.applied === 1 ? "" : "s"} added from {activeJob.fileName}. Existing activity was left untouched.</p>
            </div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-emerald-500/15 bg-background/50 p-3">
              <p className="text-2xl font-display font-bold text-emerald-300">{completionCounts.applied}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Added</p>
            </div>
            <div className="rounded-xl border border-border bg-background/50 p-3">
              <p className="text-2xl font-display font-bold">{completionCounts.duplicates}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Already existed</p>
            </div>
            <div className="rounded-xl border border-border bg-background/50 p-3">
              <p className="text-2xl font-display font-bold">{completionCounts.skipped}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Skipped</p>
            </div>
            <div className="rounded-xl border border-border bg-background/50 p-3">
              <p className="text-2xl font-display font-bold">{completionCounts.selected}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Selected</p>
            </div>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <Link href="/my-shows"><Button className="w-full rounded-xl"><Sparkles className="h-4 w-4" /> View My Tracking</Button></Link>
            <Link href="/watchlist"><Button variant="outline" className="w-full rounded-xl">View Watchlist</Button></Link>
            <Button variant="outline" className="w-full rounded-xl" disabled={downloadingReport} onClick={() => void downloadReport()}>
              {downloadingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download skipped/error report
            </Button>
          </div>
        </section>
      )}

      {activeJob && !isComplete && (
        <div className="space-y-6">
          <section className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Step 3 of 3</p>
                <h2 className="mt-2 text-2xl font-bold">Review your import</h2>
                <p className="mt-2 text-sm text-muted-foreground"><span className="font-medium text-foreground">{activeJob.fileName}</span> · {activeJob.rowCount} source row{activeJob.rowCount === 1 ? "" : "s"} · confirm only after reviewing matches.</p>
              </div>
              <Badge className="self-start rounded-full border-primary/30 bg-primary/10 px-3 py-1 text-primary" variant="outline">{activeJob.status === "confirming" ? "Confirming…" : "Preview ready"}</Badge>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {classifications.map((classification) => (
                <div key={classification} className="rounded-xl border border-border bg-background p-3">
                  <p className="text-2xl font-display font-bold">{summary?.[classification] ?? 0}</p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{classificationLabel(classification)}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedCount} selected match{selectedCount === 1 ? "" : "es"}</span> will be added. Duplicates, unresolved titles, invalid rows, and rows you skip are never written.
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="text-xl font-bold">Preview rows</h2>
                <p className="mt-1 text-sm text-muted-foreground">Resolve an offered title or leave the row skipped. We cannot create a match where one is uncertain.</p>
              </div>
              <Select value={filter} onValueChange={(value) => setFilter(value as PreviewFilter)}>
                <SelectTrigger className="w-full bg-background sm:w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="attention">Needs resolution</SelectItem>
                  <SelectItem value="all">All rows</SelectItem>
                  <SelectItem value="selected">Selected rows</SelectItem>
                  <SelectItem value="skipped">Skipped / not selected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {visibleItems.length === 0 ? (
              <div className="p-10 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />
                <h3 className="mt-3 font-display text-lg font-bold">Nothing needs resolution</h3>
                <p className="mt-1 text-sm text-muted-foreground">Use “All rows” if you want to inspect every parsed row.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {visibleItems.map((item) => {
                  const isResolving = resolvingItemId === item.id;
                  const isAmbiguous = item.classification === "ambiguous";
                  const matchedName = matchName(item);
                  return (
                    <article key={item.id} className="p-5 sm:px-6">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-muted-foreground">ROW {item.rowNumber}</span>
                            <Badge variant="outline" className={`rounded-full border px-2 py-0.5 capitalize ${classificationClass(item.classification)}`}>{classificationLabel(item.classification)}</Badge>
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{kindLabel(item)}</span>
                          </div>
                          <h3 className="mt-3 break-words font-display text-lg font-bold text-foreground">{importedTitle(item)}</h3>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            {item.normalized.year && <span>{item.normalized.year}</span>}
                            {item.normalized.imdbId && <span>IMDb {item.normalized.imdbId}</span>}
                            {item.normalized.tmdbId && <span>TMDB {item.normalized.tmdbId}</span>}
                            {item.normalized.watchedAt && <span>Watched {new Date(item.normalized.watchedAt).toLocaleDateString()}</span>}
                          </div>
                          {matchedName && <p className="mt-3 text-sm text-emerald-300">Matched to <span className="font-semibold">{matchedName}</span></p>}
                          {item.errorCode && item.classification !== "duplicate" && <p className="mt-3 text-sm text-muted-foreground">Reason: {item.errorCode.replace(/_/g, " ")}</p>}
                        </div>

                        <div className="min-w-56 lg:max-w-sm">
                          {isAmbiguous && item.candidates.length > 0 ? (
                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-amber-200">Choose a match</p>
                              <div className="mt-2 space-y-2">
                                {item.candidates.map((candidate) => (
                                  <Button key={candidate.titleId} variant="outline" size="sm" className="h-auto w-full justify-start rounded-lg border-border bg-background px-3 py-2 text-left" disabled={resolvingItemId !== null} onClick={() => resolve(item, { titleId: candidate.titleId })}>
                                    <span className="truncate">{candidate.name}{candidate.year ? ` (${candidate.year})` : ""}</span>
                                  </Button>
                                ))}
                              </div>
                              <Button variant="ghost" size="sm" className="mt-2 w-full rounded-lg text-muted-foreground" disabled={resolvingItemId !== null} onClick={() => resolve(item, { skip: true })}>
                                {isResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Skip this row
                              </Button>
                            </div>
                          ) : item.classification === "matched" && item.selected ? (
                            <Button variant="outline" size="sm" className="w-full rounded-lg" disabled={resolvingItemId !== null} onClick={() => resolve(item, { skip: true })}>
                              {isResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Skip this match
                            </Button>
                          ) : item.classification === "matched" && !item.selected && item.titleId ? (
                            <Button variant="outline" size="sm" className="w-full rounded-lg" disabled={resolvingItemId !== null} onClick={() => resolve(item, { titleId: item.titleId! })}>
                              {isResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Include this match
                            </Button>
                          ) : (
                            <p className="rounded-xl bg-secondary/40 p-3 text-sm text-muted-foreground">
                              {item.classification === "duplicate" ? "Already in your WatchTime data." : "This row will remain skipped."}
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="sticky bottom-4 z-20 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-xl backdrop-blur sm:flex sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="font-display text-lg font-bold">{selectedCount} selected record{selectedCount === 1 ? "" : "s"} ready to add</p>
              <p className="text-sm text-muted-foreground">This only adds data. Existing WatchTime records are never removed or overwritten.</p>
            </div>
            <div className="mt-4 flex gap-3 sm:mt-0">
              <Button variant="outline" className="rounded-full" onClick={() => void downloadReport()} disabled={downloadingReport}>
                {downloadingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Report
              </Button>
              <Button className="rounded-full px-6" disabled={!isReady || confirmImport.isPending || selectedCount === 0} onClick={confirm}>
                {confirmImport.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : <><CheckCircle2 className="h-4 w-4" /> Confirm import</>}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}