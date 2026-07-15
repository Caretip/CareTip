/**
 * Document title countdown for idle / unsaved warnings.
 * Checkpoint 1: isolated DOM side effect; no auth coupling.
 */

import { IDLE_BRAND_TITLE } from "./idleSessionConfig";

const COUNTDOWN_PREFIX_RE = /^\(\d+\)\s+/;

let previousTitle: string | null = null;
let active = false;

function stripCountdownPrefix(title: string): string {
  return title.replace(COUNTDOWN_PREFIX_RE, "");
}

function resolveBaseTitle(saved: string | null): string {
  const stripped = stripCountdownPrefix(saved ?? "").trim();
  if (!stripped || stripped.includes("CareTip")) return IDLE_BRAND_TITLE;
  return stripped;
}

function formatCountdownTitle(secondsRemaining: number, base: string): string {
  const n = Math.max(0, Math.floor(secondsRemaining));
  return `(${n}) ${base}`;
}

/**
 * Enter title-countdown mode. Saves the current title once.
 * Subsequent updates use {@link updateIdleDocumentTitle}.
 */
export function beginIdleDocumentTitleCountdown(secondsRemaining: number): void {
  if (typeof document === "undefined") return;

  if (!active) {
    previousTitle = document.title;
    active = true;
  }

  document.title = formatCountdownTitle(secondsRemaining, resolveBaseTitle(previousTitle));
}

/** Update countdown digits; no-op if countdown not active. */
export function updateIdleDocumentTitle(secondsRemaining: number): void {
  if (!active || typeof document === "undefined") return;
  document.title = formatCountdownTitle(secondsRemaining, resolveBaseTitle(previousTitle));
}

/** Restore the title saved at countdown start (all exit paths must call this). */
export function endIdleDocumentTitleCountdown(): void {
  if (!active) return;
  active = false;
  if (typeof document !== "undefined" && previousTitle != null) {
    document.title = previousTitle;
  }
  previousTitle = null;
}

export function isIdleDocumentTitleCountdownActive(): boolean {
  return active;
}

/** Test-only reset. */
export function resetIdleDocumentTitleForTests(): void {
  active = false;
  previousTitle = null;
}

/** Pure formatter for unit tests (no DOM). */
export function formatIdleCountdownTitleForTests(
  secondsRemaining: number,
  base: string = IDLE_BRAND_TITLE,
): string {
  return formatCountdownTitle(secondsRemaining, base);
}
