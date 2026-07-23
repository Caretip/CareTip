import { useEffect, useState } from "react";
import {
  getTipSessionContext,
  type TipSessionPendingContext,
  type TipSessionReadyContext,
} from "../lib/api";
import { logClientError } from "../lib/clientLog";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../lib/devCustomerBypass";
import { markCustomerFlowEntered } from "../lib/customerFlowGuard";
import { onVerifiedTipPaymentSession } from "../lib/postPaymentSuccess";

export type VerifiedTipSessionPhase =
  | "loading"
  | "pending"
  | "ready"
  | "expired"
  | "unpaid"
  | "failed"
  | "timeout"
  | "error";

export type VerifiedTipSessionState =
  | { phase: "loading" }
  | { phase: "pending"; sessionId: string; stripePaid?: boolean }
  | { phase: "ready"; sessionId: string; context: TipSessionReadyContext }
  | { phase: "expired"; sessionId: string }
  | { phase: "unpaid"; sessionId: string }
  /** Tip ledger exists as failed (eligibility / refund) — stop polling. */
  | { phase: "failed"; sessionId: string; tipId?: string }
  /** Wall-clock timeout while Stripe still looks paid / pending — not a confirmed unpaid. */
  | { phase: "timeout"; sessionId: string; stripePaid: boolean }
  | { phase: "error"; sessionId: string; message: string };

type UseVerifiedTipSessionOptions = {
  enabled?: boolean;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  /** Absolute wall-clock budget for webhook reconciliation (ms). */
  timeoutMs?: number;
  /** When true and sessionId matches dev mock, skip server verification. */
  allowDevMock?: boolean;
};

/** ~60s wall budget; 1s cadence keeps load reasonable while covering webhook lag. */
const DEFAULT_MAX_POLLS = 60;
const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 60_000;

function logTipReconcile(event: string, payload: Record<string, unknown>): void {
  if (import.meta.env.DEV) {
    console.info(`[tip-reconcile] ${event}`, payload);
  }
}

export function useVerifiedTipSession(
  sessionId: string,
  options?: UseVerifiedTipSessionOptions,
): VerifiedTipSessionState {
  const enabled = options?.enabled !== false;
  const maxPollAttempts = options?.maxPollAttempts ?? DEFAULT_MAX_POLLS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowDevMock = options?.allowDevMock !== false;
  const isDevMockSession =
    allowDevMock && DEV_BYPASS_ENABLED && sessionId === DEV_MOCK.sessionId;

  const [state, setState] = useState<VerifiedTipSessionState>(() =>
    !sessionId.trim() ? { phase: "error", sessionId: "", message: "missing_session" } : { phase: "loading" },
  );

  useEffect(() => {
    if (!enabled) return;

    const trimmed = sessionId.trim();
    if (!trimmed) {
      setState({ phase: "error", sessionId: "", message: "missing_session" });
      return;
    }

    if (isDevMockSession) {
      const mockContext: TipSessionReadyContext = {
        status: "ready",
        sessionId: DEV_MOCK.sessionId,
        paymentIntentId: null,
        transactionId: "dev_tx_001",
        receiptNumber: "CT-26-K8M4P9X2",
        employee: { id: DEV_MOCK.employeeId, name: DEV_MOCK.employeeName, avatar: null },
        businessId: DEV_MOCK.businessId,
        locationId: DEV_MOCK.venue.locationId,
        tableId: DEV_MOCK.venue.tableId,
        customerName: "Dev Customer",
      };
      markCustomerFlowEntered();
      onVerifiedTipPaymentSession(DEV_MOCK.sessionId, mockContext);
      setState({ phase: "ready", sessionId: trimmed, context: mockContext });
      return;
    }

    let cancelled = false;
    let tries = 0;
    let timer: number | undefined;
    let lastStripePaid = false;
    const startedAt = Date.now();

    logTipReconcile("poll_start", { sessionId: trimmed, timeoutMs, maxPollAttempts, pollIntervalMs });

    const finishReady = (ctx: TipSessionReadyContext) => {
      logTipReconcile("ready", {
        sessionId: trimmed,
        paymentIntentId: ctx.paymentIntentId,
        tipId: ctx.transactionId,
        businessId: ctx.businessId,
        employeeId: ctx.employee?.id ?? null,
        elapsedMs: Date.now() - startedAt,
        tries,
      });
      markCustomerFlowEntered();
      onVerifiedTipPaymentSession(trimmed, ctx);
      setState({ phase: "ready", sessionId: trimmed, context: ctx });
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (tries >= maxPollAttempts || elapsed >= timeoutMs) {
        logTipReconcile("timeout", {
          sessionId: trimmed,
          stripePaid: lastStripePaid,
          elapsedMs: elapsed,
          tries,
        });
        setState({ phase: "timeout", sessionId: trimmed, stripePaid: lastStripePaid });
        return;
      }
      timer = window.setTimeout(poll, pollIntervalMs);
    };

    const poll = async () => {
      tries += 1;
      try {
        const ctx = await getTipSessionContext(trimmed);
        if (cancelled) return;

        if (ctx.status === "ready") {
          finishReady(ctx);
          return;
        }
        if (ctx.status === "expired") {
          logTipReconcile("expired", { sessionId: trimmed, tries, elapsedMs: Date.now() - startedAt });
          setState({ phase: "expired", sessionId: trimmed });
          return;
        }
        if (ctx.status === "unpaid") {
          logTipReconcile("unpaid", { sessionId: trimmed, tries, elapsedMs: Date.now() - startedAt });
          setState({ phase: "unpaid", sessionId: trimmed });
          return;
        }
        if (ctx.status === "failed") {
          logTipReconcile("failed_ledger", {
            sessionId: trimmed,
            tipId: ctx.tipId,
            tipStatus: ctx.tipStatus,
            paymentIntentId: ctx.paymentIntentId,
            tries,
            elapsedMs: Date.now() - startedAt,
          });
          setState({ phase: "failed", sessionId: trimmed, tipId: ctx.tipId });
          return;
        }

        const pending = ctx as TipSessionPendingContext;
        lastStripePaid = pending.paymentStatus === "paid";
        logTipReconcile("pending", {
          sessionId: trimmed,
          paymentIntentId: pending.paymentIntentId ?? null,
          paymentStatus: pending.paymentStatus ?? null,
          stripePaid: lastStripePaid,
          try: tries,
          elapsedMs: Date.now() - startedAt,
        });
        setState({ phase: "pending", sessionId: trimmed, stripePaid: lastStripePaid });
        scheduleNext();
      } catch (err) {
        if (cancelled) return;
        logClientError("useVerifiedTipSession.poll", err, { sessionId: trimmed, try: tries });
        logTipReconcile("poll_error_retry", {
          sessionId: trimmed,
          try: tries,
          elapsedMs: Date.now() - startedAt,
          message: err instanceof Error ? err.message : String(err),
        });
        // Transient network blips during webhook lag — keep confirming, don't flip to error.
        setState({ phase: "pending", sessionId: trimmed, stripePaid: lastStripePaid });
        scheduleNext();
      }
    };

    setState({ phase: "loading" });
    void poll();

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [
    enabled,
    isDevMockSession,
    maxPollAttempts,
    pollIntervalMs,
    timeoutMs,
    sessionId,
  ]);

  return state;
}

export function isVerifiedTipSessionReady(
  state: VerifiedTipSessionState,
): state is { phase: "ready"; sessionId: string; context: TipSessionReadyContext } {
  return state.phase === "ready";
}
