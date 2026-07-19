/**
 * Sign In → destination handoff.
 * Keeps Login visually covering the app until the destination **shell** paints
 * (sidebar / header / nav). Dashboard widgets must not gate this cover.
 * Never opens the branded CareTip splash for this journey.
 */

import { authDebug } from "./authDebugLog";
import { prepareAuthSoftNavHandoff } from "./authSoftNavHandoff";
import { markPostLoginTrace, resetPostLoginTrace } from "./postLoginRuntimeTrace";

const HANDOFF_MAX_MS = 20_000;

export type SignInHandoffTiming = {
  clickAt: number;
  authCompletedAt: number | null;
  dataReadyAt: number | null;
  navigateAt: number | null;
  layoutCommittedAt: number | null;
  firstMeaningfulPaintAt: number | null;
  fullyInteractiveAt: number | null;
  targetPath: string | null;
};

let active = false;
let coverVisible = false;
let targetPath: string | null = null;
let shellReady = false;
let dataReady = false;
let maxTimer: number | null = null;
let timing: SignInHandoffTiming = emptyTiming();
const listeners = new Set<() => void>();

function emptyTiming(): SignInHandoffTiming {
  return {
    clickAt: 0,
    authCompletedAt: null,
    dataReadyAt: null,
    navigateAt: null,
    layoutCommittedAt: null,
    firstMeaningfulPaintAt: null,
    fullyInteractiveAt: null,
    targetPath: null,
  };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function clearMaxTimer(): void {
  if (maxTimer !== null) {
    window.clearTimeout(maxTimer);
    maxTimer = null;
  }
}

function setDocumentFlag(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) {
    document.documentElement.dataset.authSignInHandoff = "1";
    document.documentElement.dataset.authPostLogin = "1";
  } else {
    delete document.documentElement.dataset.authSignInHandoff;
    delete document.documentElement.dataset.authPostLogin;
  }
}

function logMark(label: string): void {
  const elapsed = timing.clickAt ? Math.round(performance.now() - timing.clickAt) : 0;
  authDebug("sign_in_handoff", { label, elapsedMs: elapsed, targetPath });
  if (import.meta.env.DEV) {
    console.info(`[AuthHandoff] ${label} +${elapsed}ms`, { targetPath });
  }
}

function maybeComplete(): void {
  if (!active) return;
  markPostLoginTrace("maybeComplete_enter", { shellReady, active, coverVisible });
  // Shell-first: CareTip handoff ends when layout commits — never wait for widgets.
  if (!shellReady) {
    markPostLoginTrace("maybeComplete_blocked_no_shellReady");
    return;
  }

  if (timing.firstMeaningfulPaintAt == null) {
    timing.firstMeaningfulPaintAt = performance.now();
    logMark("first_meaningful_paint");
    markPostLoginTrace("first_meaningful_paint");
  }
  timing.fullyInteractiveAt = performance.now();
  logMark("fully_interactive");
  markPostLoginTrace("fully_interactive");
  endAuthSignInHandoff("maybeComplete");
}

export function subscribeAuthSignInHandoff(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function isAuthSignInHandoffActive(): boolean {
  return active;
}

export function isAuthSignInHandoffCoverVisible(): boolean {
  return coverVisible;
}

export function getAuthSignInHandoffTargetPath(): string | null {
  return targetPath;
}

export function getSignInHandoffTimingSnapshot(): SignInHandoffTiming {
  return { ...timing };
}

/** Call on Sign In click — suppresses branded loaders for the whole journey. */
export function beginAuthSignInHandoff(): void {
  if (active) return;
  resetPostLoginTrace();
  prepareAuthSoftNavHandoff();
  active = true;
  coverVisible = true;
  targetPath = null;
  shellReady = false;
  dataReady = false;
  timing = emptyTiming();
  timing.clickAt = performance.now();
  clearMaxTimer();
  setDocumentFlag(true);
  maxTimer = window.setTimeout(() => {
    maxTimer = null;
    if (active) {
      logMark("timeout_force_end");
      markPostLoginTrace("timeout_force_end", { active: true });
      endAuthSignInHandoff("timeout_force_end");
    }
  }, HANDOFF_MAX_MS);
  logMark("click");
  markPostLoginTrace("click", { coverVisible: true });
  emit();
}

export function markSignInHandoffAuthCompleted(): void {
  if (!active) return;
  timing.authCompletedAt = performance.now();
  logMark("auth_completed");
  markPostLoginTrace("auth_completed");
  emit();
}

/** Timing-only: widget data no longer gates the CareTip handoff cover. */
export function markSignInHandoffDataReady(): void {
  if (!active) return;
  if (timing.dataReadyAt == null) {
    timing.dataReadyAt = performance.now();
    logMark("dashboard_data_ready");
  }
  dataReady = true;
  emit();
}

/** Mount cover (already true) and record that navigation is about to fire. */
export function markSignInHandoffNavigating(target: string): void {
  if (!active) beginAuthSignInHandoff();
  const normalized = target.split("?")[0]?.split("#")[0] ?? target;
  targetPath = normalized;
  coverVisible = true;
  timing.navigateAt = performance.now();
  timing.targetPath = normalized;
  prepareAuthSoftNavHandoff();
  setDocumentFlag(true);
  logMark("navigation_triggered");
  markPostLoginTrace("navigation_triggered", { targetPath: normalized });
  emit();
}

export function signalSignInHandoffLayoutCommitted(): void {
  markPostLoginTrace(
    "signalSignInHandoffLayoutCommitted",
    { active, shellReadyBefore: shellReady, targetPath },
    { stack: true },
  );
  if (!active) {
    markPostLoginTrace("signalSignInHandoffLayoutCommitted_ignored_inactive");
    return;
  }
  if (timing.layoutCommittedAt == null) {
    timing.layoutCommittedAt = performance.now();
    logMark("business_layout_committed");
  }
  shellReady = true;
  emit();
  maybeComplete();
}

/**
 * @deprecated Widgets must not gate Sign In handoff. Kept for timing logs only.
 */
export function signalSignInHandoffDashboardInteractive(): void {
  if (!active) return;
  dataReady = true;
  if (timing.dataReadyAt == null) {
    timing.dataReadyAt = performance.now();
    logMark("dashboard_data_ready");
  }
  emit();
}

export function endAuthSignInHandoff(caller = "unspecified"): void {
  if (!active && !coverVisible) return;
  const report = formatSignInHandoffTimingReport(timing);
  markPostLoginTrace(
    "endAuthSignInHandoff",
    {
      caller,
      shellReady,
      coverVisibleBefore: coverVisible,
      targetPath,
      layoutCommittedAt: timing.layoutCommittedAt,
    },
    { stack: true },
  );
  active = false;
  coverVisible = false;
  targetPath = null;
  shellReady = false;
  dataReady = false;
  clearMaxTimer();
  setDocumentFlag(false);
  authDebug("sign_in_handoff_end", getSignInHandoffTimingSnapshot());
  if (import.meta.env.DEV) {
    console.info("[AuthHandoff] complete\n" + report);
    console.info("[PostLoginTrace] END_CALLER=", caller);
  }
  emit();
}

export function getSignInHandoffMaxMs(): number {
  return HANDOFF_MAX_MS;
}

/** Format timing deltas for AUTH_LOADING_IMPLEMENTATION.md / DEV console. */
export function formatSignInHandoffTimingReport(snap: SignInHandoffTiming = timing): string {
  const base = snap.clickAt;
  const delta = (at: number | null) => (at == null || !base ? "—" : `${Math.round(at - base)}ms`);
  return [
    `target: ${snap.targetPath ?? "—"}`,
    `auth_completed: ${delta(snap.authCompletedAt)}`,
    `data_ready: ${delta(snap.dataReadyAt)}`,
    `navigate: ${delta(snap.navigateAt)}`,
    `layout_committed: ${delta(snap.layoutCommittedAt)}`,
    `first_meaningful_paint: ${delta(snap.firstMeaningfulPaintAt)}`,
    `fully_interactive: ${delta(snap.fullyInteractiveAt)}`,
  ].join("\n");
}
