/**
 * GDPR Slice G — Legal hold control plane (platform-admin only).
 *
 * Amendment A2: category-specific holds. Auth/session termination always allowed.
 * Amendment A3: structured audit (ids only — no email/name/phone).
 *
 * Does not invent T_* values. Does not enable destructive production execution.
 * Does not restore account access when a hold is cleared.
 */

import { Prisma, Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import { normalizeLegalHoldCategories } from "./retentionPolicy.helpers.js";

export class LegalHoldError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "VALIDATION"
      | "AUDIT_FAILED"
      | "CONFLICT",
  ) {
    super(message);
    this.name = "LegalHoldError";
  }
}

export type LegalHoldState = {
  subjectType: "user" | "business";
  subjectId: string;
  legalHold: boolean;
  legalHoldReason: string | null;
  legalHoldCategories: string[];
  legalHoldSetAt: string | null;
  legalHoldSetByUserId: string | null;
};

const REASON_MAX = 2000;

async function assertPlatformAdminActor(actorUserId: string): Promise<void> {
  const id = String(actorUserId ?? "").trim();
  if (!id) {
    throw new LegalHoldError("Platform administrator authentication required", "FORBIDDEN");
  }
  const row = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      isPlatformAdmin: true,
      isActive: true,
      emailVerified: true,
      accountStatus: true,
    },
  });
  if (
    !row ||
    row.role !== Role.SUPER_ADMIN ||
    !row.isPlatformAdmin ||
    !row.isActive ||
    !row.emailVerified ||
    row.accountStatus !== "active"
  ) {
    throw new LegalHoldError("Only platform administrators may manage legal holds", "FORBIDDEN");
  }
}

function sanitizeReason(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LegalHoldError("reason is required", "VALIDATION");
  }
  const reason = raw.trim();
  if (reason.length > REASON_MAX) {
    throw new LegalHoldError(`reason must be at most ${REASON_MAX} characters`, "VALIDATION");
  }
  return reason;
}

async function writeFailClosedAudit(input: {
  actorId: string;
  action: string;
  resourceType: "user" | "business";
  resourceId: string;
  businessId?: string | null;
  categories?: string[];
  extra?: Record<string, unknown>;
}): Promise<void> {
  const metadata: Record<string, unknown> = {
    actorId: input.actorId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action: input.action,
    timestamp: new Date().toISOString(),
  };
  if (input.businessId) metadata.businessId = input.businessId;
  if (input.categories) metadata.categories = input.categories;
  if (input.extra) {
    for (const [k, v] of Object.entries(input.extra)) {
      if (["email", "phone", "name", "actorEmail", "actorName", "userEmail"].includes(k)) continue;
      metadata[k] = v;
    }
  }
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        metadata: JSON.stringify(metadata),
      },
    });
  } catch (err) {
    throw new LegalHoldError(
      `Legal-hold audit write failed: ${err instanceof Error ? err.message : "unknown"}`,
      "AUDIT_FAILED",
    );
  }
}

function mapUserHold(row: {
  id: string;
  legalHold: boolean;
  legalHoldReason: string | null;
  legalHoldCategories: string[];
  legalHoldSetAt: Date | null;
  legalHoldSetByUserId: string | null;
}): LegalHoldState {
  return {
    subjectType: "user",
    subjectId: row.id,
    legalHold: row.legalHold,
    legalHoldReason: row.legalHoldReason,
    legalHoldCategories: row.legalHoldCategories ?? [],
    legalHoldSetAt: row.legalHoldSetAt?.toISOString() ?? null,
    legalHoldSetByUserId: row.legalHoldSetByUserId,
  };
}

function mapBusinessHold(row: {
  id: string;
  legalHold: boolean;
  legalHoldReason: string | null;
  legalHoldCategories: string[];
  legalHoldSetAt: Date | null;
  legalHoldSetByUserId: string | null;
}): LegalHoldState {
  return {
    subjectType: "business",
    subjectId: row.id,
    legalHold: row.legalHold,
    legalHoldReason: row.legalHoldReason,
    legalHoldCategories: row.legalHoldCategories ?? [],
    legalHoldSetAt: row.legalHoldSetAt?.toISOString() ?? null,
    legalHoldSetByUserId: row.legalHoldSetByUserId,
  };
}

const USER_HOLD_SELECT = {
  id: true,
  legalHold: true,
  legalHoldReason: true,
  legalHoldCategories: true,
  legalHoldSetAt: true,
  legalHoldSetByUserId: true,
  accountStatus: true,
} as const;

const BUSINESS_HOLD_SELECT = {
  id: true,
  legalHold: true,
  legalHoldReason: true,
  legalHoldCategories: true,
  legalHoldSetAt: true,
  legalHoldSetByUserId: true,
} as const;

export async function getUserLegalHold(userId: string, actorUserId: string): Promise<LegalHoldState> {
  await assertPlatformAdminActor(actorUserId);
  const id = String(userId ?? "").trim();
  const row = await prisma.user.findUnique({ where: { id }, select: USER_HOLD_SELECT });
  if (!row) throw new LegalHoldError("User not found", "NOT_FOUND");
  return mapUserHold(row);
}

export async function getBusinessLegalHold(
  businessId: string,
  actorUserId: string,
): Promise<LegalHoldState> {
  await assertPlatformAdminActor(actorUserId);
  const id = String(businessId ?? "").trim();
  const row = await prisma.business.findUnique({ where: { id }, select: BUSINESS_HOLD_SELECT });
  if (!row) throw new LegalHoldError("Business not found", "NOT_FOUND");
  return mapBusinessHold(row);
}

export async function setUserLegalHold(input: {
  userId: string;
  actorUserId: string;
  reason: unknown;
  categories: unknown;
}): Promise<LegalHoldState> {
  await assertPlatformAdminActor(input.actorUserId);
  const userId = String(input.userId ?? "").trim();
  const reason = sanitizeReason(input.reason);
  const normalized = normalizeLegalHoldCategories(input.categories);
  if (!normalized.ok) throw new LegalHoldError(normalized.message, "VALIDATION");
  if (normalized.categories.length === 0) {
    throw new LegalHoldError(
      "categories must list at least one preserved category (Amendment A2)",
      "VALIDATION",
    );
  }

  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!existing) throw new LegalHoldError("User not found", "NOT_FOUND");

  const now = new Date();
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: userId },
        data: {
          legalHold: true,
          legalHoldReason: reason,
          legalHoldCategories: normalized.categories,
          legalHoldSetAt: now,
          legalHoldSetByUserId: input.actorUserId,
        },
        select: USER_HOLD_SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: "lifecycle.legal_hold.user.set",
          metadata: JSON.stringify({
            actorId: input.actorUserId,
            resourceType: "user",
            resourceId: userId,
            action: "lifecycle.legal_hold.user.set",
            timestamp: now.toISOString(),
            categories: normalized.categories,
            // reason omitted from structured audit — free-form text may contain personal data
            reasonLength: reason.length,
          }),
        },
      });
      return row;
    });
  } catch (err) {
    if (err instanceof LegalHoldError) throw err;
    throw new LegalHoldError(
      `Failed to set user legal hold: ${err instanceof Error ? err.message : "unknown"}`,
      "AUDIT_FAILED",
    );
  }

  return mapUserHold(updated);
}

export async function clearUserLegalHold(input: {
  userId: string;
  actorUserId: string;
}): Promise<LegalHoldState> {
  await assertPlatformAdminActor(input.actorUserId);
  const userId = String(input.userId ?? "").trim();
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...USER_HOLD_SELECT },
  });
  if (!existing) throw new LegalHoldError("User not found", "NOT_FOUND");

  const now = new Date();
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: userId },
        data: {
          legalHold: false,
          legalHoldReason: null,
          legalHoldCategories: [],
          legalHoldSetAt: null,
          legalHoldSetByUserId: null,
        },
        select: USER_HOLD_SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: "lifecycle.legal_hold.user.clear",
          metadata: JSON.stringify({
            actorId: input.actorUserId,
            resourceType: "user",
            resourceId: userId,
            action: "lifecycle.legal_hold.user.clear",
            timestamp: now.toISOString(),
            previousCategories: existing.legalHoldCategories ?? [],
          }),
        },
      });
      return row;
    });
  } catch (err) {
    if (err instanceof LegalHoldError) throw err;
    throw new LegalHoldError(
      `Failed to clear user legal hold: ${err instanceof Error ? err.message : "unknown"}`,
      "AUDIT_FAILED",
    );
  }

  await wakeLifecycleAfterHoldClear({
    subjectType: "user",
    subjectId: userId,
    accountStatus: existing.accountStatus,
  });

  return mapUserHold(updated);
}

export async function setBusinessLegalHold(input: {
  businessId: string;
  actorUserId: string;
  reason: unknown;
  categories: unknown;
}): Promise<LegalHoldState> {
  await assertPlatformAdminActor(input.actorUserId);
  const businessId = String(input.businessId ?? "").trim();
  const reason = sanitizeReason(input.reason);
  const normalized = normalizeLegalHoldCategories(input.categories);
  if (!normalized.ok) throw new LegalHoldError(normalized.message, "VALIDATION");
  if (normalized.categories.length === 0) {
    throw new LegalHoldError(
      "categories must list at least one preserved category (Amendment A2)",
      "VALIDATION",
    );
  }

  const existing = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true },
  });
  if (!existing) throw new LegalHoldError("Business not found", "NOT_FOUND");

  const now = new Date();
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.business.update({
        where: { id: businessId },
        data: {
          legalHold: true,
          legalHoldReason: reason,
          legalHoldCategories: normalized.categories,
          legalHoldSetAt: now,
          legalHoldSetByUserId: input.actorUserId,
        },
        select: BUSINESS_HOLD_SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: "lifecycle.legal_hold.business.set",
          metadata: JSON.stringify({
            actorId: input.actorUserId,
            resourceType: "business",
            resourceId: businessId,
            businessId,
            action: "lifecycle.legal_hold.business.set",
            timestamp: now.toISOString(),
            categories: normalized.categories,
            reasonLength: reason.length,
          }),
        },
      });
      return row;
    });
  } catch (err) {
    if (err instanceof LegalHoldError) throw err;
    throw new LegalHoldError(
      `Failed to set business legal hold: ${err instanceof Error ? err.message : "unknown"}`,
      "AUDIT_FAILED",
    );
  }

  return mapBusinessHold(updated);
}

export async function clearBusinessLegalHold(input: {
  businessId: string;
  actorUserId: string;
}): Promise<LegalHoldState> {
  await assertPlatformAdminActor(input.actorUserId);
  const businessId = String(input.businessId ?? "").trim();
  const existing = await prisma.business.findUnique({
    where: { id: businessId },
    select: BUSINESS_HOLD_SELECT,
  });
  if (!existing) throw new LegalHoldError("Business not found", "NOT_FOUND");

  const now = new Date();
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.business.update({
        where: { id: businessId },
        data: {
          legalHold: false,
          legalHoldReason: null,
          legalHoldCategories: [],
          legalHoldSetAt: null,
          legalHoldSetByUserId: null,
        },
        select: BUSINESS_HOLD_SELECT,
      });
      await tx.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: "lifecycle.legal_hold.business.clear",
          metadata: JSON.stringify({
            actorId: input.actorUserId,
            resourceType: "business",
            resourceId: businessId,
            businessId,
            action: "lifecycle.legal_hold.business.clear",
            timestamp: now.toISOString(),
            previousCategories: existing.legalHoldCategories ?? [],
          }),
        },
      });
      return row;
    });
  } catch (err) {
    if (err instanceof LegalHoldError) throw err;
    throw new LegalHoldError(
      `Failed to clear business legal hold: ${err instanceof Error ? err.message : "unknown"}`,
      "AUDIT_FAILED",
    );
  }

  await wakeLifecycleAfterHoldClear({ subjectType: "business", subjectId: businessId });

  return mapBusinessHold(updated);
}

/**
 * After hold clear: re-queue skipped_legal_hold jobs and enqueue erasure_continue
 * when the subject is in erasure_pending (Phase 2 §12.3).
 * Does not restore account access.
 */
async function wakeLifecycleAfterHoldClear(input: {
  subjectType: "user" | "business";
  subjectId: string;
  accountStatus?: string;
}): Promise<void> {
  const now = new Date();
  await prisma.dataLifecycleJob.updateMany({
    where: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: "skipped_legal_hold",
    },
    data: {
      status: "pending",
      notBefore: now,
      lastError: null,
    },
  });

  if (input.subjectType === "user" && input.accountStatus === "erasure_pending") {
    const existing = await prisma.dataLifecycleJob.findFirst({
      where: {
        type: "erasure_continue",
        subjectType: "user",
        subjectId: input.subjectId,
        status: { in: ["pending", "running"] },
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.dataLifecycleJob.create({
        data: {
          type: "erasure_continue",
          subjectType: "user",
          subjectId: input.subjectId,
          status: "pending",
          notBefore: now,
          payload: {
            reason: "legal_hold_cleared",
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
}

/**
 * Platform-admin-only subject lookup for Legal Hold UI.
 * Minimal fields: id + label suitable for selection. Does not expand hold rules.
 */
export type LegalHoldSubjectHit = {
  id: string;
  label: string;
  secondary: string | null;
  subjectType: "user" | "business";
};

export async function searchLegalHoldSubjects(input: {
  actorUserId: string;
  subjectType: "user" | "business";
  q: string;
  take?: number;
}): Promise<LegalHoldSubjectHit[]> {
  await assertPlatformAdminActor(input.actorUserId);
  const q = String(input.q ?? "").trim();
  if (q.length < 1) return [];
  const take = Math.min(Math.max(input.take ?? 12, 1), 25);

  if (input.subjectType === "business") {
    const rows = await prisma.business.findMany({
      where: {
        deletedAt: null,
        OR: [
          { id: q },
          { name: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        legalHold: true,
      },
      orderBy: { name: "asc" },
      take,
    });
    return rows.map((b) => ({
      id: b.id,
      label: b.name,
      secondary: b.slug,
      subjectType: "business" as const,
    }));
  }

  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { id: q },
        { email: { contains: q, mode: "insensitive" } },
        { employee: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      email: true,
      role: true,
      employee: { select: { name: true } },
    },
    orderBy: { email: "asc" },
    take,
  });
  return rows.map((u) => ({
    id: u.id,
    label: u.employee?.name?.trim() || u.email,
    secondary: u.employee?.name?.trim() ? u.email : u.role,
    subjectType: "user" as const,
  }));
}

/** Test/helper: structured audit must not embed PII keys. */
export function assertAuditMetadataHasNoPii(metadataJson: string | null | undefined): boolean {
  if (!metadataJson) return true;
  try {
    const obj = JSON.parse(metadataJson) as Record<string, unknown>;
    const banned = ["email", "phone", "name", "actorEmail", "actorName", "userEmail", "employeeName"];
    return !banned.some((k) => k in obj && obj[k] != null && obj[k] !== "[redacted]");
  } catch {
    return false;
  }
}

export { writeFailClosedAudit };
