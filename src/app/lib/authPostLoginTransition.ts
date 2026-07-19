import { authDebug } from "./authDebugLog";
import { prepareAuthSoftNavHandoff } from "./authSoftNavHandoff";
import { signalSignInHandoffLayoutCommitted } from "./authSignInHandoff";

/** No branded overlay after login — end as soon as the destination shell paints. */
const POST_LOGIN_MIN_VISIBLE_MS = 0;

const POST_LOGIN_MAX_MS = 15_000;

let active = false;
let targetPath: string | null = null;
let startedAt = 0;
let shellReady = false;
let endTimer: number | null = null;
/** Dashboard stats were warmed on the login surface — must not be wiped on first mount. */
let dashboardWarmPending = false;
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

function setDocumentPostLoginFlag(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) {
    document.documentElement.dataset.authPostLogin = "1";
  } else {
    delete document.documentElement.dataset.authPostLogin;
  }
}

function maybeScheduleEnd(): void {
  if (!active || !shellReady) return;
  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, POST_LOGIN_MIN_VISIBLE_MS - elapsed);
  clearEndTimer();
  endTimer = window.setTimeout(() => {
    endTimer = null;
    endAuthPostLoginTransition();
  }, remaining);
}

export function subscribeAuthPostLoginTransition(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function isAuthPostLoginTransitionActive(): boolean {
  return active;
}

export function getAuthPostLoginTargetPath(): string | null {
  return targetPath;
}

/** Mark that period stats were warmed in the background (never gates Sign In navigation). */
export function markPostLoginDashboardWarm(): void {
  dashboardWarmPending = true;
}

/** Consume once on dashboard stats mount — preserves warm cache across login → dashboard. */
export function consumePostLoginDashboardWarm(): boolean {
  if (!dashboardWarmPending) return false;
  dashboardWarmPending = false;
  return true;
}

/**
 * Begin post-login soft-nav handoff before leaving the login route.
 * Does not open the global CareTip loader — form button spinner owns UX until navigate.
 */
export function beginAuthPostLoginTransition(target: string): void {
  const normalized = target.split("?")[0]?.split("#")[0] ?? target;
  if (active && targetPath === normalized) return;
  prepareAuthSoftNavHandoff();
  active = true;
  targetPath = normalized;
  shellReady = false;
  startedAt = Date.now();
  clearEndTimer();
  setDocumentPostLoginFlag(true);
  authDebug("post_login_transition_start", { target: normalized });
  emit();
}

/** Dashboard / post-auth shell committed — release overlay after min visible time. */
export function signalPostLoginDashboardShellReady(): void {
  if (!active) {
    signalSignInHandoffLayoutCommitted();
    return;
  }
  shellReady = true;
  signalSignInHandoffLayoutCommitted();
  maybeScheduleEnd();
}

export function endAuthPostLoginTransition(): void {
  if (!active) return;
  active = false;
  targetPath = null;
  shellReady = false;
  clearEndTimer();
  setDocumentPostLoginFlag(false);
  authDebug("post_login_transition_end");
  emit();
}

export function getPostLoginTransitionMaxMs(): number {
  return POST_LOGIN_MAX_MS;
}
