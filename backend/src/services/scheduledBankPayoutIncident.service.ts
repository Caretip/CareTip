/**
 * Phase C — durable scheduled bank payout operational incidents + platform-admin notifications.
 */
import {
  BusinessBankPayoutSchedule,
  ScheduledPayoutFailureClassification,
  ScheduledPayoutReconciliationStatus,
  ScheduledPayoutOpsIncidentStatus,
  StripeConnectScheduledPayoutRequestStatus,
  type Prisma,
  type ScheduledPayoutOpsIncident,
  type ScheduledPayoutOpsIncidentCategory,
  type ScheduledPayoutOpsIncidentPayoutType,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { isPrismaUniqueViolation } from "../utils/prismaErrors.js";
import { platformAdminIncidentRecipientWhere } from "../lib/platformAdminAccess.js";
import {
  SCHEDULED_PAYOUT_INCIDENT_LEDGER_BATCH,
  SCHEDULED_PAYOUT_INCIDENT_OPEN_RESOLVE_BATCH,
  scheduledPayoutIncidentOverdueMinutes,
} from "../config/scheduledPayoutIncident.config.js";
import {
  SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS,
  type ScheduledPayoutLedgerSnapshot,
} from "./scheduledBankPayoutRecovery.service.js";
import {
  businessScheduledLedgerSnapshot,
  employeeScheduledLedgerSnapshot,
} from "./scheduledBankPayoutLedger.util.js";
import {
  classifyScheduledPayoutLedgerIncidents,
  incidentCategoryStillActive,
  type ScheduledPayoutLedgerIncidentInput,
} from "./scheduledBankPayoutIncident.classify.js";
import {
  processScheduledPayoutIncidentDeliveries,
  type IncidentDeliveryMetrics,
} from "./scheduledBankPayoutIncidentDelivery.service.js";

export type ScheduledPayoutIncidentSyncTrigger = "payout_tick_ok" | "payout_tick_failed" | "standalone_job";

export type ScheduledPayoutIncidentSyncResult = {
  observedLedgers: number;
  incidentsOpened: number;
  incidentsUpdated: number;
  incidentsResolved: number;
  notificationsAttempted: number;
  notificationsDelivered: number;
  skippedMissingTable: boolean;
  noAdminRecipients: boolean;
  syncTrigger: ScheduledPayoutIncidentSyncTrigger;
  delivery: IncidentDeliveryMetrics;
  syncSuccess: boolean;
};

export function actionableEmployeeScheduledPayoutLedgerWhere(): Prisma.EmployeeStripeScheduledPayoutRequestWhereInput {
  return {
    OR: [
      { reconciliationStatus: ScheduledPayoutReconciliationStatus.inconclusive },
      { reconciliationStatus: ScheduledPayoutReconciliationStatus.required },
      { blockedReason: "retry_exhausted" },
      { blockedReason: "reconciliation_inconclusive" },
      { blockedReason: "reconciliation_required" },
      { blockedReason: "stale_pending_no_stripe_match" },
      { blockedReason: "stale_pending_reconcile" },
      { blockedReason: "permanent_failure" },
      { attemptCount: { gte: SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS } },
      { failureClassification: ScheduledPayoutFailureClassification.outcome_uncertain },
    ],
  };
}

export function actionableBusinessScheduledPayoutLedgerWhere(): Prisma.StripeConnectScheduledPayoutRequestWhereInput {
  return {
    OR: [
      { reconciliationStatus: ScheduledPayoutReconciliationStatus.inconclusive },
      { reconciliationStatus: ScheduledPayoutReconciliationStatus.required },
      { blockedReason: "retry_exhausted" },
      { blockedReason: "reconciliation_inconclusive" },
      { blockedReason: "reconciliation_required" },
      { blockedReason: "stale_pending_no_stripe_match" },
      { blockedReason: "stale_pending_reconcile" },
      { blockedReason: "permanent_failure" },
      { attemptCount: { gte: SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS } },
      { failureClassification: ScheduledPayoutFailureClassification.outcome_uncertain },
    ],
  };
}

function isMissingIncidentTableError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "P2021" || code === "42P01";
}

let missingTableLogged = false;

function logMissingIncidentTableOnce(): void {
  if (missingTableLogged) return;
  missingTableLogged = true;
  console.warn(
    JSON.stringify({
      event: "scheduled_payout_incident_table_missing",
      hint: "Apply scheduled_payout_ops_incidents migration for Phase C alerts",
    }),
  );
}

function payoutOverdue(accountDueAt: Date | null | undefined, now: Date): boolean {
  if (!accountDueAt) return false;
  const thresholdMs = scheduledPayoutIncidentOverdueMinutes() * 60 * 1000;
  return accountDueAt.getTime() + thresholdMs <= now.getTime();
}

function ledgerIncidentInputFromEmployeeRow(
  row: Awaited<ReturnType<typeof loadEmployeeLedgerRows>>[number],
  now: Date,
): { input: ScheduledPayoutLedgerIncidentInput; subjectLabel: string; payoutOverdue: boolean } {
  const snapshot = employeeScheduledLedgerSnapshot(row);
  const dueAt = row.employeeStripeAccount?.bankPayoutNextScheduledAt ?? null;
  const subjectLabel =
    row.employeeStripeAccount?.employee?.name?.trim() ||
    row.employeeStripeAccount?.employee?.business?.name?.trim() ||
    "Employee payout";
  const schedule = row.employeeStripeAccount?.bankPayoutSchedule;
  const overdue =
    accountScheduleEligibleForOverdue(schedule) && payoutOverdue(dueAt, now);
  return {
    subjectLabel,
    payoutOverdue: overdue,
    input: {
      snapshot,
      status: row.status,
      blockedReason: row.blockedReason,
      failureClassification: row.failureClassification,
      reconciliationStatus: row.reconciliationStatus,
      attemptCount: row.attemptCount,
      correlationId: row.correlationId,
      stripePayoutId: row.stripePayoutId,
      failureCode: row.failureCode,
    },
  };
}

function ledgerIncidentInputFromBusinessRow(
  row: Awaited<ReturnType<typeof loadBusinessLedgerRows>>[number],
  now: Date,
): { input: ScheduledPayoutLedgerIncidentInput; subjectLabel: string; payoutOverdue: boolean } {
  const snapshot = businessScheduledLedgerSnapshot(row);
  const dueAt = row.business?.bankPayoutNextScheduledAt ?? null;
  const subjectLabel = row.business?.name?.trim() || "Business payout";
  const schedule = row.business?.bankPayoutSchedule;
  const overdue =
    accountScheduleEligibleForOverdue(schedule) && payoutOverdue(dueAt, now);
  return {
    subjectLabel,
    payoutOverdue: overdue,
    input: {
      snapshot,
      status: row.status,
      blockedReason: row.blockedReason,
      failureClassification: row.failureClassification,
      reconciliationStatus: row.reconciliationStatus,
      attemptCount: row.attemptCount,
      correlationId: row.correlationId,
      stripePayoutId: row.stripePayoutId,
      failureCode: row.failureCode,
    },
  };
}

async function loadEmployeeLedgerRows() {
  return prisma.employeeStripeScheduledPayoutRequest.findMany({
    where: actionableEmployeeScheduledPayoutLedgerWhere(),
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: SCHEDULED_PAYOUT_INCIDENT_LEDGER_BATCH,
    include: {
      employeeStripeAccount: {
        select: {
          bankPayoutNextScheduledAt: true,
          bankPayoutSchedule: true,
          employee: { select: { name: true, business: { select: { name: true } } } },
        },
      },
    },
  });
}

async function loadBusinessLedgerRows() {
  return prisma.stripeConnectScheduledPayoutRequest.findMany({
    where: actionableBusinessScheduledPayoutLedgerWhere(),
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: SCHEDULED_PAYOUT_INCIDENT_LEDGER_BATCH,
    include: {
      business: { select: { name: true, bankPayoutNextScheduledAt: true, bankPayoutSchedule: true } },
    },
  });
}

function incidentUpsertMetadata(classified: ReturnType<typeof classifyScheduledPayoutLedgerIncidents>[number]) {
  return {
    severity: classified.severity,
    category: classified.category,
  };
}

export async function applyScheduledPayoutIncidentUpsertToExisting(
  existing: ScheduledPayoutOpsIncident,
  args: {
    scheduleWindowKey: string | null;
    subjectLabel: string;
    classified: ReturnType<typeof classifyScheduledPayoutLedgerIncidents>[number];
    now: Date;
  },
): Promise<"updated" | "reopened" | "unchanged"> {
  const metadata = incidentUpsertMetadata(args.classified);

  if (existing.status === ScheduledPayoutOpsIncidentStatus.resolved) {
    await prisma.scheduledPayoutOpsIncident.update({
      where: { id: existing.id },
      data: {
        status: ScheduledPayoutOpsIncidentStatus.open,
        resolvedAt: null,
        resolvedFingerprint: null,
        stateFingerprint: args.classified.fingerprint,
        scheduleWindowKey: args.scheduleWindowKey,
        subjectLabel: args.subjectLabel,
        metadata,
        severity: args.classified.severity,
        notifyGeneration: existing.notifyGeneration + 1,
        notifyingGeneration: null,
        lastObservedAt: args.now,
      },
    });
    return "reopened";
  }

  const fingerprintChanged = existing.stateFingerprint !== args.classified.fingerprint;
  if (fingerprintChanged) {
    await prisma.scheduledPayoutOpsIncident.update({
      where: { id: existing.id },
      data: {
        stateFingerprint: args.classified.fingerprint,
        scheduleWindowKey: args.scheduleWindowKey,
        subjectLabel: args.subjectLabel,
        metadata,
        severity: args.classified.severity,
        notifyGeneration: existing.notifyGeneration + 1,
        notifyingGeneration: null,
        lastObservedAt: args.now,
      },
    });
    return "updated";
  }

  await prisma.scheduledPayoutOpsIncident.update({
    where: { id: existing.id },
    data: {
      lastObservedAt: args.now,
      subjectLabel: args.subjectLabel,
      scheduleWindowKey: args.scheduleWindowKey,
    },
  });
  return "unchanged";
}

export async function upsertScheduledPayoutIncidentFromClassification(args: {
  payoutType: ScheduledPayoutOpsIncidentPayoutType;
  ledgerId: string;
  scheduleWindowKey: string | null;
  subjectLabel: string;
  classified: ReturnType<typeof classifyScheduledPayoutLedgerIncidents>[number];
  now: Date;
}): Promise<"created" | "updated" | "reopened" | "unchanged"> {
  const composite = {
    payoutType: args.payoutType,
    ledgerId: args.ledgerId,
    category: args.classified.category,
  };
  const metadata = incidentUpsertMetadata(args.classified);

  let existing = await prisma.scheduledPayoutOpsIncident.findUnique({
    where: { payoutType_ledgerId_category: composite },
  });

  if (!existing) {
    try {
      await prisma.scheduledPayoutOpsIncident.create({
        data: {
          ...composite,
          status: ScheduledPayoutOpsIncidentStatus.open,
          severity: args.classified.severity,
          stateFingerprint: args.classified.fingerprint,
          scheduleWindowKey: args.scheduleWindowKey,
          subjectLabel: args.subjectLabel,
          metadata,
          notifyGeneration: 1,
          lastNotifiedGeneration: 0,
          firstDetectedAt: args.now,
          lastObservedAt: args.now,
        },
      });
      return "created";
    } catch (err) {
      if (!isPrismaUniqueViolation(err)) throw err;
      existing = await prisma.scheduledPayoutOpsIncident.findUnique({
        where: { payoutType_ledgerId_category: composite },
      });
      if (!existing) throw err;
    }
  }

  return applyScheduledPayoutIncidentUpsertToExisting(existing, args);
}

export async function resolveScheduledPayoutIncidentIfInactive(args: {
  incident: ScheduledPayoutOpsIncident;
  classified: ReturnType<typeof classifyScheduledPayoutLedgerIncidents>;
  now: Date;
}): Promise<boolean> {
  if (args.incident.status !== ScheduledPayoutOpsIncidentStatus.open) return false;
  if (incidentCategoryStillActive(args.incident.category, args.classified)) return false;
  await prisma.scheduledPayoutOpsIncident.update({
    where: { id: args.incident.id },
    data: {
      status: ScheduledPayoutOpsIncidentStatus.resolved,
      resolvedAt: args.now,
      resolvedFingerprint: args.incident.stateFingerprint,
      notifyingGeneration: null,
    },
  });
  return true;
}

export async function listPlatformAdminIncidentRecipientUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: platformAdminIncidentRecipientWhere,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function loadLedgerForOpenIncident(
  incident: ScheduledPayoutOpsIncident,
  now: Date,
): Promise<{
  classified: ReturnType<typeof classifyScheduledPayoutLedgerIncidents>;
} | null> {
  if (incident.payoutType === "employee") {
    const row = await prisma.employeeStripeScheduledPayoutRequest.findUnique({
      where: { id: incident.ledgerId },
      include: {
        employeeStripeAccount: {
          select: {
            bankPayoutNextScheduledAt: true,
            bankPayoutSchedule: true,
            employee: { select: { name: true, business: { select: { name: true } } } },
          },
        },
      },
    });
    if (!row) return { classified: [] };
    const { input, payoutOverdue: overdue } = ledgerIncidentInputFromEmployeeRow(row, now);
    return { classified: classifyScheduledPayoutLedgerIncidents(input, { payoutOverdue: overdue }) };
  }
  const row = await prisma.stripeConnectScheduledPayoutRequest.findUnique({
    where: { id: incident.ledgerId },
    include: {
      business: { select: { name: true, bankPayoutNextScheduledAt: true, bankPayoutSchedule: true } },
    },
  });
  if (!row) return { classified: [] };
  const { input, payoutOverdue: overdue } = ledgerIncidentInputFromBusinessRow(row, now);
  return { classified: classifyScheduledPayoutLedgerIncidents(input, { payoutOverdue: overdue }) };
}

export async function runScheduledPayoutIncidentSync(
  now = new Date(),
  options?: { syncTrigger?: ScheduledPayoutIncidentSyncTrigger },
): Promise<ScheduledPayoutIncidentSyncResult> {
  const emptyDelivery: IncidentDeliveryMetrics = {
    deliveriesClaimed: 0,
    deliveriesDelivered: 0,
    deliveriesFailed: 0,
    claimsReclaimed: 0,
    claimOwnershipLost: 0,
    retryThrottled: 0,
    generationsCompleted: 0,
    oldestPendingAgeMs: null,
  };
  const result: ScheduledPayoutIncidentSyncResult = {
    observedLedgers: 0,
    incidentsOpened: 0,
    incidentsUpdated: 0,
    incidentsResolved: 0,
    notificationsAttempted: 0,
    notificationsDelivered: 0,
    skippedMissingTable: false,
    noAdminRecipients: false,
    syncTrigger: options?.syncTrigger ?? "standalone_job",
    delivery: emptyDelivery,
    syncSuccess: false,
  };

  const ledgerClassified = new Map<string, ReturnType<typeof classifyScheduledPayoutLedgerIncidents>>();

  try {
    const [employeeRows, businessRows] = await Promise.all([
      loadEmployeeLedgerRows(),
      loadBusinessLedgerRows(),
    ]);
    result.observedLedgers = employeeRows.length + businessRows.length;

    for (const row of employeeRows) {
      const { input, subjectLabel, payoutOverdue: overdue } = ledgerIncidentInputFromEmployeeRow(row, now);
      const classified = classifyScheduledPayoutLedgerIncidents(input, { payoutOverdue: overdue });
      ledgerClassified.set(`employee:${row.id}`, classified);
      for (const item of classified) {
        const outcome = await upsertScheduledPayoutIncidentFromClassification({
          payoutType: "employee",
          ledgerId: row.id,
          scheduleWindowKey: row.scheduleWindowKey,
          subjectLabel,
          classified: item,
          now,
        });
        if (outcome === "created" || outcome === "reopened") result.incidentsOpened += 1;
        if (outcome === "updated") result.incidentsUpdated += 1;
      }
    }

    for (const row of businessRows) {
      const { input, subjectLabel, payoutOverdue: overdue } = ledgerIncidentInputFromBusinessRow(row, now);
      const classified = classifyScheduledPayoutLedgerIncidents(input, { payoutOverdue: overdue });
      ledgerClassified.set(`business:${row.id}`, classified);
      for (const item of classified) {
        const outcome = await upsertScheduledPayoutIncidentFromClassification({
          payoutType: "business",
          ledgerId: row.id,
          scheduleWindowKey: row.scheduleWindowKey,
          subjectLabel,
          classified: item,
          now,
        });
        if (outcome === "created" || outcome === "reopened") result.incidentsOpened += 1;
        if (outcome === "updated") result.incidentsUpdated += 1;
      }
    }

    const openIncidents = await prisma.scheduledPayoutOpsIncident.findMany({
      where: { status: ScheduledPayoutOpsIncidentStatus.open },
      take: SCHEDULED_PAYOUT_INCIDENT_OPEN_RESOLVE_BATCH,
      orderBy: { lastObservedAt: "asc" },
    });

    for (const incident of openIncidents) {
      const cacheKey = `${incident.payoutType}:${incident.ledgerId}`;
      let classified = ledgerClassified.get(cacheKey);
      if (!classified) {
        const loaded = await loadLedgerForOpenIncident(incident, now);
        classified = loaded?.classified ?? [];
      }
      if (await resolveScheduledPayoutIncidentIfInactive({ incident, classified, now })) {
        result.incidentsResolved += 1;
      }
    }

    const adminIds = await listPlatformAdminIncidentRecipientUserIds();
    if (adminIds.length === 0) {
      result.noAdminRecipients = true;
      console.error(
        JSON.stringify({
          event: "scheduled_payout_incident_no_admin_recipients",
          severity: "high",
        }),
      );
    } else {
      const delivery = await processScheduledPayoutIncidentDeliveries(now, adminIds);
      result.delivery = delivery;
      result.notificationsAttempted = delivery.deliveriesClaimed;
      result.notificationsDelivered = delivery.deliveriesDelivered;
    }
    result.syncSuccess = true;
  } catch (err) {
    if (isMissingIncidentTableError(err)) {
      result.skippedMissingTable = true;
      logMissingIncidentTableOnce();
      return result;
    }
    logServerError("scheduled_payout_incident_sync_failed", err);
    throw err;
  }

  console.info(
    JSON.stringify({
      event: "scheduled_payout_incident_sync",
      syncTrigger: result.syncTrigger,
      syncSuccess: result.syncSuccess,
      observedLedgers: result.observedLedgers,
      incidentsOpened: result.incidentsOpened,
      incidentsUpdated: result.incidentsUpdated,
      incidentsResolved: result.incidentsResolved,
      noAdminRecipients: result.noAdminRecipients,
      delivery: result.delivery,
    }),
  );

  return result;
}

/** Fire-and-forget — never blocks payout processing. */
export function scheduleScheduledPayoutIncidentSyncAfterTick(options?: {
  syncTrigger?: ScheduledPayoutIncidentSyncTrigger;
}): void {
  const syncTrigger = options?.syncTrigger ?? "payout_tick_ok";
  void runScheduledPayoutIncidentSync(new Date(), { syncTrigger }).catch((err) => {
    if (isMissingIncidentTableError(err)) {
      logMissingIncidentTableOnce();
      return;
    }
    logServerError("scheduled_payout_incident_sync_after_tick", err, { syncTrigger });
  });
}

export function payoutTickIncidentSyncTrigger(
  payoutTickFailed: boolean,
): ScheduledPayoutIncidentSyncTrigger {
  return payoutTickFailed ? "payout_tick_failed" : "payout_tick_ok";
}

/** Called from payout tick `finally` so incident work runs even when a stream throws. */
export function scheduleScheduledPayoutIncidentSyncAfterPayoutTickAttempt(payoutTickFailed: boolean): void {
  scheduleScheduledPayoutIncidentSyncAfterTick({
    syncTrigger: payoutTickIncidentSyncTrigger(payoutTickFailed),
  });
}

/** Test-only in-memory incident store (no Prisma). */
export type MemoryIncidentRow = ScheduledPayoutOpsIncident;

export function createMemoryScheduledPayoutIncidentStore() {
  const rows = new Map<string, MemoryIncidentRow>();

  function key(payoutType: string, ledgerId: string, category: string): string {
    return `${payoutType}:${ledgerId}:${category}`;
  }

  return {
    rows,
    findUnique(composite: {
      payoutType: ScheduledPayoutOpsIncidentPayoutType;
      ledgerId: string;
      category: ScheduledPayoutOpsIncidentCategory;
    }) {
      return rows.get(key(composite.payoutType, composite.ledgerId, composite.category)) ?? null;
    },
    create(data: MemoryIncidentRow) {
      const k = key(data.payoutType, data.ledgerId, data.category);
      if (rows.has(k)) throw new Error("duplicate");
      rows.set(k, { ...data });
    },
    update(id: string, data: Partial<MemoryIncidentRow>) {
      const row = [...rows.values()].find((r) => r.id === id);
      if (!row) return;
      rows.set(key(row.payoutType, row.ledgerId, row.category), { ...row, ...data, updatedAt: new Date() });
    },
    updateMany(filter: {
      id?: string;
      notifyGeneration?: number;
      lastNotifiedGenerationLt?: number;
      notifyingGenerationNull?: boolean;
      notifyingGeneration?: number | null;
    }): number {
      let count = 0;
      for (const row of rows.values()) {
        if (filter.id && row.id !== filter.id) continue;
        if (filter.notifyGeneration != null && row.notifyGeneration !== filter.notifyGeneration) continue;
        if (
          filter.lastNotifiedGenerationLt != null &&
          row.lastNotifiedGeneration >= filter.lastNotifiedGenerationLt
        ) {
          continue;
        }
        if (filter.notifyingGenerationNull && row.notifyingGeneration != null) continue;
        if (filter.notifyingGeneration !== undefined && row.notifyingGeneration !== filter.notifyingGeneration) {
          continue;
        }
        count += 1;
      }
      return count;
    },
  };
}

export function ledgerRowIsRecoveredForIncidentTests(snapshot: ScheduledPayoutLedgerSnapshot): boolean {
  return (
    snapshot.status === StripeConnectScheduledPayoutRequestStatus.submitted ||
    snapshot.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance
  );
}

export function accountScheduleEligibleForOverdue(
  schedule: BusinessBankPayoutSchedule | null | undefined,
): boolean {
  return schedule === BusinessBankPayoutSchedule.every_3_days;
}
