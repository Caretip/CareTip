/**
 * Dispute evidence: suggest → admin edits and reviews → admin submits. Never automatic.
 *
 * The suggestion contains only facts CareTip holds or Stripe returned (payment record, card checks,
 * refunds, order details). It never states that a service was delivered, that the cardholder authorised
 * the payment, or that a refund was refused; an admin writes any such statement after checking it.
 * Only Stripe's text evidence fields (API 2025-02-24.acacia) are accepted. File evidence is uploaded in
 * the Stripe Dashboard.
 */
import type Stripe from "stripe";
import { StripeDisputeInvestigationStatus, StripeDisputeSubjectKind } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { getStripeClient } from "../stripe.service.js";
import { logServerError } from "../../utils/httpErrors.js";
import { runSerializedByKey } from "../../utils/serializedByKey.js";
import {
  isNeedsResponseStripeDisputeStatus,
  retrieveStripeDispute,
  syncStripeDisputeFromStripe,
} from "./stripeDisputeProjection.service.js";
import { notifyStripeDisputeEvent } from "./stripeDisputeNotify.service.js";

/** Stripe dispute evidence fields that take text (files are excluded). */
export const STRIPE_TEXT_EVIDENCE_FIELDS = [
  "access_activity_log",
  "billing_address",
  "cancellation_policy_disclosure",
  "cancellation_rebuttal",
  "customer_email_address",
  "customer_name",
  "customer_purchase_ip",
  "duplicate_charge_explanation",
  "duplicate_charge_id",
  "product_description",
  "refund_policy_disclosure",
  "refund_refusal_explanation",
  "service_date",
  "shipping_address",
  "shipping_carrier",
  "shipping_date",
  "shipping_tracking_number",
  "uncategorized_text",
] as const;
export type StripeTextEvidenceField = (typeof STRIPE_TEXT_EVIDENCE_FIELDS)[number];
export type EvidenceDraft = Partial<Record<StripeTextEvidenceField, string>>;

const FIELD_MAX = 20_000;
const TOTAL_MAX = 150_000;

export class DisputeEvidenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "DisputeEvidenceError";
  }
}

export function sanitizeEvidenceDraft(raw: unknown): EvidenceDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DisputeEvidenceError("INVALID_EVIDENCE", "Evidence must be an object of text fields.");
  }
  const out: EvidenceDraft = {};
  let total = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(STRIPE_TEXT_EVIDENCE_FIELDS as readonly string[]).includes(key)) {
      throw new DisputeEvidenceError("UNKNOWN_EVIDENCE_FIELD", `Unsupported evidence field: ${key.slice(0, 40)}`);
    }
    if (value == null || value === "") continue;
    if (typeof value !== "string") throw new DisputeEvidenceError("INVALID_EVIDENCE", `${key} must be text.`);
    const text = value.replace(/\r\n/g, "\n").trim();
    if (!text) continue;
    if (text.length > FIELD_MAX) throw new DisputeEvidenceError("EVIDENCE_TOO_LONG", `${key} is longer than ${FIELD_MAX} characters.`);
    total += text.length;
    out[key as StripeTextEvidenceField] = text;
  }
  if (total > TOTAL_MAX) throw new DisputeEvidenceError("EVIDENCE_TOO_LONG", "Evidence is longer than Stripe allows.");
  return out;
}

const normalizeEvidenceText = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

/**
 * Stripe returns the stored evidence text on the dispute object, so the submission can be checked field
 * by field. Files are not compared (they are uploaded in the Stripe Dashboard). Returns the draft fields
 * whose stored text differs; empty means Stripe stored exactly what was reviewed.
 */
export function compareStoredEvidence(draft: EvidenceDraft, stored: Record<string, unknown> | null | undefined): string[] {
  const mismatched: string[] = [];
  for (const [field, text] of Object.entries(draft)) {
    if (normalizeEvidenceText(stored?.[field]) !== normalizeEvidenceText(text)) mismatched.push(field);
  }
  return mismatched;
}

export function evidenceDraftHash(draft: EvidenceDraft): string {
  const ordered = Object.fromEntries(Object.entries(draft).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex").slice(0, 24);
}

export type EvidenceSuggestion = {
  draft: EvidenceDraft;
  /** Where each suggested value came from, shown next to the field. */
  sources: Partial<Record<StripeTextEvidenceField, string>>;
  facts: Array<{ label: string; value: string; source: string }>;
};

const fmtCents = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** Facts only, from CareTip records and the Stripe charge. Nothing is claimed that the data doesn't show. */
export async function buildEvidenceSuggestion(disputeRowId: string): Promise<EvidenceSuggestion> {
  const row = await prisma.stripeDispute.findUnique({
    where: { id: disputeRowId },
    include: { business: { select: { name: true } } },
  });
  if (!row) throw new DisputeEvidenceError("NOT_FOUND", "Dispute not found.", 404);
  const dispute = await retrieveStripeDispute(row.stripeDisputeId, row.stripeEventAccountId);
  const charge = dispute.charge && typeof dispute.charge === "object" ? (dispute.charge as Stripe.Charge) : null;

  const draft: EvidenceDraft = {};
  const sources: EvidenceSuggestion["sources"] = {};
  const facts: EvidenceSuggestion["facts"] = [];
  const billing = charge?.billing_details;
  if (billing?.email) {
    draft.customer_email_address = billing.email;
    sources.customer_email_address = "Stripe charge billing details";
  }
  if (billing?.name) {
    draft.customer_name = billing.name;
    sources.customer_name = "Stripe charge billing details";
  }

  const lines: string[] = [];
  if (charge) {
    lines.push(`Stripe charge ${charge.id}, created ${new Date(charge.created * 1000).toISOString()}, amount ${fmtCents(charge.amount, charge.currency)}.`);
    const card = charge.payment_method_details?.card;
    if (card) {
      const checks = card.checks;
      lines.push(
        `Card: ${card.brand ?? "unknown"} ending ${card.last4 ?? "????"}, CVC check ${checks?.cvc_check ?? "not provided"}, ` +
          `postcode check ${checks?.address_postal_code_check ?? "not provided"}.`,
      );
      const tds = (card as { three_d_secure?: { result?: string; authentication_flow?: string } | null }).three_d_secure;
      if (tds?.result) lines.push(`3D Secure result reported by Stripe: ${tds.result}.`);
    }
    if (charge.amount_refunded > 0) {
      lines.push(`Refunded before this response: ${fmtCents(charge.amount_refunded, charge.currency)} (Stripe charge).`);
    } else {
      lines.push("No refund has been issued on this charge (Stripe charge).");
    }
  }

  if (row.transactionId) {
    const tip = await prisma.transaction.findUnique({
      where: { id: row.transactionId },
      select: { createdAt: true, amount: true, receiptNumber: true, employee: { select: { name: true } } },
    });
    if (tip) {
      draft.product_description =
        `Voluntary tip (gratuity) paid by the cardholder through a CareTip QR code at ${row.business?.name ?? "the venue"}` +
        `${tip.employee?.name ? ` for ${tip.employee.name}` : ""}. The amount was entered by the cardholder on the payment page.`;
      sources.product_description = "CareTip tip record";
      lines.push(
        `CareTip tip record${tip.receiptNumber ? ` ${tip.receiptNumber}` : ""}, created ${tip.createdAt.toISOString()}, amount ${Number(tip.amount).toFixed(2)} EUR.`,
      );
      facts.push({ label: "Tip created", value: tip.createdAt.toISOString(), source: "CareTip tip record" });
    }
  } else if (row.physicalQrOrderId) {
    const order = await prisma.physicalQrOrder.findUnique({
      where: { id: row.physicalQrOrderId },
      select: { id: true, paidAt: true, quantity: true, fulfillmentStatus: true, trackingNumber: true, shippedAt: true },
    });
    if (order) {
      draft.product_description = `Printed CareTip QR code stands ordered by the business ${row.business?.name ?? ""} (order ${order.id}, quantity ${order.quantity}).`.trim();
      sources.product_description = "CareTip QR order";
      if (order.trackingNumber) {
        draft.shipping_tracking_number = order.trackingNumber;
        sources.shipping_tracking_number = "CareTip QR order";
      }
      lines.push(`QR order ${order.id}, fulfilment status ${order.fulfillmentStatus}${order.paidAt ? `, paid ${order.paidAt.toISOString()}` : ""}${order.shippedAt ? `, marked shipped ${order.shippedAt.toISOString()}` : ""}.`);
    }
  } else if (row.subjectKind === StripeDisputeSubjectKind.subscription) {
    draft.product_description = `CareTip Pro subscription for the business ${row.business?.name ?? ""}.`.trim();
    sources.product_description = "CareTip subscription record";
  }

  if (lines.length) {
    draft.uncategorized_text = lines.join("\n");
    sources.uncategorized_text = "Stripe charge and CareTip records (facts only)";
  }
  facts.push({ label: "Stripe reason", value: row.stripeReason ?? "unknown", source: "Stripe dispute" });
  if (row.evidenceDueBy) facts.push({ label: "Evidence due by", value: row.evidenceDueBy.toISOString(), source: "Stripe dispute" });
  return { draft, sources, facts };
}

export async function saveEvidenceDraft(args: { disputeRowId: string; adminUserId: string; draft: unknown }) {
  const draft = sanitizeEvidenceDraft(args.draft);
  const row = await prisma.stripeDispute.update({
    where: { id: args.disputeRowId },
    data: {
      evidenceDraft: draft,
      evidenceDraftUpdatedAt: new Date(),
      evidenceDraftUpdatedBy: args.adminUserId,
      investigationStatus: StripeDisputeInvestigationStatus.evidence_in_preparation,
    },
    select: { evidenceDraftUpdatedAt: true },
  });
  await prisma.auditLog.create({
    data: {
      userId: args.adminUserId,
      action: "stripe_dispute.evidence_draft_saved",
      metadata: JSON.stringify({ disputeRowId: args.disputeRowId, fields: Object.keys(draft), hash: evidenceDraftHash(draft) }),
    },
  });
  return { draft, hash: evidenceDraftHash(draft), updatedAt: row.evidenceDraftUpdatedAt!.toISOString() };
}

/**
 * Submits the saved draft to Stripe. `reviewedHash` must equal the saved draft: the admin confirms the
 * exact text being sent. The result is taken from Stripe (submission_count / status), not assumed.
 */
export async function submitEvidence(args: { disputeRowId: string; adminUserId: string; reviewedHash: unknown }) {
  return runSerializedByKey(`dispute_evidence:${args.disputeRowId}`, async () => {
    const head = await prisma.stripeDispute.findUnique({ where: { id: args.disputeRowId } });
    if (!head) throw new DisputeEvidenceError("NOT_FOUND", "Dispute not found.", 404);
    await syncStripeDisputeFromStripe(head.stripeDisputeId, { source: "admin", stripeEventAccount: head.stripeEventAccountId });
    const row = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: head.id } });
    const draft = sanitizeEvidenceDraft(row.evidenceDraft ?? {});
    if (Object.keys(draft).length === 0) throw new DisputeEvidenceError("EVIDENCE_EMPTY", "Save the evidence before submitting it.");
    if (typeof args.reviewedHash !== "string" || args.reviewedHash !== evidenceDraftHash(draft)) {
      throw new DisputeEvidenceError("EVIDENCE_CHANGED", "The evidence changed since you reviewed it. Review it again.", 409);
    }
    if (!isNeedsResponseStripeDisputeStatus(row.stripeStatus)) {
      throw new DisputeEvidenceError("NOT_ACCEPTING_EVIDENCE", `Stripe is not accepting evidence (status ${row.stripeStatus}).`, 409);
    }
    if (row.evidencePastDue || (row.evidenceDueBy && row.evidenceDueBy.getTime() <= Date.now())) {
      throw new DisputeEvidenceError("EVIDENCE_DEADLINE_PASSED", "The Stripe evidence deadline has passed.", 409);
    }
    const before = row.evidenceSubmissionCount;
    await prisma.auditLog.create({
      data: {
        userId: args.adminUserId,
        action: "stripe_dispute.evidence_submit_requested",
        metadata: JSON.stringify({ stripeDisputeId: row.stripeDisputeId, fields: Object.keys(draft), hash: evidenceDraftHash(draft) }),
      },
    });
    try {
      await getStripeClient().disputes.update(
        row.stripeDisputeId,
        { evidence: draft, submit: true },
        {
          idempotencyKey: `dispute_evidence:${row.stripeDisputeId}:${evidenceDraftHash(draft)}`,
          ...(row.stripeEventAccountId ? { stripeAccount: row.stripeEventAccountId } : {}),
        },
      );
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const message = String(e.message ?? "Stripe did not accept the evidence.").replace(/sk_(live|test)_[A-Za-z0-9]+/g, "sk_***").slice(0, 300);
      await prisma.stripeDispute.update({
        where: { id: row.id },
        data: { evidenceLastError: message, evidenceLastErrorAt: new Date() },
      });
      logServerError("stripeDispute.evidence.submit", err, { stripeDisputeId: row.stripeDisputeId });
      await notifyStripeDisputeEvent(row.id, "evidence_failed", evidenceDraftHash(draft));
      throw new DisputeEvidenceError("STRIPE_REJECTED_EVIDENCE", message, 502);
    }
    await syncStripeDisputeFromStripe(row.stripeDisputeId, { source: "admin", stripeEventAccount: row.stripeEventAccountId });
    const after = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: row.id } });
    const confirmed = after.evidenceSubmissionCount > before || after.stripeStatus === "under_review" || after.stripeStatus === "warning_under_review";
    // Read back what Stripe stored and compare it with the reviewed text.
    const stored = await retrieveStripeDispute(row.stripeDisputeId, row.stripeEventAccountId);
    const mismatched = compareStoredEvidence(draft, stored.evidence as unknown as Record<string, unknown>);
    await prisma.stripeDispute.update({
      where: { id: row.id },
      data: confirmed
        ? {
            evidenceSubmittedAt: new Date(),
            evidenceSubmittedBy: args.adminUserId,
            evidenceVerifiedAt: new Date(),
            evidenceVerificationMismatch: mismatched,
            evidenceLastError: mismatched.length
              ? `Stripe stored different text for: ${mismatched.join(", ")}. Check the dispute in the Stripe Dashboard.`.slice(0, 300)
              : null,
            evidenceLastErrorAt: mismatched.length ? new Date() : null,
            investigationStatus: StripeDisputeInvestigationStatus.awaiting_stripe_decision,
          }
        : { evidenceLastError: "Stripe did not confirm the submission yet. Sync again before retrying.", evidenceLastErrorAt: new Date() },
    });
    return { confirmed, verified: confirmed && mismatched.length === 0, mismatched, stripeStatus: after.stripeStatus, submissionCount: after.evidenceSubmissionCount };
  });
}
