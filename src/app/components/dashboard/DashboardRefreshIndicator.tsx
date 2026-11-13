import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type DashboardRefreshIndicatorProps = {
  isRefreshing: boolean;
  lastUpdatedAt: number | null;
  refreshFailed?: boolean;
  className?: string;
};

const MIN_UPDATING_VISIBLE_MS = 400;

/** Subtle “Updating…” / “Updated just now” for dashboard analytics sections. */
export function DashboardRefreshIndicator({
  isRefreshing,
  lastUpdatedAt,
  refreshFailed = false,
  className,
}: DashboardRefreshIndicatorProps) {
  const { t } = useTranslation();
  const [, tick] = useState(0);
  const [showUpdating, setShowUpdating] = useState(isRefreshing);
  const updatingSinceRef = useRef<number | null>(isRefreshing ? Date.now() : null);

  useEffect(() => {
    if (isRefreshing) {
      updatingSinceRef.current = Date.now();
      setShowUpdating(true);
      return;
    }
    if (!updatingSinceRef.current) {
      setShowUpdating(false);
      return;
    }
    const elapsed = Date.now() - updatingSinceRef.current;
    const remaining = Math.max(0, MIN_UPDATING_VISIBLE_MS - elapsed);
    const id = window.setTimeout(() => {
      updatingSinceRef.current = null;
      setShowUpdating(false);
    }, remaining);
    return () => window.clearTimeout(id);
  }, [isRefreshing]);

  useEffect(() => {
    if (!lastUpdatedAt || showUpdating) return;
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [lastUpdatedAt, showUpdating]);

  if (refreshFailed && !isRefreshing && !showUpdating) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-destructive/90",
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive/80" aria-hidden />
        {t("dashboard.status.refreshFailed")}
      </div>
    );
  }

  if (!showUpdating && !lastUpdatedAt) return null;

  const label = showUpdating
    ? t("dashboard.refresh.updating")
    : t("dashboard.refresh.justNow");

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground tabular-nums",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {showUpdating ? (
        <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500/80" aria-hidden />
      ) : null}
      {label}
    </div>
  );
}
