import React from "react";
import { CheckCircle2, CircleHelp, Download, FileUp, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type ImportSource,
  downloadText,
  genericCsvTemplate,
  genericJsonTemplate,
  sources,
} from "./import-utils";

type ImportUploadProps = {
  source: ImportSource;
  onSourceChange: (source: ImportSource) => void;
  onFile: (file: File | null) => Promise<void>;
  isSubmitting: boolean;
  selectedFileName: string | null;
};

export function ImportUpload({
  source,
  onSourceChange,
  onFile,
  isSubmitting,
  selectedFileName,
}: ImportUploadProps) {
  const selectedSource = sources.find((item) => item.id === source)!;

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Step 1 of 3</p>
          <h2 className="mt-2 text-2xl font-bold">Choose your export source</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">We use IDs when available, then only accept an unambiguous title, type, and year match. We never guess a collision.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {sources.map((item) => {
            const Icon = item.icon;
            const selected = source === item.id;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => onSourceChange(item.id)}
                className={`flex min-h-28 items-start gap-4 rounded-2xl border p-5 text-left transition-colors ${
                  selected ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-background hover:border-primary/40"
                }`}
              >
                <Icon className={`mt-0.5 h-6 w-6 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                <span>
                  <span className="block font-display text-lg font-bold text-foreground">{item.name}</span>
                  <span className="mt-1 block text-sm leading-5 text-muted-foreground">{item.description}</span>
                </span>
                {selected && <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Step 2 of 3</p>
          <h2 className="mt-2 text-2xl font-bold">Upload your {selectedSource.name} file</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedSource.guidance}</p>
          <div className="mt-4 rounded-xl border border-border bg-background p-4 text-sm leading-6">
            <p className="font-semibold text-foreground">Supported shape</p>
            <p className="mt-1 text-muted-foreground">{selectedSource.acceptedShape}</p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Not accepted:</span> {selectedSource.excluded}</p>
          </div>
          <label className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${isSubmitting ? "cursor-wait border-border bg-secondary/30" : "border-border bg-background hover:border-primary/60 hover:bg-primary/5"}`}>
            {isSubmitting ? <FileUp className="h-9 w-9 animate-pulse text-primary" /> : <FileUp className="h-9 w-9 text-primary" />}
            <span className="mt-4 font-display text-lg font-bold">{isSubmitting ? "Reading your export…" : "Choose a supported file"}</span>
            <span className="mt-1 text-sm text-muted-foreground">Up to 2 MiB and 5,000 rows</span>
            <input
              type="file"
              accept={selectedSource.accept}
              className="sr-only"
              disabled={isSubmitting}
              onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {selectedFileName && <p className="mt-3 text-sm text-muted-foreground">Selected: <span className="font-medium text-foreground">{selectedFileName}</span></p>}
          <p className="mt-5 flex gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> File text is sent only to build this private preview. It is not retained in your profile or application logs.</p>
        </div>

        <aside className="rounded-3xl border border-border bg-secondary/25 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <CircleHelp className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-bold">What can be imported?</h2>
          </div>
          <ul className="mt-4 space-y-3 text-sm leading-5 text-muted-foreground">
            <li><span className="font-semibold text-foreground">Watched movies</span>, including valid watch dates.</li>
            <li><span className="font-semibold text-foreground">TV episodes</span>, when a title and exact season + episode are present.</li>
            <li><span className="font-semibold text-foreground">Tracked shows</span> and a main watchlist when they are in the export.</li>
            <li><span className="font-semibold text-foreground">Not imported:</span> ratings, reviews, comments, social graphs, tags, and custom lists.</li>
          </ul>
          <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">WatchTime does not connect to source accounts or promise support for ZIP files, full proprietary archives, or undocumented export formats.</p>
        </aside>
      </section>

      <section className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-xl font-bold">Using another source?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Map your data to our generic format, then download a clean template.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => downloadText(genericCsvTemplate, "watchtime-import-template.csv", "text/csv;charset=utf-8")}>
              <Download className="h-4 w-4" /> CSV template
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => downloadText(genericJsonTemplate, "watchtime-import-template.json", "application/json;charset=utf-8")}>
              <Download className="h-4 w-4" /> JSON template
            </Button>
          </div>
        </div>
        <p className="mt-5 rounded-xl bg-background p-4 font-mono text-xs leading-6 text-muted-foreground">CSV headers: <span className="text-foreground">kind,title,type,year,imdbId,tmdbId,season,episode,watchedAt</span></p>
      </section>
    </div>
  );
}