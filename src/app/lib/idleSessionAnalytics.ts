/**
 * Idle session analytics — outcome-only emits (Phase 2 §16).
 * Checkpoint 1: thin bridge; no network coupling required.
 */

export type IdleAnalyticsEvent =
  | "idle_warning_shown"
  | "idle_session_extended"
  | "idle_logout"
  | "idle_logout_manual";

export type IdleAnalyticsProps = Record<string, string | number | boolean | undefined>;

type IdleAnalyticsSink = (event: IdleAnalyticsEvent, props?: IdleAnalyticsProps) => void;

let sink: IdleAnalyticsSink | null = null;

/** Inject sink for tests; production uses DEV console product_event style. */
export function setIdleAnalyticsSinkForTests(next: IdleAnalyticsSink | null): void {
  sink = next;
}

function emit(event: IdleAnalyticsEvent, props?: IdleAnalyticsProps): void {
  if (sink) {
    sink(event, props);
    return;
  }

  if (import.meta.env?.DEV) {
    console.info("[product_event]", event, props ?? {});
  }
}

/** Emit only after the idle warning becomes visible. */
export function emitIdleWarningShown(props?: IdleAnalyticsProps): void {
  emit("idle_warning_shown", props);
}

/** Emit only after session extension succeeded (Stay / save-during-grace). */
export function emitIdleSessionExtended(props?: IdleAnalyticsProps): void {
  emit("idle_session_extended", props);
}

/** Emit only after automatic idle logout cleanup completed successfully. */
export function emitIdleLogout(props?: IdleAnalyticsProps): void {
  emit("idle_logout", { source: "timeout", ...props });
}

/** Emit only after manual logout from warning/unsaved dialog completed successfully. */
export function emitIdleLogoutManual(props?: IdleAnalyticsProps): void {
  emit("idle_logout_manual", { source: "manual", ...props });
}
