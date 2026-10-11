/**
 * Phase B — platform admin scheduled payout ledger visibility and safe recovery actions.
 */
import {
  Prisma,
  ScheduledPayoutFailureClassification,
  ScheduledPayoutReconciliationStatus,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import {
  SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID,
  SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY,
} from "../config/scheduledPayoutStripeMetadata.js";
import { prisma } from "../prisma.js";
import {
  businessScheduledLedgerSnapshot,
  employeeScheduledLedgerSnapshot,
} from "./scheduledBankPayoutLedger.util.js";
import {
  SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS,
  canAttemptStripeCreateFromLedger,
  gateScheduledLedgerBeforeCreate,
  isLegacyFailedWithUnknownOutcome,
  reconcileScheduledPayoutWithStripe,
  sanitizeScheduledPayoutFailureMessage,
  type ScheduledBankPayoutRunResult,
  type ScheduledPayoutLedgerSnapshot,
} from "./scheduledBankPayoutRecovery.service.js";
import {
  isActiveScheduledPayoutProcessingClaim,
  SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS,
} from "./scheduledBankPayoutProcessingClaim.service.js";
import { runScheduledBankPayoutRecoveryForBusinessLedger } from "./businessScheduledBankPayout.service.js";
import { runScheduledBankPayoutRecoveryForEmployeeLedger } from "./employeeScheduledBankPayout.service.js";
import { persistEmployeePayoutFromStripeObject } from "./employeeStripePayout.service.js";
import {
  ingestStripePayoutObjectForBusiness,
  invalidateConnectPayoutListSyncThrottle,
} from "./stripeConnectPayout.service.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { paginateMergedActivityRows } from "./platformConnectActivityMerge.js";
import { scheduledPayoutRuntimeTestHooksEnabled } from "../lib/scheduledPayoutRuntimeTestHooks.js";
import { writeAuditLog, writeAuditLogStrict } from "./audit.service.js";

export type ScheduledPayoutOpsType = "employee" | "business";

export type ScheduledPayoutOpsAction =
  | "reconcile"
  | "run_recovery"
  | "manual_attachment"
  | "view_runbook"
  | "view_connect_payout";

export type ScheduledPayoutOpsListItemDto = {
  id: string;
  payoutType: ScheduledPayoutOpsType;
  businessId: string;
  businessName: string;
  employeeId: string | null;
  employeeName: string | null;
  scheduleWindowKey: string;
  amountCents: number;
  currency: string;
  status: StripeConnectScheduledPayoutRequestStatus;
  failureClassification: ScheduledPayoutFailureClassification | null;
  blockedReason: string | null;
  reconciliationStatus: ScheduledPayoutReconciliationStatus;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  stripePayoutIdMasked: string | null;
  stripeAccountSuffix: string | null;
  claimActive: boolean;
  claimStale: boolean;
  manualInterventionRequired: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledPayoutOpsDetailDto = ScheduledPayoutOpsListItemDto & {
  correlationId: string | null;
  failureCode: string | null;
  failureMessageSanitized: string | null;
  stripeErrorCode: string | null;
  stripeErrorType: string | null;
  stripeHttpStatus: number | null;
  stripeRequestId: string | null;
  claimClaimedAt: string | null;
  relatedConnectPayoutAdminPath: string | null;
  allowedActions: ScheduledPayoutOpsAction[];
  auditTrail: Array<{ at: string; action: string; actorUserId: string | null }>;
};

export type ScheduledPayoutOpsSummaryDto = {
  asOf: string;
  counts: {
    awaitingProcessing: number;
    failedOrBlocked: number;
    reconciliationOpen: number;
    retryScheduled: number;
    retryExhausted: number;
    submittedToStripe: number;
    skippedZeroBalance: number;
    claimActive: number;
    manualInterventionRequired: number;
  };
};

export type ScheduledPayoutOpsMutationResult =
  | {
      status: "completed";
      outcome: string;
      stripePayoutId?: string;
      blockedReason?: string;
    }
  | { status: "blocked"; blockedReason: string }
  | { status: "inconclusive"; reason: string }
  | {
      status: "failed";
      message: string;
      /** Stable machine code when message is audit_log_failed. */
      code?: string;
      /** True when a ledger row or Stripe payout may have changed before audit failed. Not a rollback indicator. */
      ledgerMutationMayHaveOccurred?: boolean;
      auditRecorded?: boolean;
    };

let retrievePayoutForManualAttachFn:
  | ((stripeAccountId: string, payoutId: string) => Promise<Stripe.Payout | null>)
  | null = null;

export function __setRetrievePayoutForManualAttachFnForTests(
  fn: ((stripeAccountId: string, payoutId: string) => Promise<Stripe.Payout | null>) | null,
): void {
  retrievePayoutForManualAttachFn = fn;
}

export function manualScheduledPayoutAttachmentEnabled(): boolean {
  return process.env.PLATFORM_SCHEDULED_PAYOUT_MANUAL_ATTACHMENT_ENABLED === "true";
}

function maskStripeId(id: string | null | undefined): string | null {
  const t = id?.trim();
  if (!t) return null;
  if (t.length <= 10) return `${t.slice(0, 2)}…`;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function accountSuffix(accountId: string | null | undefined): string | null {
  const id = accountId?.trim();
  if (!id || id.length < 4) return null;
  return id.length <= 8 ? id : id.slice(-8);
}

function claimState(row: { processingClaimedAt: Date | null; processingClaimToken: string | null }, now = Date.now()) {
  if (!row.processingClaimedAt || !row.processingClaimToken) {
    return { claimActive: false, claimStale: false };
  }
  const active = isActiveScheduledPayoutProcessingClaim(row, now);
  return { claimActive: active, claimStale: !active };
}

export type PersistReconcileMatchResult =
  | { ok: true; idempotent: boolean }
  | {
      ok: false;
      reason:
        | "ledger_not_found"
        | "processing_claim_held"
        | "payout_id_conflict"
        | "concurrent_update_conflict";
    };

type LedgerRowWithClaim = {
  employeeId?: string;
  businessId?: string;
  stripePayoutId: string | null;
  status: StripeConnectScheduledPayoutRequestStatus;
  processingClaimedAt: Date | null;
  processingClaimToken: string | null;
};

export type LoadedScheduledPayoutOpsLedger = {
  payoutType: ScheduledPayoutOpsType;
  row: Record<string, unknown>;
  businessId: string;
  businessName: string;
  employeeName: string | null;
  stripeAccountId: string | null;
};

let platformScheduledPayoutOpsTestHooks: {
  loadLedger?: (
    payoutType: ScheduledPayoutOpsType,
    ledgerId: string,
  ) => Promise<LoadedScheduledPayoutOpsLedger | null>;
  tryPersistReconcileMatch?: (
    payoutType: ScheduledPayoutOpsType,
    ledgerId: string,
    stripePayout: Stripe.Payout,
  ) => Promise<PersistReconcileMatchResult>;
} | null = null;

export function __setPlatformScheduledPayoutOpsTestHooks(
  hooks: typeof platformScheduledPayoutOpsTestHooks,
): void {
  if (!scheduledPayoutRuntimeTestHooksEnabled()) {
    return;
  }
  platformScheduledPayoutOpsTestHooks = hooks;
}

function scheduledPayoutAuditLogFailed(ledgerMutationMayHaveOccurred: boolean): ScheduledPayoutOpsMutationResult {
  return {
    status: "failed",
    message: "audit_log_failed",
    code: "audit_log_failed",
    ledgerMutationMayHaveOccurred,
    auditRecorded: false,
  };
}

function reconcileCompletedOutcomeMayHavePersisted(result: ScheduledPayoutOpsMutationResult): boolean {
  return (
    result.status === "completed" &&
    (result.outcome === "matched" || result.outcome === "already_matched")
  );
}

function adminMutationBlockedByClaim(row: LedgerRowWithClaim, now = Date.now()): boolean {
  return isActiveScheduledPayoutProcessingClaim(row, now);
}

function ledgerSnapshotForRow(
  payoutType: ScheduledPayoutOpsType,
  row: {
    id: string;
    status: StripeConnectScheduledPayoutRequestStatus;
    scheduleWindowKey: string;
    idempotencyKey: string;
    amountCents: number;
    currency: string;
    stripePayoutId: string | null;
    failureCode: string | null;
    attemptCount: number;
    nextRetryAt: Date | null;
    failureClassification: ScheduledPayoutFailureClassification | null;
    reconciliationStatus: ScheduledPayoutReconciliationStatus;
    correlationId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
): ScheduledPayoutLedgerSnapshot {
  return payoutType === "employee"
    ? employeeScheduledLedgerSnapshot(row as never)
    : businessScheduledLedgerSnapshot(row as never);
}

export function deriveManualInterventionRequired(
  row: {
    status: StripeConnectScheduledPayoutRequestStatus;
    blockedReason: string | null;
    failureClassification: ScheduledPayoutFailureClassification | null;
    reconciliationStatus: ScheduledPayoutReconciliationStatus;
    attemptCount: number;
    correlationId: string | null;
    stripePayoutId: string | null;
    failureCode: string | null;
  },
  snapshot: ScheduledPayoutLedgerSnapshot,
): boolean {
  if (row.reconciliationStatus === ScheduledPayoutReconciliationStatus.inconclusive) return true;
  if (
    row.reconciliationStatus === ScheduledPayoutReconciliationStatus.required &&
    row.status === StripeConnectScheduledPayoutRequestStatus.failed
  ) {
    return true;
  }
  if (row.blockedReason === "retry_exhausted" || row.attemptCount >= SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS) {
    return true;
  }
  if (isLegacyFailedWithUnknownOutcome(snapshot)) return true;
  if (row.failureClassification === ScheduledPayoutFailureClassification.outcome_uncertain) return true;
  if (row.blockedReason === "reconciliation_inconclusive" || row.blockedReason === "reconciliation_required") {
    return true;
  }
  return false;
}

function deriveAllowedActions(args: {
  payoutType: ScheduledPayoutOpsType;
  row: {
    status: StripeConnectScheduledPayoutRequestStatus;
    stripePayoutId: string | null;
    blockedReason: string | null;
    attemptCount: number;
    processingClaimedAt: Date | null;
    processingClaimToken: string | null;
  };
  snapshot: ScheduledPayoutLedgerSnapshot;
  stripeAccountId: string | null;
}): ScheduledPayoutOpsAction[] {
  const actions: ScheduledPayoutOpsAction[] = ["view_runbook"];
  if (args.row.stripePayoutId?.startsWith("po_")) {
    actions.push("view_connect_payout");
  }
  if (args.row.status === StripeConnectScheduledPayoutRequestStatus.submitted && args.row.stripePayoutId) {
    return actions;
  }
  const { claimActive } = claimState(args.row);
  if (!claimActive) {
    actions.push("reconcile");
    const attempt = canAttemptStripeCreateFromLedger(args.snapshot);
    if (attempt.allowed || attempt.reason === "retry_not_due") {
      actions.push("run_recovery");
    } else if (
      attempt.reason === "reconciliation_required" ||
      attempt.reason === "stale_pending_reconcile"
    ) {
      actions.push("run_recovery");
    }
  }
  if (manualScheduledPayoutAttachmentEnabled() && args.stripeAccountId && !args.row.stripePayoutId?.startsWith("po_")) {
    actions.push("manual_attachment");
  }
  return [...new Set(actions)];
}

type LedgerRow = {
  payoutType: ScheduledPayoutOpsType;
  id: string;
  updatedAt: Date;
  employeeId?: string;
  businessId: string;
  row: Record<string, unknown>;
};

async function loadContextMaps(ids: { employeeIds: string[]; businessIds: string[] }) {
  const [employees, businesses] = await Promise.all([
    ids.employeeIds.length
      ? prisma.employee.findMany({
          where: { id: { in: ids.employeeIds } },
          select: { id: true, name: true, businessId: true, business: { select: { name: true } } },
        })
      : [],
    ids.businessIds.length
      ? prisma.business.findMany({
          where: { id: { in: ids.businessIds } },
          select: { id: true, name: true, stripeAccountId: true },
        })
      : [],
  ]);
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const bizMap = new Map(businesses.map((b) => [b.id, b]));
  const empAccounts =
    ids.employeeIds.length
      ? await prisma.employeeStripeAccount.findMany({
          where: { employeeId: { in: ids.employeeIds } },
          select: { employeeId: true, stripeAccountId: true },
        })
      : [];
  const acctMap = new Map(empAccounts.map((a) => [a.employeeId, a.stripeAccountId]));
  return { empMap, bizMap, acctMap };
}

function mapListItem(
  payoutType: ScheduledPayoutOpsType,
  row: {
    id: string;
    scheduleWindowKey: string;
    amountCents: number;
    currency: string;
    status: StripeConnectScheduledPayoutRequestStatus;
    failureClassification: ScheduledPayoutFailureClassification | null;
    blockedReason: string | null;
    reconciliationStatus: ScheduledPayoutReconciliationStatus;
    attemptCount: number;
    nextRetryAt: Date | null;
    stripePayoutId: string | null;
    processingClaimedAt: Date | null;
    processingClaimToken: string | null;
    failureCode: string | null;
    correlationId: string | null;
    createdAt: Date;
    updatedAt: Date;
    employeeId?: string;
    businessId: string;
  },
  ctx: {
    businessName: string;
    employeeName: string | null;
    stripeAccountId: string | null;
  },
): ScheduledPayoutOpsListItemDto {
  const snapshot = ledgerSnapshotForRow(payoutType, row as never);
  const claim = claimState(row);
  return {
    id: row.id,
    payoutType,
    businessId: row.businessId,
    businessName: ctx.businessName,
    employeeId: row.employeeId ?? null,
    employeeName: ctx.employeeName,
    scheduleWindowKey: row.scheduleWindowKey,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status,
    failureClassification: row.failureClassification,
    blockedReason: row.blockedReason,
    reconciliationStatus: row.reconciliationStatus,
    attemptCount: row.attemptCount,
    maxAttempts: SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS,
    nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
    stripePayoutIdMasked: maskStripeId(row.stripePayoutId),
    stripeAccountSuffix: accountSuffix(ctx.stripeAccountId),
    claimActive: claim.claimActive,
    claimStale: claim.claimStale,
    manualInterventionRequired: deriveManualInterventionRequired(row, snapshot),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildEmployeeWhere(args: ListArgs): Prisma.EmployeeStripeScheduledPayoutRequestWhereInput {
  const where: Prisma.EmployeeStripeScheduledPayoutRequestWhereInput = {};
  if (args.businessId) {
    where.employeeStripeAccount = { employee: { businessId: args.businessId } };
  }
  if (args.status) where.status = args.status;
  if (args.reconciliationStatus) where.reconciliationStatus = args.reconciliationStatus;
  if (args.failureClassification) where.failureClassification = args.failureClassification;
  if (args.blockedReason) where.blockedReason = args.blockedReason;
  if (args.updatedFrom || args.updatedTo) {
    where.updatedAt = {};
    if (args.updatedFrom) where.updatedAt.gte = args.updatedFrom;
    if (args.updatedTo) where.updatedAt.lte = args.updatedTo;
  }
  if (args.manualOnly) {
    where.OR = [
      { reconciliationStatus: ScheduledPayoutReconciliationStatus.inconclusive },
      { reconciliationStatus: ScheduledPayoutReconciliationStatus.required },
      { blockedReason: "retry_exhausted" },
      { blockedReason: "reconciliation_inconclusive" },
      { blockedReason: "reconciliation_required" },
    ];
  }
  if (args.q) {
    const q = args.q.trim();
    where.OR = [
      { id: { startsWith: q } },
      { correlationId: { contains: q } },
      { scheduleWindowKey: { contains: q } },
      { stripePayoutId: { startsWith: q } },
      {
        employeeStripeAccount: {
          employee: { name: { contains: q, mode: "insensitive" } },
        },
      },
      {
        employeeStripeAccount: {
          employee: { business: { name: { contains: q, mode: "insensitive" } } },
        },
      },
    ];
  }
  return where;
}

function buildBusinessWhere(args: ListArgs): Prisma.StripeConnectScheduledPayoutRequestWhereInput {
  const where: Prisma.StripeConnectScheduledPayoutRequestWhereInput = {};
  if (args.businessId) where.businessId = args.businessId;
  if (args.status) where.status = args.status;
  if (args.reconciliationStatus) where.reconciliationStatus = args.reconciliationStatus;
  if (args.failureClassification) where.failureClassification = args.failureClassification;
  if (args.blockedReason) where.blockedReason = args.blockedReason;
  if (args.updatedFrom || args.updatedTo) {
    where.updatedAt = {};
    if (args.updatedFrom) where.updatedAt.gte = args.updatedFrom;
    if (args.updatedTo) where.updatedAt.lte = args.updatedTo;
  }
  if (args.manualOnly) {
    where.OR = [
      { reconciliationStatus: ScheduledPayoutReconciliationStatus.inconclusive },
      { reconciliationStatus: ScheduledPayoutReconciliationStatus.required },
      { blockedReason: "retry_exhausted" },
      { blockedReason: "reconciliation_inconclusive" },
      { blockedReason: "reconciliation_required" },
    ];
  }
  if (args.q) {
    const q = args.q.trim();
    where.OR = [
      { id: { startsWith: q } },
      { correlationId: { contains: q } },
      { scheduleWindowKey: { contains: q } },
      { stripePayoutId: { startsWith: q } },
      { business: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

type ListArgs = {
  take: number;
  skip: number;
  q?: string;
  payoutType?: ScheduledPayoutOpsType;
  businessId?: string;
  status?: StripeConnectScheduledPayoutRequestStatus;
  reconciliationStatus?: ScheduledPayoutReconciliationStatus;
  failureClassification?: ScheduledPayoutFailureClassification;
  blockedReason?: string;
  manualOnly?: boolean;
  updatedFrom?: Date;
  updatedTo?: Date;
};

export async function getScheduledPayoutOpsSummary(): Promise<ScheduledPayoutOpsSummaryDto> {
  const now = new Date();
  const [
    awaitingProcessing,
    failedOrBlocked,
    reconciliationOpen,
    retryScheduled,
    retryExhausted,
    submittedToStripe,
    skippedZeroBalance,
    claimActiveEmp,
    claimActiveBiz,
    manualEmp,
    manualBiz,
  ] = await Promise.all([
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: { status: StripeConnectScheduledPayoutRequestStatus.pending, blockedReason: null },
    }).then((e) =>
      prisma.stripeConnectScheduledPayoutRequest
        .count({
          where: { status: StripeConnectScheduledPayoutRequestStatus.pending, blockedReason: null },
        })
        .then((b) => e + b),
    ),
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: {
        OR: [
          { status: StripeConnectScheduledPayoutRequestStatus.failed },
          { blockedReason: { not: null } },
        ],
      },
    }).then((e) =>
      prisma.stripeConnectScheduledPayoutRequest
        .count({
          where: {
            OR: [
              { status: StripeConnectScheduledPayoutRequestStatus.failed },
              { blockedReason: { not: null } },
            ],
          },
        })
        .then((b) => e + b),
    ),
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: {
        reconciliationStatus: {
          in: [
            ScheduledPayoutReconciliationStatus.required,
            ScheduledPayoutReconciliationStatus.inconclusive,
          ],
        },
      },
    }).then((e) =>
      prisma.stripeConnectScheduledPayoutRequest
        .count({
          where: {
            reconciliationStatus: {
              in: [
                ScheduledPayoutReconciliationStatus.required,
                ScheduledPayoutReconciliationStatus.inconclusive,
              ],
            },
          },
        })
        .then((b) => e + b),
    ),
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: { blockedReason: "retry_scheduled" },
    }).then((e) =>
      prisma.stripeConnectScheduledPayoutRequest
        .count({ where: { blockedReason: "retry_scheduled" } })
        .then((b) => e + b),
    ),
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: {
        OR: [
          { blockedReason: "retry_exhausted" },
          { attemptCount: { gte: SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS } },
        ],
      },
    }).then((e) =>
      prisma.stripeConnectScheduledPayoutRequest
        .count({
          where: {
            OR: [
              { blockedReason: "retry_exhausted" },
              { attemptCount: { gte: SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS } },
            ],
          },
        })
        .then((b) => e + b),
    ),
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: { status: StripeConnectScheduledPayoutRequestStatus.submitted },
    }).then((e) =>
      prisma.stripeConnectScheduledPayoutRequest
        .count({ where: { status: StripeConnectScheduledPayoutRequestStatus.submitted } })
        .then((b) => e + b),
    ),
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: { status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance },
    }).then((e) =>
      prisma.stripeConnectScheduledPayoutRequest
        .count({ where: { status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance } })
        .then((b) => e + b),
    ),
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: {
        processingClaimToken: { not: null },
        processingClaimedAt: { gte: new Date(now.getTime() - SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS) },
      },
    }),
    prisma.stripeConnectScheduledPayoutRequest.count({
      where: {
        processingClaimToken: { not: null },
        processingClaimedAt: { gte: new Date(now.getTime() - SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS) },
      },
    }),
    prisma.employeeStripeScheduledPayoutRequest.count({
      where: {
        OR: [
          { reconciliationStatus: ScheduledPayoutReconciliationStatus.inconclusive },
          { blockedReason: "reconciliation_required" },
          { blockedReason: "retry_exhausted" },
        ],
      },
    }),
    prisma.stripeConnectScheduledPayoutRequest.count({
      where: {
        OR: [
          { reconciliationStatus: ScheduledPayoutReconciliationStatus.inconclusive },
          { blockedReason: "reconciliation_required" },
          { blockedReason: "retry_exhausted" },
        ],
      },
    }),
  ]);

  return {
    asOf: now.toISOString(),
    counts: {
      awaitingProcessing,
      failedOrBlocked,
      reconciliationOpen,
      retryScheduled,
      retryExhausted,
      submittedToStripe,
      skippedZeroBalance,
      claimActive: claimActiveEmp + claimActiveBiz,
      manualInterventionRequired: manualEmp + manualBiz,
    },
  };
}

export async function listScheduledPayoutOps(
  args: ListArgs,
): Promise<{ total: number; items: ScheduledPayoutOpsListItemDto[] }> {
  const streams: ScheduledPayoutOpsType[] =
    args.payoutType === "employee"
      ? ["employee"]
      : args.payoutType === "business"
        ? ["business"]
        : ["employee", "business"];

  const { total, page } = await paginateMergedActivityRows({
    streams: streams as ("business" | "employee" | "transfer")[],
    skip: args.skip,
    take: args.take,
    fetchChunk: async (stream, offset, limit) => {
      if (stream === "employee") {
        const rows = await prisma.employeeStripeScheduledPayoutRequest.findMany({
          where: buildEmployeeWhere(args),
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: offset,
          take: limit,
          select: { id: true, updatedAt: true },
        });
        return rows.map((r) => ({
          stream: "employee" as const,
          rowId: r.id,
          sortAt: r.updatedAt,
          tieId: r.id,
        }));
      }
      if (stream === "business") {
        const rows = await prisma.stripeConnectScheduledPayoutRequest.findMany({
          where: buildBusinessWhere(args),
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: offset,
          take: limit,
          select: { id: true, updatedAt: true },
        });
        return rows.map((r) => ({
          stream: "business" as const,
          rowId: r.id,
          sortAt: r.updatedAt,
          tieId: r.id,
        }));
      }
      return [];
    },
    countStream: async (stream) => {
      if (stream === "employee") {
        return prisma.employeeStripeScheduledPayoutRequest.count({ where: buildEmployeeWhere(args) });
      }
      if (stream === "business") {
        return prisma.stripeConnectScheduledPayoutRequest.count({ where: buildBusinessWhere(args) });
      }
      return 0;
    },
  });

  const employeeIds = page.filter((p) => p.stream === "employee").map((p) => p.rowId);
  const businessIds = page.filter((p) => p.stream === "business").map((p) => p.rowId);

  const [empRows, bizRows] = await Promise.all([
    employeeIds.length
      ? prisma.employeeStripeScheduledPayoutRequest.findMany({ where: { id: { in: employeeIds } } })
      : [],
    businessIds.length
      ? prisma.stripeConnectScheduledPayoutRequest.findMany({ where: { id: { in: businessIds } } })
      : [],
  ]);

  const empById = new Map(empRows.map((r) => [r.id, r]));
  const bizById = new Map(bizRows.map((r) => [r.id, r]));

  const employeesMeta = empRows.length
    ? await prisma.employee.findMany({
        where: { id: { in: empRows.map((r) => r.employeeId) } },
        select: { id: true, name: true, businessId: true, business: { select: { name: true } } },
      })
    : [];
  const businessIdsFromEmp = employeesMeta.map((e) => e.businessId);
  const ctxMaps = await loadContextMaps({
    employeeIds: empRows.map((r) => r.employeeId),
    businessIds: [...new Set([...bizRows.map((r) => r.businessId), ...businessIdsFromEmp])],
  });

  const items: ScheduledPayoutOpsListItemDto[] = [];
  for (const slot of page) {
    if (slot.stream === "employee") {
      const row = empById.get(slot.rowId);
      if (!row) continue;
      const emp = ctxMaps.empMap.get(row.employeeId);
      const biz = emp ? ctxMaps.bizMap.get(emp.businessId) : undefined;
      items.push(
        mapListItem("employee", { ...row, businessId: emp?.businessId ?? "" }, {
          businessName: biz?.name ?? emp?.business?.name ?? "—",
          employeeName: emp?.name ?? null,
          stripeAccountId: ctxMaps.acctMap.get(row.employeeId) ?? null,
        }),
      );
    } else if (slot.stream === "business") {
      const row = bizById.get(slot.rowId);
      if (!row) continue;
      const biz = ctxMaps.bizMap.get(row.businessId);
      items.push(
        mapListItem("business", row, {
          businessName: biz?.name ?? "—",
          employeeName: null,
          stripeAccountId: biz?.stripeAccountId ?? null,
        }),
      );
    }
  }

  return { total, items };
}

async function loadLedger(
  payoutType: ScheduledPayoutOpsType,
  ledgerId: string,
): Promise<LoadedScheduledPayoutOpsLedger | null> {
  if (platformScheduledPayoutOpsTestHooks?.loadLedger) {
    return platformScheduledPayoutOpsTestHooks.loadLedger(payoutType, ledgerId);
  }
  if (payoutType === "employee") {
    const row = await prisma.employeeStripeScheduledPayoutRequest.findUnique({ where: { id: ledgerId } });
    if (!row) return null;
    const emp = await prisma.employee.findUnique({
      where: { id: row.employeeId },
      select: { id: true, name: true, businessId: true, business: { select: { name: true, id: true } } },
    });
    const acct = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: row.employeeId },
      select: { stripeAccountId: true },
    });
    return {
      payoutType,
      row,
      businessId: emp?.businessId ?? "",
      businessName: emp?.business?.name ?? "—",
      employeeName: emp?.name ?? null,
      stripeAccountId: acct?.stripeAccountId?.trim() || null,
    };
  }
  const row = await prisma.stripeConnectScheduledPayoutRequest.findUnique({ where: { id: ledgerId } });
  if (!row) return null;
  const biz = await prisma.business.findUnique({
    where: { id: row.businessId },
    select: { name: true, stripeAccountId: true },
  });
  return {
    payoutType,
    row,
    businessId: row.businessId,
    businessName: biz?.name ?? "—",
    employeeName: null,
    stripeAccountId: biz?.stripeAccountId?.trim() || null,
  };
}

async function auditForLedger(ledgerId: string): Promise<ScheduledPayoutOpsDetailDto["auditTrail"]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { startsWith: "platform.scheduled_payout." },
      metadata: { contains: ledgerId },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { createdAt: true, action: true, userId: true },
  });
  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    action: r.action,
    actorUserId: r.userId,
  }));
}

export async function getScheduledPayoutOpsDetail(
  payoutType: ScheduledPayoutOpsType,
  ledgerId: string,
): Promise<ScheduledPayoutOpsDetailDto | null> {
  const loaded = await loadLedger(payoutType, ledgerId);
  if (!loaded) return null;
  const row = loaded.row as {
    stripePayoutId: string | null;
    correlationId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    stripeErrorCode: string | null;
    stripeErrorType: string | null;
    stripeHttpStatus: number | null;
    stripeRequestId: string | null;
    processingClaimedAt: Date | null;
    processingClaimToken: string | null;
  } & Record<string, unknown>;
  const snapshot = ledgerSnapshotForRow(payoutType, row as never);
  const listBase = mapListItem(payoutType, row as never, {
    businessName: loaded.businessName,
    employeeName: loaded.employeeName,
    stripeAccountId: loaded.stripeAccountId,
  });
  const claim = claimState(row as never);
  const relatedConnectPayoutAdminPath =
    row.stripePayoutId?.startsWith("po_")
      ? `/platform-admin/revenue/connect-payouts?q=${encodeURIComponent(row.stripePayoutId)}`
      : null;

  return {
    ...listBase,
    correlationId: row.correlationId,
    failureCode: row.failureCode,
    failureMessageSanitized: row.failureMessage
      ? sanitizeScheduledPayoutFailureMessage(row.failureMessage)
      : null,
    stripeErrorCode: row.stripeErrorCode,
    stripeErrorType: row.stripeErrorType,
    stripeHttpStatus: row.stripeHttpStatus,
    stripeRequestId: row.stripeRequestId,
    claimClaimedAt: row.processingClaimedAt?.toISOString() ?? null,
    relatedConnectPayoutAdminPath,
    allowedActions: deriveAllowedActions({
      payoutType,
      row: row as never,
      snapshot,
      stripeAccountId: loaded.stripeAccountId,
    }),
    auditTrail: await auditForLedger(ledgerId),
  };
}

async function ingestReconcileMatchSideEffects(
  payoutType: ScheduledPayoutOpsType,
  row: LedgerRowWithClaim,
  stripePayout: Stripe.Payout,
  ledgerId: string,
): Promise<void> {
  if (payoutType === "employee" && row.employeeId) {
    const acct = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: row.employeeId },
      select: { stripeAccountId: true },
    });
    if (acct?.stripeAccountId) {
      await persistEmployeePayoutFromStripeObject({
        employeeId: row.employeeId,
        stripeAccountId: acct.stripeAccountId,
        payout: stripePayout,
      });
    }
    return;
  }
  const businessId = row.businessId;
  if (!businessId) return;
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { stripeAccountId: true },
  });
  if (biz?.stripeAccountId) {
    await ingestStripePayoutObjectForBusiness({
      businessId,
      stripeAccountId: biz.stripeAccountId,
      payout: stripePayout,
      eventType: "payout.admin_reconcile",
      eventId: `admin_reconcile:${ledgerId}`,
    });
    invalidateConnectPayoutListSyncThrottle(businessId);
  }
}

export async function tryPersistReconcileMatch(
  payoutType: ScheduledPayoutOpsType,
  ledgerId: string,
  stripePayout: Stripe.Payout,
  now = Date.now(),
): Promise<PersistReconcileMatchResult> {
  if (platformScheduledPayoutOpsTestHooks?.tryPersistReconcileMatch) {
    return platformScheduledPayoutOpsTestHooks.tryPersistReconcileMatch(payoutType, ledgerId, stripePayout);
  }

  const poId = stripePayout.id;
  const staleBefore = new Date(now - SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS);

  if (payoutType === "employee") {
    const row = await prisma.employeeStripeScheduledPayoutRequest.findUnique({ where: { id: ledgerId } });
    if (!row) return { ok: false, reason: "ledger_not_found" };
    if (row.stripePayoutId?.startsWith("po_") && row.stripePayoutId !== poId) {
      return { ok: false, reason: "payout_id_conflict" };
    }
    if (
      row.stripePayoutId === poId &&
      row.status === StripeConnectScheduledPayoutRequestStatus.submitted
    ) {
      return { ok: true, idempotent: true };
    }
    if (adminMutationBlockedByClaim(row, now)) {
      return { ok: false, reason: "processing_claim_held" };
    }
    const updated = await prisma.employeeStripeScheduledPayoutRequest.updateMany({
      where: {
        id: ledgerId,
        OR: [{ stripePayoutId: null }, { stripePayoutId: poId }],
        AND: [
          {
            OR: [
              { processingClaimToken: null },
              { processingClaimedAt: null },
              { processingClaimedAt: { lt: staleBefore } },
            ],
          },
        ],
      },
      data: {
        status: StripeConnectScheduledPayoutRequestStatus.submitted,
        stripePayoutId: poId,
        reconciliationStatus: ScheduledPayoutReconciliationStatus.resolved,
        blockedReason: null,
        processingClaimedAt: null,
        processingClaimToken: null,
      },
    });
    if (updated.count !== 1) {
      return { ok: false, reason: "concurrent_update_conflict" };
    }
    await ingestReconcileMatchSideEffects(payoutType, row, stripePayout, ledgerId);
    return { ok: true, idempotent: false };
  }

  const row = await prisma.stripeConnectScheduledPayoutRequest.findUnique({ where: { id: ledgerId } });
  if (!row) return { ok: false, reason: "ledger_not_found" };
  if (row.stripePayoutId?.startsWith("po_") && row.stripePayoutId !== poId) {
    return { ok: false, reason: "payout_id_conflict" };
  }
  if (
    row.stripePayoutId === poId &&
    row.status === StripeConnectScheduledPayoutRequestStatus.submitted
  ) {
    return { ok: true, idempotent: true };
  }
  if (adminMutationBlockedByClaim(row, now)) {
    return { ok: false, reason: "processing_claim_held" };
  }
  const updated = await prisma.stripeConnectScheduledPayoutRequest.updateMany({
    where: {
      id: ledgerId,
      OR: [{ stripePayoutId: null }, { stripePayoutId: poId }],
      AND: [
        {
          OR: [
            { processingClaimToken: null },
            { processingClaimedAt: null },
            { processingClaimedAt: { lt: staleBefore } },
          ],
        },
      ],
    },
    data: {
      status: StripeConnectScheduledPayoutRequestStatus.submitted,
      stripePayoutId: poId,
      reconciliationStatus: ScheduledPayoutReconciliationStatus.resolved,
      blockedReason: null,
      processingClaimedAt: null,
      processingClaimToken: null,
    },
  });
  if (updated.count !== 1) {
    return { ok: false, reason: "concurrent_update_conflict" };
  }
  await ingestReconcileMatchSideEffects(payoutType, row, stripePayout, ledgerId);
  return { ok: true, idempotent: false };
}

function mutationFromPersistFailure(
  reason: Extract<PersistReconcileMatchResult, { ok: false }>,
): ScheduledPayoutOpsMutationResult {
  return { status: "blocked", blockedReason: reason.reason };
}

export async function reconcileScheduledPayoutOpsLedger(
  payoutType: ScheduledPayoutOpsType,
  ledgerId: string,
  actorUserId: string | null,
): Promise<ScheduledPayoutOpsMutationResult> {
  const loaded = await loadLedger(payoutType, ledgerId);
  if (!loaded || !loaded.stripeAccountId) {
    return { status: "failed", message: "ledger_not_found" };
  }
  if (adminMutationBlockedByClaim(loaded.row as LedgerRowWithClaim)) {
    return { status: "blocked", blockedReason: "processing_claim_held" };
  }
  const existingPo = (loaded.row.stripePayoutId as string | null | undefined)?.trim();
  if (existingPo?.startsWith("po_")) {
    const snapshot = ledgerSnapshotForRow(payoutType, loaded.row as never);
    const recon = await reconcileScheduledPayoutWithStripe({
      stripeAccountId: loaded.stripeAccountId,
      ledger: snapshot,
    });
    let result: ScheduledPayoutOpsMutationResult;
    if (recon.kind === "matched") {
      result = { status: "completed", outcome: "matched", stripePayoutId: recon.stripePayoutId };
    } else if (recon.kind === "inconclusive") {
      result = { status: "inconclusive", reason: "reconciliation_inconclusive" };
    } else {
      result = { status: "blocked", blockedReason: "payout_id_conflict" };
    }
    try {
      await writeAuditLogStrict({
        userId: actorUserId,
        action: "platform.scheduled_payout.reconcile",
        metadata: JSON.stringify({
          payoutType,
          ledgerId,
          scheduleWindowKey: loaded.row.scheduleWindowKey,
          result: recon.kind,
          stripePayoutId: recon.kind === "matched" ? recon.stripePayoutId : undefined,
        }),
      });
    } catch {
      return scheduledPayoutAuditLogFailed(false);
    }
    return result;
  }
  const snapshot = ledgerSnapshotForRow(payoutType, loaded.row as never);
  const recon = await reconcileScheduledPayoutWithStripe({
    stripeAccountId: loaded.stripeAccountId,
    ledger: snapshot,
  });
  let result: ScheduledPayoutOpsMutationResult;
  if (recon.kind === "matched") {
    const persisted = await tryPersistReconcileMatch(payoutType, ledgerId, recon.stripePayout);
    if (!persisted.ok) {
      result = mutationFromPersistFailure(persisted);
    } else {
      result = {
        status: "completed",
        outcome: persisted.idempotent ? "already_matched" : "matched",
        stripePayoutId: recon.stripePayoutId,
      };
    }
  } else if (recon.kind === "inconclusive") {
    result = { status: "inconclusive", reason: "reconciliation_inconclusive" };
  } else {
    result = { status: "completed", outcome: "no_match" };
  }
  try {
    await writeAuditLogStrict({
      userId: actorUserId,
      action: "platform.scheduled_payout.reconcile",
      metadata: JSON.stringify({
        payoutType,
        ledgerId,
        scheduleWindowKey: loaded.row.scheduleWindowKey,
        result: recon.kind,
        outcome: result.status === "completed" ? result.outcome : undefined,
        blockedReason: result.status === "blocked" ? result.blockedReason : undefined,
        stripePayoutId: recon.kind === "matched" ? recon.stripePayoutId : undefined,
      }),
    });
  } catch {
    return scheduledPayoutAuditLogFailed(reconcileCompletedOutcomeMayHavePersisted(result));
  }
  return result;
}

export async function runScheduledPayoutOpsRecovery(
  payoutType: ScheduledPayoutOpsType,
  ledgerId: string,
  actorUserId: string | null,
): Promise<ScheduledPayoutOpsMutationResult> {
  const loaded = await loadLedger(payoutType, ledgerId);
  if (!loaded) {
    return { status: "failed", message: "ledger_not_found" };
  }
  if (adminMutationBlockedByClaim(loaded.row as LedgerRowWithClaim)) {
    return { status: "blocked", blockedReason: "processing_claim_held" };
  }

  const runResult: ScheduledBankPayoutRunResult =
    payoutType === "employee"
      ? await runScheduledBankPayoutRecoveryForEmployeeLedger(ledgerId)
      : await runScheduledBankPayoutRecoveryForBusinessLedger(ledgerId);

  try {
    await writeAuditLogStrict({
      userId: actorUserId,
      action: "platform.scheduled_payout.run_recovery",
      metadata: JSON.stringify({
        payoutType,
        ledgerId,
        outcome: runResult.outcome,
        blockedReason: runResult.blockedReason,
        stripePayoutId: runResult.stripePayoutId,
      }),
    });
  } catch {
    return scheduledPayoutAuditLogFailed(runResult.outcome === "created");
  }

  if (runResult.outcome === "created") {
    return {
      status: "completed",
      outcome: "created",
      stripePayoutId: runResult.stripePayoutId,
    };
  }
  if (runResult.outcome === "blocked") {
    return { status: "blocked", blockedReason: runResult.blockedReason ?? "blocked" };
  }
  if (runResult.outcome === "skipped" || runResult.outcome === "not_due") {
    return { status: "blocked", blockedReason: runResult.outcome };
  }
  return { status: "completed", outcome: runResult.outcome };
}

function payoutMatchesLedgerForManualAttach(
  payout: Stripe.Payout,
  ledger: {
    amountCents: number;
    currency: string;
    scheduleWindowKey: string;
    correlationId: string | null;
  },
): { ok: true } | { ok: false; reason: string } {
  if (payout.amount !== ledger.amountCents) return { ok: false, reason: "amount_mismatch" };
  if (String(payout.currency).toLowerCase() !== ledger.currency.toLowerCase()) {
    return { ok: false, reason: "currency_mismatch" };
  }
  const meta = payout.metadata ?? {};
  const corr = ledger.correlationId?.trim();
  if (corr) {
    if (meta[SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID] !== corr) {
      return { ok: false, reason: "correlation_mismatch" };
    }
    if (meta[SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY] !== ledger.scheduleWindowKey) {
      return { ok: false, reason: "window_key_mismatch" };
    }
    return { ok: true };
  }
  return { ok: false, reason: "missing_correlation_metadata" };
}

export async function manualAttachScheduledPayoutOpsLedger(args: {
  payoutType: ScheduledPayoutOpsType;
  ledgerId: string;
  stripePayoutId: string;
  evidenceSummary: string;
  confirmNoDuplicate: boolean;
  actorUserId: string | null;
}): Promise<ScheduledPayoutOpsMutationResult> {
  if (!manualScheduledPayoutAttachmentEnabled()) {
    return { status: "failed", message: "manual_attachment_disabled" };
  }
  if (!args.confirmNoDuplicate) {
    return { status: "blocked", blockedReason: "confirmation_required" };
  }
  const po = args.stripePayoutId.trim();
  if (!/^po_[a-zA-Z0-9]+$/.test(po)) {
    return { status: "blocked", blockedReason: "invalid_stripe_payout_id" };
  }
  const evidence = args.evidenceSummary.trim();
  if (evidence.length < 10 || evidence.length > 2000) {
    return { status: "blocked", blockedReason: "invalid_evidence_summary" };
  }

  const loaded = await loadLedger(args.payoutType, args.ledgerId);
  if (!loaded?.stripeAccountId) {
    return { status: "failed", message: "ledger_not_found" };
  }
  if (adminMutationBlockedByClaim(loaded.row as LedgerRowWithClaim)) {
    return { status: "blocked", blockedReason: "processing_claim_held" };
  }
  const rowStripePayoutId = loaded.row.stripePayoutId as string | null | undefined;
  if (rowStripePayoutId?.startsWith("po_")) {
    return { status: "blocked", blockedReason: "already_submitted" };
  }

  const dupEmp = await prisma.employeeStripeScheduledPayoutRequest.findFirst({
    where: { stripePayoutId: po, NOT: { id: args.ledgerId } },
    select: { id: true },
  });
  const dupBiz = await prisma.stripeConnectScheduledPayoutRequest.findFirst({
    where: { stripePayoutId: po, NOT: { id: args.ledgerId } },
    select: { id: true },
  });
  if (dupEmp || dupBiz) {
    return { status: "blocked", blockedReason: "stripe_payout_id_already_attached" };
  }

  let payout: Stripe.Payout | null = null;
  if (retrievePayoutForManualAttachFn) {
    payout = await retrievePayoutForManualAttachFn(loaded.stripeAccountId, po);
  } else if (isStripeConfigured()) {
    try {
      payout = await getStripeClient().payouts.retrieve(po, {
        stripeAccount: loaded.stripeAccountId,
      });
    } catch {
      payout = null;
    }
  }
  if (!payout) {
    return { status: "inconclusive", reason: "stripe_retrieve_failed" };
  }

  const match = payoutMatchesLedgerForManualAttach(payout, loaded.row as never);
  if (!match.ok) {
    await writeAuditLog({
      userId: args.actorUserId,
      action: "platform.scheduled_payout.manual_attachment_rejected",
      metadata: JSON.stringify({
        ledgerId: args.ledgerId,
        payoutType: args.payoutType,
        reason: match.reason,
      }),
    });
    return { status: "blocked", blockedReason: match.reason };
  }

  const persisted = await tryPersistReconcileMatch(args.payoutType, args.ledgerId, payout);
  if (!persisted.ok) {
    return mutationFromPersistFailure(persisted);
  }

  try {
    await writeAuditLogStrict({
      userId: args.actorUserId,
      action: "platform.scheduled_payout.manual_attachment",
      metadata: JSON.stringify({
        ledgerId: args.ledgerId,
        payoutType: args.payoutType,
        stripePayoutId: po,
        evidenceSummary: evidence.slice(0, 500),
      }),
    });
  } catch {
    return scheduledPayoutAuditLogFailed(true);
  }

  return { status: "completed", outcome: "attached", stripePayoutId: po };
}

/** Reconcile without create — used by tests and admin API. */
export async function adminReconcileLedgerOnly(
  payoutType: ScheduledPayoutOpsType,
  ledgerId: string,
  listPendingFn: (accountId: string) => Promise<boolean>,
): Promise<ScheduledPayoutOpsMutationResult> {
  const loaded = await loadLedger(payoutType, ledgerId);
  if (!loaded?.stripeAccountId) return { status: "failed", message: "ledger_not_found" };
  if (adminMutationBlockedByClaim(loaded.row as LedgerRowWithClaim)) {
    return { status: "blocked", blockedReason: "processing_claim_held" };
  }
  const snapshot = ledgerSnapshotForRow(payoutType, loaded.row as never);
  const gate = await gateScheduledLedgerBeforeCreate({
    stripeAccountId: loaded.stripeAccountId,
    ledger: snapshot,
    ledgerCreated: false,
    listPendingFn,
  });
  if (gate.action === "reconciled") {
    const persisted = await tryPersistReconcileMatch(payoutType, ledgerId, gate.stripePayout);
    if (!persisted.ok) {
      return mutationFromPersistFailure(persisted);
    }
    return { status: "completed", outcome: "matched", stripePayoutId: gate.stripePayoutId };
  }
  if (gate.action === "block") {
    return { status: "inconclusive", reason: gate.blockedReason };
  }
  if (gate.action === "wait_retry") {
    return { status: "blocked", blockedReason: gate.blockedReason };
  }
  return { status: "completed", outcome: "no_create_path" };
}
