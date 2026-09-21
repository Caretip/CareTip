/**
 * Single-flight session bootstrap shared by every `useAuth()` caller.
 * Without this, each hook instance runs its own hydration flags and can redirect early.
 */

import type { AuthResponse } from "./api";
import { getSessionEpoch } from "./authSessionEpoch";

export type SessionBootstrapResult =
  | { kind: "authenticated"; data: AuthResponse }
  | { kind: "unauthenticated" }
  | { kind: "transient_error" };

type BootstrapRunner = () => Promise<SessionBootstrapResult>;

const listeners = new Set<() => void>();

let authHydrated = false;
let sessionValidated = false;
/** Transient API/network failures — session may still be valid; UI unlocked in degraded mode. */
let sessionConnectivityDegraded = false;
/** True after login/refresh/bootstrap returned onboarding status from the API (not stale cache). */
let onboardingStatusFromServer = false;
let bootstrapPromise: Promise<SessionBootstrapResult> | null = null;
let lastBootstrapResult: SessionBootstrapResult | null = null;
let lastBootstrapEpoch = -1;

export type BootstrapResultHandler = (result: SessionBootstrapResult) => void;

let bootstrapResultHandler: BootstrapResultHandler | null = null;

function deliverBootstrapResult(result: SessionBootstrapResult, epochAtStart: number): void {
  lastBootstrapResult = result;
  lastBootstrapEpoch = epochAtStart;
  queueMicrotask(() => {
    // Login/logout bumps the epoch — never let an older refresh overwrite the live session or flags.
    if (getSessionEpoch() !== epochAtStart) {
      return;
    }
    bootstrapResultHandler?.(result);
    authHydrated = true;
    // Transient refresh failures must NOT unlock protected APIs (prevents 401/500 storms).
    sessionValidated = result.kind === "authenticated" || result.kind === "unauthenticated";
    notify();
  });
}

/** Registers the handler that applies bootstrap results to shared auth state. */
export function registerBootstrapResultHandler(handler: BootstrapResultHandler): void {
  bootstrapResultHandler = handler;
  if (lastBootstrapResult && getSessionEpoch() === lastBootstrapEpoch) {
    queueMicrotask(() => bootstrapResultHandler?.(lastBootstrapResult!));
  }
}

function notify() {
  listeners.forEach((l) => l());
}

export function getAuthSessionFlags(): {
  authHydrated: boolean;
  sessionValidated: boolean;
  sessionConnectivityDegraded: boolean;
  onboardingStatusFromServer: boolean;
} {
  return { authHydrated, sessionValidated, sessionConnectivityDegraded, onboardingStatusFromServer };
}

/** Unblock the shell after repeated transient refresh failures without clearing the session. */
export function markSessionBootstrapDegraded(): void {
  authHydrated = true;
  sessionValidated = true;
  sessionConnectivityDegraded = true;
  notify();
}

export function clearSessionConnectivityDegraded(): void {
  if (!sessionConnectivityDegraded) return;
  sessionConnectivityDegraded = false;
  notify();
}

/** Onboarding guards may redirect only after the server confirmed completion status. */
export function markOnboardingStatusFromServer(): void {
  onboardingStatusFromServer = true;
  notify();
}

export function subscribeAuthSessionFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** After explicit login/register — skip re-bootstrap until next full reload/logout. */
export function markSessionBootstrapSettled(): void {
  authHydrated = true;
  sessionValidated = true;
  sessionConnectivityDegraded = false;
  notify();
}

/** Logout or hard reset — next mount must bootstrap again. */
export function resetSessionBootstrap(): void {
  bootstrapPromise = null;
  bootstrapResultHandler = null;
  lastBootstrapResult = null;
  lastBootstrapEpoch = -1;
  authHydrated = false;
  sessionValidated = false;
  sessionConnectivityDegraded = false;
  onboardingStatusFromServer = false;
  notify();
}

/**
 * Runs session restoration once per page load (or after {@link resetSessionBootstrap}).
 * Sets `authHydrated` + `sessionValidated` when finished.
 */
export function runSessionBootstrapOnce(run: BootstrapRunner): Promise<SessionBootstrapResult> {
  if (!bootstrapPromise) {
    const epochAtStart = getSessionEpoch();
    bootstrapPromise = (async (): Promise<SessionBootstrapResult> => {
      try {
        return await run();
      } catch {
        return { kind: "unauthenticated" as const };
      }
    })().then((result) => {
      deliverBootstrapResult(result, epochAtStart);
      return result;
    });
  }
  return bootstrapPromise;
}

/** True while the initial refresh/bootstrap pass is still running. */
export function isSessionBootstrapInProgress(): boolean {
  return !authHydrated;
}

/**
 * Resolves when bootstrap has finished its first pass (success, invalid, or transient).
 * Callers must still gate on {@link isProtectedApiReady} / `sessionValidated` before protected APIs.
 */
export function whenSessionBootstrapSettled(): Promise<void> {
  if (authHydrated) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = subscribeAuthSessionFlags(() => {
      if (authHydrated) {
        unsub();
        resolve();
      }
    });
  });
}
