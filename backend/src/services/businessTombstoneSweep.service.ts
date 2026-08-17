/**
 * Business tombstone SWEEP / ENQUEUE + tick.
 *
 * Sweep discovers eligible closed businesses and enqueues business_tombstone jobs.
 * Tick processes queued jobs via tombstoneBusinessNonEssential (already DRY_RUN / EXECUTE gated).
 * Sweep never strips logo/welcome or changes lifecycleStatus.
 */

import { Prisma, type DataLifecycleJob } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  envFlagTrue,
  isDataLifecycleDryRunEnabled,
  isDataLifecycleV1Enabled,
} from "./retentionPolicy.helpers.js";
import { ACCOUNT_ERASURE_GRACE_DAYS } from "./retentionPolicy.constants.js";
import { addUtcDays } from "./retentionCalendar.js";
import { logDryRunRecord } from "./retentionDryRun.js";
import { tombstoneBusinessNonEssential, BusinessTombstoneError } from "./businessTombstone.service.js";

const RUNNING_LEASE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const SUBJECT_CAP = 500;

export type TombstoneSweepMode = "off" | "dry_run" | "enqueue";

export type TombstoneSweepRow = {
  businessId: string;
  action: "WOULD_ENQUEUE" | "enqueued" | "exists" | "skipped";
  jobId?: string;
  skipReason?: string;
};

export type TombstoneSweepResult = {
  mode: TombstoneSweepMode;
  gated: boolean;
  dryRun: boolean;
  wouldEnqueue: number;
  enqueued: number;
  exists: number;
  skipped: number;
  rows: TombstoneSweepRow[];
};

export type TombstoneSweepOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  bypassExecutionGate?: boolean;
  restrictToBusinessIds?: string[];
  subjectCap?: number;
};

export function resolveTombstoneSweepMode(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { bypassExecutionGate?: boolean },
): TombstoneSweepMode {
  if (opts?.bypassExecutionGate) {
    return isDataLifecycleDryRunEnabled(env) ? "dry_run" : "enqueue";
  }
  if (!isDataLifecycleV1Enabled(env)) return "off";
  if (isDataLifecycleDryRunEnabled(env)) return "dry_run";
  return "enqueue";
}

export async function sweepBusinessTombstone(opts?: TombstoneSweepOptions): Promise<TombstoneSweepResult> {
  const env = opts?.env ?? process.env;
  const now = opts?.now ?? new Date();
  const mode = resolveTombstoneSweepMode(env, opts);
  const result: TombstoneSweepResult = {
    mode,
    gated: mode === "off",
    dryRun: mode === "dry_run",
    wouldEnqueue: 0,
    enqueued: 0,
    exists: 0,
    skipped: 0,
    rows: [],
  };
  if (mode === "off") return result;

  const graceCutoff = addUtcDays(now, -ACCOUNT_ERASURE_GRACE_DAYS);
  const businesses = await prisma.business.findMany({
    where: {
      lifecycleStatus: { in: ["soft_closed", "data_restricted"] },
      tombstonedAt: null,
      deletedAt: { not: null, lte: graceCutoff },
      ...(opts?.restrictToBusinessIds ? { id: { in: opts.restrictToBusinessIds } } : {}),
    },
    select: {
      id: true,
      legalHold: true,
      legalHoldCategories: true,
      deletedAt: true,
    },
    take: opts?.subjectCap ?? SUBJECT_CAP,
  });

  for (const b of businesses) {
    // Do not weaken tombstone: any legalHold blocks (including empty categories).
    if (b.legalHold) {
      logDryRunRecord({
        action: "WOULD_SKIP_LEGAL_HOLD",
        category: "business_tombstone",
        record: b.id,
        reason: "legal_hold",
        retentionExpiry: null,
        legalHold: true,
        financialPreservation: "preserved",
      });
      result.skipped += 1;
      result.rows.push({ businessId: b.id, action: "skipped", skipReason: "legal_hold" });
      continue;
    }

    const existing = await prisma.dataLifecycleJob.findFirst({
      where: {
        type: "business_tombstone",
        subjectType: "business",
        subjectId: b.id,
        status: { in: ["pending", "running"] },
      },
      select: { id: true },
    });
    if (existing) {
      result.exists += 1;
      result.rows.push({
        businessId: b.id,
        action: "exists",
        jobId: existing.id,
      });
      continue;
    }

    if (mode === "dry_run") {
      logDryRunRecord({
        action: "WOULD_ENQUEUE",
        category: "business_tombstone",
        record: b.id,
        reason: "tombstone_sweep",
        retentionExpiry: b.deletedAt
          ? addUtcDays(b.deletedAt, ACCOUNT_ERASURE_GRACE_DAYS).toISOString()
          : null,
        legalHold: false,
        financialPreservation: "preserved",
      });
      result.wouldEnqueue += 1;
      result.rows.push({ businessId: b.id, action: "WOULD_ENQUEUE" });
      continue;
    }

    const job = await prisma.dataLifecycleJob.create({
      data: {
        type: "business_tombstone",
        subjectType: "business",
        subjectId: b.id,
        status: "pending",
        notBefore: now,
        payload: { businessId: b.id, source: "business_tombstone_sweep" } as Prisma.InputJsonValue,
      },
    });
    result.enqueued += 1;
    result.rows.push({ businessId: b.id, action: "enqueued", jobId: job.id });
  }

  return result;
}

function parsePayload(job: DataLifecycleJob): { businessId?: string } {
  if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) return {};
  return job.payload as { businessId?: string };
}

async function reclaimStaleTombstoneJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - RUNNING_LEASE_MS);
  const res = await prisma.dataLifecycleJob.updateMany({
    where: {
      type: "business_tombstone",
      status: "running",
      updatedAt: { lt: cutoff },
    },
    data: { status: "pending", lastError: "reclaimed_stale_running_lease" },
  });
  return res.count;
}

function tombstoneTickAllowed(
  env: NodeJS.ProcessEnv,
  opts?: { bypassExecutionGate?: boolean },
): "off" | "dry_run" | "execute" {
  if (opts?.bypassExecutionGate) {
    return isDataLifecycleDryRunEnabled(env) ? "dry_run" : "execute";
  }
  if (!isDataLifecycleV1Enabled(env)) return "off";
  if (isDataLifecycleDryRunEnabled(env)) return "dry_run";
  if (envFlagTrue("DATA_LIFECYCLE_TOMBSTONE_EXECUTE", env)) return "execute";
  return "off";
}

export async function tickBusinessTombstoneJobs(
  limit = 10,
  opts?: { bypassExecutionGate?: boolean; env?: NodeJS.ProcessEnv; now?: Date },
): Promise<{ processed: number; reclaimed: number; gated: boolean; dryRun: boolean }> {
  const env = opts?.env ?? process.env;
  const mode = tombstoneTickAllowed(env, opts);
  if (mode === "off") {
    return { processed: 0, reclaimed: 0, gated: true, dryRun: false };
  }
  // DRY_RUN: do not claim jobs (would mark succeeded without mutation).
  if (mode === "dry_run") {
    return { processed: 0, reclaimed: 0, gated: false, dryRun: true };
  }

  const reclaimed = await reclaimStaleTombstoneJobs();
  const pending = await prisma.dataLifecycleJob.findMany({
    where: {
      type: "business_tombstone",
      status: "pending",
      notBefore: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let processed = 0;
  for (const job of pending) {
    await processBusinessTombstoneJob(job.id, opts);
    processed += 1;
  }
  return { processed, reclaimed, gated: false, dryRun: false };
}

export async function processBusinessTombstoneJob(
  jobId: string,
  opts?: { bypassExecutionGate?: boolean; env?: NodeJS.ProcessEnv; now?: Date },
): Promise<{ status: string }> {
  const job = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
  if (!job) throw new BusinessTombstoneError("Job not found", "NOT_FOUND");
  if (job.status === "succeeded" || job.status === "cancelled") return { status: job.status };
  if (job.type !== "business_tombstone") {
    throw new BusinessTombstoneError("Unsupported job type", "PRECONDITION");
  }

  const claimed = await prisma.dataLifecycleJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "running", attempts: { increment: 1 }, lastError: null },
  });
  if (job.status === "pending" && claimed.count === 0) return { status: "running" };

  const payload = parsePayload(job);
  if (job.subjectType !== "business") {
    await prisma.dataLifecycleJob.update({
      where: { id: jobId },
      data: { status: "failed", lastError: "subjectType must be business", completedAt: new Date() },
    });
    return { status: "failed" };
  }
  if (payload.businessId && payload.businessId !== job.subjectId) {
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

  try {
    const result = await tombstoneBusinessNonEssential(job.subjectId, {
      bypassExecutionGate: opts?.bypassExecutionGate,
      now: opts?.now,
    });
    await prisma.dataLifecycleJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        lastError: null,
        payload: { ...payload, lastResult: result } as Prisma.InputJsonValue,
      },
    });
    return { status: "succeeded" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const code = err instanceof BusinessTombstoneError ? err.code : "UNKNOWN";
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
    if (code === "EXECUTION_GATED" || code === "PRECONDITION" || code === "GRACE") {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: { status: "failed", lastError: message, completedAt: new Date() },
      });
      return { status: "failed" };
    }
    const attempts = job.attempts + 1;
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
