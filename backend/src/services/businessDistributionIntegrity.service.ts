/**
 * Business-distribution money-integrity observation (detection only).
 * Never creates Stripe objects, transfers, refunds, or ledger mutations.
 */
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Prisma,
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
  | "aged_held_business"
  | "distribution_allocation_exceeds_payable"
  | "distribution_allocation_tenant_mismatch";

export type BusinessDistributionScanCoverage = {
  successWithoutPayableExamined: number;
  successWithoutPayableTruncated: boolean;
  businessDistributionPayablesExamined: number;
  businessDistributionPayablesTruncated: boolean;
  allocationAnomaliesTruncated: boolean;
  /** False when any capped query hit its limit — absence of issues is then not proof of health. */
  complete: boolean;
};

const SCAN_LIMIT_SUCCESS_WITHOUT_PAYABLE = 500;
const SCAN_LIMIT_BUSINESS_DISTRIBUTION_PAYABLES = 2_000;
const SCAN_LIMIT_ALLOCATION_ANOMALIES = 500;

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

type ScanOptions = {
  businessId?: string;
  agedDays?: number;
  limits?: {
    successWithoutPayable?: number;
    businessDistributionPayables?: number;
    allocationAnomalies?: number;
  };
};

/** DB-only integrity scan — detection/alerting; never mutates money or ledger. */
export async function scanBusinessDistributionLedgerIssues(
  options?: ScanOptions,
): Promise<BusinessDistributionIntegrityIssue[]> {
  return (await scanBusinessDistributionLedgerWithCoverage(options)).issues;
}

/** Same scan as {@link scanBusinessDistributionLedgerIssues}, plus whether capped queries were truncated. */
export async function scanBusinessDistributionLedgerWithCoverage(options?: ScanOptions): Promise<{
  issues: BusinessDistributionIntegrityIssue[];
  coverage: BusinessDistributionScanCoverage;
}> {
  const businessId = options?.businessId?.trim() || undefined;
  const agedDays = options?.agedDays ?? AGED_HELD_BUSINESS_DAYS_DEFAULT;
  const cutoff = new Date(Date.now() - agedDays * 24 * 60 * 60 * 1000);
  const limitMissing = options?.limits?.successWithoutPayable ?? SCAN_LIMIT_SUCCESS_WITHOUT_PAYABLE;
  const limitPayables =
    options?.limits?.businessDistributionPayables ?? SCAN_LIMIT_BUSINESS_DISTRIBUTION_PAYABLES;
  const limitAllocations = options?.limits?.allocationAnomalies ?? SCAN_LIMIT_ALLOCATION_ANOMALIES;
  const issues: BusinessDistributionIntegrityIssue[] = [];

  const successWithoutPayableRaw = await prisma.transaction.findMany({
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
    orderBy: { createdAt: "asc" },
    take: limitMissing + 1,
  });
  const successWithoutPayableTruncated = successWithoutPayableRaw.length > limitMissing;
  const successWithoutPayable = successWithoutPayableRaw.slice(0, limitMissing);
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

  const bizDistPayablesRaw = await prisma.employeeTipPayable.findMany({
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
    orderBy: { createdAt: "asc" },
    take: limitPayables + 1,
  });
  const businessDistributionPayablesTruncated = bizDistPayablesRaw.length > limitPayables;
  const bizDistPayables = bizDistPayablesRaw.slice(0, limitPayables);

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

  // Allocations above remainingPayableCents are expected after a post-distribution refund/dispute
  // (surfaced as overDistributedCents in tip distribution); only gross payableCents is a hard ceiling.
  const businessFilter = businessId ? Prisma.sql`AND p.business_id = ${businessId}` : Prisma.empty;
  const allocationAnomaliesRaw = await prisma.$queryRaw<
    Array<{
      payable_id: string;
      business_id: string;
      employee_id: string | null;
      transaction_id: string;
      stripe_payment_intent_id: string;
      payable_cents: number;
      allocated_cents: number;
      foreign_allocation_rows: number;
    }>
  >(Prisma.sql`
    SELECT
      p.id AS payable_id,
      p.business_id,
      p.employee_id,
      p.transaction_id,
      p.stripe_payment_intent_id,
      p.payable_cents,
      SUM(a.amount_cents)::int AS allocated_cents,
      COUNT(*) FILTER (WHERE a.business_id <> p.business_id)::int AS foreign_allocation_rows
    FROM employee_tip_distribution_allocations a
    JOIN employee_tip_payables p ON p.id = a.employee_tip_payable_id
    WHERE TRUE ${businessFilter}
    GROUP BY p.id
    HAVING SUM(a.amount_cents) > p.payable_cents
        OR COUNT(*) FILTER (WHERE a.business_id <> p.business_id) > 0
    ORDER BY p.id
    LIMIT ${limitAllocations + 1}
  `);
  const allocationAnomaliesTruncated = allocationAnomaliesRaw.length > limitAllocations;
  for (const row of allocationAnomaliesRaw.slice(0, limitAllocations)) {
    const base = {
      businessId: row.business_id,
      employeeId: row.employee_id,
      paymentIntentId: row.stripe_payment_intent_id,
      transactionId: row.transaction_id,
      payableId: row.payable_id,
    };
    if (row.allocated_cents > row.payable_cents) {
      issues.push({
        ...base,
        code: "distribution_allocation_exceeds_payable",
        message: `Distribution allocations (${row.allocated_cents}¢) exceed payableCents (${row.payable_cents}¢).`,
      });
    }
    if (row.foreign_allocation_rows > 0) {
      issues.push({
        ...base,
        code: "distribution_allocation_tenant_mismatch",
        message: "Distribution allocation business differs from the payable business.",
      });
    }
  }

  return {
    issues: dedupeIssues(issues),
    coverage: {
      successWithoutPayableExamined: successWithoutPayable.length,
      successWithoutPayableTruncated,
      businessDistributionPayablesExamined: bizDistPayables.length,
      businessDistributionPayablesTruncated,
      allocationAnomaliesTruncated,
      complete:
        !successWithoutPayableTruncated &&
        !businessDistributionPayablesTruncated &&
        !allocationAnomaliesTruncated,
    },
  };
}
