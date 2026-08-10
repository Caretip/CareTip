/**
 * GDPR G-R1 remediation — erasure_continue worker.
 *
 * After legal-hold clear (or scheduled wake): re-check blockers / holds,
 * then enqueue anonymize_user when the subject is eligible.
 *
 * Does not bypass DATA_LIFECYCLE_V1 / DATA_LIFECYCLE_ANONYMIZATION_EXECUTE for
 * destructive anonymize execution. Creating a pending anonymize_user job is
 * orchestration-only (non-destructive); process/tick still gate execution.
 */

import type { DataLifecycleJob, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { getErasureBlockers } from "./erasureRequest.service.js";
import {
  AnonymizationError,
  LEGAL_HOLD_PROFILE_CATEGORY,
  enqueueAnonymizeUserJob,
  isAnonymizationExecutionEnabled,
  processAnonymizeLifecycleJob,
} from "./anonymization.service.js";

const CONTINUE_RUNNING_LEASE_MS = 15 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 8;
const BLOCKER_WAKE_MS = 60 * 60 * 1000;
const HOLD_WAKE_MS = 24 * 60 * 60 * 1000;

export type ErasureContinueErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "PRECONDITION"
  | "LEGAL_HOLD_CATEGORY"
  | "BLOCKED"
  | "EXECUTION_GATED"
  | "CONFLICT";

export class ErasureContinueError extends Error {
  constructor(
    message: string,
    readonly code: ErasureContinueErrorCode,
  ) {
    super(message);
    this.name = "ErasureContinueError";
  }
}

type ContinuePayload = {
  reason?: string;
  /** Ignored when mismatched — subjectId is authoritative. */
  userId?: string;
  anonymizeJobId?: string;
};

function parsePayload(job: DataLifecycleJob): ContinuePayload {
  if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) return {};
  return job.payload as ContinuePayload;
}

function categoryHeld(categories: string[], needle: string): boolean {
  const set = new Set(categories.map((c) => c.trim().toLowerCase()).filter(Boolean));
  if (needle === LEGAL_HOLD_PROFILE_CATEGORY) return set.has("profile");
  return set.has(needle.toLowerCase());
}

async function claimJob(jobId: string): Promise<DataLifecycleJob | null> {
  const updated = await prisma.dataLifecycleJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: {
      status: "running",
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (updated.count === 0) return null;
  return prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
}

export async function reclaimStaleErasureContinueJobs(
  now = new Date(),
  leaseMs = CONTINUE_RUNNING_LEASE_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - leaseMs);
  const res = await prisma.dataLifecycleJob.updateMany({
    where: {
      type: "erasure_continue",
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

/**
 * Process one erasure_continue job.
 * When eligible, enqueues anonymize_user (orchestration). Optionally runs anonymize
 * immediately when execution gates are on (or bypassExecutionGate for fixtures).
 */
export async function processErasureContinueJob(
  jobId: string,
  opts?: {
    bypassExecutionGate?: boolean;
    /** When true, also process the anonymize_user job inline after enqueue. */
    runAnonymizeInline?: boolean;
    deleteStorageObject?: (url: string) => Promise<void>;
  },
): Promise<{ status: string; anonymizeJobId?: string }> {
  const job = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
  if (!job) throw new ErasureContinueError("Job not found", "NOT_FOUND");
  if (job.type !== "erasure_continue") {
    throw new ErasureContinueError("Unsupported job type for erasure_continue worker", "FORBIDDEN");
  }
  if (job.status === "succeeded" || job.status === "cancelled") {
    return { status: job.status };
  }

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

  try {
    if (claimed.subjectType !== "user") {
      throw new ErasureContinueError("erasure_continue subjectType must be user", "FORBIDDEN");
    }
    // Tenant isolation: never trust payload.userId over subjectId.
    if (payload.userId && payload.userId !== claimed.subjectId) {
      throw new ErasureContinueError(
        "Job payload userId does not match subjectId — refusing cross-tenant erasure_continue",
        "FORBIDDEN",
      );
    }

    const userId = claimed.subjectId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        accountStatus: true,
        isActive: true,
        legalHold: true,
        legalHoldCategories: true,
        anonymizedAt: true,
        closedAt: true,
      },
    });
    if (!user) throw new ErasureContinueError("User not found", "NOT_FOUND");

    // Idempotent: already past erasure → succeed.
    if (
      user.accountStatus === "anonymized" ||
      user.accountStatus === "closed" ||
      user.anonymizedAt != null
    ) {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "succeeded",
          completedAt: new Date(),
          lastError: null,
          payload: {
            ...payload,
            result: "already_anonymized_or_closed",
          } as Prisma.InputJsonValue,
        },
      });
      return { status: "succeeded" };
    }

    if (user.accountStatus !== "erasure_pending") {
      throw new ErasureContinueError(
        `User accountStatus must be erasure_pending (got ${user.accountStatus})`,
        "PRECONDITION",
      );
    }

    // Amendment A2: profile hold blocks anonymize progression.
    if (user.legalHold && categoryHeld(user.legalHoldCategories ?? [], LEGAL_HOLD_PROFILE_CATEGORY)) {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "skipped_legal_hold",
          lastError: "LEGAL_HOLD_CATEGORY:profile",
          notBefore: new Date(Date.now() + HOLD_WAKE_MS),
          payload: {
            ...payload,
            result: "skipped_legal_hold_profile",
          } as Prisma.InputJsonValue,
        },
      });
      return { status: "skipped_legal_hold" };
    }

    const blockers = await getErasureBlockers(userId);
    // Continue-phase: sole-owner / subscription / pending payment / dispute still block anonymize.
    const hardBlock = blockers.filter((b) =>
      ["SOLE_BUSINESS_OWNER", "ACTIVE_SUBSCRIPTION", "PENDING_TIP_PAYMENT", "OPEN_DISPUTE"].includes(
        b.code,
      ),
    );
    if (hardBlock.length > 0) {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "pending",
          lastError: `blockers:${hardBlock.map((b) => b.code).join(",")}`,
          notBefore: new Date(Date.now() + BLOCKER_WAKE_MS),
          payload: {
            ...payload,
            result: "blocked",
            blockerCodes: hardBlock.map((b) => b.code),
          } as Prisma.InputJsonValue,
        },
      });
      return { status: "pending" };
    }

    // Orchestration enqueue — non-destructive. Execution still gated on anonymize process/tick.
    const { jobId: anonymizeJobId } = await enqueueAnonymizeUserJob(userId, {
      platformAuthorized: false,
      allowEnqueueWhenGated: true,
    });

    const runInline =
      opts?.runAnonymizeInline === true ||
      opts?.bypassExecutionGate === true ||
      isAnonymizationExecutionEnabled();

    if (runInline) {
      await processAnonymizeLifecycleJob(anonymizeJobId, {
        bypassExecutionGate: opts?.bypassExecutionGate,
        deleteStorageObject: opts?.deleteStorageObject,
      });
    }

    await prisma.dataLifecycleJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        lastError: null,
        payload: {
          ...payload,
          result: "anonymize_user_enqueued",
          anonymizeJobId,
          anonymizeRanInline: runInline,
        } as Prisma.InputJsonValue,
      },
    });
    return { status: "succeeded", anonymizeJobId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const code =
      err instanceof ErasureContinueError
        ? err.code
        : err instanceof AnonymizationError
          ? err.code
          : "UNKNOWN";

    if (code === "LEGAL_HOLD_CATEGORY") {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "skipped_legal_hold",
          lastError: message,
          notBefore: new Date(Date.now() + HOLD_WAKE_MS),
        },
      });
      return { status: "skipped_legal_hold" };
    }

    if (code === "FORBIDDEN" || code === "PRECONDITION" || code === "NOT_FOUND") {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          lastError: message,
          completedAt: new Date(),
        },
      });
      return { status: "failed" };
    }

    const attempts = claimed.attempts;
    if (attempts >= MAX_JOB_ATTEMPTS) {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          lastError: message,
          completedAt: new Date(),
        },
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

export async function tickErasureContinueJobs(
  opts?: {
    bypassExecutionGate?: boolean;
    runAnonymizeInline?: boolean;
    limit?: number;
    deleteStorageObject?: (url: string) => Promise<void>;
  },
): Promise<{ processed: number; statuses: string[] }> {
  await reclaimStaleErasureContinueJobs();
  const now = new Date();

  // Wake skipped_legal_hold rows whose notBefore has elapsed.
  await prisma.dataLifecycleJob.updateMany({
    where: {
      type: "erasure_continue",
      status: "skipped_legal_hold",
      notBefore: { lte: now },
    },
    data: { status: "pending", lastError: null },
  });

  const rows = await prisma.dataLifecycleJob.findMany({
    where: {
      type: "erasure_continue",
      status: "pending",
      notBefore: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: opts?.limit ?? 20,
  });

  const statuses: string[] = [];
  for (const row of rows) {
    const r = await processErasureContinueJob(row.id, opts);
    statuses.push(r.status);
  }
  return { processed: rows.length, statuses };
}
