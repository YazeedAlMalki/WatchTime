import { Button } from "@/components/ui/button";
import { useT } from "./i18n";
import type { MoodSyncStatus } from "./use-sync";

export function MoodSyncNotice({
  status,
  onRetry,
}: {
  status: MoodSyncStatus | null;
  onRetry: () => void;
}) {
  const { t } = useT();
  if (!status) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="mood-sync-status"
      className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 text-sm ${
        status === "waiting"
          ? "border-amber-500/40 bg-amber-500/10 text-foreground"
          : status === "saved"
            ? "border-emerald-500/30 bg-emerald-500/5 text-muted-foreground"
            : "border-border bg-card text-muted-foreground"
      }`}
    >
      <span>{t(`sync.${status}`)}</span>
      {status === "waiting" && (
        <Button
          type="button"
          variant="ghost"
          className="h-8 rounded-full px-3"
          data-testid="button-retry-mood-sync"
          onClick={onRetry}
        >
          {t("sync.retry")}
        </Button>
      )}
    </div>
  );
}
