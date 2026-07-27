import { t } from "@/i18n";

/** Relative time for activity feeds — localized. */

export function formatTimeAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Math.max(0, now - then);
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return t("timeAgo.justNow");
  if (diffMins < 60) return t("timeAgo.minutes", { count: diffMins });
  if (diffHours < 24) {
    return diffHours === 1 ? t("timeAgo.hour") : t("timeAgo.hours", { count: diffHours });
  }
  return diffDays === 1 ? t("timeAgo.day") : t("timeAgo.days", { count: diffDays });
}
