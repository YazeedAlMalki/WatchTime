import React from "react";
import { useGetMe } from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { LogOut, Tv, Film, Clock, Mail, ShieldAlert, Upload } from "lucide-react";
import { Link } from "wouter";

export default function ProfilePage() {
  const { data: me, isLoading } = useGetMe();
  const { signOut } = useClerk();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>;
  }

  if (!me) return null;

  return (
    <div className="container mx-auto px-4 sm:px-8 py-12 max-w-4xl min-h-screen flex flex-col gap-8">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 pb-8 border-b border-border">
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-3xl font-display font-bold shadow-inner">
            {me.name ? me.name.charAt(0).toUpperCase() : me.email.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-display font-bold text-foreground">{me.name || "WatchTime User"}</h1>
            <div className="flex items-center gap-2 text-muted-foreground font-medium text-sm">
              <Mail className="w-4 h-4" /> {me.email}
            </div>
            <div className="flex gap-2 mt-2">
              {me.isAdmin && <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">Admin</span>}
              {me.canContribute && <span className="bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">Contributor</span>}
            </div>
          </div>
        </div>
        
        <Button 
          variant="outline" 
          className="text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive rounded-full"
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
        >
          <LogOut className="mr-2 w-4 h-4" /> Sign Out
        </Button>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-2 shadow-sm">
          <Tv className="w-6 h-6 text-blue-500 mb-2" />
          <span className="text-3xl font-display font-bold text-foreground">{me.showsTracked}</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Shows Tracked</span>
        </div>
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-2 shadow-sm">
          <PlayIcon className="w-6 h-6 text-orange-500 mb-2" />
          <span className="text-3xl font-display font-bold text-foreground">{me.episodesWatched}</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Episodes Watched</span>
        </div>
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-2 shadow-sm">
          <Film className="w-6 h-6 text-green-500 mb-2" />
          <span className="text-3xl font-display font-bold text-foreground">{me.moviesWatched}</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Movies Watched</span>
        </div>
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-2 shadow-sm">
          <Clock className="w-6 h-6 text-purple-500 mb-2" />
          <span className="text-3xl font-display font-bold text-foreground">{me.timeWatchedMinutes ? Math.round(me.timeWatchedMinutes / 60) : 0}</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hours Watched</span>
        </div>
      </section>

      <section className="bg-card border border-border rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">Import your watch history</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground max-w-xl">Move watched movies, episode progress, tracked shows, and your watchlist from a supported CSV or JSON export. Review every match before it is added.</p>
          </div>
        </div>
        <Link href="/import-data">
          <Button className="rounded-full shadow-sm whitespace-nowrap"><Upload className="mr-2 w-4 h-4" /> Import data</Button>
        </Link>
      </section>

      {me.isAdmin && (
        <section className="bg-primary/5 border border-primary/20 rounded-2xl p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <ShieldAlert className="w-8 h-8 text-primary" />
            <div>
              <h3 className="text-lg font-bold text-foreground font-display">Admin Controls</h3>
              <p className="text-sm text-muted-foreground">Access moderation, reports, and analytics.</p>
            </div>
          </div>
          <Link href="/admin">
            <Button className="rounded-full shadow-sm">Go to Admin Panel</Button>
          </Link>
        </section>
      )}
    </div>
  );
}

function PlayIcon(props: any) {
  return <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
}
