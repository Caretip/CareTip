/**
 * GDPR lifecycle Slice F-A — non-destructive anonymization engine.
 *
 * Transforms eligible User/Employee records to anonymized/closed lifecycle states
 * while preserving financial and business evidence (tips, refunds, Business rows).
 *
 * Amendment A5: retained emailHash is PSEUDONYMIZED residual personal data — not anonymous.
 * Amendment A2: legalHold blocks only listed categories; auth satellite termination always allowed.
 *
 * Production execution is gated (DATA_LIFECYCLE_V1 + DATA_LIFECYCLE_ANONYMIZATION_EXECUTE).
 * Does NOT destroy KYC, payments, support bodies, audit trails, or invent T_* retention.
 */

import { createHmac } from "node:crypto";
import type { AccountStatus, DataLifecycleJob, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { removeUploadedObjectByPublicUrlIfPossible } from "../lib/supabaseStorageClient.js";
import { userMayAuthenticate } from "./accountAccess.service.js";
import { deriveErasureLifecycleState, resolveAnonymizeEligibleAt } from "./lifecycleStatus.helpers.js";
import { logDryRunRecord, type RetentionDryRunAction, type RetentionDryRunRecord } from "./retentionDryRun.js";

/** Amendment A5 — emailHash remains personal data under CareTip-controlled linkage. */
export const EMAIL_HASH_CLASSIFICATION = "PSEUDONYMIZED" as const;

export const FORMER_TEAM_MEMBER_NAME = "Former team member";

const ANONYMIZE_RUNNING_LEASE_MS = 15 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 8;

/** Categories that block profile / staff scrub when listed on legalHoldCategories. */
export const LEGAL_HOLD_PROFILE_CATEGORY = "profile";
export const LEGAL_HOLD_STAFF_PROFILE_CATEGORY = "staff-profile";

export type AnonymizationErrorCode =
  | "NOT_FOUND"
  | "PRECONDITION"
  | "ACTIVE_BUSINESS_OWNER"
  | "LEGAL_HOLD_CATEGORY"
  | "EXECUTION_GATED"
  | "AUDIT_FAILED"
  | "STORAGE_PENDING"
  | "FORBIDDEN"
  | "CONFLICT";

export class AnonymizationError extends Error {
  constructor(
    message: string,
    readonly code: AnonymizationErrorCode,
  ) {
    super(message);
    this.name = "AnonymizationError";
  }
}

export type AnonymizeUserOptions = {
  /** Platform lifecycle operation — may anonymize without erasure_pending. */
  platformAuthorized?: boolean;
  actorId?: string | null;
  /**
   * When true, skip DATA_LIFECYCLE_* execution gates (isolated tests only).
   * Production workers must leave this unset/false.
   */
  bypassExecutionGate?: boolean;
  /** Injectable avatar/object delete (defaults to scoped public-URL helper). */
  deleteStorageObject?: (publicUrl: string) => Promise<void>;
};

export type AnonymizeUserResult = {
  userId: string;
  accountStatus: AccountStatus;
  anonymizedAt: Date | null;
  closedAt: Date | null;
  emailHashClassification: typeof EMAIL_HASH_CLASSIFICATION | null;
  authSatellitesRemoved: boolean;
  profileScrubbed: boolean;
  employeeAnonymized: boolean | null;
  alreadyComplete: boolean;
  pendingStorageDeletes: string[];
};

export type AnonymizeEmployeeOptions = {
  actorId?: string | null;
  bypassExecutionGate?: boolean;
  deleteStorageObject?: (publicUrl: string) => Promise<void>;
  /** When true, skip legal-hold staff-profile check (caller already decided). */
  ignoreLegalHold?: boolean;
};

export type AnonymizeEmployeeResult = {
  employeeId: string;
  userIdDetached: boolean;
  alreadyComplete: boolean;
  pendingStorageDeletes: string[];
  tipCount: number;
};

type Tx = Prisma.TransactionClient;

function envFlagTrue(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Production worker gate — default OFF until both flags reviewed. */
export function isAnonymizationExecutionEnabled(): boolean {
  return envFlagTrue("DATA_LIFECYCLE_V1") && envFlagTrue("DATA_LIFECYCLE_ANONYMIZATION_EXECUTE");
}

export function assertAnonymizationExecutionAllowed(opts?: { bypassExecutionGate?: boolean }): void {
  if (opts?.bypassExecutionGate) return;
  if (!isAnonymizationExecutionEnabled()) {
    throw new AnonymizationError(
      "Anonymization execution is disabled (DATA_LIFECYCLE_V1 / DATA_LIFECYCLE_ANONYMIZATION_EXECUTE)",
      "EXECUTION_GATED",
    );
  }
}

export function tombstoneEmailForUserId(userId: string): string {
  return `deleted+${userId}@tombstone.caretip.invalid`;
}

/**
 * HMAC-SHA256 of normalized email using DATA_LIFECYCLE_EMAIL_PEPPER.
 * Result is PSEUDONYMIZED residual (Amendment A5) — still personal data.
 */
export function computeEmailHash(normalizedEmail: string): string {
  const pepper = process.env.DATA_LIFECYCLE_EMAIL_PEPPER?.trim();
  if (!pepper) {
    throw new AnonymizationError(
      "DATA_LIFECYCLE_EMAIL_PEPPER is required to retain a pseudonymized emailHash",
      "PRECONDITION",
    );
  }
  return createHmac("sha256", pepper).update(normalizedEmail, "utf8").digest("hex");
}

export function normalizeEmailForHash(email: string): string {
  return email.trim().toLowerCase();
}

function holdCategories(user: { legalHold: boolean; legalHoldCategories: string[] }): Set<string> {
  if (!user.legalHold) return new Set();
  return new Set((user.legalHoldCategories ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean));
}

function categoryHeld(held: Set<string>, category: string): boolean {
  return held.has(category.toLowerCase());
}

async function deleteAuthSatellites(tx: Tx, userId: string): Promise<void> {
  await tx.oAuthAccount.deleteMany({ where: { userId } });
  await tx.refreshToken.deleteMany({ where: { userId } });
  await tx.passwordResetToken.deleteMany({ where: { userId } });
  await tx.emailVerificationToken.deleteMany({ where: { userId } });
  await tx.mobileWebHandoffToken.deleteMany({ where: { userId } });
  await tx.pushDeviceToken.deleteMany({ where: { userId } });
  await tx.userSettings.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
}

async function writeDurableLifecycleAudit(
  tx: Tx,
  input: {
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId: string;
    businessId?: string | null;
    result: string;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // Fail-closed: invalid actorId FK aborts the surrounding transaction (Slice E pattern).
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        metadata: JSON.stringify({
          actorId: input.actorId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          businessId: input.businessId ?? null,
          action: input.action,
          timestamp: new Date().toISOString(),
          result: input.result,
          ...(input.extra ?? {}),
        }),
      },
    });
  } catch (err) {
    if (err instanceof AnonymizationError) throw err;
    throw new AnonymizationError(
      `Lifecycle audit failed: ${err instanceof Error ? err.message : "unknown"}`,
      "AUDIT_FAILED",
    );
  }
}

async function assertNoActiveBusinessOwnership(
  db: Tx | typeof prisma,
  userId: string,
): Promise<void> {
  const owned = await db.business.findFirst({
    where: {
      userId,
      deletedAt: null,
      lifecycleStatus: "active",
    },
    select: { id: true, lifecycleStatus: true },
  });
  if (owned) {
    throw new AnonymizationError(
      "Cannot anonymize user who still owns an active Business — transfer ownership or soft-close first",
      "ACTIVE_BUSINESS_OWNER",
    );
  }
}

async function scrubEmployeeActivitySummaries(db: Tx | typeof prisma, employeeId: string): Promise<void> {
  const events = await db.businessActivityEvent.findMany({
    where: { actorEmployeeId: employeeId },
    select: { id: true, summary: true },
    take: 5000,
  });
  for (const ev of events) {
    if (ev.summary && typeof ev.summary === "object" && !Array.isArray(ev.summary)) {
      const summary = { ...(ev.summary as Record<string, unknown>) };
      if ("employeeName" in summary && summary.employeeName !== FORMER_TEAM_MEMBER_NAME) {
        summary.employeeName = FORMER_TEAM_MEMBER_NAME;
        await db.businessActivityEvent.update({
          where: { id: ev.id },
          data: { summary: summary as Prisma.InputJsonValue },
        });
      }
    }
  }
}

const ANON_TX_OPTS = { maxWait: 20_000, timeout: 60_000 } as const;

async function defaultDeleteStorageObject(publicUrl: string): Promise<void> {
  await removeUploadedObjectByPublicUrlIfPossible(publicUrl);
}

/**
 * Scrub employee to a non-identifying historical stub. Never deletes tip/Transaction rows.
 * Transaction.employeeId may remain pointing at this stub (preferred) or already be null.
 */
export async function anonymizeEmployee(
  employeeId: string,
  opts?: AnonymizeEmployeeOptions,
): Promise<AnonymizeEmployeeResult> {
  assertAnonymizationExecutionAllowed(opts);
  const id = String(employeeId ?? "").trim();
  if (!id) throw new AnonymizationError("employeeId required", "NOT_FOUND");

  const deleteStorage = opts?.deleteStorageObject ?? defaultDeleteStorageObject;
  const pendingStorageDeletes: string[] = [];

  const tipCount = await prisma.transaction.count({ where: { employeeId: id } });

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      name: true,
      phone: true,
      bio: true,
      avatar: true,
      slug: true,
      anonymizedAt: true,
      businessId: true,
      user: {
        select: {
          id: true,
          legalHold: true,
          legalHoldCategories: true,
        },
      },
    },
  });
  if (!employee) throw new AnonymizationError("Employee not found", "NOT_FOUND");

  if (!opts?.ignoreLegalHold && employee.user) {
    const held = holdCategories(employee.user);
    if (categoryHeld(held, LEGAL_HOLD_STAFF_PROFILE_CATEGORY) || categoryHeld(held, "employee")) {
      throw new AnonymizationError(
        "Legal hold preserves staff-profile category — employee anonymization blocked",
        "LEGAL_HOLD_CATEGORY",
      );
    }
  }

  if (employee.anonymizedAt && !employee.userId && !employee.avatar) {
    return {
      employeeId: id,
      userIdDetached: true,
      alreadyComplete: true,
      pendingStorageDeletes: [],
      tipCount,
    };
  }

  if (employee.avatar?.trim()) {
    pendingStorageDeletes.push(employee.avatar.trim());
  }

  const now = new Date();
  const actorId = opts?.actorId ?? employee.userId ?? null;

  await prisma.$transaction(async (tx) => {
    const row = await tx.employee.findUnique({
      where: { id },
      select: { id: true, anonymizedAt: true, businessId: true, userId: true },
    });
    if (!row) throw new AnonymizationError("Employee not found", "NOT_FOUND");
    if (row.anonymizedAt && !row.userId) {
      return;
    }

    await writeDurableLifecycleAudit(tx, {
      actorId,
      action: "employee.erasure_anonymization_started",
      resourceType: "employee",
      resourceId: id,
      businessId: row.businessId,
      result: "started",
    });

    await tx.employeeTableAssignment.deleteMany({ where: { employeeId: id } });
    await tx.employeeGoal.deleteMany({ where: { employeeId: id } });
    await tx.employeeActivationToken.deleteMany({ where: { employeeId: id } });

    await tx.tipFeedback.updateMany({
      where: { employeeId: id },
      data: { customerName: null, comment: null },
    });

    await tx.employeeInviteRedemption.updateMany({
      where: { employeeId: id },
      data: {
        inviteeEmail: `redacted+${id}@tombstone.caretip.invalid`,
        inviteeName: FORMER_TEAM_MEMBER_NAME,
      },
    });

    await tx.employee.update({
      where: { id },
      data: {
        name: FORMER_TEAM_MEMBER_NAME,
        phone: null,
        bio: null,
        avatar: null,
        slug: null,
        emailNotifications: false,
        pushNotifications: false,
        isDeleted: true,
        isActive: false,
        deletedAt: row.anonymizedAt ? undefined : now,
        anonymizedAt: now,
        userId: null,
        activationStatus: "pending_activation",
      },
    });

    // Tips must survive — never delete Transaction / TipRefund.
    // Keep employeeId → non-identifying stub (this row).

    await writeDurableLifecycleAudit(tx, {
      actorId,
      action: "employee.anonymized",
      resourceType: "employee",
      resourceId: id,
      businessId: row.businessId,
      result: "succeeded",
      extra: { tipCountPreserved: tipCount },
    });
  }, ANON_TX_OPTS);

  await scrubEmployeeActivitySummaries(prisma, id);

  const stillPending: string[] = [];
  for (const url of pendingStorageDeletes) {
    try {
      await deleteStorage(url);
    } catch {
      stillPending.push(url);
    }
  }

  if (stillPending.length > 0) {
    throw new AnonymizationError(
      `Employee profile storage delete pending (${stillPending.length} object(s))`,
      "STORAGE_PENDING",
    );
  }

  return {
    employeeId: id,
    userIdDetached: true,
    alreadyComplete: false,
    pendingStorageDeletes: stillPending,
    tipCount,
  };
}

export type EvaluateAnonymizeUserResult = {
  userId: string;
  action: RetentionDryRunAction;
  reason: string;
  state: ReturnType<typeof deriveErasureLifecycleState>;
  deletionCancelUntil: string | null;
  anonymizeEligibleAt: string | null;
  legalHold: boolean;
  financialPreservation: "preserved";
};

function dryRunRecordFromAnonymizeEval(row: EvaluateAnonymizeUserResult): RetentionDryRunRecord {
  return {
    action: row.action,
    category: "user_anonymize",
    record: row.userId,
    reason: row.reason,
    retentionExpiry: row.anonymizeEligibleAt,
    legalHold: row.legalHold,
    financialPreservation: row.financialPreservation,
  };
}

/**
 * Read-only anonymizeUser gates. Never mutates (no session terminate, no profile scrub).
 * The mutate path still terminates auth satellites when a profile legal hold blocks scrub;
 * evaluation must not copy that side effect.
 */
export async function evaluateAnonymizeUser(
  userId: string,
  opts?: { now?: Date; platformAuthorized?: boolean },
): Promise<EvaluateAnonymizeUserResult> {
  const id = String(userId ?? "").trim();
  const now = opts?.now ?? new Date();
  const platformOk = opts?.platformAuthorized === true;

  const existing = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      accountStatus: true,
      anonymizedAt: true,
      legalHold: true,
      legalHoldCategories: true,
      deletionRequestedAt: true,
      deletionCancelUntil: true,
      anonymizeEligibleAt: true,
    },
  });

  const base = (partial: Pick<EvaluateAnonymizeUserResult, "action" | "reason" | "legalHold"> & {
    state?: EvaluateAnonymizeUserResult["state"];
    deletionCancelUntil?: Date | null;
    anonymizeEligibleAt?: Date | null;
  }): EvaluateAnonymizeUserResult => ({
    userId: id || "(missing)",
    action: partial.action,
    reason: partial.reason,
    state:
      partial.state ??
      (existing
        ? deriveErasureLifecycleState(existing, now)
        : "DEACTIVATED"),
    deletionCancelUntil:
      partial.deletionCancelUntil !== undefined
        ? partial.deletionCancelUntil?.toISOString() ?? null
        : existing?.deletionCancelUntil?.toISOString() ?? null,
    anonymizeEligibleAt:
      partial.anonymizeEligibleAt !== undefined
        ? partial.anonymizeEligibleAt?.toISOString() ?? null
        : existing?.anonymizeEligibleAt?.toISOString() ?? null,
    legalHold: partial.legalHold,
    financialPreservation: "preserved",
  });

  if (!id || !existing) {
    return base({ action: "WOULD_SKIP_NOT_ELIGIBLE", reason: "NOT_FOUND", legalHold: false, state: "DEACTIVATED" });
  }

  if (existing.accountStatus === "anonymized" || existing.accountStatus === "closed" || existing.anonymizedAt) {
    return base({ action: "WOULD_SKIP_ALREADY_DONE", reason: "already_anonymized_or_closed", legalHold: existing.legalHold });
  }

  if (existing.accountStatus !== "erasure_pending" && !platformOk) {
    return base({
      action: "WOULD_SKIP_NOT_ELIGIBLE",
      reason: "PRECONDITION_not_erasure_pending",
      legalHold: existing.legalHold,
    });
  }

  const held = holdCategories(existing);
  if (categoryHeld(held, LEGAL_HOLD_PROFILE_CATEGORY)) {
    return base({
      action: "WOULD_SKIP_LEGAL_HOLD",
      reason: "LEGAL_HOLD_CATEGORY_profile",
      legalHold: true,
    });
  }

  if (!platformOk) {
    const eligibleAt = resolveAnonymizeEligibleAt(existing);
    if (!eligibleAt || now.getTime() < eligibleAt.getTime()) {
      return base({
        action: "WOULD_SKIP_NOT_ELIGIBLE",
        reason: "ACCOUNT_ERASURE_30_DAY_NOT_ELAPSED",
        legalHold: existing.legalHold,
        anonymizeEligibleAt: eligibleAt,
      });
    }
  }

  const owned = await prisma.business.findFirst({
    where: { userId: id, deletedAt: null, lifecycleStatus: "active" },
    select: { id: true },
  });
  if (owned) {
    return base({
      action: "WOULD_SKIP_NOT_ELIGIBLE",
      reason: "ACTIVE_BUSINESS_OWNER",
      legalHold: existing.legalHold,
    });
  }

  return base({
    action: "WOULD_ANONYMIZE",
    reason: "erasure_30_day_elapsed_financial_preserved",
    legalHold: existing.legalHold,
  });
}

/** Scan erasure_pending users with evaluateAnonymizeUser. Never calls anonymizeUser. */
export async function evaluateErasurePendingAnonymizeDryRun(opts?: {
  now?: Date;
}): Promise<{ results: EvaluateAnonymizeUserResult[]; records: RetentionDryRunRecord[] }> {
  const pending = await prisma.user.findMany({
    where: { accountStatus: "erasure_pending" },
    select: { id: true },
    take: 500,
  });
  const results: EvaluateAnonymizeUserResult[] = [];
  const records: RetentionDryRunRecord[] = [];
  for (const u of pending) {
    const row = await evaluateAnonymizeUser(u.id, opts);
    results.push(row);
    const rec = dryRunRecordFromAnonymizeEval(row);
    records.push(rec);
    logDryRunRecord(rec);
  }
  return { results, records };
}

/**
 * Anonymize an eligible user: auth satellites removed, profile tombstoned,
 * linked employee scrubbed, financial rows preserved. Never prisma.user.delete.
 */
export async function anonymizeUser(
  userId: string,
  opts?: AnonymizeUserOptions,
): Promise<AnonymizeUserResult> {
  assertAnonymizationExecutionAllowed(opts);
  const id = String(userId ?? "").trim();
  if (!id) throw new AnonymizationError("userId required", "NOT_FOUND");

  const deleteStorage = opts?.deleteStorageObject ?? defaultDeleteStorageObject;
  const actorId = opts?.actorId ?? id;

  const existing = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      accountStatus: true,
      anonymizedAt: true,
      closedAt: true,
      emailHash: true,
      legalHold: true,
      legalHoldCategories: true,
      deletionRequestedAt: true,
      deletionCancelUntil: true,
      anonymizeEligibleAt: true,
      employee: { select: { id: true, anonymizedAt: true, avatar: true } },
    },
  });
  if (!existing) throw new AnonymizationError("User not found", "NOT_FOUND");

  if (existing.accountStatus === "anonymized" || existing.accountStatus === "closed") {
    return {
      userId: id,
      accountStatus: existing.accountStatus,
      anonymizedAt: existing.anonymizedAt,
      closedAt: existing.closedAt,
      emailHashClassification: existing.emailHash ? EMAIL_HASH_CLASSIFICATION : null,
      authSatellitesRemoved: true,
      profileScrubbed: true,
      employeeAnonymized: existing.employee ? true : null,
      alreadyComplete: true,
      pendingStorageDeletes: [],
    };
  }

  const platformOk = opts?.platformAuthorized === true;
  if (existing.accountStatus !== "erasure_pending" && !platformOk) {
    throw new AnonymizationError(
      "User must be erasure_pending (or platform-authorized) before anonymization",
      "PRECONDITION",
    );
  }

  const held = holdCategories(existing);
  const profileHeld = categoryHeld(held, LEGAL_HOLD_PROFILE_CATEGORY);
  if (profileHeld) {
    // Auth termination still runs; profile scrub blocked.
    await prisma.$transaction(async (tx) => {
      await deleteAuthSatellites(tx, id);
      await tx.user.update({
        where: { id },
        data: {
          authTokenVersion: { increment: 1 },
          passwordHash: null,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorTempSecret: null,
          oauthProvider: null,
          oauthSubject: null,
          isActive: false,
        },
      });
      await writeDurableLifecycleAudit(tx, {
        actorId,
        action: "user.erasure_anonymization_started",
        resourceType: "user",
        resourceId: id,
        result: "blocked_legal_hold_profile",
        extra: { legalHoldCategories: [...held] },
      });
    }, ANON_TX_OPTS);
    throw new AnonymizationError(
      "Legal hold preserves profile category — profile anonymization blocked",
      "LEGAL_HOLD_CATEGORY",
    );
  }

  if (!platformOk) {
    const eligibleAt = resolveAnonymizeEligibleAt(existing);
    if (!eligibleAt || Date.now() < eligibleAt.getTime()) {
      throw new AnonymizationError(
        "Account-erasure 30-day eligibility period has not elapsed",
        "PRECONDITION",
      );
    }
  }

  // Fail fast outside the interactive transaction (pooler-friendly).
  await assertNoActiveBusinessOwnership(prisma, id);

  const pendingStorageDeletes: string[] = [];
  if (existing.employee?.avatar?.trim()) {
    pendingStorageDeletes.push(existing.employee.avatar.trim());
  }

  const now = new Date();
  let emailHashClassification: typeof EMAIL_HASH_CLASSIFICATION | null = null;
  let employeeAnonymized: boolean | null = existing.employee ? false : null;
  let scrubEmployeeId: string | null = existing.employee?.id ?? null;

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        accountStatus: true,
        legalHold: true,
        legalHoldCategories: true,
        employee: { select: { id: true } },
      },
    });
    if (!fresh) throw new AnonymizationError("User not found", "NOT_FOUND");

    if (fresh.accountStatus === "anonymized" || fresh.accountStatus === "closed") {
      emailHashClassification = EMAIL_HASH_CLASSIFICATION;
      employeeAnonymized = fresh.employee ? true : null;
      scrubEmployeeId = fresh.employee?.id ?? null;
      return;
    }

    const freshPlatformOk = opts?.platformAuthorized === true;
    if (fresh.accountStatus !== "erasure_pending" && !freshPlatformOk) {
      throw new AnonymizationError(
        "User must be erasure_pending (or platform-authorized) before anonymization",
        "PRECONDITION",
      );
    }

    const freshHeld = holdCategories(fresh);
    if (categoryHeld(freshHeld, LEGAL_HOLD_PROFILE_CATEGORY)) {
      throw new AnonymizationError(
        "Legal hold preserves profile category — profile anonymization blocked",
        "LEGAL_HOLD_CATEGORY",
      );
    }

    await assertNoActiveBusinessOwnership(tx, id);

    // Detach historical authors before writing lifecycle audits (A3).
    await tx.auditLog.updateMany({
      where: { userId: id },
      data: { userId: null },
    });
    await tx.announcement.updateMany({
      where: { createdById: id },
      data: { createdById: null },
    });
    await tx.supportTicket.updateMany({
      where: { createdByUserId: id },
      data: { createdByUserId: null },
    });
    await tx.supportTicketMessage.updateMany({
      where: { authorUserId: id },
      data: { authorUserId: null },
    });

    await writeDurableLifecycleAudit(tx, {
      actorId,
      action: "user.erasure_anonymization_started",
      resourceType: "user",
      resourceId: id,
      result: "started",
    });

    await deleteAuthSatellites(tx, id);

    const normalized = normalizeEmailForHash(fresh.email);
    const emailHash = computeEmailHash(normalized);
    emailHashClassification = EMAIL_HASH_CLASSIFICATION;

    await tx.user.update({
      where: { id },
      data: {
        email: tombstoneEmailForUserId(id),
        emailHash,
        passwordHash: null,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorTempSecret: null,
        oauthProvider: null,
        oauthSubject: null,
        emailVerified: false,
        preferredLocale: null,
        accountStatus: "anonymized",
        isActive: false,
        anonymizedAt: now,
        authTokenVersion: { increment: 1 },
      },
    });

    if (fresh.employee) {
      const empId = fresh.employee.id;
      scrubEmployeeId = empId;
      const tipCount = await tx.transaction.count({ where: { employeeId: empId } });

      if (
        categoryHeld(freshHeld, LEGAL_HOLD_STAFF_PROFILE_CATEGORY) ||
        categoryHeld(freshHeld, "employee")
      ) {
        throw new AnonymizationError(
          "Legal hold preserves staff-profile category — employee anonymization blocked",
          "LEGAL_HOLD_CATEGORY",
        );
      }

      await tx.employeeTableAssignment.deleteMany({ where: { employeeId: empId } });
      await tx.employeeGoal.deleteMany({ where: { employeeId: empId } });
      await tx.employeeActivationToken.deleteMany({ where: { employeeId: empId } });
      await tx.tipFeedback.updateMany({
        where: { employeeId: empId },
        data: { customerName: null, comment: null },
      });
      await tx.employeeInviteRedemption.updateMany({
        where: { employeeId: empId },
        data: {
          inviteeEmail: `redacted+${empId}@tombstone.caretip.invalid`,
          inviteeName: FORMER_TEAM_MEMBER_NAME,
        },
      });

      await tx.employee.update({
        where: { id: empId },
        data: {
          name: FORMER_TEAM_MEMBER_NAME,
          phone: null,
          bio: null,
          avatar: null,
          slug: null,
          emailNotifications: false,
          pushNotifications: false,
          isDeleted: true,
          isActive: false,
          deletedAt: now,
          anonymizedAt: now,
          userId: null,
          activationStatus: "pending_activation",
        },
      });

      await writeDurableLifecycleAudit(tx, {
        actorId,
        action: "employee.anonymized",
        resourceType: "employee",
        resourceId: empId,
        result: "succeeded",
        extra: { tipCountPreserved: tipCount },
      });
      employeeAnonymized = true;
    }

    // Email released via tombstone → closed (Phase 2 §10.1 step 11).
    await tx.user.update({
      where: { id },
      data: {
        accountStatus: "closed",
        closedAt: now,
      },
    });

    await writeDurableLifecycleAudit(tx, {
      actorId,
      action: "user.anonymized",
      resourceType: "user",
      resourceId: id,
      result: "succeeded",
      extra: {
        emailHashClassification: EMAIL_HASH_CLASSIFICATION,
        finalStatus: "closed",
      },
    });
  }, ANON_TX_OPTS);

  if (scrubEmployeeId) {
    await scrubEmployeeActivitySummaries(prisma, scrubEmployeeId);
  }

  const stillPending: string[] = [];
  for (const url of pendingStorageDeletes) {
    try {
      await deleteStorage(url);
    } catch {
      stillPending.push(url);
    }
  }
  if (stillPending.length > 0) {
    throw new AnonymizationError(
      `Profile storage delete pending (${stillPending.length} object(s))`,
      "STORAGE_PENDING",
    );
  }

  const after = await prisma.user.findUnique({
    where: { id },
    select: {
      accountStatus: true,
      anonymizedAt: true,
      closedAt: true,
      emailHash: true,
    },
  });

  return {
    userId: id,
    accountStatus: after?.accountStatus ?? "closed",
    anonymizedAt: after?.anonymizedAt ?? now,
    closedAt: after?.closedAt ?? now,
    emailHashClassification: after?.emailHash ? EMAIL_HASH_CLASSIFICATION : emailHashClassification,
    authSatellitesRemoved: true,
    profileScrubbed: true,
    employeeAnonymized,
    alreadyComplete: false,
    pendingStorageDeletes: stillPending,
  };
}

/** Auth gate helper for tests / callers. */
export function anonymizedUserMayAuthenticate(user: {
  isActive: boolean;
  accountStatus?: AccountStatus | null;
}): boolean {
  return userMayAuthenticate(user);
}

// ── Job orchestration (anonymize_user / anonymize_employee only) ───────────

type AnonymizeJobPayload = {
  /** Ignored when mismatched — subjectId on the job is authoritative (tenant-safe). */
  userId?: string;
  employeeId?: string;
  platformAuthorized?: boolean;
  pendingStorageDeletes?: string[];
};

function parseAnonymizePayload(job: DataLifecycleJob): AnonymizeJobPayload {
  if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) return {};
  return job.payload as AnonymizeJobPayload;
}

export async function enqueueAnonymizeUserJob(
  userId: string,
  opts?: {
    platformAuthorized?: boolean;
    notBefore?: Date;
    /**
     * When true, allow creating a pending anonymize_user job even if execute gates are OFF.
     * The job still will not run until process/tick with gates enabled (or bypass in tests).
     * Used by erasure_continue orchestration (G-R1).
     */
    allowEnqueueWhenGated?: boolean;
  },
): Promise<{ jobId: string }> {
  if (!opts?.allowEnqueueWhenGated) {
    assertAnonymizationExecutionAllowed();
  }
  const id = String(userId ?? "").trim();
  if (!id) throw new AnonymizationError("userId required", "NOT_FOUND");

  const existing = await prisma.dataLifecycleJob.findFirst({
    where: {
      type: "anonymize_user",
      subjectType: "user",
      subjectId: id,
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  if (existing) return { jobId: existing.id };

  const job = await prisma.dataLifecycleJob.create({
    data: {
      type: "anonymize_user",
      subjectType: "user",
      subjectId: id,
      status: "pending",
      notBefore: opts?.notBefore ?? new Date(),
      payload: {
        platformAuthorized: opts?.platformAuthorized === true,
      } as Prisma.InputJsonValue,
    },
  });
  return { jobId: job.id };
}

export async function enqueueAnonymizeEmployeeJob(employeeId: string): Promise<{ jobId: string }> {
  assertAnonymizationExecutionAllowed();
  const id = String(employeeId ?? "").trim();
  if (!id) throw new AnonymizationError("employeeId required", "NOT_FOUND");

  const existing = await prisma.dataLifecycleJob.findFirst({
    where: {
      type: "anonymize_employee",
      subjectType: "employee",
      subjectId: id,
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  if (existing) return { jobId: existing.id };

  const job = await prisma.dataLifecycleJob.create({
    data: {
      type: "anonymize_employee",
      subjectType: "employee",
      subjectId: id,
      status: "pending",
      notBefore: new Date(),
      payload: {} as Prisma.InputJsonValue,
    },
  });
  return { jobId: job.id };
}

async function reclaimStaleAnonymizeJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - ANONYMIZE_RUNNING_LEASE_MS);
  const res = await prisma.dataLifecycleJob.updateMany({
    where: {
      type: { in: ["anonymize_user", "anonymize_employee"] },
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

function isRetryable(err: unknown): boolean {
  if (err instanceof AnonymizationError) {
    return (
      err.code === "STORAGE_PENDING" ||
      err.code === "AUDIT_FAILED" ||
      err.code === "CONFLICT"
    );
  }
  return true;
}

export async function processAnonymizeLifecycleJob(
  jobId: string,
  opts?: { bypassExecutionGate?: boolean; deleteStorageObject?: (url: string) => Promise<void> },
): Promise<{ status: string }> {
  assertAnonymizationExecutionAllowed(opts);

  const job = await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AnonymizationError("Job not found", "NOT_FOUND");
  if (job.status === "succeeded" || job.status === "cancelled") {
    return { status: job.status };
  }
  if (job.type !== "anonymize_user" && job.type !== "anonymize_employee") {
    throw new AnonymizationError("Unsupported job type for anonymization worker", "FORBIDDEN");
  }

  let claimed = job;
  if (job.status === "pending") {
    const c = await claimJob(jobId);
    if (!c) return { status: "running" }; // another worker
    claimed = c;
  } else if (job.status === "running") {
    // Allow same-process retry after crash mid-run only if lease stale — tick reclaims first.
    return { status: "running" };
  } else if (job.status === "failed" || job.status === "skipped_legal_hold") {
    await prisma.dataLifecycleJob.update({
      where: { id: jobId },
      data: { status: "running", attempts: { increment: 1 } },
    });
    claimed = (await prisma.dataLifecycleJob.findUnique({ where: { id: jobId } }))!;
  }

  const payload = parseAnonymizePayload(claimed);

  try {
    if (claimed.type === "anonymize_user") {
      if (claimed.subjectType !== "user") {
        throw new AnonymizationError("anonymize_user subjectType must be user", "FORBIDDEN");
      }
      // Cross-tenant safety: never trust payload.userId over subjectId.
      if (payload.userId && payload.userId !== claimed.subjectId) {
        throw new AnonymizationError(
          "Job payload userId does not match subjectId — refusing cross-tenant anonymization",
          "FORBIDDEN",
        );
      }
      await anonymizeUser(claimed.subjectId, {
        platformAuthorized: payload.platformAuthorized === true,
        bypassExecutionGate: opts?.bypassExecutionGate,
        deleteStorageObject: opts?.deleteStorageObject,
        actorId: claimed.subjectId,
      });
    } else {
      if (claimed.subjectType !== "employee") {
        throw new AnonymizationError("anonymize_employee subjectType must be employee", "FORBIDDEN");
      }
      if (payload.employeeId && payload.employeeId !== claimed.subjectId) {
        throw new AnonymizationError(
          "Job payload employeeId does not match subjectId — refusing cross-tenant anonymization",
          "FORBIDDEN",
        );
      }
      await anonymizeEmployee(claimed.subjectId, {
        bypassExecutionGate: opts?.bypassExecutionGate,
        deleteStorageObject: opts?.deleteStorageObject,
        actorId: null,
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
          pendingStorageDeletes: [],
        } as Prisma.InputJsonValue,
      },
    });
    return { status: "succeeded" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const code = err instanceof AnonymizationError ? err.code : "UNKNOWN";

    if (code === "LEGAL_HOLD_CATEGORY") {
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

    if (code === "EXECUTION_GATED" || code === "PRECONDITION" || code === "ACTIVE_BUSINESS_OWNER") {
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

    if (code === "FORBIDDEN") {
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
    if (!isRetryable(err) || attempts >= MAX_JOB_ATTEMPTS) {
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
          pendingStorageDeletes:
            code === "STORAGE_PENDING" ? payload.pendingStorageDeletes ?? [] : payload.pendingStorageDeletes,
        } as Prisma.InputJsonValue,
      },
    });
    return { status: "pending" };
  }
}

/**
 * Poll pending erasure_continue then anonymize_* jobs.
 * No-ops anonymize execution when flags are off (fail-closed).
 * erasure_continue may still enqueue pending anonymize_user jobs (orchestration only).
 */
export async function tickAnonymizationJobs(
  limit = 10,
  opts?: { bypassExecutionGate?: boolean },
): Promise<{
  processed: number;
  reclaimed: number;
  gated: boolean;
  erasureContinueProcessed: number;
}> {
  const { tickErasureContinueJobs, reclaimStaleErasureContinueJobs } = await import(
    "./erasureContinue.service.js"
  );

  // Always reclaim + attempt erasure_continue orchestration (may only enqueue anonymize jobs).
  const continueReclaimed = await reclaimStaleErasureContinueJobs();
  const continueTick = await tickErasureContinueJobs({
    bypassExecutionGate: opts?.bypassExecutionGate,
    runAnonymizeInline: opts?.bypassExecutionGate === true,
    limit,
  });

  if (!opts?.bypassExecutionGate && !isAnonymizationExecutionEnabled()) {
    return {
      processed: 0,
      reclaimed: continueReclaimed,
      gated: true,
      erasureContinueProcessed: continueTick.processed,
    };
  }

  const reclaimed = (await reclaimStaleAnonymizeJobs()) + continueReclaimed;
  const pending = await prisma.dataLifecycleJob.findMany({
    where: {
      type: { in: ["anonymize_user", "anonymize_employee"] },
      status: "pending",
      notBefore: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  for (const row of pending) {
    await processAnonymizeLifecycleJob(row.id, opts);
  }

  return {
    processed: pending.length,
    reclaimed,
    gated: false,
    erasureContinueProcessed: continueTick.processed,
  };
}
