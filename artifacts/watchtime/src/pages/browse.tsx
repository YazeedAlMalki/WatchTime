import React, { useState, useEffect } from "react";
import { useListTitles, ListTitlesType, ListTitlesSort } from "@workspace/api-client-react";
import { PosterCard } from "@/components/ui/poster-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { trackEvent } from "@/lib/analytics";

export default function BrowsePage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const [type, setType] = useState<ListTitlesType | "all">("all");
  const [sort, setSort] = useState<ListTitlesSort>("popular");

  const { data: titles, isLoading, isSuccess } = useListTitles({
    q: debouncedSearch || undefined,
    type: type !== "all" ? type : undefined,
    sort,
    limit: 40
  });

  useEffect(() => {
    if (!isSuccess || !debouncedSearch.trim()) return;
    trackEvent("catalog_search", {
      query_length: debouncedSearch.trim().length,
      result_count: titles?.length ?? 0,
      title_type: type,
      sort,
    });
  }, [debouncedSearch, isSuccess, sort, titles?.length, type]);

  return (
    <div className="container mx-auto px-4 sm:px-8 py-8 flex flex-col gap-8 min-h-screen">
      <header className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Browse Catalog</h1>
          <p className="text-muted-foreground mt-1">Discover new shows and movies.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search titles..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card w-full"
            />
          </div>
          
          <div className="flex gap-3 w-full sm:w-auto">
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger className="w-[140px] bg-card">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="movie">Movies</SelectItem>
                <SelectItem value="tv">TV Shows</SelectItem>
                <SelectItem value="anime">Anime</SelectItem>
                <SelectItem value="documentary">Documentaries</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={(v) => setSort(v as any)}>
              <SelectTrigger className="w-[140px] bg-card">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="popular">Popular</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-xl bg-secondary/30 animate-pulse" />
          ))}
        </div>
      ) : titles?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Search className="w-12 h-12 mb-4 opacity-20" />
          <h3 className="text-xl font-display font-medium text-foreground">No titles found</h3>
          <p>Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {titles?.map((title) => (
            <PosterCard key={title.id} title={title} />
          ))}
        </div>
      )}
    </div>
  );
}
