import React from "react";
import { Link } from "wouter";
import { Title } from "@workspace/api-client-react";
import { Play, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PosterCardProps {
  title: Title;
  onWatchlistToggle?: (id: number) => void;
  onWatchedToggle?: (id: number) => void;
}

export function PosterCard({ title, onWatchlistToggle, onWatchedToggle }: PosterCardProps) {
  return (
    <div className="group relative flex flex-col gap-3 w-full">
      <Link href={`/title/${title.id}`} className="block relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-secondary shadow-sm transition-all duration-300 group-hover:shadow-md group-hover:-translate-y-1">
        {title.posterUrl ? (
          <img
            src={title.posterUrl}
            alt={title.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
            <span className="font-display font-semibold text-lg">{title.name}</span>
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
          <div className="flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
            {onWatchlistToggle && (
              <Button
                size="icon"
                variant="secondary"
                className={`w-9 h-9 rounded-full ${title.inWatchlist ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm"}`}
                onClick={(e) => {
                  e.preventDefault();
                  onWatchlistToggle(title.id);
                }}
              >
                {title.inWatchlist ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              </Button>
            )}
            {onWatchedToggle && (
              <Button
                size="icon"
                variant="secondary"
                className={`w-9 h-9 rounded-full ${title.watched ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm"}`}
                onClick={(e) => {
                  e.preventDefault();
                  onWatchedToggle(title.id);
                }}
              >
                {title.watched ? <Check className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>

        {/* Badges */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {title.type && (
            <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-black/60 text-white backdrop-blur-md rounded-md shadow-sm">
              {title.type}
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-col gap-0.5 px-1">
        <Link href={`/title/${title.id}`} className="font-display font-semibold text-foreground truncate hover:text-primary transition-colors">
          {title.name}
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
          {title.year && <span>{title.year}</span>}
          {title.year && title.genres?.length > 0 && <span>•</span>}
          {title.genres && title.genres.length > 0 && (
            <span className="truncate">{title.genres[0]}</span>
          )}
        </div>
      </div>
    </div>
  );
}
