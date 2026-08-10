/**
 * GDPR lifecycle Slice F-C — category retention jobs (fail-closed).
 *
 * Categories: analytics_ttl, audit_scrub, support_redact, notify_cleanup,
 * guest_scrub, billing_redact, staff_pii_scrub.
 *
 * NEVER invents T_* days. UNSET → no destructive work.
 * NEVER deletes Transaction/TipRefund/Business/Employee stubs/KYC/DSAR.
 * NEVER gates MVP onboarding/dashboard access.
 * Production: DATA_LIFECYCLE_V1 + per-category EXECUTE flags (default OFF).
 */

import { Prisma, type DataLifecycleJob, type DataLifecycleJobType } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  cutoffDateFromDays,
  isCategoryHeld,
  isCategoryRetentionExecutionEnabled,
  readCategoryRetentionDays,
  redactBillingPayload,
  scrubPiiKeysInJson,
  scrubPiiKeysInMetadataString,
  type RetentionCategory,
} from "./retentionPolicy.helpers.js";
import { FORMER_TEAM_MEMBER_NAME } from "./anonymization.service.js";

const RUNNING_LEASE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const BATCH = 200;

export class CategoryRetentionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "EXECUTION_GATED"
      | "T_UNSET"
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

export function assertCategoryExecutionAllowed(
  kind: CategoryJobKind,
  opts?: { bypassExecutionGate?: boolean; env?: NodeJS.ProcessEnv },
): void {
  if (opts?.bypassExecutionGate) return;
  const cat = JOB_TO_CATEGORY[kind];
  if (!isCategoryRetentionExecutionEnabled(cat, opts?.env ?? process.env)) {
    throw new CategoryRetentionError(
      `${kind} execution disabled (DATA_LIFECYCLE_V1 / category execute flag)`,
      "EXECUTION_GATED",
    );
  }
}

export function assertCategoryRetentionConfigured(
  kind: CategoryJobKind,
  env: NodeJS.ProcessEnv = process.env,
): { days: number; cutoff: Date } {
  const cat = JOB_TO_CATEGORY[kind];
  const cfg = readCategoryRetentionDays(cat, env);
  if (!cfg.configured) {
    throw new CategoryRetentionError(
      `${cat} retention UNSET/invalid — fail-closed (no destructive work)`,
      "T_UNSET",
    );
  }
  return { days: cfg.days, cutoff: cutoffDateFromDays(cfg.days) };
}

async function businessHeld(
  businessId: string,
  category: RetentionCategory,
): Promise<boolean> {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { legalHold: true, legalHoldCategories: true },
  });
  return isCategoryHeld(b, category);
}

// ── Analytics ─────────────────────────────────────────────────────────────

export type AnalyticsTtlResult = {
  deletedFunnel: number;
  deletedVisits: number;
  deletedScans: number;
  skippedHeldBusinesses: number;
  alreadyComplete: boolean;
};

export async function runAnalyticsTtl(
  opts?: {
    bypassExecutionGate?: boolean;
    env?: NodeJS.ProcessEnv;
    businessId?: string;
    now?: Date;
  },
): Promise<AnalyticsTtlResult> {
  assertCategoryExecutionAllowed("analytics_ttl", opts);
  const env = opts?.env ?? process.env;
  const { cutoff } = assertCategoryRetentionConfigured("analytics_ttl", env);
  const bizFilter = opts?.businessId ? { businessId: opts.businessId } : {};

  let deletedFunnel = 0;
  let deletedVisits = 0;
  let deletedScans = 0;
  let skippedHeldBusinesses = 0;

  // Process per-business to honor category holds.
  const bizIds = opts?.businessId
    ? [opts.businessId]
    : (
        await prisma.qrScanEvent.findMany({
          where: { scannedAt: { lt: cutoff }, ...bizFilter },
          select: { businessId: true },
          distinct: ["businessId"],
          take: 500,
        })
      ).map((r) => r.businessId);

  const extraBiz = await prisma.qrFunnelEvent.findMany({
    where: { createdAt: { lt: cutoff }, ...(opts?.businessId ? { businessId: opts.businessId } : {}) },
    select: { businessId: true },
    distinct: ["businessId"],
    take: 500,
  });
  const allBiz = [...new Set([...bizIds, ...extraBiz.map((b) => b.businessId)])];

  if (allBiz.length === 0) {
    return {
      deletedFunnel: 0,
      deletedVisits: 0,
      deletedScans: 0,
      skippedHeldBusinesses: 0,
      alreadyComplete: true,
    };
  }

  for (const businessId of allBiz) {
    if (await businessHeld(businessId, "analytics")) {
      skippedHeldBusinesses += 1;
      continue;
    }
    const funnel = await prisma.qrFunnelEvent.deleteMany({
      where: { businessId, createdAt: { lt: cutoff } },
    });
    deletedFunnel += funnel.count;

    const visits = await prisma.qrGuestVisit.deleteMany({
      where: { businessId, startedAt: { lt: cutoff } },
    });
    deletedVisits += visits.count;

    const scans = await prisma.qrScanEvent.deleteMany({
      where: { businessId, scannedAt: { lt: cutoff } },
    });
    deletedScans += scans.count;
  }

  return {
    deletedFunnel,
    deletedVisits,
    deletedScans,
    skippedHeldBusinesses,
    alreadyComplete: deletedFunnel + deletedVisits + deletedScans === 0,
  };
}

// ── Audit scrub ───────────────────────────────────────────────────────────

export type AuditScrubResult = {
  scrubbedAuditLogs: number;
  scrubbedActivityEvents: number;
  skipped: number;
  alreadyComplete: boolean;
};

export async function runAuditScrub(
  opts?: {
    bypassExecutionGate?: boolean;
    env?: NodeJS.ProcessEnv;
    businessId?: string;
  },
): Promise<AuditScrubResult> {
  assertCategoryExecutionAllowed("audit_scrub", opts);
  const env = opts?.env ?? process.env;
  const { cutoff } = assertCategoryRetentionConfigured("audit_scrub", env);

  let scrubbedAuditLogs = 0;
  let scrubbedActivityEvents = 0;
  let skipped = 0;

  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [
        { metadata: { contains: '"email"' } },
        { metadata: { contains: '"phone"' } },
        { metadata: { contains: '"customerName"' } },
        { metadata: { contains: '"inviteeEmail"' } },
        { metadata: { contains: "@" } },
      ],
    },
    select: { id: true, userId: true, metadata: true },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });

  for (const log of logs) {
    if (log.userId) {
      const user = await prisma.user.findUnique({
        where: { id: log.userId },
        select: { legalHold: true, legalHoldCategories: true },
      });
      if (isCategoryHeld(user, "audit")) {
        skipped += 1;
        continue;
      }
    }
    const { changed, value } = scrubPiiKeysInMetadataString(log.metadata);
    if (changed) {
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { metadata: value },
      });
      scrubbedAuditLogs += 1;
    }
  }

  const activityWhere: Prisma.BusinessActivityEventWhereInput = {
    occurredAt: { lt: cutoff },
    ...(opts?.businessId ? { businessId: opts.businessId } : {}),
  };
  const events = await prisma.businessActivityEvent.findMany({
    where: activityWhere,
    select: { id: true, businessId: true, summary: true },
    take: BATCH,
  });

  for (const ev of events) {
    if (await businessHeld(ev.businessId, "audit")) {
      skipped += 1;
      continue;
    }
    const { changed, value } = scrubPiiKeysInJson(ev.summary);
    if (changed) {
      await prisma.businessActivityEvent.update({
        where: { id: ev.id },
        data: { summary: value as Prisma.InputJsonValue },
      });
      scrubbedActivityEvents += 1;
    }
  }

  return {
    scrubbedAuditLogs,
    scrubbedActivityEvents,
    skipped,
    alreadyComplete: scrubbedAuditLogs + scrubbedActivityEvents === 0,
  };
}

// ── Support redact ────────────────────────────────────────────────────────

export type SupportRedactResult = {
  redactedMessages: number;
  skippedTickets: number;
  alreadyComplete: boolean;
};

export async function runSupportRedact(
  opts?: {
    bypassExecutionGate?: boolean;
    env?: NodeJS.ProcessEnv;
    businessId?: string;
  },
): Promise<SupportRedactResult> {
  assertCategoryExecutionAllowed("support_redact", opts);
  const env = opts?.env ?? process.env;
  const { cutoff } = assertCategoryRetentionConfigured("support_redact", env);

  let redactedMessages = 0;
  let skippedTickets = 0;

  const tickets = await prisma.supportTicket.findMany({
    where: {
      updatedAt: { lt: cutoff },
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: { id: true, businessId: true },
    take: BATCH,
  });

  for (const t of tickets) {
    if (await businessHeld(t.businessId, "support")) {
      skippedTickets += 1;
      continue;
    }
    const res = await prisma.supportTicketMessage.updateMany({
      where: {
        ticketId: t.id,
        NOT: { body: "[redacted]" },
      },
      data: { body: "[redacted]" },
    });
    redactedMessages += res.count;
    // Detach authors (nullable) — keep ticket structure.
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
  };
}

// ── Notifications ─────────────────────────────────────────────────────────

export type NotifyCleanupResult = {
  deleted: number;
  alreadyComplete: boolean;
};

export async function runNotifyCleanup(
  opts?: {
    bypassExecutionGate?: boolean;
    env?: NodeJS.ProcessEnv;
    userId?: string;
  },
): Promise<NotifyCleanupResult> {
  assertCategoryExecutionAllowed("notify_cleanup", opts);
  const env = opts?.env ?? process.env;
  const { cutoff } = assertCategoryRetentionConfigured("notify_cleanup", env);

  // User-scoped hold: skip users with notify held.
  if (opts?.userId) {
    const user = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: { legalHold: true, legalHoldCategories: true },
    });
    if (isCategoryHeld(user, "notify")) {
      return { deleted: 0, alreadyComplete: true };
    }
    const res = await prisma.notification.deleteMany({
      where: { userId: opts.userId, createdAt: { lt: cutoff } },
    });
    return { deleted: res.count, alreadyComplete: res.count === 0 };
  }

  const candidates = await prisma.notification.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, userId: true },
    take: BATCH,
  });

  let deleted = 0;
  for (const n of candidates) {
    const user = await prisma.user.findUnique({
      where: { id: n.userId },
      select: { legalHold: true, legalHoldCategories: true },
    });
    if (isCategoryHeld(user, "notify")) continue;
    await prisma.notification.delete({ where: { id: n.id } });
    deleted += 1;
  }

  return { deleted, alreadyComplete: deleted === 0 };
}

// ── Guest feedback ────────────────────────────────────────────────────────

export type GuestScrubResult = {
  scrubbed: number;
  skipped: number;
  alreadyComplete: boolean;
};

export async function runGuestScrub(
  opts?: {
    bypassExecutionGate?: boolean;
    env?: NodeJS.ProcessEnv;
    businessId?: string;
  },
): Promise<GuestScrubResult> {
  assertCategoryExecutionAllowed("guest_scrub", opts);
  const env = opts?.env ?? process.env;
  const { cutoff } = assertCategoryRetentionConfigured("guest_scrub", env);

  const rows = await prisma.tipFeedback.findMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [{ customerName: { not: null } }, { comment: { not: null } }],
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: { id: true, businessId: true },
    take: BATCH,
  });

  let scrubbed = 0;
  let skipped = 0;
  for (const row of rows) {
    if (await businessHeld(row.businessId, "guest")) {
      skipped += 1;
      continue;
    }
    await prisma.tipFeedback.update({
      where: { id: row.id },
      data: { customerName: null, comment: null },
    });
    scrubbed += 1;
  }

  return {
    scrubbed,
    skipped,
    alreadyComplete: scrubbed === 0 && rows.length === 0,
  };
}

// ── Billing event redact ──────────────────────────────────────────────────

export type BillingRedactResult = {
  redacted: number;
  alreadyComplete: boolean;
};

export async function runBillingRedact(
  opts?: {
    bypassExecutionGate?: boolean;
    env?: NodeJS.ProcessEnv;
  },
): Promise<BillingRedactResult> {
  assertCategoryExecutionAllowed("billing_redact", opts);
  const env = opts?.env ?? process.env;
  const { cutoff } = assertCategoryRetentionConfigured("billing_redact", env);

  const candidateIds = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM subscription_events
    WHERE occurred_at < ${cutoff}
      AND payload IS NOT NULL
      AND payload::text LIKE '%"email"%'
      AND payload::text NOT LIKE '%"[redacted]"%'
    ORDER BY occurred_at ASC
    LIMIT ${BATCH}
  `;

  const events = candidateIds.length
    ? await prisma.subscriptionEvent.findMany({
        where: { id: { in: candidateIds.map((r) => r.id) } },
        select: { id: true, payload: true, subscriptionId: true },
      })
    : [];

  let redacted = 0;
  for (const ev of events) {
    if (ev.payload == null) continue;
    // Optional: if subscription → business held for billing, skip.
    if (ev.subscriptionId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: ev.subscriptionId },
        select: { businessId: true },
      });
      if (sub && (await businessHeld(sub.businessId, "billing"))) {
        continue;
      }
    }
    const { changed, value } = redactBillingPayload(ev.payload);
    if (changed) {
      await prisma.subscriptionEvent.update({
        where: { id: ev.id },
        data: { payload: value as Prisma.InputJsonValue },
      });
      redacted += 1;
    }
  }

  return { redacted, alreadyComplete: redacted === 0 };
}

// ── Staff PII scrub (soft-removed only; does not undo F-A; no tip deletes) ─

export type StaffPiiScrubResult = {
  scrubbed: number;
  skipped: number;
  alreadyComplete: boolean;
};

export async function runStaffPiiScrub(
  opts?: {
    bypassExecutionGate?: boolean;
    env?: NodeJS.ProcessEnv;
    businessId?: string;
  },
): Promise<StaffPiiScrubResult> {
  assertCategoryExecutionAllowed("staff_pii_scrub", opts);
  const env = opts?.env ?? process.env;
  const { cutoff } = assertCategoryRetentionConfigured("staff_pii_scrub", env);

  const employees = await prisma.employee.findMany({
    where: {
      isDeleted: true,
      anonymizedAt: null,
      deletedAt: { lt: cutoff },
      ...(opts?.businessId ? { businessId: opts.businessId } : {}),
    },
    select: {
      id: true,
      businessId: true,
      userId: true,
      name: true,
      phone: true,
      bio: true,
      avatar: true,
    },
    take: BATCH,
  });

  let scrubbed = 0;
  let skipped = 0;
  for (const emp of employees) {
    if (await businessHeld(emp.businessId, "staff_pii")) {
      skipped += 1;
      continue;
    }
    if (emp.userId) {
      const user = await prisma.user.findUnique({
        where: { id: emp.userId },
        select: { legalHold: true, legalHoldCategories: true },
      });
      if (isCategoryHeld(user, "staff_pii")) {
        skipped += 1;
        continue;
      }
    }
    // Scrub identifiers only — keep Employee row as tip stub; do not delete tips.
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
        anonymizedAt: new Date(),
        // userId left as-is unless already null — F-A owns full detach; avoid conflicting auth path
      },
    });
    scrubbed += 1;
  }

  return {
    scrubbed,
    skipped,
    alreadyComplete: scrubbed === 0 && employees.length === 0,
  };
}

// ── Job orchestration ─────────────────────────────────────────────────────

type JobPayload = {
  businessId?: string;
  userId?: string;
};

function parsePayload(job: DataLifecycleJob): JobPayload {
  if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) return {};
  return job.payload as JobPayload;
}

function isCategoryJobType(t: string): t is CategoryJobKind {
  return t in JOB_TO_CATEGORY;
}

export async function enqueueCategoryRetentionJob(
  kind: CategoryJobKind,
  opts?: {
    bypassExecutionGate?: boolean;
    businessId?: string;
    userId?: string;
    notBefore?: Date;
  },
): Promise<{ jobId: string }> {
  assertCategoryExecutionAllowed(kind, opts);

  const subjectType = opts?.businessId ? "business" : opts?.userId ? "user" : "platform";
  const subjectId = opts?.businessId ?? opts?.userId ?? "platform";

  const existing = await prisma.dataLifecycleJob.findFirst({
    where: {
      type: kind,
      subjectType,
      subjectId,
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  if (existing) return { jobId: existing.id };

  const job = await prisma.dataLifecycleJob.create({
    data: {
      type: kind as DataLifecycleJobType,
      subjectType,
      subjectId,
      status: "pending",
      notBefore: opts?.notBefore ?? new Date(),
      payload: {
        ...(opts?.businessId ? { businessId: opts.businessId } : {}),
        ...(opts?.userId ? { userId: opts.userId } : {}),
      } as Prisma.InputJsonValue,
    },
  });
  return { jobId: job.id };
}

async function reclaimStale(): Promise<number> {
  const cutoff = new Date(Date.now() - RUNNING_LEASE_MS);
  const kinds = Object.keys(JOB_TO_CATEGORY) as CategoryJobKind[];
  const res = await prisma.dataLifecycleJob.updateMany({
    where: {
      type: { in: kinds },
      status: "running",
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "pending",
      lastError: "reclaimed_stale_running_lease",
    },
  });
  return res.count;
}

export async function reclaimStaleCategoryRetentionJobs(): Promise<number> {
  return reclaimStale();
}

async function claimJob(jobId: string): Promise<DataLifecycleJob | null> {
  const updated = await prisma.dataLifecycleJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "running", attempts: { increment: 1 }, lastError: null },
  });
  if (updated.count === 0) return null;
  return prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
}

export async function processCategoryRetentionJob(
  jobId: string,
  opts?: { bypassExecutionGate?: boolean; env?: NodeJS.ProcessEnv },
): Promise<{ status: string; result?: unknown }> {
  const job = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
  if (!job) throw new CategoryRetentionError("Job not found", "NOT_FOUND");
  if (job.status === "succeeded" || job.status === "cancelled") {
    return { status: job.status };
  }
  if (!isCategoryJobType(job.type)) {
    throw new CategoryRetentionError("Unsupported F-C job type", "FORBIDDEN");
  }

  assertCategoryExecutionAllowed(job.type, opts);

  let claimed = job;
  if (job.status === "pending") {
    const c = await claimJob(jobId);
    if (!c) return { status: "running" };
    claimed = c;
  } else if (job.status === "running") {
    return { status: "running" };
  } else if (job.status === "failed" || job.status === "skipped_legal_hold") {
    await prisma.dataLifecycleJob.update({
      where: { id: jobId },
      data: { status: "running", attempts: { increment: 1 } },
    });
    claimed = (await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } }))!;
  }

  const payload = parsePayload(claimed);
  // Tenant safety: subjectId authoritative for business/user scoped jobs.
  if (claimed.subjectType === "business") {
    if (payload.businessId && payload.businessId !== claimed.subjectId) {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          lastError: "payload businessId mismatch subjectId",
          completedAt: new Date(),
        },
      });
      return { status: "failed" };
    }
  }
  if (claimed.subjectType === "user") {
    if (payload.userId && payload.userId !== claimed.subjectId) {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          lastError: "payload userId mismatch subjectId",
          completedAt: new Date(),
        },
      });
      return { status: "failed" };
    }
  }

  const scope = {
    bypassExecutionGate: opts?.bypassExecutionGate,
    env: opts?.env,
    businessId: claimed.subjectType === "business" ? claimed.subjectId : payload.businessId,
    userId: claimed.subjectType === "user" ? claimed.subjectId : payload.userId,
  };

  try {
    let result: unknown;
    switch (claimed.type as CategoryJobKind) {
      case "analytics_ttl":
        result = await runAnalyticsTtl(scope);
        break;
      case "audit_scrub":
        result = await runAuditScrub(scope);
        break;
      case "support_redact":
        result = await runSupportRedact(scope);
        break;
      case "notify_cleanup":
        result = await runNotifyCleanup(scope);
        break;
      case "guest_scrub":
        result = await runGuestScrub(scope);
        break;
      case "billing_redact":
        result = await runBillingRedact(scope);
        break;
      case "staff_pii_scrub":
        result = await runStaffPiiScrub(scope);
        break;
      default:
        throw new CategoryRetentionError("Unknown kind", "FORBIDDEN");
    }

    await prisma.dataLifecycleJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        lastError: null,
        payload: { ...payload, lastResult: result } as Prisma.InputJsonValue,
      },
    });
    return { status: "succeeded", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const code = err instanceof CategoryRetentionError ? err.code : "UNKNOWN";

    if (code === "LEGAL_HOLD") {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "skipped_legal_hold",
          lastError: message,
          notBefore: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      return { status: "skipped_legal_hold" };
    }

    if (code === "T_UNSET" || code === "EXECUTION_GATED" || code === "FORBIDDEN") {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: { status: "failed", lastError: message, completedAt: new Date() },
      });
      return { status: "failed" };
    }

    const attempts = claimed.attempts;
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: { status: "failed", lastError: message, completedAt: new Date() },
      });
      return { status: "failed" };
    }

    await prisma.dataLifecycleJob.update({
      where: { id: jobId },
      data: {
        status: "pending",
        lastError: message,
        notBefore: new Date(Date.now() + Math.min(60_000 * attempts, 15 * 60_000)),
      },
    });
    return { status: "pending" };
  }
}

/**
 * Tick all F-C category jobs. Each category independently gated.
 * Returns per-category processed counts; gated categories contribute 0.
 */
export async function tickCategoryRetentionJobs(
  limitPerType = 5,
  opts?: { bypassExecutionGate?: boolean; env?: NodeJS.ProcessEnv },
): Promise<{
  reclaimed: number;
  processed: Record<CategoryJobKind, number>;
  gated: Record<CategoryJobKind, boolean>;
}> {
  const reclaimed = await reclaimStale();
  const kinds = Object.keys(JOB_TO_CATEGORY) as CategoryJobKind[];
  const processed = {} as Record<CategoryJobKind, number>;
  const gated = {} as Record<CategoryJobKind, boolean>;

  for (const kind of kinds) {
    const cat = JOB_TO_CATEGORY[kind];
    const enabled =
      opts?.bypassExecutionGate === true ||
      isCategoryRetentionExecutionEnabled(cat, opts?.env ?? process.env);
    gated[kind] = !enabled;
    processed[kind] = 0;
    if (!enabled) continue;

    const pending = await prisma.dataLifecycleJob.findMany({
      where: {
        type: kind,
        status: "pending",
        notBefore: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: limitPerType,
      select: { id: true },
    });
    for (const row of pending) {
      await processCategoryRetentionJob(row.id, opts);
      processed[kind] += 1;
    }
  }

  return { reclaimed, processed, gated };
}
