import { lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";

import { PublicNavbar } from "@/components/layout/PublicNavbar";
import { queryClient } from "@/lib/query-client";
import LandingPage from "@/pages/landing";

const AuthenticatedApp = lazy(() => import("@/authenticated-app"));
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function hasSessionHint(): boolean {
  return (
    document.cookie.split(";").some((cookie) => cookie.trim().startsWith("__session=")) ||
    window.localStorage.getItem("watchtime.devDemoActive") === "1"
  );
}

function PublicLanding() {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-background">
      <PublicNavbar />
      <main className="flex w-full flex-1 flex-col">
        <LandingPage />
      </main>
    </div>
  );
}

function AppRouter() {
  const [location] = useLocation();
  const needsAuth = location !== "/" || hasSessionHint();

  if (!needsAuth) {
    return (
      <Switch>
        <Route path="/" component={PublicLanding} />
      </Switch>
    );
  }

  return (
    <Suspense fallback={location === "/" ? <PublicLanding /> : null}>
      <AuthenticatedApp />
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={basePath}>
        <AppRouter />
      </WouterRouter>
    </QueryClientProvider>
  );
}