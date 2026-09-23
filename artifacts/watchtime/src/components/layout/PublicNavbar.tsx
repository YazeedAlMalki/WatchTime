import { useRef, useState } from "react";
import { Link } from "wouter";
import { Menu, Popcorn, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PublicNavbar() {
  const menuRef = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function openMenu() {
    menuRef.current?.showModal();
    setMenuOpen(true);
  }

  function closeMenu() {
    menuRef.current?.close();
  }

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
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls="public-navigation"
              onClick={openMenu}
              data-testid="button-open-public-navigation"
            >
              <Menu className="h-6 w-6" />
            </Button>
            <dialog
              ref={menuRef}
              id="public-navigation"
              aria-labelledby="public-navigation-title"
              onClose={() => setMenuOpen(false)}
              onClick={(event) => {
                if (event.target === menuRef.current || (event.target as HTMLElement).closest("a")) {
                  closeMenu();
                }
              }}
              className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[280px] max-w-full border-l border-border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/80"
            >
              <h2 id="public-navigation-title" className="sr-only">Navigation</h2>
              <div className="flex h-full flex-col gap-3">
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={closeMenu}
                  autoFocus
                  data-testid="button-close-public-navigation"
                  className="mb-4 ml-auto rounded-sm p-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
                <Link href="/browse" className="rounded-md px-4 py-2 text-sm font-medium hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="link-public-browse">Browse</Link>
                <Link href="/stats" className="rounded-md px-4 py-2 text-sm font-medium hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="link-public-stats">Stats</Link>
                <div className="mt-auto flex flex-col gap-3">
                  <Link href="/sign-in" className="rounded-md border px-4 py-2 text-center text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="link-public-sign-in">Sign In</Link>
                  <Link href="/sign-up" className="rounded-md border border-primary-border bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="link-public-sign-up">Get Started</Link>
                </div>
              </div>
            </dialog>
          </div>
        </div>
      </div>
    </nav>
  );
}