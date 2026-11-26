/**
 * Platform-admin read model and internal (non-Stripe) edits for disputes. Admins can change only CareTip
 * operational fields here; Stripe status, amounts, evidence state and funds come from syncs only.
 */
import { Prisma, StripeDisputeInvestigationStatus, StripeDisputeRecoveryStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { evidenceDraftHash, sanitizeEvidenceDraft } from "./stripeDisputeEvidence.service.js";
import { recoveryTarget } from "./stripeDisputeRecovery.service.js";
import { explainDispute } from "./stripeDisputeExplain.service.js";

export const DISPUTE_VIEWS = [
  "all",
  "open",
  "needs_evidence",
  "deadline_soon",
  "awaiting_decision",
  "won",
  "lost",
  "funds_withdrawn",
  "funds_reinstated",
  "recovery_attention",
  "recovery_outstanding",
  "sync_errors",
] as const;
export type DisputeView = (typeof DISPUTE_VIEWS)[number];

function viewWhere(view: DisputeView, now: Date): Prisma.StripeDisputeWhereInput {
  switch (view) {
    case "open":
      return { stripeStatus: { in: ["needs_response", "under_review", "warning_needs_response", "warning_under_review"] } };
    case "needs_evidence":
      return { stripeStatus: { in: ["needs_response", "warning_needs_response"] } };
    case "deadline_soon":
      return {
        stripeStatus: { in: ["needs_response", "warning_needs_response"] },
        evidenceDueBy: { gt: now, lt: new Date(now.getTime() + 7 * 86_400_000) },
      };
    case "awaiting_decision":
      return { stripeStatus: { in: ["under_review", "warning_under_review"] } };
    case "won":
      return { stripeStatus: { in: ["won", "warning_closed"] } };
    case "lost":
      return { stripeStatus: "lost" };
    case "funds_withdrawn":
      return { fundsWithdrawnCents: { gt: 0 } };
    case "funds_reinstated":
      return { fundsReinstatedCents: { gt: 0 } };
    case "recovery_attention":
      return {
        recoveryStatus: {
          in: [
            StripeDisputeRecoveryStatus.review_required,
            StripeDisputeRecoveryStatus.in_progress,
            StripeDisputeRecoveryStatus.failed,
            StripeDisputeRecoveryStatus.partially_recovered,
            StripeDisputeRecoveryStatus.outstanding,
          ],
        },
      };
    case "recovery_outstanding":
      return { recoveryStatus: { in: [StripeDisputeRecoveryStatus.outstanding, StripeDisputeRecoveryStatus.partially_recovered] }, recoveryCancelledAt: null };
    case "sync_errors":
      return { lastSyncError: { not: null } };
    default:
      return {};
  }
}

export function parseDisputeView(raw: unknown): DisputeView {
  return (DISPUTE_VIEWS as readonly string[]).includes(String(raw)) ? (raw as DisputeView) : "all";
}

const listSelect = {
  id: true,
  stripeDisputeId: true,
  stripeStatus: true,
  stripeReason: true,
  amountCents: true,
  currency: true,
  livemode: true,
  subjectKind: true,
  businessId: true,
  business: { select: { name: true } },
  evidenceDueBy: true,
  evidenceSubmissionCount: true,
  evidencePastDue: true,
  fundsWithdrawnCents: true,
  fundsReinstatedCents: true,
  investigationStatus: true,
  recoveryStatus: true,
  recoveredCents: true,
  stripeCreatedAt: true,
  lastStripeSyncAt: true,
  lastSyncError: true,
} satisfies Prisma.StripeDisputeSelect;

export async function listDisputesForAdmin(params: { view?: unknown; q?: unknown; take?: unknown; skip?: unknown }) {
  const view = parseDisputeView(params.view);
  const take = Math.min(Math.max(Number(params.take) || 25, 1), 100);
  const skip = Math.min(Math.max(Number(params.skip) || 0, 0), 100_000);
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const and: Prisma.StripeDisputeWhereInput[] = [viewWhere(view, new Date())];
  if (q) {
    and.push({
      OR: [
        { stripeDisputeId: { contains: q, mode: "insensitive" } },
        { stripeChargeId: { contains: q, mode: "insensitive" } },
        { stripePaymentIntentId: { contains: q, mode: "insensitive" } },
        { destinationTransferId: { contains: q, mode: "insensitive" } },
        { business: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.StripeDisputeWhereInput = { AND: and };
  const [total, items] = await Promise.all([
    prisma.stripeDispute.count({ where }),
    prisma.stripeDispute.findMany({ where, select: listSelect, orderBy: { stripeCreatedAt: "desc" }, take, skip }),
  ]);
  return {
    view,
    total,
    items: items.map((r) => ({
      ...r,
      businessName: r.business?.name ?? null,
      business: undefined,
      evidenceDueBy: r.evidenceDueBy?.toISOString() ?? null,
      stripeCreatedAt: r.stripeCreatedAt.toISOString(),
      lastStripeSyncAt: r.lastStripeSyncAt.toISOString(),
    })),
  };
}

export async function disputeSummaryForAdmin() {
  const now = new Date();
  const views: DisputeView[] = ["open", "needs_evidence", "deadline_soon", "awaiting_decision", "lost", "recovery_attention", "sync_errors"];
  const counts = await Promise.all(views.map((v) => prisma.stripeDispute.count({ where: viewWhere(v, now) })));
  return Object.fromEntries(views.map((v, i) => [v, counts[i]]));
}

export async function getDisputeDetailForAdmin(id: string) {
  const row = await prisma.stripeDispute.findUnique({
    where: { id },
    include: {
      business: { select: { id: true, name: true } },
      recoveryAttempts: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!row) return null;
  const employee = row.employeeId
    ? await prisma.employee.findUnique({ where: { id: row.employeeId }, select: { id: true, name: true } })
    : null;
  const payable = row.transactionId
    ? await prisma.employeeTipPayable.findUnique({
        where: { transactionId: row.transactionId },
        select: {
          chargeModel: true,
          payableCents: true,
          transferredCents: true,
          reversedCents: true,
          refundedCents: true,
          disputedOpenCents: true,
          disputedLostCents: true,
          stripeTransferId: true,
        },
      })
    : null;
  let evidenceDraftHashValue: string | null = null;
  try {
    evidenceDraftHashValue = row.evidenceDraft ? evidenceDraftHash(sanitizeEvidenceDraft(row.evidenceDraft)) : null;
  } catch {
    evidenceDraftHashValue = null;
  }
  // Outstanding chargeback exposure for review: what could still be recovered, from CareTip records
  // (the recovered amount itself comes from Stripe reversals).
  const target = row.stripeStatus === "lost" ? await recoveryTarget(row) : null;
  const cap = target ? (row.recoveryApprovedCents != null ? Math.min(row.recoveryApprovedCents, target.targetCents) : target.targetCents) : 0;
  const recoveryExposureCents = target && !row.recoveryCancelledAt ? Math.max(0, cap - row.recoveredCents) : 0;
  const approver = row.recoveryApprovedBy
    ? await prisma.user.findUnique({ where: { id: row.recoveryApprovedBy }, select: { email: true } })
    : null;
  const payment = row.transactionId
    ? await prisma.transaction.findUnique({ where: { id: row.transactionId }, select: { createdAt: true } })
    : null;
  // Plain-language summary for non-technical admins, computed on the server.
  const explanation = explainDispute(row, {
    businessName: row.business?.name ?? null,
    employeeName: employee?.name ?? null,
    paymentDate: payment?.createdAt ?? null,
    platformHoldTransferredCents: payable?.chargeModel === "platform_hold" ? payable.transferredCents : null,
    outstandingCents: recoveryExposureCents,
  });
  return {
    ...row,
    explanation,
    notifiedKeys: undefined,
    recoveryClaimedAt: undefined,
    recoveryExposureCents,
    recoveryTargetCents: target?.targetCents ?? 0,
    employee,
    payable,
    evidenceDraftHash: evidenceDraftHashValue,
    recoveryApprovedByEmail: approver?.email ?? null,
  };
}

export async function updateDisputeInternalFields(args: {
  id: string;
  adminUserId: string;
  investigationStatus?: unknown;
  internalNotes?: unknown;
}) {
  const data: Prisma.StripeDisputeUpdateInput = {};
  if (args.investigationStatus !== undefined) {
    const v = String(args.investigationStatus);
    if (!(Object.values(StripeDisputeInvestigationStatus) as string[]).includes(v)) {
      throw Object.assign(new Error("Unknown investigation status."), { httpStatus: 400 });
    }
    data.investigationStatus = v as StripeDisputeInvestigationStatus;
  }
  if (args.internalNotes !== undefined) {
    if (args.internalNotes !== null && typeof args.internalNotes !== "string") {
      throw Object.assign(new Error("Notes must be text."), { httpStatus: 400 });
    }
    data.internalNotes = args.internalNotes ? String(args.internalNotes).slice(0, 10_000) : null;
  }
  if (Object.keys(data).length === 0) throw Object.assign(new Error("Nothing to update."), { httpStatus: 400 });
  await prisma.stripeDispute.update({ where: { id: args.id }, data });
  await prisma.auditLog.create({
    data: {
      userId: args.adminUserId,
      action: "stripe_dispute.internal_updated",
      metadata: JSON.stringify({ disputeRowId: args.id, fields: Object.keys(data) }),
    },
  });
}
