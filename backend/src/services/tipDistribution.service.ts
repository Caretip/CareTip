/**
 * Off-platform employee tip distribution for business_distribution routing.
 * EmployeeTipPayable remains authoritative for entitlement; distribution records
 * represent what the business says it paid employees outside CareTip/Stripe.
 */
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Prisma,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { remainingPayableCents, type EmployeePayableMoneyRow } from "./employeeTipPayable.service.js";
import { businessDistributionObservabilityForBusiness } from "./businessDistributionIntegrity.service.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";

export type TipDistributionEmployeeRow = {
  employeeId: string | null;
  employeeName: string | null;
  grossCents: number;
  platformFeeCents: number;
  netEntitlementCents: number;
  distributedCents: number;
  remainingCents: number;
  tipCount: number;
  overDistributedCents: number;
};

export type TipDistributionSummary = {
  routingMode: EmployeeTipPayoutMode;
  totalToDistributeCents: number;
  employeesAwaitingCount: number;
  lastDistributionAt: string | null;
  lastDistributionActorName: string | null;
  sinceLastDistribution: {
    tipCount: number;
    grossCents: number;
    platformFeeCents: number;
    netCents: number;
  } | null;
};

export type TipDistributionBatchListRow = {
  id: string;
  completedAt: string;
  totalAmountCents: number;
  employeeCount: number;
  paymentReference: string | null;
  actorName: string | null;
};

export type TipDistributionBatchDetail = {
  id: string;
  completedAt: string;
  totalAmountCents: number;
  employeeCount: number;
  paymentReference: string | null;
  notes: string | null;
  actorName: string | null;
  items: Array<{
    id: string;
    employeeId: string | null;
    employeeName: string | null;
    amountCents: number;
    paymentReference: string | null;
    allocations: Array<{
      payableId: string;
      amountCents: number;
      transactionId: string;
    }>;
  }>;
};

export type CreateTipDistributionInput = {
  businessId: string;
  actorUserId: string;
  idempotencyKey: string;
  paymentReference?: string | null;
  notes?: string | null;
  items: Array<{
    employeeId: string;
    amountCents: number;
    paymentReference?: string | null;
  }>;
};

export class TipDistributionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type PayableAllocationRow = EmployeePayableMoneyRow & {
  id: string;
  employeeId: string | null;
  createdAt: Date;
  allocatedCents: number;
  grossCents: number;
  platformFeeCents: number;
};

function remainingDistributableCents(row: PayableAllocationRow): number {
  const obligation = remainingPayableCents(row);
  const distributable = obligation - row.allocatedCents;
  return distributable > 0 ? distributable : 0;
}

function overDistributedCents(row: PayableAllocationRow): number {
  const obligation = remainingPayableCents(row);
  const excess = row.allocatedCents - obligation;
  return excess > 0 ? excess : 0;
}

async function loadAllocationTotalsByPayable(
  businessId: string,
  payableIds?: string[],
): Promise<Map<string, number>> {
  const rows = await prisma.employeeTipDistributionAllocation.groupBy({
    by: ["employeeTipPayableId"],
    where: {
      businessId,
      ...(payableIds?.length ? { employeeTipPayableId: { in: payableIds } } : {}),
    },
    _sum: { amountCents: true },
  });
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.employeeTipPayableId, row._sum.amountCents ?? 0);
  }
  return map;
}

async function loadEligiblePayables(
  businessId: string,
  employeeId?: string,
): Promise<PayableAllocationRow[]> {
  const payables = await prisma.employeeTipPayable.findMany({
    where: {
      businessId,
      routingMode: EmployeeTipPayoutMode.business_distribution,
      chargeModel: EmployeeTipChargeModel.destination_business,
      status: EmployeeTipPayableStatus.held_business,
      ...(employeeId ? { employeeId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      employeeId: true,
      createdAt: true,
      payableCents: true,
      transferredCents: true,
      reversedCents: true,
      refundedCents: true,
      disputedOpenCents: true,
      disputedLostCents: true,
      grossCents: true,
      platformFeeCents: true,
    },
  });
  const allocationTotals = await loadAllocationTotalsByPayable(
    businessId,
    payables.map((p) => p.id),
  );
  return payables.map((p) => ({
    ...p,
    allocatedCents: allocationTotals.get(p.id) ?? 0,
  }));
}

function aggregateEmployees(rows: PayableAllocationRow[]): TipDistributionEmployeeRow[] {
  const byEmployee = new Map<string, TipDistributionEmployeeRow>();

  for (const row of rows) {
    const key = row.employeeId ?? "__unassigned__";
    const remaining = remainingDistributableCents(row);
    const over = overDistributedCents(row);
    const existing = byEmployee.get(key) ?? {
      employeeId: row.employeeId,
      employeeName: null,
      grossCents: 0,
      platformFeeCents: 0,
      netEntitlementCents: 0,
      distributedCents: 0,
      remainingCents: 0,
      tipCount: 0,
      overDistributedCents: 0,
    };
    existing.grossCents += row.grossCents;
    existing.platformFeeCents += row.platformFeeCents;
    existing.netEntitlementCents += row.payableCents;
    existing.distributedCents += row.allocatedCents;
    existing.remainingCents += remaining;
    existing.overDistributedCents += over;
    if (remaining > 0 || row.allocatedCents > 0) {
      existing.tipCount += 1;
    }
    byEmployee.set(key, existing);
  }

  return [...byEmployee.values()]
    .filter((row) => row.distributedCents > 0 || row.remainingCents > 0 || row.overDistributedCents > 0)
    .sort((a, b) => (b.remainingCents - a.remainingCents) || (a.employeeName ?? "").localeCompare(b.employeeName ?? ""));
}

export async function listTipDistributionEmployeesForBusiness(
  businessId: string,
): Promise<{ items: TipDistributionEmployeeRow[] }> {
  const trimmed = businessId.trim();
  const payables = await loadEligiblePayables(trimmed);
  const items = aggregateEmployees(payables);

  const employeeIds = items
    .map((row) => row.employeeId)
    .filter((id): id is string => Boolean(id));
  if (employeeIds.length > 0) {
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds }, businessId: trimmed },
      select: { id: true, name: true },
    });
    const nameById = new Map(employees.map((e) => [e.id, e.name]));
    for (const row of items) {
      if (row.employeeId) row.employeeName = nameById.get(row.employeeId) ?? null;
    }
  }

  return { items };
}

export async function loadTipDistributionSummaryForBusiness(
  businessId: string,
): Promise<TipDistributionSummary> {
  const trimmed = businessId.trim();
  const [business, payables, lastBatch] = await Promise.all([
    prisma.business.findUnique({
      where: { id: trimmed },
      select: { employeeTipPayoutMode: true },
    }),
    loadEligiblePayables(trimmed),
    prisma.employeeTipDistributionBatch.findFirst({
      where: { businessId: trimmed },
      orderBy: { completedAt: "desc" },
      select: {
        completedAt: true,
        actor: { select: { email: true } },
      },
    }),
  ]);

  const routingMode = business?.employeeTipPayoutMode ?? EmployeeTipPayoutMode.business_distribution;
  const employees = aggregateEmployees(payables);
  const totalToDistributeCents = employees.reduce((sum, row) => sum + row.remainingCents, 0);
  const employeesAwaitingCount = employees.filter((row) => row.remainingCents > 0 && row.employeeId).length;

  let sinceLastDistribution: TipDistributionSummary["sinceLastDistribution"] = null;
  if (lastBatch) {
    const boundary = lastBatch.completedAt;
    let tipCount = 0;
    let grossCents = 0;
    let platformFeeCents = 0;
    let netCents = 0;
    for (const row of payables) {
      if (row.createdAt <= boundary) continue;
      const remaining = remainingDistributableCents(row);
      if (remaining <= 0) continue;
      tipCount += 1;
      grossCents += row.grossCents;
      platformFeeCents += row.platformFeeCents;
      netCents += remaining;
    }
    sinceLastDistribution = { tipCount, grossCents, platformFeeCents, netCents };
  }

  return {
    routingMode,
    totalToDistributeCents,
    employeesAwaitingCount,
    lastDistributionAt: lastBatch?.completedAt.toISOString() ?? null,
    lastDistributionActorName: lastBatch?.actor.email ?? null,
    sinceLastDistribution,
  };
}

export async function listTipDistributionBatchesForBusiness(
  businessId: string,
  params?: { skip?: number; take?: number },
): Promise<{ items: TipDistributionBatchListRow[]; total: number }> {
  const trimmed = businessId.trim();
  const skip = Math.min(5_000, Math.max(0, params?.skip ?? 0));
  const take = Math.min(50, Math.max(1, params?.take ?? 20));

  const [total, rows] = await prisma.$transaction([
    prisma.employeeTipDistributionBatch.count({ where: { businessId: trimmed } }),
    prisma.employeeTipDistributionBatch.findMany({
      where: { businessId: trimmed },
      orderBy: { completedAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        completedAt: true,
        totalAmountCents: true,
        employeeCount: true,
        paymentReference: true,
        actor: { select: { email: true } },
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      completedAt: row.completedAt.toISOString(),
      totalAmountCents: row.totalAmountCents,
      employeeCount: row.employeeCount,
      paymentReference: row.paymentReference,
      actorName: row.actor.email,
    })),
  };
}

export async function getTipDistributionBatchForBusiness(
  businessId: string,
  batchId: string,
): Promise<TipDistributionBatchDetail | null> {
  const trimmedBusinessId = businessId.trim();
  const trimmedBatchId = batchId.trim();
  const batch = await prisma.employeeTipDistributionBatch.findFirst({
    where: { id: trimmedBatchId, businessId: trimmedBusinessId },
    select: {
      id: true,
      completedAt: true,
      totalAmountCents: true,
      employeeCount: true,
      paymentReference: true,
      notes: true,
      actor: { select: { email: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          employeeId: true,
          amountCents: true,
          paymentReference: true,
          employee: { select: { name: true } },
          allocations: {
            orderBy: { createdAt: "asc" },
            select: {
              amountCents: true,
              payable: { select: { id: true, transactionId: true } },
            },
          },
        },
      },
    },
  });
  if (!batch) return null;

  return {
    id: batch.id,
    completedAt: batch.completedAt.toISOString(),
    totalAmountCents: batch.totalAmountCents,
    employeeCount: batch.employeeCount,
    paymentReference: batch.paymentReference,
    notes: batch.notes,
    actorName: batch.actor.email,
    items: batch.items.map((item) => ({
      id: item.id,
      employeeId: item.employeeId,
      employeeName: item.employee?.name ?? null,
      amountCents: item.amountCents,
      paymentReference: item.paymentReference,
      allocations: item.allocations.map((allocation) => ({
        payableId: allocation.payable.id,
        amountCents: allocation.amountCents,
        transactionId: allocation.payable.transactionId,
      })),
    })),
  };
}

function normalizeIdempotencyKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 160) {
    throw new TipDistributionError("INVALID_IDEMPOTENCY_KEY", "Invalid idempotency key.");
  }
  return trimmed;
}

function allocateFifo(
  payables: PayableAllocationRow[],
  amountCents: number,
): Array<{ payableId: string; amountCents: number }> {
  let remaining = amountCents;
  const allocations: Array<{ payableId: string; amountCents: number }> = [];
  for (const payable of payables) {
    if (remaining <= 0) break;
    const distributable = remainingDistributableCents(payable);
    if (distributable <= 0) continue;
    const slice = Math.min(distributable, remaining);
    allocations.push({ payableId: payable.id, amountCents: slice });
    payable.allocatedCents += slice;
    remaining -= slice;
  }
  if (remaining > 0) {
    throw new TipDistributionError(
      "DISTRIBUTION_EXCEEDS_REMAINING",
      "Distribution amount exceeds remaining employee entitlement.",
    );
  }
  return allocations;
}

export async function createTipDistributionBatch(
  input: CreateTipDistributionInput,
): Promise<TipDistributionBatchDetail> {
  const businessId = input.businessId.trim();
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!input.items.length) {
    throw new TipDistributionError("EMPTY_DISTRIBUTION", "At least one employee distribution is required.");
  }

  return runSerializedByKey(`tip-distribution:${businessId}`, async () => {
    const existing = await prisma.employeeTipDistributionBatch.findUnique({
      where: { businessId_idempotencyKey: { businessId, idempotencyKey } },
      select: { id: true },
    });
    if (existing) {
      const detail = await getTipDistributionBatchForBusiness(businessId, existing.id);
      if (!detail) {
        throw new TipDistributionError("IDEMPOTENCY_REPLAY_FAILED", "Unable to load existing distribution batch.");
      }
      return detail;
    }

    const normalizedItems = input.items.map((item) => {
      const employeeId = item.employeeId.trim();
      const amountCents = item.amountCents;
      if (!employeeId) {
        throw new TipDistributionError("INVALID_EMPLOYEE", "Invalid employee id.");
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new TipDistributionError("INVALID_DISTRIBUTION_AMOUNT", "Distribution amount must be a positive integer of cents.");
      }
      return {
        employeeId,
        amountCents,
        paymentReference: item.paymentReference?.trim() || null,
      };
    });

    const employeeIds = [...new Set(normalizedItems.map((item) => item.employeeId))];
    const employees = await prisma.employee.findMany({
      where: { businessId, id: { in: employeeIds } },
      select: { id: true },
    });
    if (employees.length !== employeeIds.length) {
      throw new TipDistributionError("EMPLOYEE_NOT_FOUND", "One or more employees were not found for this business.");
    }

    const batchId = await prisma.$transaction(async (tx) => {
      const payablesByEmployee = new Map<string, PayableAllocationRow[]>();
      for (const employeeId of employeeIds) {
        const lockedPayables = await tx.$queryRaw<
          Array<{
            id: string;
            employee_id: string | null;
            created_at: Date;
            payable_cents: number;
            transferred_cents: number;
            reversed_cents: number;
            refunded_cents: number;
            disputed_open_cents: number;
            disputed_lost_cents: number;
            gross_cents: number;
            platform_fee_cents: number;
          }>
        >(Prisma.sql`
          SELECT
            p.id,
            p.employee_id,
            p.created_at,
            p.payable_cents,
            p.transferred_cents,
            p.reversed_cents,
            p.refunded_cents,
            p.disputed_open_cents,
            p.disputed_lost_cents,
            p.gross_cents,
            p.platform_fee_cents
          FROM employee_tip_payables p
          WHERE p.business_id = ${businessId}
            AND p.employee_id = ${employeeId}
            AND p.routing_mode = 'business_distribution'
            AND p.charge_model = 'destination_business'
            AND p.status = 'held_business'
          ORDER BY p.created_at ASC
          FOR UPDATE
        `);

        const payableIds = lockedPayables.map((row) => row.id);
        const allocationTotals = payableIds.length
          ? await tx.employeeTipDistributionAllocation.groupBy({
              by: ["employeeTipPayableId"],
              where: { employeeTipPayableId: { in: payableIds } },
              _sum: { amountCents: true },
            })
          : [];
        const allocatedByPayable = new Map(
          allocationTotals.map((row) => [row.employeeTipPayableId, row._sum.amountCents ?? 0]),
        );

        payablesByEmployee.set(
          employeeId,
          lockedPayables.map((row) => ({
            id: row.id,
            employeeId: row.employee_id,
            createdAt: row.created_at,
            payableCents: row.payable_cents,
            transferredCents: row.transferred_cents,
            reversedCents: row.reversed_cents,
            refundedCents: row.refunded_cents,
            disputedOpenCents: row.disputed_open_cents,
            disputedLostCents: row.disputed_lost_cents,
            grossCents: row.gross_cents,
            platformFeeCents: row.platform_fee_cents,
            allocatedCents: allocatedByPayable.get(row.id) ?? 0,
          })),
        );
      }

      const plannedItems: Array<{
        employeeId: string;
        amountCents: number;
        paymentReference: string | null;
        allocations: Array<{ payableId: string; amountCents: number }>;
      }> = [];

      for (const item of normalizedItems) {
        const payables = payablesByEmployee.get(item.employeeId) ?? [];
        const allocations = allocateFifo(payables, item.amountCents);
        plannedItems.push({
          employeeId: item.employeeId,
          amountCents: item.amountCents,
          paymentReference: item.paymentReference,
          allocations,
        });
      }

      const totalAmountCents = plannedItems.reduce((sum, item) => sum + item.amountCents, 0);
      if (totalAmountCents <= 0) {
        throw new TipDistributionError("EMPTY_DISTRIBUTION", "Distribution total must be greater than zero.");
      }

      const completedAt = new Date();
      const batch = await tx.employeeTipDistributionBatch.create({
        data: {
          businessId,
          actorUserId: input.actorUserId,
          completedAt,
          totalAmountCents,
          employeeCount: plannedItems.length,
          idempotencyKey,
          paymentReference: input.paymentReference?.trim() || null,
          notes: input.notes?.trim() || null,
        },
      });

      for (const item of plannedItems) {
        const createdItem = await tx.employeeTipDistributionItem.create({
          data: {
            batchId: batch.id,
            businessId,
            employeeId: item.employeeId,
            amountCents: item.amountCents,
            paymentReference: item.paymentReference,
          },
        });
        for (const allocation of item.allocations) {
          await tx.employeeTipDistributionAllocation.create({
            data: {
              itemId: createdItem.id,
              businessId,
              employeeTipPayableId: allocation.payableId,
              amountCents: allocation.amountCents,
            },
          });
        }
      }

      return batch.id;
    });

    const detail = await getTipDistributionBatchForBusiness(businessId, batchId);
    if (!detail) {
      throw new TipDistributionError("DISTRIBUTION_CREATE_FAILED", "Distribution batch was created but could not be loaded.");
    }
    return detail;
  });
}

export type BusinessDistributionObligationSnapshot = {
  remainingDistributableCents: number;
  payableRowCount: number;
};

/** Authoritative remaining business-distribution obligation minus recorded off-platform distributions. */
export async function businessDistributionRemainingObligationForBusiness(
  businessId: string,
): Promise<BusinessDistributionObligationSnapshot> {
  const payables = await loadEligiblePayables(businessId.trim());
  let totalRemainingCents = 0;
  let payableRowCount = 0;
  for (const row of payables) {
    const remaining = remainingDistributableCents(row);
    if (remaining > 0) {
      totalRemainingCents += remaining;
      payableRowCount += 1;
    }
  }
  return { remainingDistributableCents: totalRemainingCents, payableRowCount };
}

/** Authoritative remaining business-distribution obligation minus recorded off-platform distributions. */
export async function totalRemainingDistributableCentsForBusiness(businessId: string): Promise<number> {
  const snapshot = await businessDistributionRemainingObligationForBusiness(businessId);
  return snapshot.remainingDistributableCents;
}

/** Cross-check against held-business observability without double-counting allocations. */
export async function reconcileDistributionObligationCents(businessId: string): Promise<{
  heldBusinessRemainingCents: number;
  recordedRemainingCents: number;
}> {
  const [observability, recorded] = await Promise.all([
    businessDistributionObservabilityForBusiness(businessId),
    totalRemainingDistributableCentsForBusiness(businessId),
  ]);
  return {
    heldBusinessRemainingCents: observability.heldBusinessCents,
    recordedRemainingCents: recorded,
  };
}
