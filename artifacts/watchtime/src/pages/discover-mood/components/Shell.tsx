import type { ReactNode } from "react";
import { Link } from "wouter";
import { Clapperboard, FlaskConical, Languages, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "../i18n";
import { actions, useStore } from "../store";

export function Chip({
  on,
  onClick,
  children,
  testId,
  disabled,
  ariaLabel,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  testId: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={`min-h-9 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40 ${
        on
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-card text-foreground/85 hover:bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}

export function Shell({
  current,
  children,
  heading,
  description,
}: {
  current: "discover" | "ideas";
  children: ReactNode;
  heading?: string;
  description?: string;
}) {
  const { t, lang, dir } = useT();
  const { storageError } = useStore();
  return (
    <div dir={dir} lang={lang} className="min-h-[100dvh] bg-background text-foreground" data-testid="page-discover-mood-shell">
      <header className="relative overflow-hidden border-b border-border bg-card/40">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-3 opacity-40"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, hsl(var(--background)) 0 10px, transparent 10px 22px)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
          style={{ insetInlineEnd: "-3rem" }}
        />
        <div className="container relative mx-auto px-4 pb-6 pt-8 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="flex items-center gap-1.5" aria-label={t("nav.label")}>
              <Link
                href="/discover-mood"
                data-testid="link-discover-mood"
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  current === "discover" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {t("nav.discover")}
              </Link>
              <Link
                href="/movie-ideas"
                data-testid="link-movie-ideas"
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  current === "ideas" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {t("nav.ideas")}
              </Link>
            </nav>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-full"
              data-testid="button-toggle-language"
              onClick={() => actions.setLang(lang === "en" ? "ar" : "en")}
            >
              <Languages className="h-4 w-4" aria-hidden /> {t("lang.toggle")}
            </Button>
          </div>
          <h1 className="mt-6 flex items-center gap-3 text-2xl font-bold sm:text-4xl" data-testid="text-page-title">
            <Clapperboard className="h-8 w-8 text-primary" aria-hidden />
            {heading ?? (current === "discover" ? t("title") : t("i.title"))}
            <Sparkles className="h-5 w-5 text-primary/70" aria-hidden />
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {description ?? (current === "discover" ? t("subtitle") : t("i.sub"))}
          </p>
          <div
            role="note"
            data-testid="text-demo-disclaimer"
            className="mt-5 flex max-w-3xl items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-foreground/90"
          >
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>{t("demoBanner")}</span>
          </div>
          {storageError && (
            <p
              role="alert"
              data-testid="text-storage-warning"
              className="mt-3 max-w-3xl rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100"
            >
              {t("storage.unavailable")}
            </p>
          )}
        </div>
      </header>
      <div className="container mx-auto px-4 py-8 sm:px-8">{children}</div>
    </div>
  );
}
