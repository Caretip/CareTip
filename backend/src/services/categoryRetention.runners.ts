/**
 * Category retention runners — imported by categoryRetention.service.ts.
 * Never deletes Transaction / TipRefund / Stripe IDs / FeatureUtilizationDaily.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  categoryHoldDecision,
  resolveApprovedCategoryPolicy,
  resolveRetentionJobMode,
  redactBillingPayload,
  scrubPiiKeysInJson,
  scrubPiiKeysInMetadataString,
  type RetentionCategory,
} from "./retentionPolicy.helpers.js";
import { FORMER_TEAM_MEMBER_NAME } from "./anonymization.service.js";
import { calendarYearRetentionEligibleAt, daysCutoff, hoursCutoff } from "./retentionCalendar.js";
import { QR_ANONYMIZED_SESSION_ID } from "./retentionPolicy.constants.js";
import { logDryRunRecord, type RetentionDryRunRecord } from "./retentionDryRun.js";

const BATCH = 200;

export class CategoryRetentionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "EXECUTION_GATED"
      | "T_UNSET"
      | "POLICY_CONTRADICTION"
      | "LEGAL_HOLD"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "PRECONDITION",
  ) {
    super(message);
    this.name = "CategoryRetentionError";
  }
}

export type CategoryJobKind =
  | "analytics_ttl"
  | "audit_scrub"
  | "support_redact"
  | "notify_cleanup"
  | "guest_scrub"
  | "billing_redact"
  | "staff_pii_scrub";

const JOB_TO_CATEGORY: Record<CategoryJobKind, Exclude<RetentionCategory, "kyc" | "financial" | "payment">> = {
  analytics_ttl: "analytics",
  audit_scrub: "audit",
  support_redact: "support",
  notify_cleanup: "notify",
  guest_scrub: "guest",
  billing_redact: "billing",
  staff_pii_scrub: "staff_pii",
};

function assertRunnable(
  kind: CategoryJobKind,
  opts?: { bypassExecutionGate?: boolean; env?: NodeJS.ProcessEnv },
): void {
  const mode = resolveRetentionJobMode(JOB_TO_CATEGORY[kind], opts?.env ?? process.env, {
    bypassExecutionGate: opts?.bypassExecutionGate,
  });
  if (mode === "off") {
    throw new CategoryRetentionError(
      `${kind} execution disabled (DATA_LIFECYCLE_V1 / category execute flag / dry-run)`,
      "EXECUTION_GATED",
    );
  }
}

function isDryRun(
  kind: CategoryJobKind,
  opts?: { bypassExecutionGate?: boolean; env?: NodeJS.ProcessEnv },
): boolean {
  return (
    resolveRetentionJobMode(JOB_TO_CATEGORY[kind], opts?.env ?? process.env, {
      bypassExecutionGate: opts?.bypassExecutionGate,
    }) === "dry_run"
  );
}

async function businessHoldDecision(
  businessId: string,
  category: RetentionCategory,
): Promise<"held" | "clear" | "unknown"> {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { legalHold: true, legalHoldCategories: true },
  });
  return categoryHoldDecision(b, category);
}

/** Prefetch hold decisions for many businesses (1 query instead of N). */
async function businessHoldDecisionsBatch(
  businessIds: string[],
  category: RetentionCategory,
): Promise<Map<string, "held" | "clear" | "unknown">> {
  const unique = [...new Set(businessIds.filter(Boolean))];
  const map = new Map<string, "held" | "clear" | "unknown">();
  if (unique.length === 0) return map;
  const rows = await prisma.business.findMany({
    where: { id: { in: unique } },
    select: { id: true, legalHold: true, legalHoldCategories: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  for (const id of unique) {
    map.set(id, categoryHoldDecision(byId.get(id) ?? null, category));
  }
  return map;
}

async function businessTimezone(businessId: string): Promise<string | null> {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  });
  return b?.timezone ?? null;
}

function policyOrThrow(kind: CategoryJobKind, env: NodeJS.ProcessEnv) {
  const policy = resolveApprovedCategoryPolicy(JOB_TO_CATEGORY[kind], env);
  if (!policy.ok) {
    throw new CategoryRetentionError(
      `${JOB_TO_CATEGORY[kind]} retention env contradicts approved policy or is invalid — fail-closed`,
      policy.reason === "contradicts_policy" ? "POLICY_CONTRADICTION" : "T_UNSET",
    );
  }
  return policy;
}

export type AnalyticsTtlResult = {
  deletedFunnel: number;
  deletedVisits: number;
  deletedScans: number;
  anonymizedFunnel: number;
  anonymizedVisits: number;
  anonymizedScans: number;
  skippedHeldBusinesses: number;
  skippedUnknownHold: number;
  alreadyComplete: boolean;
  dryRun: boolean;
  dryRunRecords: RetentionDryRunRecord[];
};

export async function runAnalyticsTtl(opts?: {
  bypassExecutionGate?: boolean;
  env?: NodeJS.ProcessEnv;
  businessId?: string;
  now?: Date;
}): Promise<AnalyticsTtlResult> {
  assertRunnable("analytics_ttl", opts);
  const env = opts?.env ?? process.env;
  const dryRun = isDryRun("analytics_ttl", opts);
  const policy = policyOrThrow("analytics_ttl", env);
  if (policy.kind !== "hours") {
    throw new CategoryRetentionError("analytics must be 48-hour policy", "T_UNSET");
  }
  const now = opts?.now ?? new Date();
  const cutoff = hoursCutoff(policy.hours, now);
  const expiryIso = cutoff.toISOString();

  const empty: AnalyticsTtlResult = {
    deletedFunnel: 0,
    deletedVisits: 0,
    deletedScans: 0,
    anonymizedFunnel: 0,
    anonymizedVisits: 0,
    anonymizedScans: 0,
    skippedHeldBusinesses: 0,
    skippedUnknownHold: 0,
    alreadyComplete: true,
    dryRun,
    dryRunRecords: [],
  };

  const scans = await prisma.qrScanEvent.findMany({
    where: {
      scannedAt: { lt: cutoff },
      anonymizedAt: null,
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: { id: true, businessId: true },
    take: BATCH,
  });
  const visits = await prisma.qrGuestVisit.findMany({
    where: {
      startedAt: { lt: cutoff },
      anonymizedAt: null,
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: { id: true, businessId: true },
    take: BATCH,
  });
  const funnels = await prisma.qrFunnelEvent.findMany({
    where: {
      createdAt: { lt: cutoff },
      anonymizedAt: null,
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: { id: true, businessId: true, transactionId: true },
    take: BATCH,
  });

  if (scans.length + visits.length + funnels.length === 0) return empty;

  let anonymizedFunnel = 0;
  let anonymizedVisits = 0;
  let anonymizedScans = 0;
  let skippedHeldBusinesses = 0;
  let skippedUnknownHold = 0;
  const dryRunRecords: RetentionDryRunRecord[] = [];

  const holdByBusiness = await businessHoldDecisionsBatch(
    [
      ...scans.map((r) => r.businessId),
      ...visits.map((r) => r.businessId),
      ...funnels.map((r) => r.businessId),
    ],
    "analytics",
  );

  const clearScanIds: string[] = [];
  for (const row of scans) {
    const d = holdByBusiness.get(row.businessId) ?? "unknown";
    if (d === "held") {
      skippedHeldBusinesses += 1;
      dryRunRecords.push({
        action: "WOULD_SKIP_LEGAL_HOLD",
        category: "qr_personal",
        record: row.id,
        reason: "legal_hold",
        retentionExpiry: expiryIso,
        legalHold: true,
        financialPreservation: "n/a",
      });
      continue;
    }
    if (d === "unknown") {
      skippedUnknownHold += 1;
      dryRunRecords.push({
        action: "WOULD_SKIP_UNKNOWN_HOLD",
        category: "qr_personal",
        record: row.id,
        reason: "hold_unknown_fail_closed",
        retentionExpiry: expiryIso,
        legalHold: "unknown",
        financialPreservation: "n/a",
      });
      continue;
    }
    dryRunRecords.push({
      action: "WOULD_ANONYMIZE",
      category: "qr_personal",
      record: row.id,
      reason: "qr_personal_48h",
      retentionExpiry: expiryIso,
      legalHold: false,
      financialPreservation: "n/a",
    });
    clearScanIds.push(row.id);
  }

  const clearVisitIds: string[] = [];
  for (const row of visits) {
    const d = holdByBusiness.get(row.businessId) ?? "unknown";
    if (d !== "clear") {
      if (d === "held") skippedHeldBusinesses += 1;
      else skippedUnknownHold += 1;
      continue;
    }
    dryRunRecords.push({
      action: "WOULD_ANONYMIZE",
      category: "qr_personal",
      record: row.id,
      reason: "qr_personal_48h",
      retentionExpiry: expiryIso,
      legalHold: false,
      financialPreservation: "n/a",
    });
    clearVisitIds.push(row.id);
  }

  const clearFunnelIds: string[] = [];
  for (const row of funnels) {
    const d = holdByBusiness.get(row.businessId) ?? "unknown";
    if (d !== "clear") {
      if (d === "held") skippedHeldBusinesses += 1;
      else skippedUnknownHold += 1;
      continue;
    }
    dryRunRecords.push({
      action: "WOULD_ANONYMIZE",
      category: "qr_personal",
      record: row.id,
      reason: "qr_personal_48h",
      retentionExpiry: expiryIso,
      legalHold: false,
      financialPreservation: row.transactionId ? "preserved" : "n/a",
    });
    clearFunnelIds.push(row.id);
  }

  if (!dryRun) {
    if (clearScanIds.length > 0) {
      const res = await prisma.qrScanEvent.updateMany({
        where: { id: { in: clearScanIds } },
        data: {
          sessionId: QR_ANONYMIZED_SESSION_ID,
          userAgent: null,
          country: null,
          city: null,
          anonymizedAt: now,
        },
      });
      anonymizedScans = res.count;
    }
    if (clearVisitIds.length > 0) {
      const res = await prisma.qrGuestVisit.updateMany({
        where: { id: { in: clearVisitIds } },
        data: { sessionId: QR_ANONYMIZED_SESSION_ID, anonymizedAt: now },
      });
      anonymizedVisits = res.count;
    }
    if (clearFunnelIds.length > 0) {
      const res = await prisma.qrFunnelEvent.updateMany({
        where: { id: { in: clearFunnelIds } },
        data: { sessionId: QR_ANONYMIZED_SESSION_ID, anonymizedAt: now },
      });
      anonymizedFunnel = res.count;
    }
  } else {
    anonymizedScans = clearScanIds.length;
    anonymizedVisits = clearVisitIds.length;
    anonymizedFunnel = clearFunnelIds.length;
  }

  for (const rec of dryRunRecords) {
    if (dryRun) logDryRunRecord(rec);
  }

  return {
    deletedFunnel: 0,
    deletedVisits: 0,
    deletedScans: 0,
    anonymizedFunnel,
    anonymizedVisits,
    anonymizedScans,
    skippedHeldBusinesses,
    skippedUnknownHold,
    alreadyComplete: anonymizedFunnel + anonymizedVisits + anonymizedScans === 0,
    dryRun,
    dryRunRecords: dryRun ? dryRunRecords : [],
  };
}

export type AuditScrubResult = {
  scrubbedAuditLogs: number;
  scrubbedActivityEvents: number;
  skipped: number;
  alreadyComplete: boolean;
  dryRun: boolean;
};

async function tenantAuditLogUserIds(opts?: {
  businessId?: string;
  userId?: string;
}): Promise<{ mode: "all" } | { mode: "users"; userIds: string[] } | { mode: "none" }> {
  if (opts?.userId) return { mode: "users", userIds: [opts.userId] };
  if (opts?.businessId) {
    const biz = await prisma.business.findUnique({
      where: { id: opts.businessId },
      select: { userId: true },
    });
    if (!biz) return { mode: "none" };
    const emps = await prisma.employee.findMany({
      where: { businessId: opts.businessId, userId: { not: null } },
      select: { userId: true },
    });
    const ids = new Set<string>();
    if (biz.userId) ids.add(biz.userId);
    for (const e of emps) {
      if (e.userId) ids.add(e.userId);
    }
    return { mode: "users", userIds: [...ids] };
  }
  return { mode: "all" };
}

export async function runAuditScrub(opts?: {
  bypassExecutionGate?: boolean;
  env?: NodeJS.ProcessEnv;
  businessId?: string;
  userId?: string;
  now?: Date;
}): Promise<AuditScrubResult> {
  assertRunnable("audit_scrub", opts);
  const env = opts?.env ?? process.env;
  const dryRun = isDryRun("audit_scrub", opts);
  const policy = policyOrThrow("audit_scrub", env);
  if (policy.kind !== "calendar_years") {
    throw new CategoryRetentionError("audit must be calendar-year policy", "T_UNSET");
  }
  const now = opts?.now ?? new Date();

  let scrubbedAuditLogs = 0;
  let scrubbedActivityEvents = 0;
  let skipped = 0;

  const logScope = await tenantAuditLogUserIds(opts);
  const logs =
    logScope.mode === "none"
      ? []
      : await prisma.auditLog.findMany({
          where: {
            retentionClass: "admin_audit",
            ...(logScope.mode === "users" ? { userId: { in: logScope.userIds } } : {}),
            OR: [
              { metadata: { contains: '"email"' } },
              { metadata: { contains: '"phone"' } },
              { metadata: { contains: '"customerName"' } },
              { metadata: { contains: '"inviteeEmail"' } },
              { metadata: { contains: "@" } },
            ],
          },
          select: { id: true, userId: true, metadata: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          take: BATCH,
        });

  for (const log of logs) {
    const cal = calendarYearRetentionEligibleAt(log.createdAt, policy.years, "UTC");
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    if (log.userId) {
      const user = await prisma.user.findUnique({
        where: { id: log.userId },
        select: { legalHold: true, legalHoldCategories: true },
      });
      const d = categoryHoldDecision(user, "audit");
      if (d !== "clear") {
        skipped += 1;
        continue;
      }
    }
    const { changed, value } = scrubPiiKeysInMetadataString(log.metadata);
    if (!changed) continue;
    if (dryRun) {
      logDryRunRecord({
        action: "WOULD_REDACT",
        category: "audit",
        record: log.id,
        reason: "admin_audit_3y_calendar",
        retentionExpiry: cal.eligibleAt.toISOString(),
        legalHold: false,
        financialPreservation: "n/a",
      });
      scrubbedAuditLogs += 1;
      continue;
    }
    await prisma.auditLog.update({ where: { id: log.id }, data: { metadata: value } });
    scrubbedAuditLogs += 1;
  }

  const events = opts?.userId
    ? []
    : await prisma.businessActivityEvent.findMany({
        where: {
          ...(opts?.businessId ? { businessId: opts.businessId } : {}),
        },
        select: { id: true, businessId: true, summary: true, occurredAt: true },
        take: BATCH,
      });

  for (const ev of events) {
    const tz = (await businessTimezone(ev.businessId)) ?? "UTC";
    const cal = calendarYearRetentionEligibleAt(ev.occurredAt, policy.years, tz);
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    const d = await businessHoldDecision(ev.businessId, "audit");
    if (d !== "clear") {
      skipped += 1;
      continue;
    }
    const { changed, value } = scrubPiiKeysInJson(ev.summary);
    if (!changed) continue;
    if (dryRun) {
      scrubbedActivityEvents += 1;
      continue;
    }
    await prisma.businessActivityEvent.update({
      where: { id: ev.id },
      data: { summary: value as Prisma.InputJsonValue },
    });
    scrubbedActivityEvents += 1;
  }

  return {
    scrubbedAuditLogs,
    scrubbedActivityEvents,
    skipped,
    alreadyComplete: scrubbedAuditLogs + scrubbedActivityEvents === 0,
    dryRun,
  };
}

export type SupportRedactResult = {
  redactedMessages: number;
  skippedTickets: number;
  alreadyComplete: boolean;
  dryRun: boolean;
};

export async function runSupportRedact(opts?: {
  bypassExecutionGate?: boolean;
  env?: NodeJS.ProcessEnv;
  businessId?: string;
  now?: Date;
}): Promise<SupportRedactResult> {
  assertRunnable("support_redact", opts);
  const env = opts?.env ?? process.env;
  const dryRun = isDryRun("support_redact", opts);
  const policy = policyOrThrow("support_redact", env);
  if (policy.kind !== "calendar_years") {
    throw new CategoryRetentionError("support must be calendar-year policy", "T_UNSET");
  }
  const now = opts?.now ?? new Date();

  let redactedMessages = 0;
  let skippedTickets = 0;

  const tickets = await prisma.supportTicket.findMany({
    where: {
      closedAt: { not: null },
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: { id: true, businessId: true, closedAt: true },
    take: BATCH,
  });

  for (const t of tickets) {
    if (!t.closedAt) {
      skippedTickets += 1;
      continue;
    }
    const tz = (await businessTimezone(t.businessId)) ?? "UTC";
    const cal = calendarYearRetentionEligibleAt(t.closedAt, policy.years, tz);
    if (!cal.ok) {
      skippedTickets += 1;
      continue;
    }
    if (now.getTime() < cal.eligibleAt.getTime()) continue;
    const d = await businessHoldDecision(t.businessId, "support");
    if (d !== "clear") {
      skippedTickets += 1;
      continue;
    }
    if (dryRun) {
      logDryRunRecord({
        action: "WOULD_REDACT",
        category: "support",
        record: t.id,
        reason: "support_closedAt_3y_calendar",
        retentionExpiry: cal.eligibleAt.toISOString(),
        legalHold: false,
        financialPreservation: "n/a",
      });
      redactedMessages += 1;
      continue;
    }
    const res = await prisma.supportTicketMessage.updateMany({
      where: { ticketId: t.id, NOT: { body: "[redacted]" } },
      data: { body: "[redacted]" },
    });
    redactedMessages += res.count;
    await prisma.supportTicket.update({
      where: { id: t.id },
      data: { createdByUserId: null },
    });
    await prisma.supportTicketMessage.updateMany({
      where: { ticketId: t.id },
      data: { authorUserId: null },
    });
  }

  return {
    redactedMessages,
    skippedTickets,
    alreadyComplete: redactedMessages === 0 && skippedTickets === 0 && tickets.length === 0,
    dryRun,
  };
}

export type NotifyCleanupResult = {
  deleted: number;
  alreadyComplete: boolean;
  dryRun: boolean;
};

export async function runNotifyCleanup(opts?: {
  bypassExecutionGate?: boolean;
  env?: NodeJS.ProcessEnv;
  userId?: string;
  now?: Date;
}): Promise<NotifyCleanupResult> {
  assertRunnable("notify_cleanup", opts);
  const env = opts?.env ?? process.env;
  const dryRun = isDryRun("notify_cleanup", opts);
  const policy = policyOrThrow("notify_cleanup", env);
  if (policy.kind !== "days") {
    throw new CategoryRetentionError("notify must be 90-day policy", "T_UNSET");
  }
  const cutoff = daysCutoff(policy.days, opts?.now ?? new Date());

  if (opts?.userId) {
    const user = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: { legalHold: true, legalHoldCategories: true },
    });
    const d = categoryHoldDecision(user, "notify");
    if (d !== "clear") return { deleted: 0, alreadyComplete: true, dryRun };
    const matching = await prisma.notification.findMany({
      where: { userId: opts.userId, createdAt: { lt: cutoff } },
      select: { id: true },
    });
    if (dryRun) {
      for (const n of matching) {
        logDryRunRecord({
          action: "WOULD_DELETE",
          category: "notify",
          record: n.id,
          reason: "notification_90d",
          retentionExpiry: cutoff.toISOString(),
          legalHold: false,
          financialPreservation: "n/a",
        });
      }
      return { deleted: matching.length, alreadyComplete: matching.length === 0, dryRun };
    }
    const res = await prisma.notification.deleteMany({
      where: { userId: opts.userId, createdAt: { lt: cutoff } },
    });
    return { deleted: res.count, alreadyComplete: res.count === 0, dryRun };
  }

  const candidates = await prisma.notification.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, userId: true },
    take: BATCH,
  });

  if (candidates.length === 0) {
    return { deleted: 0, alreadyComplete: true, dryRun };
  }

  const userIds = [...new Set(candidates.map((n) => n.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, legalHold: true, legalHoldCategories: true },
  });
  const userById = new Map(users.map((u) => [u.id, u] as const));

  const deletableIds: string[] = [];
  for (const n of candidates) {
    const d = categoryHoldDecision(userById.get(n.userId) ?? null, "notify");
    if (d !== "clear") continue;
    if (dryRun) {
      logDryRunRecord({
        action: "WOULD_DELETE",
        category: "notify",
        record: n.id,
        reason: "notification_90d",
        retentionExpiry: cutoff.toISOString(),
        legalHold: false,
        financialPreservation: "n/a",
      });
      deletableIds.push(n.id);
      continue;
    }
    deletableIds.push(n.id);
  }

  if (dryRun) {
    return { deleted: deletableIds.length, alreadyComplete: deletableIds.length === 0, dryRun };
  }

  if (deletableIds.length === 0) {
    return { deleted: 0, alreadyComplete: true, dryRun };
  }

  const res = await prisma.notification.deleteMany({
    where: { id: { in: deletableIds } },
  });
  return { deleted: res.count, alreadyComplete: res.count === 0, dryRun };
}

export type GuestScrubResult = {
  scrubbed: number;
  skipped: number;
  alreadyComplete: boolean;
  dryRun: boolean;
};

export async function runGuestScrub(opts?: {
  bypassExecutionGate?: boolean;
  env?: NodeJS.ProcessEnv;
  businessId?: string;
}): Promise<GuestScrubResult> {
  assertRunnable("guest_scrub", opts);
  const env = opts?.env ?? process.env;
  const dryRun = isDryRun("guest_scrub", opts);
  policyOrThrow("guest_scrub", env);

  const rows = await prisma.tipFeedback.findMany({
    where: {
      customerName: { not: null },
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: { id: true, businessId: true },
    take: BATCH,
  });

  const holdByBusiness = await businessHoldDecisionsBatch(
    rows.map((r) => r.businessId),
    "guest",
  );

  let scrubbed = 0;
  let skipped = 0;
  const clearIds: string[] = [];
  for (const row of rows) {
    const d = holdByBusiness.get(row.businessId) ?? "unknown";
    if (d !== "clear") {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      logDryRunRecord({
        action: "WOULD_ANONYMIZE",
        category: "guest",
        record: row.id,
        reason: "guest_name_leftover",
        retentionExpiry: null,
        legalHold: false,
        financialPreservation: "preserved",
      });
      scrubbed += 1;
      continue;
    }
    clearIds.push(row.id);
  }

  if (!dryRun && clearIds.length > 0) {
    const res = await prisma.tipFeedback.updateMany({
      where: { id: { in: clearIds } },
      data: { customerName: null, nameAnonymizedAt: new Date() },
    });
    scrubbed = res.count;
  }

  return {
    scrubbed,
    skipped,
    alreadyComplete: scrubbed === 0 && rows.length === 0,
    dryRun,
  };
}

export type BillingRedactResult = {
  redacted: number;
  alreadyComplete: boolean;
  dryRun: boolean;
};

export async function runBillingRedact(opts?: {
  bypassExecutionGate?: boolean;
  env?: NodeJS.ProcessEnv;
  businessId?: string;
  now?: Date;
}): Promise<BillingRedactResult> {
  assertRunnable("billing_redact", opts);
  const env = opts?.env ?? process.env;
  const dryRun = isDryRun("billing_redact", opts);
  const policy = policyOrThrow("billing_redact", env);
  if (policy.kind !== "calendar_years") {
    throw new CategoryRetentionError("billing must be calendar-year policy", "T_UNSET");
  }
  const now = opts?.now ?? new Date();
  const prefilter = new Date(Date.UTC(now.getUTCFullYear() - policy.years + 1, 0, 1));

  const candidateIds = opts?.businessId
    ? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT se.id FROM subscription_events se
        INNER JOIN subscriptions s ON s.id = se.subscription_id
        WHERE se.payload IS NOT NULL
          AND se.payload::text LIKE ${'%"email"%'}
          AND se.payload::text NOT LIKE ${'%"[redacted]"%'}
          AND se.occurred_at < ${prefilter}
          AND s.business_id = ${opts.businessId}
        ORDER BY se.occurred_at ASC
        LIMIT ${BATCH}
      `)
    : await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM subscription_events
        WHERE payload IS NOT NULL
          AND payload::text LIKE ${'%"email"%'}
          AND payload::text NOT LIKE ${'%"[redacted]"%'}
          AND occurred_at < ${prefilter}
        ORDER BY occurred_at ASC
        LIMIT ${BATCH}
      `);

  const events = candidateIds.length
    ? await prisma.subscriptionEvent.findMany({
        where: { id: { in: candidateIds.map((r) => r.id) } },
        select: { id: true, payload: true, subscriptionId: true, occurredAt: true },
      })
    : [];

  let redacted = 0;
  for (const ev of events) {
    if (ev.payload == null) continue;
    let tz = "UTC";
    if (ev.subscriptionId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: ev.subscriptionId },
        select: { businessId: true },
      });
      if (sub) {
        const d = await businessHoldDecision(sub.businessId, "billing");
        if (d !== "clear") continue;
        tz = (await businessTimezone(sub.businessId)) ?? "UTC";
      }
    }
    const cal = calendarYearRetentionEligibleAt(ev.occurredAt, policy.years, tz);
    if (!cal.ok || now.getTime() < cal.eligibleAt.getTime()) continue;
    const { changed, value } = redactBillingPayload(ev.payload);
    if (!changed) continue;
    if (dryRun) {
      logDryRunRecord({
        action: "WOULD_REDACT",
        category: "billing",
        record: ev.id,
        reason: "billing_10y_calendar",
        retentionExpiry: cal.eligibleAt.toISOString(),
        legalHold: false,
        financialPreservation: "preserved",
      });
      redacted += 1;
      continue;
    }
    await prisma.subscriptionEvent.update({
      where: { id: ev.id },
      data: { payload: value as Prisma.InputJsonValue },
    });
    redacted += 1;
  }

  return { redacted, alreadyComplete: redacted === 0, dryRun };
}

export type StaffPiiScrubResult = {
  scrubbed: number;
  skipped: number;
  alreadyComplete: boolean;
  dryRun: boolean;
};

export async function runStaffPiiScrub(opts?: {
  bypassExecutionGate?: boolean;
  env?: NodeJS.ProcessEnv;
  businessId?: string;
  now?: Date;
}): Promise<StaffPiiScrubResult> {
  assertRunnable("staff_pii_scrub", opts);
  const env = opts?.env ?? process.env;
  const dryRun = isDryRun("staff_pii_scrub", opts);
  const policy = policyOrThrow("staff_pii_scrub", env);
  if (policy.kind !== "calendar_years") {
    throw new CategoryRetentionError("staff_pii must be calendar-year policy", "T_UNSET");
  }
  const now = opts?.now ?? new Date();

  const employees = await prisma.employee.findMany({
    where: {
      isDeleted: true,
      anonymizedAt: null,
      deletedAt: { not: null },
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: {
      id: true,
      businessId: true,
      userId: true,
      deletedAt: true,
      name: true,
    },
    take: BATCH,
  });

  let scrubbed = 0;
  let skipped = 0;
  for (const emp of employees) {
    if (!emp.deletedAt) {
      skipped += 1;
      continue;
    }
    const tz = (await businessTimezone(emp.businessId)) ?? "UTC";
    const cal = calendarYearRetentionEligibleAt(emp.deletedAt, policy.years, tz);
    if (!cal.ok) {
      skipped += 1;
      continue;
    }
    if (now.getTime() < cal.eligibleAt.getTime()) continue;
    const bizD = await businessHoldDecision(emp.businessId, "staff_pii");
    if (bizD !== "clear") {
      skipped += 1;
      continue;
    }
    if (emp.userId) {
      const user = await prisma.user.findUnique({
        where: { id: emp.userId },
        select: { legalHold: true, legalHoldCategories: true },
      });
      if (categoryHoldDecision(user, "staff_pii") !== "clear") {
        skipped += 1;
        continue;
      }
    }
    if (dryRun) {
      logDryRunRecord({
        action: "WOULD_ANONYMIZE",
        category: "employee_pii",
        record: emp.id,
        reason: "employee_historical_10y_calendar",
        retentionExpiry: cal.eligibleAt.toISOString(),
        legalHold: false,
        financialPreservation: "preserved",
      });
      scrubbed += 1;
      continue;
    }
    await prisma.employee.update({
      where: { id: emp.id },
      data: {
        name: FORMER_TEAM_MEMBER_NAME,
        phone: null,
        bio: null,
        avatar: null,
        slug: null,
        emailNotifications: false,
        pushNotifications: false,
        anonymizedAt: now,
      },
    });
    scrubbed += 1;
  }

  return {
    scrubbed,
    skipped,
    alreadyComplete: scrubbed === 0 && employees.length === 0,
    dryRun,
  };
}
