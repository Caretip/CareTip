/**
 * Backfill of EmployeeTipPayable rows for successful tips paid before the payable writer shipped
 * (2026-09-10 ledger transition window). Plans from read-only Stripe facts, refuses on any
 * mismatch, and writes the payable plus its dispute state in one transaction through the same
 * helpers the webhook path uses. Never calls Stripe write APIs: destination charges have no
 * CareTip-side transfer to reverse.
 *
 * Idempotent: re-running against an existing row writes nothing and reports whether the stored
 * row matches the plan.
 */
import { EmployeeTipChargeModel, EmployeeTipPayableStatus, EmployeeTipPayoutMode, TipRefundKind } from "@prisma/client";
import { prisma } from "../../src/prisma.js";
import { calculateTipPlatformFeeCents } from "../../src/config/fees.js";
import {
  createEmployeeTipPayableForSuccessfulTip,
  employeeDisputeExposureCents,
  employeeDisputePhaseFromStripeStatus,
} from "../../src/services/employeeTipPayable.service.js";

/** Read-only Stripe facts for one tip (PaymentIntent + latest charge + transfer + disputes). */
export type TransitionTipStripeFacts = {
  livemode: boolean;
  paymentIntentId: string;
  paymentIntentStatus: string;
  amountReceivedCents: number;
  currency: string;
  applicationFeeAmountCents: number | null;
  destinationAccountId: string | null;
  chargeId: string;
  chargeAmountRefundedCents: number;
  chargeTransferId: string | null;
  transferAmountCents: number | null;
  transferDestinationAccountId: string | null;
  transferAmountReversedCents: number | null;
  disputes: { id: string; status: string; amountCents: number }[];
};

export type PlannedPayable = {
  transactionId: string;
  employeeId: string;
  businessId: string;
  routingMode: EmployeeTipPayoutMode;
  chargeModel: EmployeeTipChargeModel;
  status: EmployeeTipPayableStatus;
  grossCents: number;
  platformFeeCents: number;
  payableCents: number;
  transferredCents: number;
  reversedCents: number;
  refundedCents: number;
  disputedOpenCents: number;
  disputedLostCents: number;
  stripeDisputeId: string | null;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  stripeDestinationAccountId: string;
  stripeTransferId: string | null;
};

export type BackfillPlan =
  | { kind: "create"; payable: PlannedPayable }
  | { kind: "already_present"; payable: PlannedPayable; payableId: string; matches: boolean; diffs: string[] }
  | { kind: "blocked"; reasons: string[] };

const PLAN_FIELDS: (keyof PlannedPayable)[] = [
  "employeeId", "businessId", "routingMode", "chargeModel", "status", "grossCents", "platformFeeCents",
  "payableCents", "transferredCents", "reversedCents", "refundedCents", "disputedOpenCents",
  "disputedLostCents", "stripeDisputeId", "stripePaymentIntentId", "stripeChargeId",
  "stripeDestinationAccountId", "stripeTransferId",
];

export async function planTransitionWindowPayable(
  transactionId: string,
  facts: TransitionTipStripeFacts,
): Promise<BackfillPlan> {
  const reasons: string[] = [];
  const tip = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true, amount: true, status: true, employeeId: true, businessId: true, stripePaymentIntentId: true,
      business: { select: { stripeAccountId: true } },
      employee: { select: { stripeAccount: { select: { stripeAccountId: true } } } },
    },
  });
  if (!tip) return { kind: "blocked", reasons: ["tip not found"] };
  if (tip.status !== "success") reasons.push(`tip status ${tip.status}`);
  if (!tip.employeeId) reasons.push("tip has no employee");
  if (tip.stripePaymentIntentId !== facts.paymentIntentId) reasons.push("PaymentIntent differs from tip");

  const grossCents = Math.round(Number(tip.amount) * 100);
  const platformFeeCents = calculateTipPlatformFeeCents(grossCents);
  const payableCents = grossCents - platformFeeCents;

  if (facts.livemode) reasons.push("live-mode Stripe object");
  if (facts.paymentIntentStatus !== "succeeded") reasons.push(`PaymentIntent ${facts.paymentIntentStatus}`);
  if (facts.currency !== "eur") reasons.push(`currency ${facts.currency}`);
  if (facts.amountReceivedCents !== grossCents) reasons.push(`amount_received ${facts.amountReceivedCents} != gross ${grossCents}`);
  if (facts.applicationFeeAmountCents !== platformFeeCents) {
    reasons.push(`application_fee ${facts.applicationFeeAmountCents} != frozen fee ${platformFeeCents}`);
  }
  if (facts.chargeAmountRefundedCents !== 0) reasons.push("charge has refunds; replay refunds through the refund path first");

  let chargeModel: EmployeeTipChargeModel | null = null;
  let routingMode: EmployeeTipPayoutMode | null = null;
  const dest = facts.destinationAccountId;
  if (!dest) reasons.push("no transfer_data.destination (platform_hold backfill is out of scope)");
  else if (dest === tip.business?.stripeAccountId) {
    chargeModel = EmployeeTipChargeModel.destination_business;
    routingMode = EmployeeTipPayoutMode.business_distribution;
  } else if (dest === tip.employee?.stripeAccount?.stripeAccountId) {
    chargeModel = EmployeeTipChargeModel.destination_employee;
    routingMode = EmployeeTipPayoutMode.direct_to_employee;
  } else reasons.push("destination is neither this business nor this employee");

  if (!facts.chargeTransferId) reasons.push("destination charge has no transfer");
  if (facts.transferAmountCents !== grossCents) reasons.push(`transfer ${facts.transferAmountCents} != gross ${grossCents}`);
  if (dest && facts.transferDestinationAccountId !== dest) reasons.push("transfer destination != charge destination");
  if ((facts.transferAmountReversedCents ?? 0) !== 0) reasons.push("transfer has reversals; reconcile manually");

  if (facts.disputes.length > 1) reasons.push("more than one dispute on charge");
  const dispute = facts.disputes[0] ?? null;
  if (dispute) {
    const ledger = await prisma.tipRefund.findUnique({
      where: { stripeDisputeId: dispute.id },
      select: { kind: true, status: true, tipId: true, amountEur: true },
    });
    if (!ledger) reasons.push("dispute has no TipRefund ledger row");
    else {
      if (ledger.kind !== TipRefundKind.dispute) reasons.push(`dispute ledger kind ${ledger.kind}`);
      if (ledger.tipId !== transactionId) reasons.push("dispute ledger row linked to another tip");
      if (employeeDisputePhaseFromStripeStatus(ledger.status) !== employeeDisputePhaseFromStripeStatus(dispute.status)) {
        reasons.push(`dispute ledger status ${ledger.status} != Stripe ${dispute.status}`);
      }
      if (Math.round(Number(ledger.amountEur) * 100) !== dispute.amountCents) reasons.push("dispute ledger amount != Stripe");
    }
  }
  if (reasons.length || !chargeModel || !routingMode || !tip.employeeId || !dest) {
    return { kind: "blocked", reasons };
  }

  const destSettled = chargeModel === EmployeeTipChargeModel.destination_employee;
  let disputedOpenCents = 0;
  let disputedLostCents = 0;
  if (dispute) {
    const exposure = employeeDisputeExposureCents({ payableCents, refundedCents: 0, disputeAmountCents: dispute.amountCents });
    const phase = employeeDisputePhaseFromStripeStatus(dispute.status);
    if (phase === "open") disputedOpenCents = exposure;
    if (phase === "lost") disputedLostCents = exposure;
  }
  const payable: PlannedPayable = {
    transactionId,
    employeeId: tip.employeeId,
    businessId: tip.businessId,
    routingMode,
    chargeModel,
    status: destSettled ? EmployeeTipPayableStatus.destination_settled : EmployeeTipPayableStatus.held_business,
    grossCents,
    platformFeeCents,
    payableCents,
    transferredCents: destSettled ? payableCents : 0,
    reversedCents: 0,
    refundedCents: 0,
    disputedOpenCents,
    disputedLostCents,
    stripeDisputeId: dispute?.id ?? null,
    stripePaymentIntentId: facts.paymentIntentId,
    stripeChargeId: facts.chargeId,
    stripeDestinationAccountId: dest,
    stripeTransferId: facts.chargeTransferId,
  };

  const existing = await prisma.employeeTipPayable.findUnique({ where: { transactionId } });
  if (existing) {
    const diffs = PLAN_FIELDS.filter((f) => existing[f] !== payable[f]).map((f) => `${f}: stored ${existing[f]} != planned ${payable[f]}`);
    return { kind: "already_present", payable, payableId: existing.id, matches: diffs.length === 0, diffs };
  }
  return { kind: "create", payable };
}

export class TransitionBackfillAbort extends Error {
  constructor(public readonly reasons: string[]) {
    super(`backfill aborted: ${reasons.join("; ")}`);
    this.name = "TransitionBackfillAbort";
  }
}

/**
 * Writes one planned payable (and dispute state) atomically. Returns "exists" if another run won.
 * Locks the tip row and re-verifies the tip and dispute ledger against the plan before writing;
 * throws TransitionBackfillAbort (nothing written) if anything changed since planning.
 */
export async function applyTransitionWindowPayable(plan: Extract<BackfillPlan, { kind: "create" }>): Promise<"created" | "exists"> {
  const p = plan.payable;
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { status: string; amount_cents: number; employee_id: string | null; business_id: string; pi: string | null }[]
    >`SELECT status::text AS status, ROUND(amount * 100)::int AS amount_cents, employee_id, business_id,
             stripe_payment_intent_id AS pi
      FROM tips WHERE id = ${p.transactionId} FOR UPDATE`;
    const tip = locked[0];
    const drift: string[] = [];
    if (!tip) drift.push("tip not found");
    else {
      if (tip.status !== "success") drift.push(`tip status ${tip.status}`);
      if (tip.amount_cents !== p.grossCents) drift.push(`tip amount ${tip.amount_cents} != planned ${p.grossCents}`);
      if (tip.employee_id !== p.employeeId) drift.push("tip employee changed");
      if (tip.business_id !== p.businessId) drift.push("tip business changed");
      if (tip.pi !== p.stripePaymentIntentId) drift.push("tip PaymentIntent changed");
    }
    const disputes = await tx.tipRefund.findMany({
      where: { tipId: p.transactionId, kind: TipRefundKind.dispute },
      select: { stripeDisputeId: true, status: true },
    });
    if (p.stripeDisputeId) {
      const d = disputes.find((x) => x.stripeDisputeId === p.stripeDisputeId);
      const phase = d ? employeeDisputePhaseFromStripeStatus(d.status) : null;
      const plannedPhase = p.disputedLostCents > 0 ? "lost" : p.disputedOpenCents > 0 ? "open" : phase;
      if (!d) drift.push("planned dispute ledger row missing");
      else if (phase !== plannedPhase) drift.push(`dispute ledger now ${d.status}`);
      if (disputes.length !== 1) drift.push(`tip has ${disputes.length} dispute ledger rows`);
    } else if (disputes.length) drift.push("tip gained a dispute ledger row");
    const refunds = await tx.tipRefund.count({ where: { tipId: p.transactionId, kind: { not: TipRefundKind.dispute } } });
    if (refunds) drift.push(`tip has ${refunds} refund ledger rows`);
    if (drift.length) throw new TransitionBackfillAbort(drift);

    const before = await tx.employeeTipPayable.findUnique({ where: { transactionId: p.transactionId }, select: { id: true } });
    if (before) return "exists";
    await createEmployeeTipPayableForSuccessfulTip({
      tx,
      transactionId: p.transactionId,
      employeeId: p.employeeId,
      businessId: p.businessId,
      paymentIntentId: p.stripePaymentIntentId,
      grossCents: p.grossCents,
      snapshot: { chargeModel: p.chargeModel, routingMode: p.routingMode, destinationAccountId: p.stripeDestinationAccountId },
      stripeChargeId: p.stripeChargeId,
      destinationTransferId: p.stripeTransferId,
    });
    if (p.stripeDisputeId) {
      await tx.employeeTipPayable.update({
        where: { transactionId: p.transactionId },
        data: {
          stripeDisputeId: p.stripeDisputeId,
          disputedOpenCents: p.disputedOpenCents,
          disputedLostCents: p.disputedLostCents,
        },
      });
    }
    // Errors if the insert was swallowed as P2002 and left this transaction aborted.
    const mine = await tx.employeeTipPayable.findUnique({ where: { transactionId: p.transactionId }, select: { id: true } });
    if (!mine) throw new Error("payable not visible after create");
    return "created";
  }).catch(async (err) => {
    if (err instanceof TransitionBackfillAbort) throw err;
    // A concurrent run's insert surfaces as P2002 (or an aborted transaction after the service swallows it).
    const winner = await prisma.employeeTipPayable.findUnique({ where: { transactionId: p.transactionId }, select: { id: true } });
    if (winner) return "exists" as const;
    throw err;
  });
}
