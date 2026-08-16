import React from "react";
import { useGetPublicStats } from "@workspace/api-client-react";
import { PosterCard } from "@/components/ui/poster-card";
import { BarChart3, Users, Play, ShieldAlert, Film, Tv } from "lucide-react";

export default function StatsPage() {
  const { data: stats, isLoading } = useGetPublicStats();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>;
  }

  if (!stats) return null;

  const statCards = [
    { label: "Registered Users", value: stats.registeredUsers.toLocaleString(), icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Titles Tracked", value: stats.titlesTracked.toLocaleString(), icon: BookmarkIcon, color: "text-purple-500", bg: "bg-purple-500/10" },
    { label: "Episodes Watched", value: stats.episodesWatched.toLocaleString(), icon: Tv, color: "text-orange-500", bg: "bg-orange-500/10" },
    { label: "Movies Watched", value: stats.moviesWatched.toLocaleString(), icon: Film, color: "text-green-500", bg: "bg-green-500/10" },
  ];

  return (
    <div className="container mx-auto px-4 sm:px-8 py-12 flex flex-col gap-16 min-h-screen">
      <header className="text-center max-w-2xl mx-auto">
        <h1 className="text-4xl font-display font-bold text-foreground mb-4">WatchTime Stats</h1>
        <p className="text-lg text-muted-foreground">The community's watching habits at a glance.</p>
      </header>

      {/* Global Counters */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((s, i) => (
          <div key={i} className="bg-card border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${s.bg} ${s.color}`}>
              <s.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-3xl font-display font-bold text-foreground">{s.value}</p>
              <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Most Safety Checked */}
      <section className="bg-primary/5 border border-primary/10 rounded-3xl p-8 sm:p-12">
        <div className="flex items-center gap-3 mb-8">
          <ShieldAlert className="w-8 h-8 text-primary" />
          <h2 className="text-2xl font-display font-bold text-foreground">Most Safety-Checked Titles</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {stats.mostSafetyChecked.map(title => (
            <PosterCard key={title.id} title={title} />
          ))}
        </div>
      </section>

      {/* Trending Breakdowns */}
      <section className="flex flex-col gap-12">
        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-6 flex items-center gap-2">
            <Tv className="w-6 h-6 text-muted-foreground" /> Top TV Shows
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {stats.trendingTv.map(title => <PosterCard key={title.id} title={title} />)}
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-6 flex items-center gap-2">
            <Film className="w-6 h-6 text-muted-foreground" /> Top Movies
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {stats.trendingMovies.map(title => <PosterCard key={title.id} title={title} />)}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-6">Top Anime</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
              {stats.trendingAnime.map(title => <PosterCard key={title.id} title={title} />)}
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-6">Top Documentaries</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
              {stats.trendingDocumentaries.map(title => <PosterCard key={title.id} title={title} />)}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// Simple icon for tracked
function BookmarkIcon(props: any) {
  return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>;
}
