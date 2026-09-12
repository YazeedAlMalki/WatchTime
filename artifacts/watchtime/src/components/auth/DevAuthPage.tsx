import { FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, KeyRound, ShieldAlert } from "lucide-react";
import {
  DEV_DEMO_EMAIL,
  DEV_DEMO_PASSWORD,
  getDevAuthDestination,
  isValidDevDemoCredentials,
} from "@workspace/dev-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthMode = "sign-in" | "sign-up";

function getReturnTo(): string | undefined {
  return new URLSearchParams(window.location.search).get("returnTo") ?? undefined;
}

export function DevAuthPage({ mode }: { mode: AuthMode }) {
  const [, setLocation] = useLocation();
  const returnTo = getReturnTo();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const isSignIn = mode === "sign-in";
  const alternateMode = isSignIn ? "sign-up" : "sign-in";
  const alternateHref = returnTo
    ? `/${alternateMode}?returnTo=${encodeURIComponent(returnTo)}`
    : `/${alternateMode}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidDevDemoCredentials(email, password)) {
      setError("That demo email or password is incorrect. Use the credentials shown above.");
      return;
    }

    setError("");
    setLocation(getDevAuthDestination(returnTo));
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl sm:p-8">
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-primary">Development demo login</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This is not production authentication. No real account is created, and
            these credentials do not unlock protected API data.
          </p>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {isSignIn ? "Welcome back" : "Try the demo"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSignIn ? "Use the shared development credentials." : "No sign-up or email verification is needed."}
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-background/60 p-4 text-sm">
        <p className="mb-2 font-semibold text-foreground">Demo credentials</p>
        <p className="text-muted-foreground">
          Email: <code className="text-foreground">{DEV_DEMO_EMAIL}</code>
        </p>
        <p className="mt-1 text-muted-foreground">
          Password: <code className="text-foreground">{DEV_DEMO_PASSWORD}</code>
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="dev-auth-email">Email</Label>
          <Input
            id="dev-auth-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="demo@watchtime.local"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dev-auth-password">Password</Label>
          <Input
            id="dev-auth-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="watchtime-demo"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full rounded-full" disabled={!email || !password}>
          {isSignIn ? "Enter demo" : "Start demo"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignIn ? "Need the demo entry point?" : "Already have the demo credentials?"}{" "}
        <Link href={alternateHref} className="font-semibold text-primary hover:text-primary/90">
          {isSignIn ? "Use sign up" : "Use sign in"}
        </Link>
      </p>
    </div>
  );
}