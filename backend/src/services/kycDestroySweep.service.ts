/**
 * KYC secure-destroy SWEEP / ENQUEUE.
 *
 * Discovers businesses eligible for KYC object destruction and enqueues
 * kyc_secure_destroy DataLifecycleJob rows. Never calls secureDestroyBusinessKyc.
 *
 * Tick + DATA_LIFECYCLE_KYC_DESTROY_EXECUTE remain the only mutation path.
 * DRY_RUN never creates jobs. Storage-not-configured and legal hold fail closed.
 */

import { prisma } from "../prisma.js";
import {
  isSupabaseStorageConfigured,
  supabaseKycStorageBucketName,
} from "../lib/supabaseStorageClient.js";
import { resolveKycDestroyTarget } from "../lib/kycStorageReference.js";
import { isDataLifecycleDryRunEnabled, isDataLifecycleV1Enabled } from "./retentionPolicy.helpers.js";
import { logDryRunRecord } from "./retentionDryRun.js";
import {
  collectKycStorageRefs,
  enqueueKycSecureDestroyJob,
  evaluateKycDestroyEligibility,
} from "./kycSecureDestroy.service.js";

export type KycSweepMode = "off" | "dry_run" | "enqueue";

export type KycSweepRow = {
  businessId: string;
  action: "WOULD_ENQUEUE" | "enqueued" | "exists" | "skipped";
  jobId?: string;
  skipReason?: string;
  kycRefCount: number;
  taxIdUntouched: true;
};

export type KycSweepResult = {
  mode: KycSweepMode;
  gated: boolean;
  dryRun: boolean;
  wouldEnqueue: number;
  enqueued: number;
  exists: number;
  skipped: number;
  rows: KycSweepRow[];
};

export type KycSweepOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  bypassExecutionGate?: boolean;
  restrictToBusinessIds?: string[];
  subjectCap?: number;
};

const SUBJECT_CAP = 500;

export function resolveKycSweepMode(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { bypassExecutionGate?: boolean },
): KycSweepMode {
  if (opts?.bypassExecutionGate) {
    return isDataLifecycleDryRunEnabled(env) ? "dry_run" : "enqueue";
  }
  if (!isDataLifecycleV1Enabled(env)) return "off";
  if (isDataLifecycleDryRunEnabled(env)) return "dry_run";
  return "enqueue";
}

function kycStorageBlocksEnqueue(businessId: string, refs: string[]): string | null {
  const bucket = supabaseKycStorageBucketName();
  let needsRemote = false;
  for (const ref of refs) {
    const resolved = resolveKycDestroyTarget(businessId, ref, bucket);
    if (!resolved.ok) return `invalid_ref:${resolved.reason}`;
    if (resolved.target.kind === "remote") needsRemote = true;
  }
  if (needsRemote && !isSupabaseStorageConfigured()) return "storage_not_configured";
  return null;
}

/**
 * Enqueue-only KYC eligibility sweep. Does not destroy objects, clear DB refs,
 * change taxId, Stripe mapping, or lifecycleStatus.
 */
export async function sweepKycSecureDestroy(opts?: KycSweepOptions): Promise<KycSweepResult> {
  const env = opts?.env ?? process.env;
  const now = opts?.now ?? new Date();
  const mode = resolveKycSweepMode(env, opts);
  const empty: KycSweepResult = {
    mode,
    gated: mode === "off",
    dryRun: mode === "dry_run",
    wouldEnqueue: 0,
    enqueued: 0,
    exists: 0,
    skipped: 0,
    rows: [],
  };
  if (mode === "off") return empty;

  const businesses = await prisma.business.findMany({
    where: {
      lifecycleStatus: { in: ["soft_closed", "data_restricted"] },
      ...(opts?.restrictToBusinessIds ? { id: { in: opts.restrictToBusinessIds } } : {}),
    },
    select: {
      id: true,
      lifecycleStatus: true,
      deletedAt: true,
      kycRetainUntil: true,
      legalHold: true,
      legalHoldCategories: true,
      verificationDocumentPath: true,
      kycDocuments: true,
    },
    take: opts?.subjectCap ?? SUBJECT_CAP,
  });

  const result = { ...empty, rows: [] as KycSweepRow[] };

  for (const b of businesses) {
    const refs = collectKycStorageRefs({
      verificationDocumentPath: b.verificationDocumentPath,
      kycDocuments: b.kycDocuments,
    });
    const elig = evaluateKycDestroyEligibility(
      {
        id: b.id,
        lifecycleStatus: b.lifecycleStatus,
        deletedAt: b.deletedAt,
        kycRetainUntil: b.kycRetainUntil,
        legalHold: b.legalHold,
        legalHoldCategories: b.legalHoldCategories,
      },
      { now, env },
    );

    const push = (row: Omit<KycSweepRow, "taxIdUntouched">) => {
      result.rows.push({ ...row, taxIdUntouched: true });
    };

    if (!elig.eligible) {
      const hold = elig.code === "LEGAL_HOLD_KYC";
      logDryRunRecord({
        action: hold ? "WOULD_SKIP_LEGAL_HOLD" : "WOULD_SKIP_NOT_ELIGIBLE",
        category: "kyc",
        record: b.id,
        reason: elig.code ?? "ineligible",
        retentionExpiry: elig.earliestDestroyAt,
        legalHold: hold ? true : false,
        financialPreservation: "preserved",
      });
      result.skipped += 1;
      push({
        businessId: b.id,
        action: "skipped",
        skipReason: elig.code ?? "ineligible",
        kycRefCount: refs.length,
      });
      continue;
    }

    if (refs.length === 0) {
      result.skipped += 1;
      push({
        businessId: b.id,
        action: "skipped",
        skipReason: "no_kyc_refs",
        kycRefCount: 0,
      });
      continue;
    }

    const storageBlock = kycStorageBlocksEnqueue(b.id, refs);
    if (storageBlock) {
      logDryRunRecord({
        action: "WOULD_SKIP_NOT_ELIGIBLE",
        category: "kyc",
        record: b.id,
        reason: storageBlock,
        retentionExpiry: elig.earliestDestroyAt,
        legalHold: false,
        financialPreservation: "preserved",
      });
      result.skipped += 1;
      push({
        businessId: b.id,
        action: "skipped",
        skipReason: storageBlock,
        kycRefCount: refs.length,
      });
      continue;
    }

    const existing = await prisma.dataLifecycleJob.findFirst({
      where: {
        type: "kyc_secure_destroy",
        subjectType: "business",
        subjectId: b.id,
        status: { in: ["pending", "running"] },
      },
      select: { id: true },
    });
    if (existing) {
      result.exists += 1;
      push({
        businessId: b.id,
        action: "exists",
        jobId: existing.id,
        kycRefCount: refs.length,
      });
      continue;
    }

    if (mode === "dry_run") {
      logDryRunRecord({
        action: "WOULD_ENQUEUE",
        category: "kyc",
        record: b.id,
        reason: "kyc_secure_destroy_sweep",
        retentionExpiry: elig.earliestDestroyAt,
        legalHold: false,
        financialPreservation: "preserved",
      });
      result.wouldEnqueue += 1;
      push({
        businessId: b.id,
        action: "WOULD_ENQUEUE",
        kycRefCount: refs.length,
      });
      continue;
    }

    const { jobId } = await enqueueKycSecureDestroyJob(b.id, { allowEnqueueWhenGated: true });
    result.enqueued += 1;
    push({ businessId: b.id, action: "enqueued", jobId, kycRefCount: refs.length });
  }

  return result;
}
