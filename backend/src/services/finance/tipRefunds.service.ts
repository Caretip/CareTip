/**
 * Tip refund / chargeback / dispute ledger — Stripe SSOT.
 * Never invent rows from tip status=failed.
 */
import { Prisma, TipRefundKind, TipRefundStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";

export type TipRefundListItem = {
  id: string;
  businessId: string;
  businessName: string;
  tipId: string | null;
  stripeRefundId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeDisputeId: string | null;
  kind: TipRefundKind;
  status: TipRefundStatus;
  amountEur: number;
  originalAmountEur: number | null;
  currency: string;
  reason: string | null;
  occurredAt: string;
};

async function resolveBusinessFromPaymentIntent(
  paymentIntentId: string | null | undefined,
): Promise<{ businessId: string; tipId: string; amountEur: number } | null> {
  if (!paymentIntentId?.trim()) return null;
  const tip = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId.trim() },
    select: { id: true, businessId: true, amount: true },
  });
  if (!tip) return null;
  return {
    businessId: tip.businessId,
    tipId: tip.id,
    amountEur: Number(tip.amount),
  };
}

export async function upsertStripeRefundEvent(input: {
  stripeRefundId: string;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  amountCents: number;
  currency?: string;
  status: string;
  reason?: string | null;
  occurredAt: Date;
  /** When known from eligibility path */
  businessId?: string | null;
  tipId?: string | null;
}): Promise<void> {
  const linked =
    (await resolveBusinessFromPaymentIntent(input.stripePaymentIntentId)) ??
    (input.businessId
      ? {
          businessId: input.businessId,
          tipId: input.tipId ?? null,
          amountEur: input.amountCents / 100,
        }
      : null);
  if (!linked?.businessId) {
    console.warn("[tipRefunds] skip refund — no business link", {
      stripeRefundId: input.stripeRefundId,
      paymentIntentId: input.stripePaymentIntentId,
    });
    return;
  }

  const statusMap: Record<string, TipRefundStatus> = {
    pending: TipRefundStatus.pending,
    requires_action: TipRefundStatus.pending,
    succeeded: TipRefundStatus.succeeded,
    failed: TipRefundStatus.failed,
    canceled: TipRefundStatus.canceled,
    cancelled: TipRefundStatus.canceled,
  };
  const status = statusMap[String(input.status).toLowerCase()] ?? TipRefundStatus.pending;
  const alreadyApplied =
    (
      await prisma.tipRefund.findUnique({
        where: { stripeRefundId: input.stripeRefundId },
        select: { status: true },
      })
    )?.status === TipRefundStatus.succeeded;
  const amountEur = Number((input.amountCents / 100).toFixed(2));

  await prisma.tipRefund.upsert({
    where: { stripeRefundId: input.stripeRefundId },
    create: {
      businessId: linked.businessId,
      tipId: linked.tipId ?? input.tipId ?? null,
      stripeRefundId: input.stripeRefundId,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeChargeId: input.stripeChargeId ?? null,
      kind: TipRefundKind.refund,
      status,
      amountEur,
      currency: (input.currency ?? "eur").toLowerCase(),
      reason: input.reason?.slice(0, 120) ?? null,
      originalAmountEur: linked.amountEur ?? null,
      occurredAt: input.occurredAt,
    },
    update: {
      status,
      amountEur,
      reason: input.reason?.slice(0, 120) ?? undefined,
      stripeChargeId: input.stripeChargeId ?? undefined,
      tipId: linked.tipId ?? undefined,
    },
  });
  const tipId = linked.tipId ?? input.tipId ?? null;
  if (status === TipRefundStatus.succeeded && !alreadyApplied && tipId) {
    const { applyRefundToEmployeePayable } = await import("../employeeTipPayable.service.js");
    await applyRefundToEmployeePayable({
      transactionId: tipId,
      refundedCents: input.amountCents,
    });
  }
}

function mapStripeDisputeStatus(statusRaw: string): TipRefundStatus {
  const s = String(statusRaw).toLowerCase();
  if (s === "won" || s === "warning_closed") return TipRefundStatus.won;
  if (s === "lost" || s === "charge_refunded") return TipRefundStatus.lost;
  return TipRefundStatus.needs_response;
}

function mergeDisputeLedgerStatus(
  previous: TipRefundStatus | undefined,
  incoming: TipRefundStatus,
): TipRefundStatus {
  const terminal = (status: TipRefundStatus) =>
    status === TipRefundStatus.won || status === TipRefundStatus.lost;
  if (previous && terminal(previous) && !terminal(incoming)) return previous;
  return incoming;
}

async function resolveBusinessFromChargeId(
  stripeChargeId: string | null | undefined,
): Promise<{ businessId: string; tipId: string; amountEur: number } | null> {
  const chargeId = stripeChargeId?.trim();
  if (!chargeId) return null;
  const payable = await prisma.employeeTipPayable.findFirst({
    where: { stripeChargeId: chargeId },
    select: { businessId: true, transactionId: true, transaction: { select: { amount: true } } },
  });
  if (!payable) return null;
  return {
    businessId: payable.businessId,
    tipId: payable.transactionId,
    amountEur: Number(payable.transaction.amount),
  };
}

export async function upsertStripeDisputeEvent(input: {
  stripeDisputeId: string;
  stripeChargeId?: string | null;
  stripePaymentIntentId?: string | null;
  amountCents: number;
  currency?: string;
  status: string;
  reason?: string | null;
  occurredAt: Date;
  stripeEventAccount?: string | null;
}): Promise<void> {
  const linked =
    (await resolveBusinessFromPaymentIntent(input.stripePaymentIntentId)) ??
    (await resolveBusinessFromChargeId(input.stripeChargeId));
  if (!linked?.businessId) {
    console.warn("[tipRefunds] skip dispute — no business link", {
      stripeDisputeId: input.stripeDisputeId,
    });
    return;
  }

  const incomingStatus = mapStripeDisputeStatus(input.status);
  const existing = await prisma.tipRefund.findUnique({
    where: { stripeDisputeId: input.stripeDisputeId },
    select: { status: true },
  });
  const status = mergeDisputeLedgerStatus(existing?.status, incomingStatus);
  const amountEur = Number((input.amountCents / 100).toFixed(2));

  await prisma.tipRefund.upsert({
    where: { stripeDisputeId: input.stripeDisputeId },
    create: {
      businessId: linked.businessId,
      tipId: linked.tipId,
      stripeDisputeId: input.stripeDisputeId,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeChargeId: input.stripeChargeId ?? null,
      kind: TipRefundKind.dispute,
      status,
      amountEur,
      currency: (input.currency ?? "eur").toLowerCase(),
      reason: input.reason?.slice(0, 120) ?? null,
      originalAmountEur: linked.amountEur,
      occurredAt: input.occurredAt,
    },
    update: {
      status,
      amountEur,
      reason: input.reason?.slice(0, 120) ?? undefined,
      stripeChargeId: input.stripeChargeId ?? undefined,
      tipId: linked.tipId ?? undefined,
    },
  });

  if (linked.tipId) {
    const { applyDisputeToEmployeePayable } = await import("../employeeTipPayable.service.js");
    const phaseStatus =
      status === TipRefundStatus.won ? "won" : status === TipRefundStatus.lost ? "lost" : input.status;
    const result = await applyDisputeToEmployeePayable({
      transactionId: linked.tipId,
      stripeDisputeId: input.stripeDisputeId,
      disputeAmountCents: input.amountCents,
      stripeStatus: phaseStatus,
      stripeEventAccount: input.stripeEventAccount,
    });
    if (result === "skipped_mismatch") {
      console.warn("[tipRefunds] dispute payable skipped — connected account mismatch", {
        stripeDisputeId: input.stripeDisputeId,
      });
    }
  }
}

export async function listTipRefunds(params: {
  q?: string;
  take?: number;
  skip?: number;
  kind?: string;
  status?: string;
}): Promise<{
  total: number;
  items: TipRefundListItem[];
  ledgerAvailable: true;
  /** Sum of ledger amounts for the filtered set — never part of tip GMV. */
  ledgerTotalEur: number;
}> {
  const take = Math.min(Math.max(params.take ?? 50, 1), 100);
  const skip = Math.max(params.skip ?? 0, 0);
  const where = buildTipRefundWhere(params);

  const [total, rows, sumRow] = await Promise.all([
    prisma.tipRefund.count({ where }),
    prisma.tipRefund.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take,
      skip,
      include: { business: { select: { name: true } } },
    }),
    prisma.tipRefund.aggregate({ where, _sum: { amountEur: true } }),
  ]);

  return {
    ledgerAvailable: true,
    total,
    ledgerTotalEur: Number(sumRow._sum.amountEur ?? 0),
    items: rows.map(mapTipRefundRow),
  };
}

function buildTipRefundWhere(params: {
  q?: string;
  kind?: string;
  status?: string;
}): Prisma.TipRefundWhereInput {
  const q = params.q?.trim();
  const and: Prisma.TipRefundWhereInput[] = [];

  if (q) {
    and.push({
      OR: [
        { stripeRefundId: { contains: q, mode: "insensitive" } },
        { stripeDisputeId: { contains: q, mode: "insensitive" } },
        { stripePaymentIntentId: { contains: q, mode: "insensitive" } },
        { tipId: { contains: q, mode: "insensitive" } },
        { business: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const kindRaw = params.kind?.trim().toLowerCase();
  if (kindRaw && kindRaw !== "all") {
    if (kindRaw === "chargeback" || kindRaw === "chargebacks") {
      and.push({ kind: { in: [TipRefundKind.chargeback, TipRefundKind.dispute] } });
    } else if (kindRaw === "refund" || kindRaw === "refunds") {
      and.push({ kind: TipRefundKind.refund });
    } else if (kindRaw === "dispute" || kindRaw === "disputes") {
      and.push({ kind: TipRefundKind.dispute });
    }
  }

  const statusRaw = params.status?.trim().toLowerCase();
  if (statusRaw && statusRaw !== "all") {
    const statusMap: Record<string, TipRefundStatus> = {
      pending: TipRefundStatus.pending,
      succeeded: TipRefundStatus.succeeded,
      failed: TipRefundStatus.failed,
      canceled: TipRefundStatus.canceled,
      cancelled: TipRefundStatus.canceled,
      needs_response: TipRefundStatus.needs_response,
      won: TipRefundStatus.won,
      lost: TipRefundStatus.lost,
    };
    const status = statusMap[statusRaw];
    if (status) and.push({ status });
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

function mapTipRefundRow(r: {
  id: string;
  businessId: string;
  business: { name: string };
  tipId: string | null;
  stripeRefundId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeDisputeId: string | null;
  kind: TipRefundKind;
  status: TipRefundStatus;
  amountEur: Prisma.Decimal | number;
  originalAmountEur: Prisma.Decimal | number | null;
  currency: string;
  reason: string | null;
  occurredAt: Date;
}): TipRefundListItem {
  return {
    id: r.id,
    businessId: r.businessId,
    businessName: r.business.name,
    tipId: r.tipId,
    stripeRefundId: r.stripeRefundId,
    stripePaymentIntentId: r.stripePaymentIntentId,
    stripeChargeId: r.stripeChargeId,
    stripeDisputeId: r.stripeDisputeId,
    kind: r.kind,
    status: r.status,
    amountEur: Number(r.amountEur),
    originalAmountEur: r.originalAmountEur != null ? Number(r.originalAmountEur) : null,
    currency: r.currency,
    reason: r.reason,
    occurredAt: r.occurredAt.toISOString(),
  };
}

/** CSV export for admin refund ledger — never includes tip GMV. */
export async function exportTipRefundsCsv(params: {
  q?: string;
  kind?: string;
  status?: string;
}): Promise<string> {
  const where = buildTipRefundWhere(params);
  const rows = await prisma.tipRefund.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 5_000,
    include: { business: { select: { name: true } } },
  });

  const header = [
    "id",
    "kind",
    "status",
    "amount_eur",
    "original_amount_eur",
    "currency",
    "business",
    "tip_id",
    "stripe_refund_id",
    "stripe_dispute_id",
    "stripe_payment_intent_id",
    "reason",
    "occurred_at",
  ];
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    const item = mapTipRefundRow(r);
    lines.push(
      [
        item.id,
        item.kind,
        item.status,
        item.amountEur.toFixed(2),
        item.originalAmountEur != null ? item.originalAmountEur.toFixed(2) : "",
        item.currency,
        item.businessName,
        item.tipId ?? "",
        item.stripeRefundId ?? "",
        item.stripeDisputeId ?? "",
        item.stripePaymentIntentId ?? "",
        item.reason ?? "",
        item.occurredAt,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}
