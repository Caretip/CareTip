import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ADMIN_FINANCIAL_TIMEZONE, formatAdminFinancialDateTime } from "../../lib/adminFinancialTimezone";

export type PlatformAdminStatusTone = "success" | "pending" | "attention" | "failure" | "neutral" | "dispute";

const STATUS_TONE_CLASS: Record<PlatformAdminStatusTone, string> = {
  success: "platform-admin-status-badge--success",
  pending: "platform-admin-status-badge--pending",
  attention: "platform-admin-status-badge--attention",
  failure: "platform-admin-status-badge--failure",
  neutral: "platform-admin-status-badge--neutral",
  dispute: "platform-admin-status-badge--dispute",
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
    <span
      className={cn("platform-admin-status-badge", STATUS_TONE_CLASS[tone], className)}
      title={label}
    >
      {icon ? <span className="platform-admin-status-badge__icon" aria-hidden>{icon}</span> : null}
      <span className="platform-admin-status-badge__label">{label}</span>
    </span>
  );
}

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
      className={cn(
        "platform-admin-metric-cell",
        loading && "platform-admin-metric-cell--loading",
        featured && "platform-admin-metric-cell--featured",
        className,
      )}
    >
      <p className="platform-admin-metric-cell__label">{label}</p>
      <p className="platform-admin-metric-cell__value tabular-nums text-foreground" aria-busy={loading || undefined}>
        {loading ? "—" : value}
      </p>
      {hint ? <p className="platform-admin-metric-cell__hint">{hint}</p> : null}
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
