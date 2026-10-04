import { useState, type ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useT } from "../i18n";
import { actions, useStore } from "../store";
import { AGE_RANK, CONTENT_KEYS, CONTEXTS, MOOD_KEYS, PROVIDERS, REGIONS, type AccessType, type Context, type ContentKey, type Region } from "../types";
import { Chip } from "./Shell";

function Section({
  title,
  hint,
  children,
  testId,
  initiallyOpen = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  testId: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const panelId = `${testId}-content`;
  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid={`button-toggle-${testId}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <span className="block text-base font-semibold">{title}</span>
          {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <div id={panelId} className="mt-4">{children}</div>}
    </section>
  );
}

const toggle = (values: string[], value: string) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
const OTHER_LANGUAGES = ["fr", "es", "hi", "de"];
const AGE_RATINGS = ["G", "PG", "PG-13", "R", "18", "any"];
const IMPORTANCE = [1, 2, 3] as const;
const CONTENT_OPTIONS = [0, 1, 2, 3, 4] as const;

function LimitOptions({ kind, value, onChange }: { kind: ContentKey; value: number; onChange: (v: number) => void }) {
  const { t } = useT();
  const values = CONTENT_OPTIONS;
  const optionLabel = (level: number) =>
    level === 0 ? t("content.none") :
      level === 1 ? t("content.mild") :
        level === 2 ? t("content.moderate") :
          level === 3 ? t("content.strong") : t("content.any");
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t(`content.${kind}`)}>
      {values.map((level) => (
        <Chip
          key={level}
          testId={`chip-limit-${kind}-${level}`}
          on={value === level}
          onClick={() => onChange(level)}
        >
          {optionLabel(level)}
        </Chip>
      ))}
    </div>
  );
}

export function FilterPanel() {
  const { t } = useT();
  const { filters: f } = useStore();
  const ageOptions = [...AGE_RATINGS].sort((a, b) =>
    (a === "any" ? 99 : AGE_RANK[a]) - (b === "any" ? 99 : AGE_RANK[b]),
  );

  return (
    <div className="flex flex-col gap-4" data-testid="panel-filters">
      <Section title={t("sec.moods")} hint={t("sec.moods.d")} testId="section-moods" initiallyOpen>
        <div className="flex flex-col gap-5">
          {MOOD_KEYS.map((key) => {
            const label = t(`mood.${key}`);
            return (
              <div key={key} className="rounded-xl border border-border/70 bg-background/40 p-3" data-testid={`control-mood-${key}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`slider-mood-${key}`} className="text-sm font-semibold">{label}</label>
                  <Switch
                    aria-label={t("slider.use", { label })}
                    checked={f.active[key]}
                    onCheckedChange={(on) => actions.setActive(key, on)}
                    data-testid={`switch-mood-${key}`}
                  />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-start text-[11px] leading-tight text-muted-foreground">{t(`mood.low.${key}`)}</span>
                  <span className="w-8 text-center text-xs tabular-nums text-foreground" data-testid={`text-target-${key}`}>
                    {f.active[key] ? f.targets[key] : "—"}
                  </span>
                  <span className="min-w-0 flex-1 text-end text-[11px] leading-tight text-muted-foreground">{t(`mood.high.${key}`)}</span>
                </div>
                <Slider
                  id={`slider-mood-${key}`}
                  aria-label={`${label}: ${t(`mood.low.${key}`)} to ${t(`mood.high.${key}`)}`}
                  min={0}
                  max={100}
                  step={5}
                  value={[f.targets[key]]}
                  onValueChange={([value]) => actions.setTarget(key, value)}
                  data-testid={`slider-mood-${key}`}
                />
                <div className={`mt-3 flex items-center gap-2 ${f.active[key] ? "" : "opacity-50"}`}>
                  <span className="text-xs text-muted-foreground">{t("importance.title")}</span>
                  <div className="flex flex-wrap gap-1" role="group" aria-label={t("importance.title")}>
                    {IMPORTANCE.map((importance) => (
                      <Chip
                        key={importance}
                        testId={`chip-importance-${key}-${importance}`}
                        on={f.active[key] && f.importance[key] === importance}
                        disabled={!f.active[key]}
                        onClick={() => actions.setImportance(key, importance)}
                      >
                        {t(`importance.${importance === 1 ? "nice" : importance === 2 ? "important" : "must"}`)}
                      </Chip>
                    ))}
                  </div>
                  <span className="relative inline-flex" title={t("importance.help")}>
                    <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={t("importance.help")} />
                  </span>
                </div>
              </div>
            );
          })}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => actions.resetMoods()} data-testid="button-reset-moods">
            {t("reset.moods")}
          </Button>
        </div>
      </Section>

      <Section title={t("sec.runtime")} testId="section-runtime">
        <div className="flex flex-wrap gap-2">
          <Chip testId="chip-runtime-90" on={f.maxRuntime === 89} onClick={() => actions.patchFilters({ maxRuntime: 89 })}>{t("runtime.under90")}</Chip>
          <Chip testId="chip-runtime-120" on={f.maxRuntime === 119} onClick={() => actions.patchFilters({ maxRuntime: 119 })}>{t("runtime.under120")}</Chip>
          <Chip testId="chip-runtime-any" on={f.maxRuntime === 240} onClick={() => actions.patchFilters({ maxRuntime: 240 })}>{t("runtime.any")}</Chip>
        </div>
        <div className="mt-5">
          <p className="mb-3 text-sm font-medium" data-testid="text-runtime-value">
            {f.maxRuntime === 240 ? t("runtime.any") : t("runtime.custom.value", { n: f.maxRuntime })}
          </p>
          <Slider
            aria-label={t("runtime.custom")}
            min={60}
            max={240}
            step={1}
            value={[Math.max(60, f.maxRuntime === 240 ? 120 : f.maxRuntime)]}
            onValueChange={([value]) => actions.patchFilters({ maxRuntime: value })}
            data-testid="slider-runtime"
          />
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>{t("runtime.left")}</span><span>{t("runtime.right")}</span>
          </div>
        </div>
      </Section>

      <Section title={t("sec.context")} hint={t("ctx.note")} testId="section-context">
        <div className="flex flex-wrap gap-2">
          {CONTEXTS.map((context: Context) => (
            <Chip key={context} testId={`chip-context-${context}`} on={f.context === context} onClick={() => actions.patchFilters({ context })}>
              {t(`ctx.${context}`)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title={t("sec.language")} hint={t("sec.language.d")} testId="section-language">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t("language.primary")}</p>
        <div className="flex flex-wrap gap-2">
          {["ar", "en", "ko", "ja"].map((language) => (
            <Chip key={language} testId={`chip-language-${language}`} on={f.languages.includes(language)} onClick={() => actions.patchFilters({ languages: toggle(f.languages, language) })}>
              {t(`lang.${language}`)}
            </Chip>
          ))}
          <Chip
            testId="chip-language-other"
            on={OTHER_LANGUAGES.every((language) => f.languages.includes(language))}
            onClick={() => {
              const hasOthers = OTHER_LANGUAGES.every((language) => f.languages.includes(language));
              actions.patchFilters({ languages: hasOthers ? f.languages.filter((language) => !OTHER_LANGUAGES.includes(language)) : [...new Set([...f.languages, ...OTHER_LANGUAGES])] });
            }}
          >
            {t("language.other")}
          </Chip>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            {t("accept.subs")}
            <Switch aria-label={t("accept.subs")} checked={f.acceptSubs} onCheckedChange={(value) => actions.patchFilters({ acceptSubs: value })} data-testid="switch-accept-subs" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            {t("accept.dub")}
            <Switch aria-label={t("accept.dub")} checked={f.acceptDub} onCheckedChange={(value) => actions.patchFilters({ acceptDub: value })} data-testid="switch-accept-dub" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            {t("language.arSubs")}
            <Switch aria-label={t("language.arSubs")} checked={f.requireArabicSubtitles} onCheckedChange={(value) => actions.patchFilters({ requireArabicSubtitles: value })} data-testid="switch-arabic-subs" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            {t("language.arDub")}
            <Switch aria-label={t("language.arDub")} checked={f.requireArabicDubbing} onCheckedChange={(value) => actions.patchFilters({ requireArabicDubbing: value })} data-testid="switch-arabic-dub" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            {t("language.original")}
            <Switch aria-label={t("language.original")} checked={f.originalAudioOnly} onCheckedChange={(value) => actions.patchFilters({ originalAudioOnly: value })} data-testid="switch-original-audio" />
          </label>
        </div>
      </Section>

      <Section title={t("sec.region")} hint={t("availability.region", { region: t(`region.${f.region}`) })} testId="section-region">
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((region: Region) => (
            <Chip key={region} testId={`chip-region-${region}`} on={f.region === region} onClick={() => actions.patchFilters({ region })}>
              {t(`region.${region}`)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title={t("sec.providers")} hint={t("prov.any")} testId="section-providers">
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((provider) => (
            <Chip key={provider} testId={`chip-provider-${provider}`} on={f.providers.includes(provider)} onClick={() => actions.patchFilters({ providers: toggle(f.providers, provider) })}>
              {provider}
            </Chip>
          ))}
        </div>
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("availability.types")}</p>
          <div className="flex flex-wrap gap-2">
            {(["stream", "rent", "buy"] as const).map((type: AccessType) => (
              <Chip
                key={type}
                testId={`chip-availability-${type}`}
                on={f.accessTypes.includes(type)}
                onClick={() => actions.patchFilters({ accessTypes: toggle(f.accessTypes, type) as AccessType[] })}
              >
                {t(`availability.${type === "stream" ? "subscription" : type}`)}
              </Chip>
            ))}
          <Chip
            testId="chip-availability-any"
            on={f.providers.length === 0 && f.accessTypes.length === 3}
            onClick={() => actions.patchFilters({ providers: [], accessTypes: ["stream", "rent", "buy"] })}
          >
            {t("availability.any")}
          </Chip>
          </div>
        </div>
      </Section>

      <Section title={t("sec.content")} hint={t("content.note")} testId="section-content">
        <p className="mb-4 text-xs text-muted-foreground">{t("content.help")}</p>
        <div className="flex flex-col gap-5">
          {CONTENT_KEYS.map((key) => (
            <div key={key}>
              <p className="mb-2 text-sm font-medium">{t(`content.${key}`)}</p>
              <LimitOptions kind={key} value={f.limits[key]} onChange={(value) => actions.setLimit(key, value)} />
            </div>
          ))}
          <div>
            <p className="mb-2 text-sm font-medium">{t("age.title")}</p>
            <div className="flex flex-wrap gap-2">
              {ageOptions.map((rating) => (
                <Chip
                  key={rating}
                  testId={`chip-age-${rating}`}
                  on={f.maxAgeRating === rating}
                  onClick={() => actions.patchFilters({ maxAgeRating: rating })}
                >
                  {t(`age.${rating}`)}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("sec.history")} hint={t("hist.note")} testId="section-history">
        <div className="flex flex-col gap-4">
          {([
            ["hideWatched", "hideWatched", f.hideWatched],
            ["includeHighlyRated", "hist.highly", f.includeHighlyRated],
            ["includeComfortRewatches", "hist.rewatches", f.includeComfortRewatches],
            ["hideDismissed", "hist.dismissed", f.hideDismissed],
            ["avoidPoorMatches", "hist.poor", f.avoidPoorMatches],
          ] as const).map(([key, label, checked]) => (
            <label key={key} className="flex items-center justify-between gap-3 text-sm" data-testid={`label-history-${key}`}>
              <span>{t(label)}</span>
              <Switch
                checked={checked}
                aria-label={t(label)}
                onCheckedChange={(value) => actions.patchFilters({ [key]: value })}
                data-testid={`switch-history-${key}`}
              />
            </label>
          ))}
        </div>
      </Section>

      <Button variant="outline" className="rounded-full" onClick={() => actions.resetAllFilters()} data-testid="button-reset-all">
        {t("reset.all")}
      </Button>
    </div>
  );
}