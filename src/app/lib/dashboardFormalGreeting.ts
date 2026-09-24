/**
 * Formal dashboard greeting for hero eyebrow/badge.
 * Uses authenticated display name only — never "undefined"/"null".
 */
export function resolveDashboardGreetingName(
  name: string | null | undefined,
  fallback?: string | null,
): string | null {
  const primary = typeof name === "string" ? name.trim() : "";
  if (primary) return primary;
  const secondary = typeof fallback === "string" ? fallback.trim() : "";
  return secondary || null;
}

/** First token of display name — for compact hero greetings ("Felix" not "Felix Wagner"). */
export function resolveDashboardGreetingFirstName(
  name: string | null | undefined,
  fallback?: string | null,
): string | null {
  const resolved = resolveDashboardGreetingName(name, fallback);
  if (!resolved) return null;
  const first = resolved.split(/\s+/)[0]?.trim();
  return first || resolved;
}

type TranslateFn = (key: string, options?: Record<string, string>) => string;

type GreetingPeriod = "morning" | "afternoon" | "evening";

function resolveGreetingPeriod(date = new Date()): GreetingPeriod {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** SaaS-style time-of-day greeting; falls back to welcome-back when name is unavailable. */
export function formatDashboardFormalGreeting(
  t: TranslateFn,
  name: string | null | undefined,
  fallback?: string | null,
  opts?: { firstNameOnly?: boolean },
): string {
  const resolved = opts?.firstNameOnly
    ? resolveDashboardGreetingFirstName(name, fallback)
    : resolveDashboardGreetingName(name, fallback);
  const period = resolveGreetingPeriod();
  if (resolved) {
    return t(`dashboard.formalGreeting.${period}Named`, { name: resolved });
  }
  return t(`dashboard.formalGreeting.${period}`);
}

/** Marker + black text for hero eyebrow/badge greeting (Hello + name). */
export const dashboardFormalGreetingBadgeClassName =
  "dashboard-formal-greeting-badge text-foreground break-words max-w-[min(100%,42ch)]";
