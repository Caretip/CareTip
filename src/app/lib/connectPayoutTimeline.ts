import type { ConnectPayoutStatus } from "./api";
import { payoutMethodKind } from "./connectPayoutDisplay";

export type PayoutTimelineStepKind =
  | "initiated"
  | "in_transit"
  | "expected_arrival"
  | "completed"
  | "failed"
  | "canceled";

export type PayoutTimelineStep = {
  kind: PayoutTimelineStepKind;
  /** ISO instant for single-point steps */
  at?: string;
  /** ISO date range (calendar dates derived from Stripe created + arrival_date) */
  rangeStart?: string;
  rangeEnd?: string;
};

export type PayoutBankLifecycleInput = {
  status: ConnectPayoutStatus | string;
  stripeCreatedAt: string;
  arrivalDate?: string | null;
  paidAt?: string | null;
  failedAt?: string | null;
  canceledAt?: string | null;
  method?: string | null;
};

function startOfUtcDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function normalizeStatus(status: string): ConnectPayoutStatus | "unknown" {
  const s = status.toLowerCase();
  if (s === "pending" || s === "in_transit" || s === "paid" || s === "failed" || s === "canceled") {
    return s;
  }
  return "unknown";
}

/**
 * Build payout lifecycle steps from authoritative Stripe-backed timestamps only.
 * No invented processing delays or +N day arrival estimates.
 */
export function buildPayoutTimelineSteps(input: PayoutBankLifecycleInput): PayoutTimelineStep[] {
  const status = normalizeStatus(input.status);
  const initiatedAt = input.stripeCreatedAt;
  const arrival = input.arrivalDate?.trim() || null;
  const steps: PayoutTimelineStep[] = [];

  const initiatedDay = startOfUtcDay(initiatedAt);
  const arrivalDay = arrival ? startOfUtcDay(arrival) : null;

  if (status === "failed") {
    steps.push({
      kind: "failed",
      at: input.failedAt ?? initiatedAt,
    });
  } else if (status === "canceled") {
    steps.push({
      kind: "canceled",
      at: input.canceledAt ?? initiatedAt,
    });
  } else if (status === "paid") {
    if (arrival) {
      steps.push({ kind: "completed", at: arrival });
    } else if (input.paidAt) {
      steps.push({ kind: "completed", at: input.paidAt });
    }
    if (arrivalDay && arrivalDay !== initiatedDay) {
      steps.push({
        kind: "in_transit",
        rangeStart: initiatedDay,
        rangeEnd: arrivalDay,
      });
    }
  } else if (status === "pending" || status === "in_transit") {
    if (arrival) {
      steps.push({ kind: "expected_arrival", at: arrival });
    }
    if (arrivalDay) {
      steps.push({
        kind: "in_transit",
        rangeStart: initiatedDay,
        rangeEnd: arrivalDay,
      });
    }
  }

  steps.push({ kind: "initiated", at: initiatedAt });

  return steps;
}

export type PayoutInitiationKind = "caretip_scheduled" | "caretip_instant" | null;

export function resolvePayoutInitiationPresentation(args: {
  method: string | null | undefined;
  initiationKind: PayoutInitiationKind;
  bankPayoutSchedule?: string | null;
}): "instant" | "caretip_scheduled" | "standard" | "unknown" {
  const method = payoutMethodKind(args.method);
  if (method === "instant" || args.initiationKind === "caretip_instant") return "instant";
  if (args.initiationKind === "caretip_scheduled") return "caretip_scheduled";
  if (method === "standard") return "standard";
  return "unknown";
}
