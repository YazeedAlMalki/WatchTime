import React from "react";
import { useGetMyWatchlist, useRemoveFromWatchlist } from "@workspace/api-client-react";
import { PosterCard } from "@/components/ui/poster-card";
import { Bookmark, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function WatchlistPage() {
  const { data: watchlist, isLoading } = useGetMyWatchlist();
  const removeWatchlist = useRemoveFromWatchlist();
  const queryClient = useQueryClient();

  const handleRemove = (id: number) => {
    removeWatchlist.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/me/watchlist"] })
    });
  };

  return (
    <div className="container mx-auto px-4 sm:px-8 py-8 min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
          <Bookmark className="w-8 h-8 text-primary" /> My Watchlist
        </h1>
        <p className="text-muted-foreground mt-2">Titles you've saved to watch later.</p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-xl bg-secondary/30 animate-pulse" />
          ))}
        </div>
      ) : watchlist?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center text-muted-foreground bg-card border border-border rounded-2xl shadow-sm">
          <Bookmark className="w-12 h-12 mb-4 opacity-20" />
          <h3 className="text-xl font-display font-medium text-foreground mb-2">Your watchlist is empty</h3>
          <p className="mb-6">Save shows and movies you want to keep track of.</p>
          <Link href="/browse">
            <Button className="rounded-full shadow-sm">Explore Catalog</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {watchlist?.map((title) => (
            <PosterCard 
              key={title.id} 
              title={{...title, inWatchlist: true}} 
              onWatchlistToggle={handleRemove} 
            />
          ))}
        </div>
      )}
    </div>
  );
}
