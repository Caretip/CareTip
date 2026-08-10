import { queryClient } from "@/services/api/queryClient";
import { markNewAccessSession } from "@/services/api/client";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import { useUiStore } from "@/store/uiStore";
import type { AuthUser } from "@/types/auth";
import { clearAllOfflineQrCaches } from "@/utils/offlineQrCache";
import { logAuthEvent } from "@/utils/authDebug";

export type AuthBoundaryReason =
  | "password-login"
  | "google-login"
  | "oauth-login"
  | "mfa-complete"
  | "session-restore"
  | "verify-email"
  | "onboarding-complete"
  | "logout";

/**
 * Phase 2.1 — wipe in-memory React Query before any authenticated UI mounts.
 * Must run before setAuthenticated / navigation so private screens never paint
 * another account's cached responses.
 */
export function clearReactQueryForAuthBoundary(reason: AuthBoundaryReason): void {
  queryClient.clear();
  logAuthEvent("auth.cache.clear", { reason, layer: "react-query" });
}

/**
 * Interactive account changes also clear AsyncStorage QR offline caches so tip URLs
 * cannot survive a missed logout or a late write from a prior session.
 * Session restore (cold start) must NOT clear offline QR — same user, offline UX.
 */
export async function resetCachesForNewAuthentication(reason: AuthBoundaryReason): Promise<void> {
  clearReactQueryForAuthBoundary(reason);
  try {
    await clearAllOfflineQrCaches();
    logAuthEvent("auth.cache.clear", { reason, layer: "offline-qr" });
  } catch {
    /* Non-fatal — React Query already cleared. */
  }
}

function shouldClearOfflineQrOnAuth(
  reason: AuthBoundaryReason,
  explicit?: boolean,
): boolean {
  if (explicit !== undefined) return explicit;
  return (
    reason === "password-login" ||
    reason === "google-login" ||
    reason === "oauth-login" ||
    reason === "mfa-complete" ||
    reason === "verify-email" ||
    reason === "onboarding-complete"
  );
}

/**
 * Establish an authenticated session with a clean private cache boundary.
 * Call only after tokens are persisted (or about to be used) and before navigation.
 */
export async function establishAuthenticatedSession(
  token: string,
  user: AuthUser,
  reason: AuthBoundaryReason,
  options?: { clearOfflineQr?: boolean },
): Promise<void> {
  if (shouldClearOfflineQrOnAuth(reason, options?.clearOfflineQr)) {
    await resetCachesForNewAuthentication(reason);
  } else {
    clearReactQueryForAuthBoundary(reason);
  }

  // Ensure interceptor Bearer matches the session we are about to mount.
  markNewAccessSession(token);
  // Drop any stale global banner (e.g. prior refresh failure / transport error).
  useUiStore.getState().clearGlobalError();

  useUserStore.getState().setUser(user);
  useAuthStore.getState().setAuthenticated(token);
}
