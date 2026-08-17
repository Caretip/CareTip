/**
 * GDPR category retention jobs (fail-closed, legal-hold-aware, dry-run capable).
 *
 * NEVER deletes Transaction/TipRefund/Business/Employee stubs/KYC/DSAR.
 * Production mutate: DATA_LIFECYCLE_V1 + per-category EXECUTE (default OFF).
 * DATA_LIFECYCLE_DRY_RUN reports WOULD_* without mutation and wins over EXECUTE.
 */

import { Prisma, type DataLifecycleJob, type DataLifecycleJobType } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  resolveApprovedCategoryPolicy,
  resolveRetentionJobMode,
  type RetentionCategory,
} from "./retentionPolicy.helpers.js";
import { daysCutoff, hoursCutoff } from "./retentionCalendar.js";
import {
  CategoryRetentionError,
  type CategoryJobKind,
  runAnalyticsTtl,
  runAuditScrub,
  runBillingRedact,
  runGuestScrub,
  runNotifyCleanup,
  runStaffPiiScrub,
  runSupportRedact,
} from "./categoryRetention.runners.js";

export {
  CategoryRetentionError,
  runAnalyticsTtl,
  runAuditScrub,
  runBillingRedact,
  runGuestScrub,
  runNotifyCleanup,
  runStaffPiiScrub,
  runSupportRedact,
};
export type { CategoryJobKind } from "./categoryRetention.runners.js";
export type {
  AnalyticsTtlResult,
  AuditScrubResult,
  BillingRedactResult,
  GuestScrubResult,
  NotifyCleanupResult,
  StaffPiiScrubResult,
  SupportRedactResult,
} from "./categoryRetention.runners.js";

const RUNNING_LEASE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

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
  const env = opts?.env ?? process.env;
  const cat = JOB_TO_CATEGORY[kind];
  const mode = resolveRetentionJobMode(cat, env, { bypassExecutionGate: opts?.bypassExecutionGate });
  if (mode === "off") {
    throw new CategoryRetentionError(
      `${kind} execution disabled (DATA_LIFECYCLE_V1 / category execute flag / dry-run)`,
      "EXECUTION_GATED",
    );
  }
}

export function assertApprovedCategoryPolicy(
  kind: CategoryJobKind,
  env: NodeJS.ProcessEnv = process.env,
) {
  const cat = JOB_TO_CATEGORY[kind];
  const policy = resolveApprovedCategoryPolicy(cat, env);
  if (!policy.ok) {
    throw new CategoryRetentionError(
      `${cat} retention env contradicts approved policy or is invalid — fail-closed`,
      policy.reason === "contradicts_policy" ? "POLICY_CONTRADICTION" : "T_UNSET",
    );
  }
  return policy;
}

/** @deprecated Use assertApprovedCategoryPolicy — kept so existing imports compile. */
export function assertCategoryRetentionConfigured(
  kind: CategoryJobKind,
  env: NodeJS.ProcessEnv = process.env,
): { days: number; cutoff: Date } {
  const policy = assertApprovedCategoryPolicy(kind, env);
  if (policy.kind === "days") {
    return { days: policy.days, cutoff: daysCutoff(policy.days) };
  }
  if (policy.kind === "hours") {
    const daysApprox = Math.max(1, Math.ceil(policy.hours / 24));
    return { days: daysApprox, cutoff: hoursCutoff(policy.hours) };
  }
  throw new CategoryRetentionError(`${kind} is not a rolling-day policy`, "T_UNSET");
}

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
      },
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

    if (
      code === "T_UNSET" ||
      code === "POLICY_CONTRADICTION" ||
      code === "EXECUTION_GATED" ||
      code === "FORBIDDEN"
    ) {
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
  const env = opts?.env ?? process.env;

  for (const kind of kinds) {
    const cat = JOB_TO_CATEGORY[kind];
    const mode = resolveRetentionJobMode(cat, env, { bypassExecutionGate: opts?.bypassExecutionGate });
    const enabled = mode !== "off";
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
