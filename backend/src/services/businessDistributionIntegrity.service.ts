/**
 * Business-distribution money-integrity observation (detection only).
 * Never creates Stripe objects, transfers, refunds, or ledger mutations.
 */
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  TipStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { remainingPayableCents } from "./employeeTipPayable.service.js";
import { routingModeFromStripeMetadata } from "./employeeTipRouting.service.js";

/** Default age threshold for operational "aged obligation" visibility. */
export const AGED_HELD_BUSINESS_DAYS_DEFAULT = 30;

export type BusinessDistributionIntegrityIssueCode =
  | "orphan_captured_payment_intent"
  | "success_transaction_missing_payable"
  | "payable_charge_model_mismatch"
  | "payable_destination_mismatch"
  | "employee_business_mismatch"
  | "anomalous_platform_hold_business_distribution"
  | "aged_held_business";

export type BusinessDistributionIntegrityIssue = {
  code: BusinessDistributionIntegrityIssueCode;
  businessId: string | null;
  employeeId: string | null;
  paymentIntentId: string | null;
  transactionId: string | null;
  payableId: string | null;
  message: string;
};

export type BusinessDistributionObservability = {
  heldBusinessCents: number;
  heldBusinessRowCount: number;
  agedHeldBusinessRowCount: number;
  agedHeldBusinessCents: number;
  anomalyPlatformHoldRowCount: number;
};

export type BusinessDistributionObligationRow = {
  id: string;
  employeeId: string | null;
  employeeName: string | null;
  createdAt: string;
  grossCents: number;
  platformFeeCents: number;
  payableCents: number;
  refundedCents: number;
  disputedOpenCents: number;
  disputedLostCents: number;
  remainingPayableCents: number;
  status: EmployeeTipPayableStatus;
  chargeModel: EmployeeTipChargeModel;
  isAged: boolean;
};

function issueKey(row: BusinessDistributionIntegrityIssue): string {
  return [
    row.code,
    row.businessId ?? "",
    row.paymentIntentId ?? "",
    row.transactionId ?? "",
    row.payableId ?? "",
  ].join(":");
}

function dedupeIssues(rows: BusinessDistributionIntegrityIssue[]): BusinessDistributionIntegrityIssue[] {
  const seen = new Set<string>();
  const out: BusinessDistributionIntegrityIssue[] = [];
  for (const row of rows) {
    const key = issueKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function isBusinessDistributionPaymentIntentMetadata(
  metadata: Stripe.Metadata | Record<string, string> | null | undefined,
): boolean {
  return routingModeFromStripeMetadata(metadata) === EmployeeTipPayoutMode.business_distribution;
}

export function isCapturedBusinessDistributionPaymentIntent(
  paymentIntent: Pick<Stripe.PaymentIntent, "status" | "amount_received" | "amount">,
): boolean {
  const received = paymentIntent.amount_received ?? 0;
  return paymentIntent.status === "succeeded" && received > 0;
}

/**
 * Read-only classification of a captured PaymentIntent against authoritative DB rows.
 * Safe for tests and ops tools — performs no Stripe mutations.
 */
export function classifyCapturedPaymentIntentLedger(params: {
  paymentIntent: Pick<
    Stripe.PaymentIntent,
    "id" | "status" | "amount_received" | "amount" | "metadata" | "transfer_data"
  >;
  business: { id: string; stripeAccountId: string | null };
  employee: { id: string; businessId: string } | null;
  transaction: { id: string; status: string } | null;
  payable: {
    id: string;
    routingMode: EmployeeTipPayoutMode;
    chargeModel: EmployeeTipChargeModel;
    status: EmployeeTipPayableStatus;
    stripeDestinationAccountId: string | null;
    employeeId: string | null;
  } | null;
}): BusinessDistributionIntegrityIssue[] {
  const issues: BusinessDistributionIntegrityIssue[] = [];
  const md = params.paymentIntent.metadata ?? {};
  const employeeId = typeof md.employeeId === "string" ? md.employeeId.trim() : null;
  const businessId = typeof md.businessId === "string" ? md.businessId.trim() : null;
  const piId = params.paymentIntent.id;

  if (!isBusinessDistributionPaymentIntentMetadata(md)) {
    return issues;
  }
  if (!isCapturedBusinessDistributionPaymentIntent(params.paymentIntent)) {
    return issues;
  }
  if (businessId && businessId !== params.business.id) {
    issues.push({
      code: "employee_business_mismatch",
      businessId,
      employeeId,
      paymentIntentId: piId,
      transactionId: params.transaction?.id ?? null,
      payableId: params.payable?.id ?? null,
      message: "PaymentIntent businessId does not match authoritative business record.",
    });
    return issues;
  }
  if (params.employee && employeeId && params.employee.id !== employeeId) {
    issues.push({
      code: "employee_business_mismatch",
      businessId: params.business.id,
      employeeId,
      paymentIntentId: piId,
      transactionId: params.transaction?.id ?? null,
      payableId: params.payable?.id ?? null,
      message: "PaymentIntent employeeId does not match authoritative employee record.",
    });
  }
  if (params.employee && params.employee.businessId !== params.business.id) {
    issues.push({
      code: "employee_business_mismatch",
      businessId: params.business.id,
      employeeId: params.employee.id,
      paymentIntentId: piId,
      transactionId: params.transaction?.id ?? null,
      payableId: params.payable?.id ?? null,
      message: "Employee does not belong to the business tenant.",
    });
  }

  const dest =
    typeof params.paymentIntent.transfer_data?.destination === "string"
      ? params.paymentIntent.transfer_data.destination.trim()
      : "";
  const expectedBusinessAcct = params.business.stripeAccountId?.trim() ?? "";
  if (dest && expectedBusinessAcct && dest !== expectedBusinessAcct) {
    issues.push({
      code: "payable_destination_mismatch",
      businessId: params.business.id,
      employeeId: params.employee?.id ?? employeeId,
      paymentIntentId: piId,
      transactionId: params.transaction?.id ?? null,
      payableId: params.payable?.id ?? null,
      message: "PaymentIntent destination does not match Business.stripeAccountId.",
    });
  }

  if (!params.transaction) {
    issues.push({
      code: "orphan_captured_payment_intent",
      businessId: params.business.id,
      employeeId: params.employee?.id ?? employeeId,
      paymentIntentId: piId,
      transactionId: null,
      payableId: null,
      message: "Captured business-distribution PaymentIntent has no CareTip Transaction.",
    });
    return issues;
  }

  if (!params.payable) {
    issues.push({
      code: "success_transaction_missing_payable",
      businessId: params.business.id,
      employeeId: params.employee?.id ?? employeeId,
      paymentIntentId: piId,
      transactionId: params.transaction.id,
      payableId: null,
      message: "Successful tip Transaction is missing EmployeeTipPayable.",
    });
    return issues;
  }

  const expectedCharge =
    dest && expectedBusinessAcct && dest === expectedBusinessAcct
      ? EmployeeTipChargeModel.destination_business
      : EmployeeTipChargeModel.platform_hold;

  if (
    params.payable.routingMode === EmployeeTipPayoutMode.business_distribution &&
    params.payable.chargeModel !== expectedCharge &&
    expectedCharge === EmployeeTipChargeModel.destination_business
  ) {
    issues.push({
      code: "payable_charge_model_mismatch",
      businessId: params.business.id,
      employeeId: params.payable.employeeId,
      paymentIntentId: piId,
      transactionId: params.transaction.id,
      payableId: params.payable.id,
      message: "Payable chargeModel disagrees with captured destination-charge PaymentIntent.",
    });
  }

  if (
    params.payable.chargeModel === EmployeeTipChargeModel.destination_business &&
    params.payable.stripeDestinationAccountId &&
    expectedBusinessAcct &&
    params.payable.stripeDestinationAccountId !== expectedBusinessAcct
  ) {
    issues.push({
      code: "payable_destination_mismatch",
      businessId: params.business.id,
      employeeId: params.payable.employeeId,
      paymentIntentId: piId,
      transactionId: params.transaction.id,
      payableId: params.payable.id,
      message: "Payable destination account does not match current Business.stripeAccountId.",
    });
  }

  if (
    params.payable.routingMode === EmployeeTipPayoutMode.business_distribution &&
    params.payable.chargeModel === EmployeeTipChargeModel.platform_hold
  ) {
    issues.push({
      code: "anomalous_platform_hold_business_distribution",
      businessId: params.business.id,
      employeeId: params.payable.employeeId,
      paymentIntentId: piId,
      transactionId: params.transaction.id,
      payableId: params.payable.id,
      message: "Historical anomaly: business_distribution routing with platform_hold charge model.",
    });
  }

  return issues;
}

export async function businessDistributionObservabilityForBusiness(
  businessId: string,
  agedDays = AGED_HELD_BUSINESS_DAYS_DEFAULT,
): Promise<BusinessDistributionObservability> {
  const trimmed = businessId.trim();
  const cutoff = new Date(Date.now() - agedDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.employeeTipPayable.findMany({
    where: {
      businessId: trimmed,
      routingMode: EmployeeTipPayoutMode.business_distribution,
      status: EmployeeTipPayableStatus.held_business,
      chargeModel: EmployeeTipChargeModel.destination_business,
    },
    select: {
      payableCents: true,
      transferredCents: true,
      reversedCents: true,
      refundedCents: true,
      disputedOpenCents: true,
      disputedLostCents: true,
      createdAt: true,
    },
  });

  let heldBusinessCents = 0;
  let agedHeldBusinessCents = 0;
  let agedHeldBusinessRowCount = 0;
  for (const row of rows) {
    const remaining = remainingPayableCents(row);
    if (remaining <= 0) continue;
    heldBusinessCents += remaining;
    if (row.createdAt < cutoff) {
      agedHeldBusinessRowCount += 1;
      agedHeldBusinessCents += remaining;
    }
  }

  const anomalyPlatformHoldRowCount = await prisma.employeeTipPayable.count({
    where: {
      businessId: trimmed,
      routingMode: EmployeeTipPayoutMode.business_distribution,
      chargeModel: EmployeeTipChargeModel.platform_hold,
    },
  });

  return {
    heldBusinessCents,
    heldBusinessRowCount: rows.length,
    agedHeldBusinessRowCount,
    agedHeldBusinessCents,
    anomalyPlatformHoldRowCount,
  };
}

export async function listBusinessDistributionObligationsForBusiness(
  businessId: string,
  params?: { take?: number; skip?: number; agedDays?: number },
): Promise<{ items: BusinessDistributionObligationRow[]; total: number }> {
  const trimmed = businessId.trim();
  const take = Math.min(50, Math.max(1, params?.take ?? 20));
  const skip = Math.min(5_000, Math.max(0, params?.skip ?? 0));
  const agedDays = params?.agedDays ?? AGED_HELD_BUSINESS_DAYS_DEFAULT;
  const cutoff = new Date(Date.now() - agedDays * 24 * 60 * 60 * 1000);
  const where = {
    businessId: trimmed,
    routingMode: EmployeeTipPayoutMode.business_distribution,
    chargeModel: EmployeeTipChargeModel.destination_business,
    status: EmployeeTipPayableStatus.held_business,
  };

  const [total, rows] = await prisma.$transaction([
    prisma.employeeTipPayable.count({ where }),
    prisma.employeeTipPayable.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        employeeId: true,
        createdAt: true,
        grossCents: true,
        platformFeeCents: true,
        payableCents: true,
        refundedCents: true,
        disputedOpenCents: true,
        disputedLostCents: true,
        transferredCents: true,
        reversedCents: true,
        status: true,
        chargeModel: true,
        employee: { select: { name: true } },
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => {
      const remaining = remainingPayableCents(row);
      return {
        id: row.id,
        employeeId: row.employeeId,
        employeeName: row.employee?.name ?? null,
        createdAt: row.createdAt.toISOString(),
        grossCents: row.grossCents,
        platformFeeCents: row.platformFeeCents,
        payableCents: row.payableCents,
        refundedCents: row.refundedCents,
        disputedOpenCents: row.disputedOpenCents,
        disputedLostCents: row.disputedLostCents,
        remainingPayableCents: remaining,
        status: row.status,
        chargeModel: row.chargeModel,
        isAged: row.createdAt < cutoff && remaining > 0,
      };
    }),
  };
}

/** DB-only integrity scan — detection/alerting; never mutates money or ledger. */
export async function scanBusinessDistributionLedgerIssues(options?: {
  businessId?: string;
  agedDays?: number;
}): Promise<BusinessDistributionIntegrityIssue[]> {
  const businessId = options?.businessId?.trim() || undefined;
  const agedDays = options?.agedDays ?? AGED_HELD_BUSINESS_DAYS_DEFAULT;
  const cutoff = new Date(Date.now() - agedDays * 24 * 60 * 60 * 1000);
  const issues: BusinessDistributionIntegrityIssue[] = [];

  const successWithoutPayable = await prisma.transaction.findMany({
    where: {
      status: TipStatus.success,
      employeeId: { not: null },
      employeeTipPayable: { is: null },
      ...(businessId ? { businessId } : {}),
    },
    select: {
      id: true,
      businessId: true,
      employeeId: true,
      stripePaymentIntentId: true,
    },
    take: 500,
  });
  for (const row of successWithoutPayable) {
    issues.push({
      code: "success_transaction_missing_payable",
      businessId: row.businessId,
      employeeId: row.employeeId,
      paymentIntentId: row.stripePaymentIntentId,
      transactionId: row.id,
      payableId: null,
      message: "Successful tip Transaction is missing EmployeeTipPayable.",
    });
  }

  const bizDistPayables = await prisma.employeeTipPayable.findMany({
    where: {
      routingMode: EmployeeTipPayoutMode.business_distribution,
      ...(businessId ? { businessId } : {}),
    },
    select: {
      id: true,
      businessId: true,
      employeeId: true,
      transactionId: true,
      stripePaymentIntentId: true,
      routingMode: true,
      chargeModel: true,
      status: true,
      stripeDestinationAccountId: true,
      createdAt: true,
      payableCents: true,
      transferredCents: true,
      reversedCents: true,
      refundedCents: true,
      disputedOpenCents: true,
      disputedLostCents: true,
      business: { select: { stripeAccountId: true } },
      employee: { select: { businessId: true } },
    },
    take: 2_000,
  });

  for (const row of bizDistPayables) {
    if (row.employee?.businessId && row.employee.businessId !== row.businessId) {
      issues.push({
        code: "employee_business_mismatch",
        businessId: row.businessId,
        employeeId: row.employeeId,
        paymentIntentId: row.stripePaymentIntentId,
        transactionId: row.transactionId,
        payableId: row.id,
        message: "Payable employee is not in the payable business tenant.",
      });
    }

    if (
      row.chargeModel === EmployeeTipChargeModel.destination_business &&
      row.stripeDestinationAccountId &&
      row.business.stripeAccountId &&
      row.stripeDestinationAccountId !== row.business.stripeAccountId
    ) {
      issues.push({
        code: "payable_destination_mismatch",
        businessId: row.businessId,
        employeeId: row.employeeId,
        paymentIntentId: row.stripePaymentIntentId,
        transactionId: row.transactionId,
        payableId: row.id,
        message: "Payable destination account does not match Business.stripeAccountId.",
      });
    }

    if (row.chargeModel === EmployeeTipChargeModel.platform_hold) {
      issues.push({
        code: "anomalous_platform_hold_business_distribution",
        businessId: row.businessId,
        employeeId: row.employeeId,
        paymentIntentId: row.stripePaymentIntentId,
        transactionId: row.transactionId,
        payableId: row.id,
        message: "Historical anomaly: business_distribution routing with platform_hold charge model.",
      });
    }

    if (
      row.chargeModel === EmployeeTipChargeModel.destination_business &&
      row.status === EmployeeTipPayableStatus.held_business &&
      row.createdAt < cutoff &&
      remainingPayableCents(row) > 0
    ) {
      issues.push({
        code: "aged_held_business",
        businessId: row.businessId,
        employeeId: row.employeeId,
        paymentIntentId: row.stripePaymentIntentId,
        transactionId: row.transactionId,
        payableId: row.id,
        message: `held_business obligation older than ${agedDays} days.`,
      });
    }
  }

  return dedupeIssues(issues);
}
