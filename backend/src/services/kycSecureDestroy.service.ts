/**
 * GDPR lifecycle Slice F-B — KYC secure destroy (fail-closed).
 *
 * MVP COMPATIBILITY (mandatory):
 * KYC is NOT part of current MVP onboarding/dashboard authorization.
 * This module must NEVER be wired into auth middleware, onboarding completion,
 * dashboard route guards, or go-live capability checks.
 * It only destroys KYC storage/DB refs when KYC data already exists and
 * lifecycle/T_KYC/legal-hold gates pass. No KYC data → no-op (alreadyComplete).
 * T_KYC remains UNSET and DATA_LIFECYCLE_KYC_DESTROY_EXECUTE remains OFF by default.
 *
 * - T_KYC via RETENTION_T_KYC_DAYS must be explicitly configured (non-empty integer).
 * - Never invent retention days. UNSET/invalid → no KYC deletion.
 * - Storage delete succeeds before DB refs are cleared.
 * - Unconfigured storage provider is never treated as successful deletion.
 * - Does NOT tombstone Business. Does NOT destroy tips/payments/support/audit.
 * - taxId left untouched (LEGAL REVIEW — not decided in F-B).
 *
 * Production gate: DATA_LIFECYCLE_V1 + DATA_LIFECYCLE_KYC_DESTROY_EXECUTE (default OFF).
 */

import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Prisma, type BusinessLifecycle, type DataLifecycleJob } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  isSupabaseStorageConfigured,
  removeKycStorageObject,
  supabaseKycStorageBucketName,
} from "../lib/supabaseStorageClient.js";
import {
  resolveKycDestroyTarget,
  type KycDestroyTarget,
} from "../lib/kycStorageReference.js";
import { parseKycDocuments } from "./kyc.service.js";

const KYC_RUNNING_LEASE_MS = 15 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 8;
const TX_OPTS = { maxWait: 20_000, timeout: 60_000 } as const;

const ELIGIBLE_LIFECYCLES: BusinessLifecycle[] = ["soft_closed", "data_restricted"];

export type KycSecureDestroyErrorCode =
  | "NOT_FOUND"
  | "EXECUTION_GATED"
  | "T_KYC_UNSET"
  | "LIFECYCLE_INELIGIBLE"
  | "RETENTION_NOT_ELAPSED"
  | "LEGAL_HOLD_KYC"
  | "STORAGE_NOT_CONFIGURED"
  | "STORAGE_FAILED"
  | "INVALID_REF"
  | "CROSS_TENANT"
  | "FORBIDDEN"
  | "AUDIT_FAILED"
  | "PRECONDITION";

export class KycSecureDestroyError extends Error {
  constructor(
    message: string,
    readonly code: KycSecureDestroyErrorCode,
  ) {
    super(message);
    this.name = "KycSecureDestroyError";
  }
}

export type TKycConfig = { configured: false; reason: "unset" | "invalid" } | { configured: true; days: number };

/**
 * Read RETENTION_T_KYC_DAYS. Empty / missing / non-integer → UNSET (fail-closed).
 * Does not invent defaults (no 30/90/180/365).
 */
export function readTKycDaysFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TKycConfig {
  const raw = env.RETENTION_T_KYC_DAYS;
  if (raw === undefined || raw.trim() === "") {
    return { configured: false, reason: "unset" };
  }
  const trimmed = raw.trim();
  // Reject floats, negatives, scientific notation, junk.
  if (!/^\d+$/.test(trimmed)) {
    return { configured: false, reason: "invalid" };
  }
  return { configured: true, days: Number(trimmed) };
}

function envFlagTrue(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Production worker gate — default OFF. */
export function isKycDestroyExecutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlagTrue("DATA_LIFECYCLE_V1", env) && envFlagTrue("DATA_LIFECYCLE_KYC_DESTROY_EXECUTE", env);
}

export function assertKycDestroyExecutionAllowed(opts?: { bypassExecutionGate?: boolean }): void {
  if (opts?.bypassExecutionGate) return;
  if (!isKycDestroyExecutionEnabled()) {
    throw new KycSecureDestroyError(
      "KYC destroy execution is disabled (DATA_LIFECYCLE_V1 / DATA_LIFECYCLE_KYC_DESTROY_EXECUTE)",
      "EXECUTION_GATED",
    );
  }
}

function holdCategories(b: { legalHold: boolean; legalHoldCategories: string[] }): Set<string> {
  if (!b.legalHold) return new Set();
  return new Set((b.legalHoldCategories ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean));
}

/** Amendment A2: only the `kyc` category blocks KYC destruction. */
export function isKycCategoryHeld(b: {
  legalHold: boolean;
  legalHoldCategories: string[];
}): boolean {
  return holdCategories(b).has("kyc");
}

export type KycDestroyEligibility = {
  eligible: boolean;
  code?: KycSecureDestroyErrorCode;
  message: string;
  tKycDays: number | null;
  earliestDestroyAt: string | null;
};

export type BusinessKycEligibilityInput = {
  id: string;
  lifecycleStatus: BusinessLifecycle;
  deletedAt: Date | null;
  kycRetainUntil: Date | null;
  legalHold: boolean;
  legalHoldCategories: string[];
};

/**
 * Evaluate KYC destroy guards (fail-closed).
 * Legal authority: RETENTION_T_KYC_DAYS. kycRetainUntil is an additional orchestration gate only.
 */
export function evaluateKycDestroyEligibility(
  business: BusinessKycEligibilityInput,
  opts?: { now?: Date; env?: NodeJS.ProcessEnv },
): KycDestroyEligibility {
  const now = opts?.now ?? new Date();
  const tKyc = readTKycDaysFromEnv(opts?.env ?? process.env);
  if (!tKyc.configured) {
    return {
      eligible: false,
      code: "T_KYC_UNSET",
      message:
        tKyc.reason === "invalid"
          ? "RETENTION_T_KYC_DAYS is invalid — KYC destroy fail-closed"
          : "RETENTION_T_KYC_DAYS is UNSET — KYC destroy fail-closed",
      tKycDays: null,
      earliestDestroyAt: null,
    };
  }

  if (!ELIGIBLE_LIFECYCLES.includes(business.lifecycleStatus)) {
    return {
      eligible: false,
      code: "LIFECYCLE_INELIGIBLE",
      message: `Business lifecycle ${business.lifecycleStatus} is not eligible for KYC destroy`,
      tKycDays: tKyc.days,
      earliestDestroyAt: null,
    };
  }

  if (isKycCategoryHeld(business)) {
    return {
      eligible: false,
      code: "LEGAL_HOLD_KYC",
      message: "Legal hold preserves kyc category — KYC destroy blocked",
      tKycDays: tKyc.days,
      earliestDestroyAt: null,
    };
  }

  // Soft-close / restriction anchor — do not invent if missing.
  const anchor = business.deletedAt;
  if (!anchor) {
    return {
      eligible: false,
      code: "RETENTION_NOT_ELAPSED",
      message: "No soft-close deletedAt anchor — cannot compute T_KYC elapsed (fail-closed)",
      tKycDays: tKyc.days,
      earliestDestroyAt: null,
    };
  }

  const earliestFromPolicy = new Date(anchor.getTime() + tKyc.days * 24 * 60 * 60 * 1000);
  // Orchestration helper: if set, also wait until kycRetainUntil (never sole authority).
  const earliest =
    business.kycRetainUntil && business.kycRetainUntil.getTime() > earliestFromPolicy.getTime()
      ? business.kycRetainUntil
      : earliestFromPolicy;

  if (now.getTime() < earliest.getTime()) {
    return {
      eligible: false,
      code: "RETENTION_NOT_ELAPSED",
      message: "KYC retention period has not elapsed",
      tKycDays: tKyc.days,
      earliestDestroyAt: earliest.toISOString(),
    };
  }

  return {
    eligible: true,
    message: "eligible",
    tKycDays: tKyc.days,
    earliestDestroyAt: earliest.toISOString(),
  };
}

export function collectKycStorageRefs(input: {
  verificationDocumentPath: string | null;
  kycDocuments: unknown;
}): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    refs.push(s);
  };
  push(input.verificationDocumentPath);
  const docs = parseKycDocuments(input.kycDocuments);
  push(docs.registration);
  push(docs.address);
  push(docs.governmentId);
  if (Array.isArray(docs.additional)) {
    for (const a of docs.additional) push(a);
  }
  return refs;
}

export type DestroyKycStorageFn = (target: KycDestroyTarget, businessId: string) => Promise<void>;

async function defaultDestroyKycStorage(target: KycDestroyTarget, businessId: string): Promise<void> {
  if (target.kind === "remote") {
    await removeKycStorageObject(target.bucket, target.objectPath, {
      requireConfigured: true,
      businessId,
    });
    return;
  }
  // Disk path — no Supabase required; still fail if unlink errors unexpectedly.
  const fp = path.join(process.cwd(), target.relativePath);
  if (!existsSync(fp)) {
    return; // already gone — idempotent
  }
  unlinkSync(fp);
}

async function writeDurableKycAudit(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string | null;
    businessId: string;
    action: string;
    result: string;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        metadata: JSON.stringify({
          actorId: input.actorId,
          businessId: input.businessId,
          resourceType: "business",
          resourceId: input.businessId,
          action: input.action,
          timestamp: new Date().toISOString(),
          result: input.result,
          ...(input.extra ?? {}),
        }),
      },
    });
  } catch (err) {
    throw new KycSecureDestroyError(
      `KYC destroy audit failed: ${err instanceof Error ? err.message : "unknown"}`,
      "AUDIT_FAILED",
    );
  }
}

export type SecureDestroyKycOptions = {
  bypassExecutionGate?: boolean;
  actorId?: string | null;
  destroyStorage?: DestroyKycStorageFn;
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

export type SecureDestroyKycResult = {
  businessId: string;
  alreadyComplete: boolean;
  destroyedRefCount: number;
  pendingRefCount: number;
  lifecycleStatus: BusinessLifecycle;
  taxIdPreserved: boolean;
};

/**
 * Destroy KYC storage objects then clear DB refs. Never tombstones Business.
 * Never clears taxId (LEGAL REVIEW). Never deletes tips/transactions.
 */
export async function secureDestroyBusinessKyc(
  businessId: string,
  opts?: SecureDestroyKycOptions,
): Promise<SecureDestroyKycResult> {
  assertKycDestroyExecutionAllowed(opts);
  const id = String(businessId ?? "").trim();
  if (!id) throw new KycSecureDestroyError("businessId required", "NOT_FOUND");

  const destroyStorage = opts?.destroyStorage ?? defaultDestroyKycStorage;
  const now = opts?.now ?? new Date();
  const env = opts?.env ?? process.env;
  const actorId = opts?.actorId ?? null;

  const business = await prisma.business.findUnique({
    where: { id },
    select: {
      id: true,
      lifecycleStatus: true,
      deletedAt: true,
      kycRetainUntil: true,
      legalHold: true,
      legalHoldCategories: true,
      verificationDocumentPath: true,
      kycDocuments: true,
      taxId: true,
      kycReviewNotes: true,
    },
  });
  if (!business) throw new KycSecureDestroyError("Business not found", "NOT_FOUND");

  const eligibility = evaluateKycDestroyEligibility(business, { now, env });
  if (!eligibility.eligible) {
    throw new KycSecureDestroyError(eligibility.message, eligibility.code ?? "PRECONDITION");
  }

  const refs = collectKycStorageRefs(business);
  if (refs.length === 0) {
    return {
      businessId: id,
      alreadyComplete: true,
      destroyedRefCount: 0,
      pendingRefCount: 0,
      lifecycleStatus: business.lifecycleStatus,
      taxIdPreserved: true,
    };
  }

  // Remote KYC objects require a configured provider when using the real storage deleter.
  const needsRemote = refs.some((r) => {
    const resolved = resolveKycDestroyTarget(id, r, supabaseKycStorageBucketName());
    return resolved.ok && resolved.target.kind === "remote";
  });
  if (needsRemote && !opts?.destroyStorage && !isSupabaseStorageConfigured()) {
    throw new KycSecureDestroyError(
      "Supabase KYC storage is not configured — refusing destroy",
      "STORAGE_NOT_CONFIGURED",
    );
  }

  const kycBucket = supabaseKycStorageBucketName();
  const destroyed: string[] = [];
  const pending: string[] = [];

  for (const ref of refs) {
    const resolved = resolveKycDestroyTarget(id, ref, kycBucket);
    if (!resolved.ok) {
      if (resolved.reason === "cross_business_ref") {
        throw new KycSecureDestroyError(
          `Cross-business KYC reference refused: ${resolved.reason}`,
          "CROSS_TENANT",
        );
      }
      // Invalid/unrecognized — fail closed (do not scrub DB while unknown objects may remain).
      throw new KycSecureDestroyError(
        `Invalid or non-allowlisted KYC reference (${resolved.reason})`,
        "INVALID_REF",
      );
    }
    try {
      await destroyStorage(resolved.target, id);
      destroyed.push(ref);
    } catch (err) {
      pending.push(ref);
      throw new KycSecureDestroyError(
        `Storage delete failed: ${err instanceof Error ? err.message : "unknown"}`,
        "STORAGE_FAILED",
      );
    }
  }

  // All storage deletes succeeded → clear DB refs in one transaction (+ durable audit).
  // taxId intentionally NOT cleared (LEGAL REVIEW).
  // lifecycleStatus NOT changed to tombstoned.
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.business.findUnique({
      where: { id },
      select: {
        id: true,
        lifecycleStatus: true,
        deletedAt: true,
        kycRetainUntil: true,
        legalHold: true,
        legalHoldCategories: true,
        verificationDocumentPath: true,
        kycDocuments: true,
        taxId: true,
      },
    });
    if (!fresh) throw new KycSecureDestroyError("Business not found", "NOT_FOUND");

    const again = evaluateKycDestroyEligibility(fresh, { now, env });
    if (!again.eligible) {
      throw new KycSecureDestroyError(again.message, again.code ?? "PRECONDITION");
    }

    await writeDurableKycAudit(tx, {
      actorId,
      businessId: id,
      action: "business.kyc_secure_destroy_started",
      result: "started",
      extra: { refCount: refs.length },
    });

    await tx.business.update({
      where: { id },
      data: {
        verificationDocumentPath: null,
        kycDocuments: Prisma.DbNull,
        kycReviewNotes: null,
        // taxId: untouched — LEGAL REVIEW
      },
    });

    await writeDurableKycAudit(tx, {
      actorId,
      businessId: id,
      action: "business.kyc_secure_destroy_completed",
      result: "succeeded",
      extra: {
        destroyedRefCount: destroyed.length,
        taxIdPreserved: true,
        tombstoned: false,
      },
    });
  }, TX_OPTS);

  const after = await prisma.business.findUnique({
    where: { id },
    select: { lifecycleStatus: true, taxId: true },
  });

  return {
    businessId: id,
    alreadyComplete: false,
    destroyedRefCount: destroyed.length,
    pendingRefCount: pending.length,
    lifecycleStatus: after?.lifecycleStatus ?? business.lifecycleStatus,
    taxIdPreserved: true,
  };
}

// ── Job orchestration ─────────────────────────────────────────────────────

type KycJobPayload = {
  businessId?: string;
  pendingRefs?: string[];
  destroyedRefs?: string[];
};

function parsePayload(job: DataLifecycleJob): KycJobPayload {
  if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) return {};
  return job.payload as KycJobPayload;
}

export async function enqueueKycSecureDestroyJob(
  businessId: string,
  opts?: { bypassExecutionGate?: boolean; notBefore?: Date },
): Promise<{ jobId: string }> {
  assertKycDestroyExecutionAllowed(opts);
  const id = String(businessId ?? "").trim();
  if (!id) throw new KycSecureDestroyError("businessId required", "NOT_FOUND");

  const existing = await prisma.dataLifecycleJob.findFirst({
    where: {
      type: "kyc_secure_destroy",
      subjectType: "business",
      subjectId: id,
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  if (existing) return { jobId: existing.id };

  const job = await prisma.dataLifecycleJob.create({
    data: {
      type: "kyc_secure_destroy",
      subjectType: "business",
      subjectId: id,
      status: "pending",
      notBefore: opts?.notBefore ?? new Date(),
      payload: {} as Prisma.InputJsonValue,
    },
  });
  return { jobId: job.id };
}

async function reclaimStaleKycJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - KYC_RUNNING_LEASE_MS);
  const res = await prisma.dataLifecycleJob.updateMany({
    where: {
      type: "kyc_secure_destroy",
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

export async function processKycSecureDestroyJob(
  jobId: string,
  opts?: SecureDestroyKycOptions,
): Promise<{ status: string }> {
  assertKycDestroyExecutionAllowed(opts);

  const job = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
  if (!job) throw new KycSecureDestroyError("Job not found", "NOT_FOUND");
  if (job.status === "succeeded" || job.status === "cancelled") {
    return { status: job.status };
  }
  if (job.type !== "kyc_secure_destroy") {
    throw new KycSecureDestroyError("Unsupported job type", "FORBIDDEN");
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
    if (claimed.subjectType !== "business") {
      throw new KycSecureDestroyError("kyc_secure_destroy subjectType must be business", "FORBIDDEN");
    }
    if (payload.businessId && payload.businessId !== claimed.subjectId) {
      throw new KycSecureDestroyError(
        "Job payload businessId does not match subjectId — refusing cross-tenant destroy",
        "FORBIDDEN",
      );
    }

    await secureDestroyBusinessKyc(claimed.subjectId, {
      ...opts,
      actorId: opts?.actorId ?? null,
    });

    await prisma.dataLifecycleJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        lastError: null,
        payload: {
          ...payload,
          pendingRefs: [],
        } as Prisma.InputJsonValue,
      },
    });
    return { status: "succeeded" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const code = err instanceof KycSecureDestroyError ? err.code : "UNKNOWN";

    if (code === "LEGAL_HOLD_KYC") {
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
      code === "T_KYC_UNSET" ||
      code === "LIFECYCLE_INELIGIBLE" ||
      code === "RETENTION_NOT_ELAPSED" ||
      code === "EXECUTION_GATED" ||
      code === "FORBIDDEN" ||
      code === "CROSS_TENANT" ||
      code === "INVALID_REF"
    ) {
      await prisma.dataLifecycleJob.update({
        where: { id: jobId },
        data: {
          status: code === "T_KYC_UNSET" || code === "RETENTION_NOT_ELAPSED" || code === "LIFECYCLE_INELIGIBLE"
            ? "failed"
            : "failed",
          lastError: message,
          completedAt: new Date(),
        },
      });
      return { status: "failed" };
    }

    const attempts = claimed.attempts;
    const retryable =
      code === "STORAGE_FAILED" ||
      code === "STORAGE_NOT_CONFIGURED" ||
      code === "AUDIT_FAILED" ||
      code === "UNKNOWN";

    if (!retryable || attempts >= MAX_JOB_ATTEMPTS) {
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
        payload: {
          ...payload,
          // DB refs intentionally retained until storage succeeds.
        } as Prisma.InputJsonValue,
      },
    });
    return { status: "pending" };
  }
}

/**
 * Poll pending kyc_secure_destroy jobs. No-ops when execution flags are off.
 */
export async function tickKycSecureDestroyJobs(
  limit = 10,
  opts?: SecureDestroyKycOptions,
): Promise<{ processed: number; reclaimed: number; gated: boolean }> {
  if (!opts?.bypassExecutionGate && !isKycDestroyExecutionEnabled(opts?.env)) {
    return { processed: 0, reclaimed: 0, gated: true };
  }

  const reclaimed = await reclaimStaleKycJobs();
  const pending = await prisma.dataLifecycleJob.findMany({
    where: {
      type: "kyc_secure_destroy",
      status: "pending",
      notBefore: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  for (const row of pending) {
    await processKycSecureDestroyJob(row.id, opts);
  }

  return { processed: pending.length, reclaimed, gated: false };
}

/** Exported for tests — reclaim helper. */
export async function reclaimStaleKycSecureDestroyJobs(): Promise<number> {
  return reclaimStaleKycJobs();
}
