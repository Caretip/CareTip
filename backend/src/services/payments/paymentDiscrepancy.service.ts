/**
 * Durable payment discrepancies (webhook handlers and the payment reconciliation job).
 * One row per distinct problem (fingerprint = workflow:kind:subject). Recording is idempotent:
 * a repeat sighting bumps `occurrences`/`lastSeenAt` and reopens a resolved row.
 */
import { Prisma, PaymentDiscrepancyStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { captureServerException } from "../../instrument/sentry.js";

export type PaymentWorkflow = "tip" | "qr_order" | "subscription" | "refund";

export type RecordPaymentDiscrepancyInput = {
  workflow: PaymentWorkflow;
  kind: string;
  subjectKey: string;
  businessId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  transactionId?: string | null;
  physicalQrOrderId?: string | null;
  details?: Record<string, unknown>;
  /** Alert ops on first sighting (Sentry). Default true. */
  alert?: boolean;
};

export function paymentDiscrepancyFingerprint(workflow: string, kind: string, subjectKey: string): string {
  return `${workflow}:${kind}:${subjectKey}`.slice(0, 191);
}

/** Returns true when this call opened (or reopened) the discrepancy. */
export async function recordPaymentDiscrepancy(input: RecordPaymentDiscrepancyInput): Promise<boolean> {
  const fingerprint = paymentDiscrepancyFingerprint(input.workflow, input.kind, input.subjectKey);
  const now = new Date();
  const details = (input.details ?? {}) as Prisma.InputJsonValue;
  const existing = await prisma.paymentDiscrepancy.findUnique({
    where: { fingerprint },
    select: { status: true },
  });
  await prisma.paymentDiscrepancy.upsert({
    where: { fingerprint },
    create: {
      fingerprint,
      workflow: input.workflow,
      kind: input.kind,
      subjectKey: input.subjectKey.slice(0, 191),
      businessId: input.businessId ?? null,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
      transactionId: input.transactionId ?? null,
      physicalQrOrderId: input.physicalQrOrderId ?? null,
      details,
    },
    update: {
      occurrences: { increment: 1 },
      lastSeenAt: now,
      details,
      ...(existing && existing.status !== PaymentDiscrepancyStatus.open
        ? { status: PaymentDiscrepancyStatus.open, resolvedAt: null }
        : {}),
    },
  });
  const opened = !existing || existing.status !== PaymentDiscrepancyStatus.open;
  if (opened) {
    console.warn("[payment.discrepancy] opened", {
      workflow: input.workflow,
      kind: input.kind,
      subjectKey: input.subjectKey,
    });
    if (input.alert !== false) {
      captureServerException(new Error(`Payment discrepancy: ${input.workflow}/${input.kind}`), {
        workflow: input.workflow,
        kind: input.kind,
        subjectKey: input.subjectKey,
      });
    }
  }
  return opened;
}

/**
 * Closes open discrepancies for `subjectKey` whose kind is not in `stillPresentKinds`
 * (a later check found that object consistent again).
 */
export async function resolvePaymentDiscrepanciesForSubject(params: {
  workflow: PaymentWorkflow;
  subjectKey: string;
  stillPresentKinds: string[];
  status?: "resolved" | "auto_repaired";
  onlyKinds?: string[];
}): Promise<number> {
  const updated = await prisma.paymentDiscrepancy.updateMany({
    where: {
      workflow: params.workflow,
      subjectKey: params.subjectKey,
      status: PaymentDiscrepancyStatus.open,
      kind: {
        notIn: params.stillPresentKinds,
        ...(params.onlyKinds ? { in: params.onlyKinds } : {}),
      },
    },
    data: {
      status:
        params.status === "auto_repaired"
          ? PaymentDiscrepancyStatus.auto_repaired
          : PaymentDiscrepancyStatus.resolved,
      resolvedAt: new Date(),
    },
  });
  return updated.count;
}
