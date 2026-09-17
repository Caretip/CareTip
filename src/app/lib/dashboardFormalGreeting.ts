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

type TranslateFn = (key: string, options?: Record<string, string>) => string;

/** EN: "Hello {name}" / DE: "Hallo {name}" — or bare Hello/Hallo when name is unavailable. */
export function formatDashboardFormalGreeting(
  t: TranslateFn,
  name: string | null | undefined,
  fallback?: string | null,
): string {
  const resolved = resolveDashboardGreetingName(name, fallback);
  if (resolved) {
    return t("dashboard.formalGreeting.helloNamed", { name: resolved });
  }
  return t("dashboard.formalGreeting.hello");
}

/** Marker + brand orange for hero eyebrow/badge greeting text. */
export const dashboardFormalGreetingBadgeClassName =
  "dashboard-formal-greeting-badge text-primary break-words max-w-[min(100%,42ch)]";
