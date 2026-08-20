/**
 * Deprecated: Class S setup prompts use server notification intelligence.
 * Quick Start / PWA keep their own keys. This module remains only if any
 * legacy caller still imports it — prefer deleting call sites.
 */
export type FixPromptDismissPersistence = "local" | "session";

const LOCAL_KEY = "dismissedFixes";
const SESSION_KEY = "dismissedFixesSession";

/** Clear legacy browser dismiss flags (one-time hygiene; safe no-op). */
export function clearLegacyFixPromptDismissStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
