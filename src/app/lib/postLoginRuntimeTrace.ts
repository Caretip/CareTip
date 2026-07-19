/**
 * DEV-only post-login runtime tracer.
 * Temporary instrumentation for POST_LOGIN_RENDER_PROFILING — not a product fix.
 * Exposes window.__POST_LOGIN_TRACE__ after Sign In.
 */

export type PostLoginTraceEvent = {
  event: string;
  t: number;
  elapsedMs: number;
  detail?: Record<string, unknown>;
  stack?: string;
};

type TraceState = {
  originMs: number | null;
  events: PostLoginTraceEvent[];
  endCaller: string | null;
  timeoutForceEndExecuted: boolean;
  layoutCommittedExecuted: boolean;
};

declare global {
  interface Window {
    __POST_LOGIN_TRACE__?: TraceState;
  }
}

const state: TraceState = {
  originMs: null,
  events: [],
  endCaller: null,
  timeoutForceEndExecuted: false,
  layoutCommittedExecuted: false,
};

function ensureWindow(): void {
  if (typeof window === "undefined") return;
  window.__POST_LOGIN_TRACE__ = state;
}

export function resetPostLoginTrace(): void {
  state.originMs = null;
  state.events = [];
  state.endCaller = null;
  state.timeoutForceEndExecuted = false;
  state.layoutCommittedExecuted = false;
  ensureWindow();
}

export function markPostLoginTrace(
  event: string,
  detail?: Record<string, unknown>,
  options?: { stack?: boolean },
): void {
  if (!import.meta.env.DEV) return;
  const now = performance.now();
  if (event === "click" || state.originMs == null) {
    state.originMs = now;
    state.events = [];
    state.endCaller = null;
    state.timeoutForceEndExecuted = false;
    state.layoutCommittedExecuted = false;
  }
  const origin = state.originMs ?? now;
  const entry: PostLoginTraceEvent = {
    event,
    t: now,
    elapsedMs: Math.round(now - origin),
    detail,
  };
  if (options?.stack) {
    entry.stack = new Error(`trace:${event}`).stack ?? "";
  }
  if (event === "timeout_force_end") state.timeoutForceEndExecuted = true;
  if (event === "signalSignInHandoffLayoutCommitted") state.layoutCommittedExecuted = true;
  if (event === "endAuthSignInHandoff") {
    state.endCaller = String(detail?.caller ?? "unknown");
  }
  state.events.push(entry);
  ensureWindow();
  console.info(`[PostLoginTrace] ${event} +${entry.elapsedMs}ms`, detail ?? {}, entry.stack ? { stack: entry.stack } : "");
}

export function getPostLoginTraceSnapshot(): TraceState {
  return {
    originMs: state.originMs,
    events: [...state.events],
    endCaller: state.endCaller,
    timeoutForceEndExecuted: state.timeoutForceEndExecuted,
    layoutCommittedExecuted: state.layoutCommittedExecuted,
  };
}
