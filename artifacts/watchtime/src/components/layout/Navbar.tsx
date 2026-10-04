import React from "react";
import { Link, useLocation } from "wouter";
import { Show, useClerk, useUser } from "@clerk/react";
import { Popcorn, Search, LogOut, User, Menu, ChartBar, Bookmark, PlaySquare, LayoutDashboard, Sparkles, Film, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function Navbar() {
  const [location] = useLocation();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { signOut } = useClerk();
  const { user } = useUser();

  const handleSignOut = () => {
    signOut({ redirectUrl: basePath || "/" });
  };

  const navLinks = [
    { href: "/browse", label: "Browse", icon: Search },
    { href: "/trending", label: "Trending", icon: TrendingUp },
    { href: "/discover-mood", label: "Discover by Mood", icon: Sparkles },
    { href: "/movie-ideas", label: "Movie Ideas", icon: Film },
    { href: "/stats", label: "Stats" },
  ];

  const authenticatedLinks = [
    { href: "/home", label: "Dashboard", icon: LayoutDashboard },
    { href: "/my-shows", label: "My Shows", icon: PlaySquare },
    { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-lg group-hover:scale-105 transition-transform duration-200">
              <Popcorn className="w-5 h-5" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-foreground">
              WatchTime
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            <Show when="signed-in">
              {authenticatedLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    location === link.href
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </Show>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location === link.href
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/browse" className="hidden sm:flex text-muted-foreground hover:text-foreground p-2 rounded-full hover:bg-secondary/50 transition-colors">
            <Search className="w-5 h-5" />
          </Link>

          <Show when="signed-out">
            <div className="hidden sm:flex items-center gap-2">
              <Link href="/sign-in" className="text-sm font-medium text-foreground hover:text-primary transition-colors px-3 py-2">
                Sign In
              </Link>
              <Link href="/sign-up">
                <Button size="sm" className="rounded-full shadow-sm">
                  Get Started
                </Button>
              </Link>
            </div>
          </Show>

          <Show when="signed-in">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-full overflow-hidden border-2 border-transparent hover:border-primary transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={user?.imageUrl} alt={user?.fullName || "User"} />
                    <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                      {user?.firstName?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 mt-2 rounded-xl shadow-lg border-border">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium text-foreground truncate">{user?.fullName}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</p>
                </div>
                <div className="p-1">
                  <Link href="/profile">
                    <DropdownMenuItem className="cursor-pointer rounded-lg px-3 py-2">
                      <User className="mr-2 w-4 h-4 text-muted-foreground" />
                      <span>Profile</span>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/feedback">
                    <DropdownMenuItem className="cursor-pointer rounded-lg px-3 py-2">
                      <ChartBar className="mr-2 w-4 h-4 text-muted-foreground" />
                      <span>Send Feedback</span>
                    </DropdownMenuItem>
                  </Link>
                </div>
                <DropdownMenuSeparator />
                <div className="p-1">
                  <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive rounded-lg px-3 py-2">
                    <LogOut className="mr-2 w-4 h-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </Show>

          {/* Mobile Menu */}
          <div className="md:hidden flex items-center">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="text-foreground">
                  <Menu className="w-6 h-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] sm:w-[350px] p-0 border-l border-border bg-background">
                <div className="flex flex-col h-full">
                  <div className="p-6 border-b border-border">
                    <Link href="/" className="flex items-center gap-2 group">
                      <div className="bg-primary text-primary-foreground p-1.5 rounded-lg">
                        <Popcorn className="w-5 h-5" />
                      </div>
                      <span className="font-display font-bold text-xl tracking-tight text-foreground">
                        WatchTime
                      </span>
                    </Link>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1">
                    <Show when="signed-in">
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">Your App</p>
                        {authenticatedLinks.map(link => (
                          <Link
                            key={link.href}
                            href={link.href}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors ${
                              location === link.href ? "bg-secondary text-secondary-foreground" : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <link.icon className="w-5 h-5" />
                            {link.label}
                          </Link>
                        ))}
                      </div>
                    </Show>

                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">Discover</p>
                      {navLinks.map(link => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors ${
                            location === link.href ? "bg-secondary text-secondary-foreground" : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </div>

                  <Show when="signed-out">
                    <div className="p-4 border-t border-border flex flex-col gap-3">
                      <Link href="/sign-in">
                        <Button variant="outline" className="w-full justify-center">Sign In</Button>
                      </Link>
                      <Link href="/sign-up">
                        <Button className="w-full justify-center">Get Started</Button>
                      </Link>
                    </div>
                  </Show>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}
