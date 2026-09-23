import { Link } from "wouter";
import { Menu, Popcorn, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function PublicNavbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="group flex items-center gap-2">
            <div className="rounded-lg bg-primary p-1.5 text-primary-foreground transition-transform duration-200 group-hover:scale-105">
              <Popcorn className="h-5 w-5" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-foreground">WatchTime</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <Link href="/browse" className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground">
              Browse
            </Link>
            <Link href="/stats" className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground">
              Stats
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/browse" className="hidden rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground sm:flex">
            <Search className="h-5 w-5" />
          </Link>
          <div className="hidden items-center gap-2 sm:flex">
            <Link href="/sign-in" className="px-3 py-2 text-sm font-medium text-foreground transition-colors hover:text-primary">
              Sign In
            </Link>
            <Link href="/sign-up">
              <Button size="sm" className="rounded-full shadow-sm">Get Started</Button>
            </Link>
          </div>
          <div className="flex md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open navigation">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] border-l border-border bg-background p-6">
                <div className="flex h-full flex-col gap-3 pt-8">
                  <Link href="/browse"><Button variant="ghost" className="w-full justify-start">Browse</Button></Link>
                  <Link href="/stats"><Button variant="ghost" className="w-full justify-start">Stats</Button></Link>
                  <div className="mt-auto flex flex-col gap-3">
                    <Link href="/sign-in"><Button variant="outline" className="w-full">Sign In</Button></Link>
                    <Link href="/sign-up"><Button className="w-full">Get Started</Button></Link>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}