import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MovieCard } from "./components/MovieCard";
import { MovieDetail } from "./components/MovieDetail";
import { Shell } from "./components/Shell";
import { MOVIES, MOVIE_BY_ID } from "./data";
import { classify, comfortList } from "./engine";
import { useT } from "./i18n";
import { actions, useStore } from "./store";
import type { Movie } from "./types";

const TABS = ["saved", "recent", "near", "comfort", "dismissed"] as const;

export default function MovieIdeasPage() {
  const { t } = useT();
  const s = useStore();
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get("tab") ?? "saved";
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>(
    TABS.includes(requestedTab as (typeof TABS)[number]) ? requestedTab as (typeof TABS)[number] : "saved",
  );
  const onlySavedNear = params.get("saved") === "1";
  const [openId, setOpenId] = useState<string | null>(params.get("movie"));
  const [cleared, setCleared] = useState(false);

  const lists = useMemo(() => {
    const pick = (ids: string[]) => ids.map((id) => MOVIE_BY_ID[id]).filter(Boolean) as Movie[];
    const recent = Object.entries(s.viewed)
      .sort((a, b) => b[1].lastViewedAt - a[1].lastViewedAt)
      .map(([id]) => id);
    const { near } = classify(MOVIES, s.filters, s);
    return {
      saved: pick(s.saved),
      recent: pick(recent),
      near: onlySavedNear ? near.filter((item) => s.saved.includes(item.movie.id)) : near,
      comfort: comfortList(MOVIES, s.filters, s),
      dismissed: pick(s.dismissed),
    };
  }, [s, onlySavedNear]);

  const count = (k: (typeof TABS)[number]) => lists[k].length;

  const Empty = ({ k }: { k: string }) => (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center" data-testid={`empty-${k}`}>
      <Film className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
      <p className="max-w-sm text-sm text-muted-foreground">{t(`i.empty.${k}`)}</p>
      <Link href="/discover-mood" data-testid={`link-empty-${k}-discover`} className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        {t("i.cta")}
      </Link>
    </div>
  );

  return (
    <Shell current="ideas">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as (typeof TABS)[number])}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-card p-1">
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`tab-${k}`} className="rounded-full">
              {t(`i.tab.${k}`)} <span className="ms-1.5 text-xs tabular-nums opacity-70" data-testid={`count-${k}`}>{count(k)}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {(["saved", "recent", "comfort", "dismissed"] as const).map((k) => (
          <TabsContent key={k} value={k} className="mt-5">
            {k === "comfort" && <p className="mb-3 text-xs text-muted-foreground">{t("i.comfort.note")}</p>}
            {lists[k].length === 0 ? (
              <Empty k={k} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2" data-testid={`list-${k}`}>
                {lists[k].map((m) => (
                  <MovieCard key={m.id} movie={m} restore={k === "dismissed"} onOpen={setOpenId} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}

        <TabsContent value="near" className="mt-5">
          <p className="mb-3 text-xs text-muted-foreground">{t("near.d")}</p>
          {lists.near.length === 0 ? (
            <Empty k="near" />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2" data-testid="list-near">
              {lists.near.map((n) => (
                <MovieCard
                  key={n.movie.id}
                  movie={n.movie}
                  score={n.score}
                  note={t("near.blocked", { list: n.fails.map((x) => t(`fail.${x}`)).join(", ") })}
                  onOpen={setOpenId}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-10 border-t border-border pt-5">
        <Button
          variant="outline"
          className="rounded-full"
          data-testid="button-clear-local-data"
          onClick={() => {
            if (!window.confirm(t("ideas.clear.confirm"))) return;
            actions.clearPersonalData();
            setCleared(true);
          }}
        >
          {t("i.clear")}
        </Button>
        {cleared && (
          <p className="mt-2 text-sm text-muted-foreground" role="status" data-testid="text-cleared">{t("i.cleared")}</p>
        )}
      </div>

      <MovieDetail movieId={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />
    </Shell>
  );
}
