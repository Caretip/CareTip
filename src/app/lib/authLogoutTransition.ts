import { clearLogoutPending } from "./api";
import { authDebug } from "./authDebugLog";
import { prepareAuthSoftNavHandoff } from "./authSoftNavHandoff";

/** Visual polish — end as soon as the login surface is ready (no dedicated logout screen). */
const POST_LOGOUT_MIN_VISIBLE_MS = 0;

const POST_LOGOUT_MAX_MS = 15_000;

/** Brief window after logout cleanup — suppress session bootstrap on the login route. */
const POST_LOGOUT_BOOTSTRAP_SUPPRESS_MS = 600;

let active = false;
let targetLoginPath: string | null = null;
let startedAt = 0;
let authPageReady = false;
let endTimer: number | null = null;
let bootstrapSuppressUntil = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function clearEndTimer(): void {
  if (endTimer !== null) {
    window.clearTimeout(endTimer);
    endTimer = null;
  }
}

function maybeScheduleEnd(): void {
  if (!active || !authPageReady) return;
  const remaining = Math.max(0, POST_LOGOUT_MIN_VISIBLE_MS - (Date.now() - startedAt));
  clearEndTimer();
  endTimer = window.setTimeout(() => {
    endTimer = null;
    endAuthLogoutTransition();
  }, remaining);
}

export function subscribeAuthLogoutTransition(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function isAuthLogoutTransitionActive(): boolean {
  return active;
}

export function getAuthLogoutTargetPath(): string | null {
  return targetLoginPath;
}

export function isPostLogoutBootstrapSuppress(): boolean {
  return Date.now() < bootstrapSuppressUntil;
}

/**
 * Mark intentional logout before navigation.
 * Overlay stays until {@link signalLogoutAuthPageReady} (or max timeout).
 */
export function beginAuthLogoutTransition(loginPath = "/login"): void {
  if (active) return;
  const normalized = loginPath.split("?")[0]?.split("#")[0] ?? loginPath;
  // Drop residual cold-boot CareTip overlay — logout must not reopen the branded screen.
  prepareAuthSoftNavHandoff();
  active = true;
  targetLoginPath = normalized;
  authPageReady = false;
  startedAt = Date.now();
  bootstrapSuppressUntil = Date.now() + 60_000;
  clearEndTimer();
  authDebug("logout_transition_start", { target: normalized });
  emit();
}

/** Login surface committed — release logout overlay after min visible time. */
export function signalLogoutAuthPageReady(): void {
  if (!active || authPageReady) return;
  authPageReady = true;
  authDebug("logout_auth_page_ready", { target: targetLoginPath });
  maybeScheduleEnd();
}

/** Finish logout — keeps brief bootstrap suppress window on the login route. */
export function endAuthLogoutTransition(): void {
  if (!active) return;
  active = false;
  targetLoginPath = null;
  authPageReady = false;
  clearEndTimer();
  bootstrapSuppressUntil = Date.now() + POST_LOGOUT_BOOTSTRAP_SUPPRESS_MS;
  clearLogoutPending();
  authDebug("logout_transition_end");
  emit();
  window.setTimeout(() => {
    if (Date.now() >= bootstrapSuppressUntil) {
      emit();
    }
  }, POST_LOGOUT_BOOTSTRAP_SUPPRESS_MS + 16);
}

export function getLogoutTransitionMaxMs(): number {
  return POST_LOGOUT_MAX_MS;
}
