/**
 * Phase 2 exact Stripe ↔ ledger comparison by stored references (retrieve calls only — read-only).
 *
 * Destination charges (destination_employee / destination_business): the PaymentIntent carries
 * transfer_data.destination + application_fee_amount, and Stripe creates one Transfer of the gross
 * amount whose source_transaction is the platform charge. platform_hold: no transfer_data; CareTip
 * later creates a separate Transfer of the payable amount with metadata caretip_payable_id.
 *
 * A failed, unauthorized, wrong-mode or skipped lookup is never reported as not_found.
 */
import type Stripe from "stripe";
import { stripeIdShape } from "./phase2FixtureClassification.js";

export type LookupOutcome = "match" | "mismatch" | "not_found" | "unsupported_synthetic" | "inconclusive";
export type LookupObject = "payment_intent" | "transfer" | "refund" | "dispute";
export type LookupCheck = { subjectId: string; object: LookupObject; outcome: LookupOutcome; detail: string };

export type StripeReader = {
  paymentIntent(id: string): Promise<Stripe.PaymentIntent>;
  transfer(id: string): Promise<Stripe.Transfer>;
  refund(id: string): Promise<Stripe.Refund>;
  dispute(id: string): Promise<Stripe.Dispute>;
};

export function stripeReaderFromClient(stripe: Stripe): StripeReader {
  return {
    paymentIntent: (id) => stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] }),
    transfer: (id) => stripe.transfers.retrieve(id),
    refund: (id) => stripe.refunds.retrieve(id),
    dispute: (id) => stripe.disputes.retrieve(id),
  };
}

export function outcomeFromError(err: unknown): { outcome: "not_found" | "inconclusive"; detail: string } {
  const e = err as { type?: string; code?: string; statusCode?: number; message?: string };
  if (e?.code === "resource_missing" && e?.statusCode === 404) {
    if (/(live|test) mode/i.test(e.message ?? "")) return { outcome: "inconclusive", detail: "object exists in the other Stripe mode" };
    return { outcome: "not_found", detail: "resource_missing (404)" };
  }
  if (e?.type === "StripeAuthenticationError" || e?.type === "StripePermissionError" || e?.statusCode === 401 || e?.statusCode === 403) {
    return { outcome: "inconclusive", detail: "unauthorized for this object/account" };
  }
  return { outcome: "inconclusive", detail: `lookup failed (${e?.type ?? e?.code ?? "error"})` };
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : v?.id ?? null);

function verdict(subjectId: string, object: LookupObject, problems: string[], livemode: boolean | undefined): LookupCheck {
  if (livemode === true) return { subjectId, object, outcome: "inconclusive", detail: "live-mode object (wrong mode for validation)" };
  return problems.length
    ? { subjectId, object, outcome: "mismatch", detail: problems.join("; ") }
    : { subjectId, object, outcome: "match", detail: "ok" };
}

export type PayableForLookup = {
  id: string;
  chargeModel: string;
  status: string;
  grossCents: number;
  platformFeeCents: number;
  transferredCents: number;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  stripeTransferId: string | null;
  stripeDestinationAccountId: string | null;
  employeeStripeAccountId: string | null;
};

export async function verifyPayable(reader: StripeReader, p: PayableForLookup): Promise<LookupCheck[]> {
  const checks: LookupCheck[] = [];
  const destinationCharge = p.chargeModel === "destination_employee" || p.chargeModel === "destination_business";

  let pi: Stripe.PaymentIntent | null = null;
  if (stripeIdShape.paymentIntent(p.stripePaymentIntentId) !== "real-format") {
    checks.push({ subjectId: p.id, object: "payment_intent", outcome: "unsupported_synthetic", detail: "synthetic PaymentIntent id" });
  } else {
    try {
      pi = await reader.paymentIntent(p.stripePaymentIntentId);
      const problems: string[] = [];
      if (pi.status !== "succeeded") problems.push(`status ${pi.status}`);
      if (pi.amount_received !== p.grossCents) problems.push(`amount_received ${pi.amount_received} != gross ${p.grossCents}`);
      if (pi.currency !== "eur") problems.push(`currency ${pi.currency}`);
      const dest = idOf(pi.transfer_data?.destination as string | { id: string } | null | undefined);
      if (destinationCharge) {
        if (dest !== p.stripeDestinationAccountId) problems.push("transfer_data.destination != payable destination");
        if (pi.application_fee_amount !== p.platformFeeCents) {
          problems.push(`application_fee ${pi.application_fee_amount} != frozen fee ${p.platformFeeCents}`);
        }
      } else if (dest) {
        problems.push("platform_hold payable but PaymentIntent has transfer_data");
      }
      const chargeId = idOf(pi.latest_charge as string | { id: string } | null);
      if (p.stripeChargeId && chargeId && chargeId !== p.stripeChargeId) problems.push("latest_charge != stored charge id");
      checks.push(verdict(p.id, "payment_intent", problems, pi.livemode));
    } catch (err) {
      checks.push({ subjectId: p.id, object: "payment_intent", ...outcomeFromError(err) });
    }
  }

  let transferId: string | null = p.stripeTransferId;
  if (destinationCharge) {
    const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const chargeTransfer = charge ? idOf(charge.transfer as string | { id: string } | null) : null;
    if (charge && !chargeTransfer) {
      checks.push({ subjectId: p.id, object: "transfer", outcome: "mismatch", detail: "destination charge has no transfer" });
      return checks;
    }
    if (transferId && chargeTransfer && transferId !== chargeTransfer) {
      checks.push({ subjectId: p.id, object: "transfer", outcome: "mismatch", detail: "stored transfer id != charge.transfer" });
      return checks;
    }
    transferId ??= chargeTransfer;
    if (!transferId) {
      checks.push({ subjectId: p.id, object: "transfer", outcome: "inconclusive", detail: "no transfer reference and charge not resolved" });
      return checks;
    }
  } else if (!transferId) {
    if (p.transferredCents > 0 || p.status === "transferred") {
      checks.push({ subjectId: p.id, object: "transfer", outcome: "mismatch", detail: "ledger transferred but no transfer id stored" });
    }
    return checks;
  }

  if (stripeIdShape.transfer(transferId) !== "real-format") {
    checks.push({ subjectId: p.id, object: "transfer", outcome: "unsupported_synthetic", detail: "synthetic Transfer id" });
    return checks;
  }
  try {
    const tr = await reader.transfer(transferId);
    const problems: string[] = [];
    const dest = idOf(tr.destination as string | { id: string } | null);
    if (destinationCharge) {
      if (tr.amount !== p.grossCents) problems.push(`transfer ${tr.amount} != gross ${p.grossCents}`);
      if (dest !== p.stripeDestinationAccountId) problems.push("transfer destination != payable destination");
      const source = idOf(tr.source_transaction as string | { id: string } | null);
      if (p.stripeChargeId && source && source !== p.stripeChargeId) problems.push("source_transaction != stored charge");
    } else {
      if (tr.amount !== p.transferredCents) problems.push(`transfer ${tr.amount} != transferred ${p.transferredCents}`);
      const expected = p.employeeStripeAccountId ?? p.stripeDestinationAccountId;
      if (expected && dest !== expected) problems.push("transfer destination != employee account");
      const meta = tr.metadata?.caretip_payable_id;
      if (meta && meta !== p.id) problems.push("transfer metadata caretip_payable_id points to another payable");
    }
    checks.push(verdict(p.id, "transfer", problems, tr.livemode));
  } catch (err) {
    checks.push({ subjectId: p.id, object: "transfer", ...outcomeFromError(err) });
  }
  return checks;
}

export type RefundForLookup = {
  id: string;
  kind: string;
  status: string;
  amountCents: number;
  stripeRefundId: string | null;
  stripeDisputeId: string | null;
  stripePaymentIntentId: string | null;
};

const DISPUTE_OPEN = new Set(["needs_response", "under_review", "warning_needs_response", "warning_under_review"]);

export async function verifyRefund(reader: StripeReader, r: RefundForLookup): Promise<LookupCheck | null> {
  if (r.kind === "refund") {
    if (!r.stripeRefundId) return null;
    if (!/^(re|pyr)_[A-Za-z0-9]{24}$/.test(r.stripeRefundId)) {
      return { subjectId: r.id, object: "refund", outcome: "unsupported_synthetic", detail: "synthetic Refund id" };
    }
    try {
      const re = await reader.refund(r.stripeRefundId);
      const problems: string[] = [];
      if (re.amount !== r.amountCents) problems.push(`amount ${re.amount} != ledger ${r.amountCents}`);
      if (re.status !== r.status && !(r.status === "pending" && re.status === "requires_action")) {
        problems.push(`status ${re.status} != ledger ${r.status}`);
      }
      if (r.stripePaymentIntentId && idOf(re.payment_intent as string | { id: string } | null) !== r.stripePaymentIntentId) {
        problems.push("payment_intent differs");
      }
      return verdict(r.id, "refund", problems, (re as { livemode?: boolean }).livemode);
    } catch (err) {
      return { subjectId: r.id, object: "refund", ...outcomeFromError(err) };
    }
  }
  if (!r.stripeDisputeId) return null;
  if (!/^(dp|du)_[A-Za-z0-9]{24}$/.test(r.stripeDisputeId)) {
    return { subjectId: r.id, object: "dispute", outcome: "unsupported_synthetic", detail: "synthetic Dispute id" };
  }
  try {
    const dp = await reader.dispute(r.stripeDisputeId);
    const problems: string[] = [];
    if (dp.amount !== r.amountCents) problems.push(`amount ${dp.amount} != ledger ${r.amountCents}`);
    const ledgerOpen = r.status === "needs_response" || r.status === "pending";
    const same = dp.status === r.status || (ledgerOpen && DISPUTE_OPEN.has(dp.status)) || (r.status === "won" && dp.status === "warning_closed");
    if (!same) problems.push(`status ${dp.status} != ledger ${r.status}`);
    return verdict(r.id, "dispute", problems, dp.livemode);
  } catch (err) {
    return { subjectId: r.id, object: "dispute", ...outcomeFromError(err) };
  }
}
