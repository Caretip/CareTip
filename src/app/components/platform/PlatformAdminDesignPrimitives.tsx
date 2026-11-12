import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ADMIN_FINANCIAL_TIMEZONE, formatAdminFinancialDateTime } from "../../lib/adminFinancialTimezone";

export type PlatformAdminStatusTone = "success" | "pending" | "attention" | "failure" | "neutral" | "dispute";

const STATUS_TONE_CLASS: Record<PlatformAdminStatusTone, string> = {
  success: "ac-status--success",
  pending: "ac-status--info",
  attention: "ac-status--attention",
  failure: "ac-status--failure",
  neutral: "ac-status--neutral",
  dispute: "ac-status--dispute",
};

export function PlatformAdminStatusBadge({
  label,
  tone = "neutral",
  icon,
  className,
}: {
  label: string;
  tone?: PlatformAdminStatusTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("ac-status", STATUS_TONE_CLASS[tone], className)} title={label}>
      {icon ? <span className="inline-flex [&_svg]:h-3 [&_svg]:w-3" aria-hidden>{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}

/** KPI tile (renders inside PlatformAdminMetricStrip). */
export function PlatformAdminMetricCell({
  label,
  value,
  hint,
  loading = false,
  featured = false,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  featured?: boolean;
  className?: string;
}) {
  return (
    <div
      role="listitem"
      className={cn("ac-kpi", featured && "ac-kpi--attention", loading && "ac-kpi--loading", className)}
    >
      <p className="ac-kpi__label">{label}</p>
      <p className="ac-kpi__value" aria-busy={loading || undefined}>
        {loading ? "—" : value}
      </p>
      {hint ? <p className="ac-kpi__hint">{hint}</p> : null}
    </div>
  );
}

function formatRelativeFreshness(
  generatedAt: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const ms = Date.now() - new Date(generatedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return t("admin.statsFreshnessJustNow");
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("admin.statsFreshnessJustNow");
  if (minutes < 60) return t("admin.statsFreshnessMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("admin.statsFreshnessHours", { count: hours });
  return t("admin.statsFreshnessDays", { count: Math.floor(hours / 24) });
}

export function PlatformAdminFreshnessIndicator({
  generatedAt,
  cacheTtlSeconds,
  locale,
  timezone = ADMIN_FINANCIAL_TIMEZONE,
  className,
}: {
  generatedAt?: string | null;
  cacheTtlSeconds?: number;
  locale?: string;
  timezone?: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = locale ?? i18n.language;

  const line = useMemo(() => {
    if (!generatedAt) return null;
    const time = formatAdminFinancialDateTime(generatedAt, lang);
    const relative = formatRelativeFreshness(generatedAt, t);
    return t("admin.statsFreshnessLine", { time, relative, tz: timezone });
  }, [generatedAt, lang, t, timezone]);

  if (!line) return null;

  return (
    <p
      className={cn("platform-admin-freshness text-xs text-muted-foreground", className)}
      title={
        cacheTtlSeconds
          ? t("admin.statsFreshnessCacheHint", { seconds: cacheTtlSeconds })
          : undefined
      }
    >
      {line}
    </p>
  );
}
