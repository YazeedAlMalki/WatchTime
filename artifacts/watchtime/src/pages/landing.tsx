import React, { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useGetTrendingTitles } from "@workspace/api-client-react";
import { PosterCard } from "@/components/ui/poster-card";
import { Button } from "@/components/ui/button";
import { Popcorn, ShieldCheck, TrendingUp, Search, Check } from "lucide-react";

export default function LandingPage() {
  const { data: trendingTitles, isLoading } = useGetTrendingTitles({ limit: 10 });

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative w-full overflow-hidden bg-background pt-24 pb-32">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[100px] transform translate-x-1/3 -translate-y-1/3" />
          <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-secondary/5 rounded-full blur-[80px] transform -translate-x-1/3 translate-y-1/3" />
        </div>

        <div className="container mx-auto px-4 sm:px-8 relative z-10">
          <div className="max-w-3xl mx-auto text-center flex flex-col items-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/30 text-secondary-foreground text-sm font-medium mb-8">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span>Know before you press play</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tight text-foreground leading-[1.1] mb-6">
              Track your shows. <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-amber-300">
                Protect your screen.
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl leading-relaxed">
              WatchTime helps you track every show, movie, anime, and documentary you watch — and know, before pressing play, whether it's safe for your family.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <Link href="/sign-up" className="w-full sm:w-auto">
                <Button size="lg" className="w-full rounded-full h-14 px-8 text-base shadow-md hover:shadow-lg transition-all">
                  Start Tracking for Free
                </Button>
              </Link>
              <Link href="/browse" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="w-full rounded-full h-14 px-8 text-base bg-background/50 backdrop-blur-sm border-border">
                  <Search className="mr-2 w-5 h-5" /> Browse Catalog
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Trending Section */}
      <section className="py-20 bg-card border-t border-border">
        <div className="container mx-auto px-4 sm:px-8">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-xl text-primary">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h2 className="text-3xl font-display font-bold text-foreground">Trending Now</h2>
            </div>
            <Link href="/browse">
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                View All
              </Button>
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-xl bg-secondary/30 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {trendingTitles?.slice(0, 5).map((title) => (
                <PosterCard key={title.id} title={title} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Feature Section */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 sm:px-8">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="order-2 md:order-1 relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 to-transparent rounded-3xl transform -rotate-3 scale-105" />
              <div className="bg-card border border-border rounded-3xl p-8 relative shadow-xl">
                <div className="flex flex-col gap-6">
                  <div className="flex items-center gap-4 border-b border-border pb-6">
                    <div className="w-16 h-16 rounded-2xl bg-secondary animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 bg-secondary rounded w-1/3 animate-pulse" />
                      <div className="h-4 bg-secondary rounded w-1/4 animate-pulse" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-xl">
                      <span className="text-sm font-medium text-foreground">Violence</span>
                      <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-destructive/10 text-destructive">Severe</span>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-xl">
                      <span className="text-sm font-medium text-foreground">Language</span>
                      <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-orange-500/10 text-orange-600 dark:text-orange-400">Moderate</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="order-1 md:order-2 flex flex-col gap-6">
              <h2 className="text-4xl font-display font-bold text-foreground leading-tight">
                Detailed content safety, built by the community.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Before you watch with your family, check our comprehensive safety ratings. We aggregate data from multiple trusted sources and our dedicated community to give you a clear picture of what's in every episode and movie.
              </p>
              <ul className="flex flex-col gap-4 mt-2">
                {['Episode-level safety granularity', 'Multiple trusted data sources', 'Community-verified reports'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                    <div className="bg-primary text-primary-foreground p-1 rounded-full">
                      <Check className="w-4 h-4" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-card border-t border-border mt-auto">
        <div className="container mx-auto px-4 sm:px-8 text-center flex flex-col items-center gap-6">
          <div className="flex items-center gap-2">
            <Popcorn className="w-6 h-6 text-primary" />
            <span className="font-display font-bold text-xl text-foreground">WatchTime</span>
          </div>
          <p className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} WatchTime. Built for viewers.
          </p>
        </div>
      </footer>
    </div>
  );
}
