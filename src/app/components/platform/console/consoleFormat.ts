/** Display-only formatters shared by admin console pages. */

export function consoleLocale(language: string | undefined): string {
  return (language ?? "en").toLowerCase().startsWith("de") ? "de-DE" : "en-GB";
}

export function formatCount(n: number | null | undefined, language?: string): string {
  return new Intl.NumberFormat(consoleLocale(language)).format(n ?? 0);
}

export function formatPercent(n: number | null | undefined, language?: string, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat(consoleLocale(language), { maximumFractionDigits: digits }).format(n)}%`;
}

export function formatEurCompact(n: number, language?: string): string {
  return new Intl.NumberFormat(consoleLocale(language), {
    style: "currency",
    currency: "EUR",
    notation: Math.abs(n) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(n) >= 10_000 ? 1 : 2,
  }).format(n);
}

/** "3 min ago", "vor 2 Std." — falls back to a date for anything older than a week. */
export function formatRelative(iso: string | null | undefined, language?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(consoleLocale(language), { numeric: "auto", style: "short" });
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(diffSec / 86_400), "day");
  return formatDateShort(iso, language);
}

export function formatDateShort(iso: string | null | undefined, language?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat(consoleLocale(language), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(d);
}

export function formatDateTime(iso: string | null | undefined, language?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat(consoleLocale(language), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(d);
}

/**
 * "platform.business.approved" → "Business approved"; keeps the raw key available for a
 * secondary mono line so operators can still search the audit log by exact action.
 */
export function humanizeAuditAction(action: string): string {
  const parts = action.split(".").filter(Boolean);
  const meaningful = parts[0] === "platform" && parts.length > 1 ? parts.slice(1) : parts;
  const text = meaningful.join(" ").replace(/[_-]+/g, " ").trim();
  if (!text) return action;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
