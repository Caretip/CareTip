/**
 * GDPR Slice E — async-first DSAR / portable export (Amendment A4) + Slice E remediation.
 * Uses DataLifecycleJob type=dsar_export. Never includes auth secrets or raw KYC bytes.
 * Artifacts use a dedicated private DSAR bucket (or local private dir), never the KYC bucket.
 *
 * MVP: obtain export while account is active, before confirming deletion.
 * Technical artifact TTL is a security control — not a legal retention period.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AccountStatus, DataLifecycleJob, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { writeAuditLog } from "./audit.service.js";
import { logDryRunRecord, type RetentionDryRunRecord } from "./retentionDryRun.js";
import {
  assertAllowedDsarObjectPath,
  createSignedUrlForDsarObject,
  isAllowedDsarObjectPath,
  isSupabaseStorageConfigured,
  removeDsarStorageObject,
  removeKycStorageObject,
  supabaseDsarStorageBucketName,
  supabaseKycStorageBucketName,
  uploadBufferToSupabaseDsarObject,
} from "../lib/supabaseStorageClient.js";

/** Technical security TTL for export artifacts (not a GDPR T_* retention period). */
export const DSAR_ARTIFACT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SIGNED_URL_TTL_SEC = 15 * 60;
/** Lease timeout for stuck running workers — reclaim for idempotent retry. */
export const DSAR_RUNNING_LEASE_MS = 15 * 60 * 1000; // 15 minutes

export class DsarExportError extends Error {
  constructor(
    message: string,
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "EXPIRED"
      | "NOT_READY"
      | "DENIED_STATUS"
      | "ARTIFACT_MISSING",
  ) {
    super(message);
    this.name = "DsarExportError";
  }
}

type ArtifactRef =
  | { kind: "inline"; json: Prisma.JsonValue }
  | { kind: "local_file"; absolutePath: string }
  | { kind: "private_storage"; bucket: string; objectPath: string };

export type DsarExportPayload = {
  downloadToken: string;
  expiresAt: string;
  artifact?: ArtifactRef;
  sizeBytes?: number;
};

/** Interactive create: active only (MVP export-before-deletion). Worker may still finish in-flight jobs. */
const CREATE_EXPORTABLE: AccountStatus[] = ["active"];
const BUILD_EXPORTABLE: AccountStatus[] = ["active", "deactivated", "erasure_pending"];

export function localDsarRootDir(): string {
  return path.join(process.cwd(), "storage", "private", "dsar");
}

export function dsarObjectKey(userId: string, jobId: string): string {
  return assertAllowedDsarObjectPath(`exports/${userId}/${jobId}.json`);
}

export function localDsarAbsolutePath(userId: string, jobId: string): string {
  return path.join(localDsarRootDir(), userId, `${jobId}.json`);
}

function basenameFromPath(p: string | null | undefined): string | null {
  if (!p?.trim()) return null;
  try {
    const cleaned = p.replace(/\\/g, "/");
    const base = cleaned.split("/").pop();
    return base && base.length > 0 ? base : null;
  } catch {
    return null;
  }
}

function kycFileNamesFromBusiness(kycDocuments: unknown, verificationDocumentPath: string | null): string[] {
  const names = new Set<string>();
  const v = basenameFromPath(verificationDocumentPath);
  if (v) names.add(v);
  if (Array.isArray(kycDocuments)) {
    for (const item of kycDocuments) {
      if (typeof item === "string") {
        const b = basenameFromPath(item);
        if (b) names.add(b);
      } else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const candidate =
          (typeof o.fileName === "string" && o.fileName) ||
          (typeof o.filename === "string" && o.filename) ||
          (typeof o.name === "string" && o.name) ||
          (typeof o.path === "string" && o.path) ||
          (typeof o.storagePath === "string" && o.storagePath);
        const b = basenameFromPath(candidate || null);
        if (b) names.add(b);
      }
    }
  }
  return [...names];
}

export function assertUserMayCreateExport(accountStatus: AccountStatus): void {
  if (accountStatus === "anonymized" || accountStatus === "closed") {
    throw new DsarExportError("Export is not available for anonymized or closed accounts", "DENIED_STATUS");
  }
  if (accountStatus === "erasure_pending") {
    throw new DsarExportError(
      "Export is no longer available after deletion is confirmed. Download your data before confirming account deletion.",
      "DENIED_STATUS",
    );
  }
  if (!CREATE_EXPORTABLE.includes(accountStatus)) {
    throw new DsarExportError("Export is not available for this account status", "DENIED_STATUS");
  }
}

export function assertUserMayBuildExport(accountStatus: AccountStatus): void {
  if (accountStatus === "anonymized" || accountStatus === "closed") {
    throw new DsarExportError("Export is not available for anonymized or closed accounts", "DENIED_STATUS");
  }
  if (!BUILD_EXPORTABLE.includes(accountStatus)) {
    throw new DsarExportError("Export is not available for this account status", "DENIED_STATUS");
  }
}

/** @deprecated use assertUserMayCreateExport — kept for callers expecting old name */
export function assertUserMayRequestExport(accountStatus: AccountStatus): void {
  assertUserMayCreateExport(accountStatus);
}

/** Build portable package (§14). Never includes secrets. */
export async function buildDsarExportPackage(userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      accountStatus: true,
      preferredLocale: true,
      emailVerified: true,
      createdAt: true,
      hasCompletedOnboarding: true,
      twoFactorEnabled: true,
      settings: {
        select: {
          tipReceivedNotifications: true,
          summaryEmails: true,
          systemAlerts: true,
          notifyNewLogin: true,
        },
      },
      oauthAccounts: { select: { provider: true } },
      pushDeviceTokens: { select: { platform: true, createdAt: true } },
      employee: {
        select: {
          id: true,
          name: true,
          jobTitle: true,
          bio: true,
          businessId: true,
          monthlyGoal: true,
          employeeGoals: {
            select: {
              id: true,
              name: true,
              goalAmount: true,
              goalPeriod: true,
              status: true,
              startDate: true,
            },
          },
          transactions: {
            where: { status: "success" },
            orderBy: { createdAt: "desc" },
            take: 5000,
            select: { id: true, amount: true, status: true, createdAt: true, businessId: true },
          },
        },
      },
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          verificationStatus: true,
          kycVerificationStatus: true,
          subscriptionTier: true,
          contactEmail: true,
          contactPhone: true,
          website: true,
          timezone: true,
          createdAt: true,
          stripeCustomerId: true,
          verificationDocumentPath: true,
          kycDocuments: true,
          subscription: {
            select: {
              planKey: true,
              status: true,
              billingCycle: true,
              currentPeriodEnd: true,
            },
          },
        },
      },
    },
  });
  if (!user) {
    throw new DsarExportError("User not found", "NOT_FOUND");
  }
  assertUserMayBuildExport(user.accountStatus);

  const supportTickets = await prisma.supportTicket.findMany({
    where: { createdByUserId: userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      ticketNumber: true,
      subject: true,
      status: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 100,
        select: { body: true, createdAt: true, authorUserId: true },
      },
    },
  });

  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { type: true, title: true, createdAt: true, readAt: true },
  });

  const auditActions = await prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { action: true, createdAt: true },
  });

  const pkg: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    subject: {
      userId: user.id,
      role: user.role,
      email: user.email,
      accountStatus: user.accountStatus,
      emailVerified: user.emailVerified,
      preferredLocale: user.preferredLocale,
      createdAt: user.createdAt.toISOString(),
      hasCompletedOnboarding: user.hasCompletedOnboarding,
      twoFactorEnabled: user.twoFactorEnabled,
    },
    profile: user.employee
      ? {
          name: user.employee.name,
          jobTitle: user.employee.jobTitle,
          bio: user.employee.bio,
          monthlyGoal:
            user.employee.monthlyGoal != null ? Number(user.employee.monthlyGoal) : null,
        }
      : user.business
        ? { businessName: user.business.name }
        : {},
    settings: user.settings
      ? {
          tipReceivedNotifications: user.settings.tipReceivedNotifications,
          summaryEmails: user.settings.summaryEmails,
          systemAlerts: user.settings.systemAlerts,
          notifyNewLogin: user.settings.notifyNewLogin,
        }
      : {},
    oauthProviders: user.oauthAccounts.map((o) => o.provider),
    devices: user.pushDeviceTokens.map((d) => ({
      platform: d.platform,
      createdAt: d.createdAt.toISOString(),
    })),
    employees: user.employee
      ? [
          {
            businessId: user.employee.businessId,
            name: user.employee.name,
            jobTitle: user.employee.jobTitle,
            tips: user.employee.transactions.map((t) => ({
              id: t.id,
              amount: Number(t.amount),
              status: t.status,
              createdAt: t.createdAt.toISOString(),
              businessId: t.businessId,
            })),
            goals: user.employee.employeeGoals.map((g) => ({
              id: g.id,
              name: g.name,
              goalAmount: Number(g.goalAmount),
              goalPeriod: g.goalPeriod,
              status: g.status,
              startDate: g.startDate.toISOString(),
            })),
          },
        ]
      : [],
    supportTickets: supportTickets.map((t) => ({
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      messages: t.messages.map((m) => ({
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        authorUserId: m.authorUserId,
      })),
    })),
    notifications: notifications.map((n) => ({
      type: n.type,
      title: n.title,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt?.toISOString() ?? null,
    })),
    auditActions: auditActions.map((a) => ({
      action: a.action,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  if (user.role === "MANAGER" && user.business) {
    pkg.business = {
      id: user.business.id,
      name: user.business.name,
      slug: user.business.slug,
      verificationStatus: user.business.verificationStatus,
      kycStatus: user.business.kycVerificationStatus,
      subscriptionTier: user.business.subscriptionTier,
      contactEmail: user.business.contactEmail,
      contactPhone: user.business.contactPhone,
      website: user.business.website,
      timezone: user.business.timezone,
      createdAt: user.business.createdAt.toISOString(),
      hasStripeCustomer: Boolean(user.business.stripeCustomerId),
      kycDocumentFileNames: kycFileNamesFromBusiness(
        user.business.kycDocuments,
        user.business.verificationDocumentPath,
      ),
      subscription: user.business.subscription
        ? {
            planKey: user.business.subscription.planKey,
            status: user.business.subscription.status,
            billingCycle: user.business.subscription.billingCycle,
            currentPeriodEnd: user.business.subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
    };
  }

  return pkg;
}

function parsePayload(job: DataLifecycleJob): DsarExportPayload {
  return readDsarExportPayload(job);
}

/** Read DSAR job payload without mutating artifacts. */
export function readDsarExportPayload(job: { payload: Prisma.JsonValue | null }): DsarExportPayload {
  const raw = job.payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { downloadToken: "", expiresAt: new Date(0).toISOString() };
  }
  return raw as DsarExportPayload;
}

export type DsarCleanupDryRunJob = {
  jobId: string;
  subjectId: string;
  status: string;
  expiresAt: string;
  artifactKind: string | null;
};

export type DsarCleanupDryRunOrphan = {
  userId: string;
  jobId: string;
  file: string;
};

export type DsarCleanupDryRunResult = {
  expiredSucceededJobs: DsarCleanupDryRunJob[];
  failedOrCancelledWithArtifact: DsarCleanupDryRunJob[];
  localOrphans: DsarCleanupDryRunOrphan[];
  wouldDeleteArtifacts: number;
  records: RetentionDryRunRecord[];
};

/**
 * Read-only DSAR artifact TTL evaluation.
 * Never calls expireDsarExportArtifact, cleanupOrphanLocalDsarArtifacts, or tickDsarExportJobs.
 * Technical artifact TTL (6 hours) is not a legal retention period.
 */
export async function evaluateDsarCleanupDryRun(now = new Date()): Promise<DsarCleanupDryRunResult> {
  const records: RetentionDryRunRecord[] = [];
  const expiredSucceededJobs: DsarCleanupDryRunJob[] = [];
  const failedOrCancelledWithArtifact: DsarCleanupDryRunJob[] = [];

  const jobs = await prisma.dataLifecycleJob.findMany({
    where: {
      type: "dsar_export",
      status: { in: ["succeeded", "failed", "cancelled"] },
    },
    take: 500,
  });

  const nowMs = now.getTime();
  for (const job of jobs) {
    const payload = readDsarExportPayload(job);
    const artifactKind = payload.artifact?.kind ?? null;
    const summary: DsarCleanupDryRunJob = {
      jobId: job.id,
      subjectId: job.subjectId,
      status: job.status,
      expiresAt: payload.expiresAt,
      artifactKind,
    };
    if (job.status === "succeeded" && new Date(payload.expiresAt).getTime() <= nowMs) {
      expiredSucceededJobs.push(summary);
      const rec: RetentionDryRunRecord = {
        action: "WOULD_DELETE",
        category: "dsar_artifact",
        record: job.id,
        reason: "technical_ttl_expired_not_legal_retention",
        retentionExpiry: payload.expiresAt,
        legalHold: false,
        financialPreservation: "n/a",
      };
      records.push(rec);
      logDryRunRecord(rec);
      continue;
    }
    if ((job.status === "failed" || job.status === "cancelled") && payload.artifact) {
      failedOrCancelledWithArtifact.push(summary);
      const rec: RetentionDryRunRecord = {
        action: "WOULD_DELETE",
        category: "dsar_artifact",
        record: job.id,
        reason: `terminal_${job.status}_artifact_ref`,
        retentionExpiry: payload.expiresAt,
        legalHold: false,
        financialPreservation: "n/a",
      };
      records.push(rec);
      logDryRunRecord(rec);
    }
  }

  const localOrphans: DsarCleanupDryRunOrphan[] = [];
  let userDirs: string[] = [];
  try {
    userDirs = await readdir(localDsarRootDir());
  } catch {
    userDirs = [];
  }
  for (const userId of userDirs) {
    if (!/^[A-Za-z0-9_-]+$/.test(userId)) continue;
    const dir = path.join(localDsarRootDir(), userId);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const jobId = file.replace(/\.json$/, "");
      if (!/^[A-Za-z0-9_-]+$/.test(jobId)) continue;
      const job = await prisma.dataLifecycleJob.findFirst({
        where: {
          id: jobId,
          type: "dsar_export",
          subjectType: "user",
          subjectId: userId,
        },
      });
      const payload = job ? readDsarExportPayload(job) : null;
      const expired = payload ? new Date(payload.expiresAt).getTime() <= nowMs : true;
      const keep =
        Boolean(job) &&
        job!.status === "succeeded" &&
        !expired &&
        payload?.artifact?.kind === "local_file";
      if (!keep) {
        localOrphans.push({ userId, jobId, file });
        const rec: RetentionDryRunRecord = {
          action: "WOULD_DELETE",
          category: "dsar_local_orphan",
          record: jobId,
          reason: job ? "local_file_not_kept" : "no_matching_dsar_job",
          retentionExpiry: payload?.expiresAt ?? null,
          legalHold: false,
          financialPreservation: "n/a",
        };
        records.push(rec);
        logDryRunRecord(rec);
      }
    }
  }

  return {
    expiredSucceededJobs,
    failedOrCancelledWithArtifact,
    localOrphans,
    wouldDeleteArtifacts:
      expiredSucceededJobs.length + failedOrCancelledWithArtifact.length + localOrphans.length,
    records,
  };
}

/** Delete a single DSAR artifact reference — never KYC. */
export async function deleteDsarArtifactRef(art: ArtifactRef | undefined): Promise<void> {
  if (!art) return;
  if (art.kind === "inline") return;
  if (art.kind === "local_file") {
    const root = path.resolve(localDsarRootDir());
    const abs = path.resolve(art.absolutePath);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      throw new Error("Refusing to delete local path outside DSAR root");
    }
    await unlink(abs).catch(() => undefined);
    return;
  }
  if (art.kind === "private_storage") {
    await removeDsarStorageObject(art.bucket, art.objectPath);
  }
}

/** Deterministic cleanup for a job's known storage key (idempotent retry safety). */
export async function deleteDsarArtifactForJob(userId: string, jobId: string): Promise<void> {
  const localPath = localDsarAbsolutePath(userId, jobId);
  await unlink(localPath).catch(() => undefined);
  if (isSupabaseStorageConfigured()) {
    const key = dsarObjectKey(userId, jobId);
    await removeDsarStorageObject(supabaseDsarStorageBucketName(), key).catch(() => undefined);
  }
}

export async function createDsarExportJob(userId: string): Promise<{
  jobId: string;
  status: string;
  downloadToken: string;
  expiresAt: string;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, accountStatus: true },
  });
  if (!user) throw new DsarExportError("User not found", "NOT_FOUND");
  assertUserMayCreateExport(user.accountStatus);

  const downloadToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + DSAR_ARTIFACT_TTL_MS).toISOString();
  const payload: DsarExportPayload = { downloadToken, expiresAt };

  const job = await prisma.dataLifecycleJob.create({
    data: {
      type: "dsar_export",
      status: "pending",
      subjectType: "user",
      subjectId: userId,
      payload: payload as Prisma.InputJsonValue,
      notBefore: new Date(),
    },
    select: { id: true, status: true },
  });

  await writeAuditLog({
    userId,
    action: "dsar.export_created",
    metadata: JSON.stringify({
      actorId: userId,
      resourceType: "user",
      resourceId: userId,
      jobId: job.id,
    }),
  });

  void processDsarExportJob(job.id).catch((err) => {
    console.error("[dsar] process failed", job.id, err);
  });

  return {
    jobId: job.id,
    status: job.status,
    downloadToken,
    expiresAt,
  };
}

/**
 * Reclaim stale running dsar_export jobs (worker crash / hang).
 * Deletes any known artifact for the job, then returns them to pending for idempotent retry.
 */
export async function reclaimStaleDsarRunningJobs(
  now = new Date(),
  leaseMs = DSAR_RUNNING_LEASE_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - leaseMs);
  const stale = await prisma.dataLifecycleJob.findMany({
    where: {
      type: "dsar_export",
      status: "running",
      updatedAt: { lt: cutoff },
    },
    take: 50,
  });
  let n = 0;
  for (const job of stale) {
    const payload = parsePayload(job);
    await deleteDsarArtifactRef(payload.artifact).catch(() => undefined);
    await deleteDsarArtifactForJob(job.subjectId, job.id).catch(() => undefined);
    const next: DsarExportPayload = {
      downloadToken: payload.downloadToken,
      expiresAt: payload.expiresAt,
    };
    await prisma.dataLifecycleJob.update({
      where: { id: job.id },
      data: {
        status: "pending",
        lastError: "reclaimed_stale_running",
        payload: next as Prisma.InputJsonValue,
      },
    });
    n += 1;
  }
  return n;
}

export async function processDsarExportJob(jobId: string): Promise<void> {
  const job = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "dsar_export") return;
  if (job.status === "succeeded" || job.status === "cancelled") return;

  // Stale running: reclaim this job if lease expired (duplicate workers / crash).
  if (job.status === "running") {
    const age = Date.now() - job.updatedAt.getTime();
    if (age < DSAR_RUNNING_LEASE_MS) return;
    await reclaimStaleDsarRunningJobs();
    return processDsarExportJob(jobId);
  }

  const claimed = await prisma.dataLifecycleJob.updateMany({
    where: { id: jobId, status: { in: ["pending", "failed"] } },
    data: { status: "running", attempts: { increment: 1 }, lastError: null },
  });
  if (claimed.count === 0) {
    // Another worker holds the lease — wait briefly for terminal/pending.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const cur = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
      if (!cur) return;
      if (cur.status === "succeeded" || cur.status === "failed" || cur.status === "cancelled") return;
      if (cur.status === "pending") {
        return processDsarExportJob(jobId);
      }
    }
    return;
  }

  const fresh = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
  if (!fresh || fresh.status !== "running") return;
  const prev = parsePayload(fresh);

  // Clear any prior orphan artifact for this deterministic key before rewrite (idempotent).
  await deleteDsarArtifactForJob(fresh.subjectId, fresh.id).catch(() => undefined);
  await deleteDsarArtifactRef(prev.artifact).catch(() => undefined);

  try {
    const pkg = await buildDsarExportPackage(fresh.subjectId);
    const json = JSON.stringify(pkg);
    const sizeBytes = Buffer.byteLength(json, "utf8");
    const buf = Buffer.from(json, "utf8");

    let artifact: ArtifactRef;
    if (sizeBytes < 256_000) {
      artifact = { kind: "inline", json: pkg as Prisma.JsonValue };
    } else if (isSupabaseStorageConfigured()) {
      const objectPath = dsarObjectKey(fresh.subjectId, fresh.id);
      const uploaded = await uploadBufferToSupabaseDsarObject(objectPath, buf, "application/json");
      artifact = { kind: "private_storage", bucket: uploaded.bucket, objectPath: uploaded.objectPath };
    } else {
      const dir = path.join(localDsarRootDir(), fresh.subjectId);
      await mkdir(dir, { recursive: true });
      const absolutePath = localDsarAbsolutePath(fresh.subjectId, fresh.id);
      await writeFile(absolutePath, buf);
      artifact = { kind: "local_file", absolutePath };
    }

    const next: DsarExportPayload = {
      ...prev,
      artifact,
      sizeBytes,
    };

    const marked = await prisma.dataLifecycleJob.updateMany({
      where: { id: jobId, status: "running" },
      data: {
        status: "succeeded",
        payload: next as Prisma.InputJsonValue,
        completedAt: new Date(),
        lastError: null,
      },
    });
    if (marked.count === 0) {
      // Job deleted mid-flight — drop artifact we just wrote.
      await deleteDsarArtifactRef(artifact).catch(() => undefined);
      await deleteDsarArtifactForJob(fresh.subjectId, fresh.id).catch(() => undefined);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort: remove any object written before DB failure.
    await deleteDsarArtifactForJob(fresh.subjectId, fresh.id).catch(() => undefined);
    await prisma.dataLifecycleJob
      .updateMany({
        where: { id: jobId, status: "running" },
        data: {
          status: "failed",
          lastError: message.slice(0, 2000),
          payload: {
            downloadToken: prev.downloadToken,
            expiresAt: prev.expiresAt,
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }
}

export async function getDsarExportJobForUser(userId: string, jobId: string) {
  const job = await prisma.dataLifecycleJob.findFirst({
    where: { id: jobId, type: "dsar_export", subjectType: "user", subjectId: userId },
  });
  if (!job) throw new DsarExportError("Export job not found", "NOT_FOUND");
  const payload = parsePayload(job);
  const expired = new Date(payload.expiresAt).getTime() <= Date.now();
  return {
    jobId: job.id,
    status: expired && job.status === "succeeded" ? "expired" : job.status,
    expiresAt: payload.expiresAt,
    completedAt: job.completedAt?.toISOString() ?? null,
    lastError: job.lastError,
  };
}

async function loadArtifactJson(payload: DsarExportPayload): Promise<unknown> {
  const art = payload.artifact;
  if (!art) throw new DsarExportError("Export is not ready yet", "NOT_READY");
  if (art.kind === "inline") return art.json;
  if (art.kind === "local_file") {
    try {
      const raw = await readFile(art.absolutePath, "utf8");
      return JSON.parse(raw);
    } catch {
      throw new DsarExportError("Export artifact is missing", "ARTIFACT_MISSING");
    }
  }
  throw new DsarExportError("Use download URL for private storage artifacts", "NOT_READY");
}

export async function downloadDsarExportForUser(opts: {
  userId: string;
  jobId: string;
  downloadToken?: string | null;
}): Promise<
  | { mode: "json"; body: unknown; expiresAt: string }
  | { mode: "redirect"; url: string; expiresAt: string }
> {
  const job = await prisma.dataLifecycleJob.findFirst({
    where: {
      id: opts.jobId,
      type: "dsar_export",
      subjectType: "user",
      subjectId: opts.userId,
    },
  });
  if (!job) throw new DsarExportError("Export job not found", "NOT_FOUND");

  const payload = parsePayload(job);
  if (opts.downloadToken && opts.downloadToken !== payload.downloadToken) {
    throw new DsarExportError("Invalid download token", "FORBIDDEN");
  }

  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    await expireDsarExportArtifact(job.id).catch(() => undefined);
    throw new DsarExportError("Export artifact has expired", "EXPIRED");
  }

  if (job.status !== "succeeded" || !payload.artifact) {
    throw new DsarExportError("Export is not ready yet", "NOT_READY");
  }

  if (payload.artifact.kind === "private_storage") {
    const url = await createSignedUrlForDsarObject(
      payload.artifact.bucket,
      payload.artifact.objectPath,
      opts.userId,
      SIGNED_URL_TTL_SEC,
    );
    return { mode: "redirect", url, expiresAt: payload.expiresAt };
  }

  const body = await loadArtifactJson(payload);
  return { mode: "json", body, expiresAt: payload.expiresAt };
}

export async function expireDsarExportArtifact(jobId: string): Promise<void> {
  const job = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "dsar_export") return;
  const payload = parsePayload(job);
  await deleteDsarArtifactRef(payload.artifact).catch(() => undefined);
  await deleteDsarArtifactForJob(job.subjectId, job.id).catch(() => undefined);
  await prisma.dataLifecycleJob.update({
    where: { id: jobId },
    data: {
      status: "cancelled",
      payload: {
        downloadToken: payload.downloadToken,
        expiresAt: payload.expiresAt,
      } as Prisma.InputJsonValue,
      completedAt: job.completedAt ?? new Date(),
      lastError: job.lastError === "expired" ? job.lastError : "expired",
    },
  });
}

/**
 * Clean local orphan files under storage/private/dsar that do not belong to an
 * active/succeeded (non-expired) job. Never touches KYC paths.
 */
export async function cleanupOrphanLocalDsarArtifacts(): Promise<number> {
  const root = localDsarRootDir();
  let removed = 0;
  let userDirs: string[] = [];
  try {
    userDirs = await readdir(root);
  } catch {
    return 0;
  }

  for (const userId of userDirs) {
    if (!/^[A-Za-z0-9_-]+$/.test(userId)) continue;
    const dir = path.join(root, userId);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const jobId = file.replace(/\.json$/, "");
      if (!/^[A-Za-z0-9_-]+$/.test(jobId)) continue;
      const job = await prisma.dataLifecycleJob.findFirst({
        where: {
          id: jobId,
          type: "dsar_export",
          subjectType: "user",
          subjectId: userId,
        },
      });
      const abs = path.join(dir, file);
      if (!job) {
        await unlink(abs).catch(() => undefined);
        removed += 1;
        continue;
      }
      const payload = parsePayload(job);
      const expired = new Date(payload.expiresAt).getTime() <= Date.now();
      const keep =
        job.status === "succeeded" &&
        !expired &&
        payload.artifact?.kind === "local_file";
      if (!keep) {
        await unlink(abs).catch(() => undefined);
        removed += 1;
      }
    }
  }
  return removed;
}

/** Expire succeeded jobs past TTL; cleanup failed/cancelled artifact refs; reclaim; orphans. */
export async function tickDsarExportJobs(limit = 10): Promise<{
  processed: number;
  expired: number;
  reclaimed: number;
  orphansRemoved: number;
}> {
  const reclaimed = await reclaimStaleDsarRunningJobs();

  const pending = await prisma.dataLifecycleJob.findMany({
    where: {
      type: "dsar_export",
      status: "pending",
      notBefore: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const row of pending) {
    await processDsarExportJob(row.id);
  }

  const terminal = await prisma.dataLifecycleJob.findMany({
    where: {
      type: "dsar_export",
      status: { in: ["succeeded", "failed", "cancelled"] },
    },
    take: 100,
  });
  let expired = 0;
  const now = Date.now();
  for (const job of terminal) {
    const payload = parsePayload(job);
    if (job.status === "succeeded" && new Date(payload.expiresAt).getTime() <= now) {
      await expireDsarExportArtifact(job.id);
      expired += 1;
      continue;
    }
    if (
      (job.status === "failed" || job.status === "cancelled") &&
      payload.artifact
    ) {
      await deleteDsarArtifactRef(payload.artifact).catch(() => undefined);
      await deleteDsarArtifactForJob(job.subjectId, job.id).catch(() => undefined);
      await prisma.dataLifecycleJob.update({
        where: { id: job.id },
        data: {
          payload: {
            downloadToken: payload.downloadToken,
            expiresAt: payload.expiresAt,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  const orphansRemoved = await cleanupOrphanLocalDsarArtifacts();

  return { processed: pending.length, expired, reclaimed, orphansRemoved };
}

/** Test helpers — storage isolation boundaries. */
export function dsarCleanupWouldTouchKyc(bucket: string, objectPath: string): boolean {
  try {
    if (bucket === supabaseKycStorageBucketName()) return true;
    if (!isAllowedDsarObjectPath(objectPath)) return true;
    if (bucket !== supabaseDsarStorageBucketName()) return true;
    return false;
  } catch {
    return true;
  }
}

export function kycCleanupWouldTouchDsar(bucket: string, objectPath: string): boolean {
  if (bucket === supabaseDsarStorageBucketName()) return true;
  const key = objectPath.replace(/^\/+/, "");
  if (key.startsWith("exports/") || key.startsWith("dsar/")) return true;
  return false;
}

/** Expose KYC delete guard for tests without performing deletes. */
export async function assertKycCleanupRejectsDsar(
  bucket: string,
  objectPath: string,
): Promise<boolean> {
  try {
    await removeKycStorageObject(bucket, objectPath);
    return false;
  } catch {
    return true;
  }
}

export async function assertDsarCleanupRejectsKyc(
  bucket: string,
  objectPath: string,
): Promise<boolean> {
  try {
    await removeDsarStorageObject(bucket, objectPath);
    return false;
  } catch {
    return true;
  }
}

export function exportPackageContainsSecrets(pkg: unknown): boolean {
  const s = JSON.stringify(pkg);
  const needles = [
    "passwordHash",
    "password_hash",
    "twoFactorSecret",
    "two_factor_secret",
    "twoFactorTempSecret",
    "refreshToken",
    "tokenHash",
  ];
  return needles.some((n) => s.includes(n));
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
