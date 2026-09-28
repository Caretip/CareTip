/**
 * Dev/test performance marks for landing cold-load sequencing.
 * No-op in production unless `import.meta.env.DEV` or `?caretipPerfMarks=1`.
 */

const PREFIX = "caretip:";

export type LandingColdLoadMark =
  | "boot-locale-ready"
  | "react-start"
  | "i18n-ready"
  | "landing-commit"
  | "hero-ready"
  | "boot-exit-start"
  | "boot-removed"
  | "landing-interactive";

function marksEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;
  try {
    return new URLSearchParams(window.location.search).has("caretipPerfMarks");
  } catch {
    return false;
  }
}

export function markLandingColdLoad(name: LandingColdLoadMark, detail?: Record<string, unknown>): void {
  if (!marksEnabled()) return;
  const full = `${PREFIX}${name}`;
  try {
    performance.mark(full, { detail });
  } catch {
    /* ignore */
  }
  if (import.meta.env.DEV) {
    console.debug(`[landing-cold-load] ${full}`, detail ?? "");
  }
}
