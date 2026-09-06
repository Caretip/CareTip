/**
 * Account erasure-request foundation (GDPR lifecycle Slice B).
 * Never hard-deletes User when tips may exist — no prisma.user.delete Art. 17 path.
 */

import bcrypt from "bcrypt";
import { prisma } from "../prisma.js";
import { writeAuditLog } from "./audit.service.js";
import { terminateUserSessions } from "./accountAccess.service.js";
import {
  deriveErasureLifecycleState,
  resolveAnonymizeEligibleAt,
  resolveDeletionCancelUntil,
  userErasureCancelledData,
  userErasurePendingData,
  type ErasureLifecycleState,
} from "./lifecycleStatus.helpers.js";
import { ACCOUNT_ERASURE_GRACE_DAYS } from "./retentionPolicy.constants.js";
import { addUtcDays } from "./retentionCalendar.js";

export type ErasureBlockerCode =
  | "SOLE_BUSINESS_OWNER"
  | "ACTIVE_SUBSCRIPTION"
  | "PENDING_TIP_PAYMENT"
  | "OPEN_DISPUTE"
  | "ALREADY_INACTIVE";

export type ErasureBlocker = {
  code: ErasureBlockerCode;
  message: string;
};

export type ErasureStatus = {
  userId: string;
  role: string;
  isActive: boolean;
  accountStatus: string | null;
  employeeDeleted: boolean | null;
  blockers: ErasureBlocker[];
  lifecyclePhase: "active" | "access_revoked" | "blocked";
  erasureLifecycleState: ErasureLifecycleState;
  deletionRequestedAt: string | null;
  /** 14-day cancellation window — not the 30-day anonymize clock. */
  deletionCancelUntil: string | null;
  /** 30-day irreversible profile anonymization eligibility. */
  anonymizeEligibleAt: string | null;
  canCancelDeletion: boolean;
};

export type ErasureRequestResult = {
  ok: boolean;
  status: ErasureStatus;
  message: string;
};

async function loadErasureContext(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
      accountStatus: true,
      anonymizedAt: true,
      legalHold: true,
      legalHoldCategories: true,
      deletionRequestedAt: true,
      deletionCancelUntil: true,
      anonymizeEligibleAt: true,
      passwordHash: true,
      employee: { select: { id: true, isDeleted: true, businessId: true, deletedAt: true } },
      business: {
        select: {
          id: true,
          deletedAt: true,
          lifecycleStatus: true,
          subscription: { select: { status: true } },
        },
      },
    },
  });
}

function clocksFor(user: {
  accountStatus: string;
  anonymizedAt: Date | null;
  legalHold: boolean;
  legalHoldCategories: string[];
  deletionRequestedAt: Date | null;
  deletionCancelUntil: Date | null;
  anonymizeEligibleAt: Date | null;
  isActive: boolean;
}, now = new Date()) {
  const cancelUntil = resolveDeletionCancelUntil(user);
  const eligibleAt = resolveAnonymizeEligibleAt(user);
  const erasureLifecycleState = deriveErasureLifecycleState(user, now);
  const canCancelDeletion =
    user.accountStatus === "erasure_pending" &&
    user.anonymizedAt == null &&
    cancelUntil != null &&
    now.getTime() < cancelUntil.getTime();
  return {
    erasureLifecycleState,
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    deletionCancelUntil: cancelUntil?.toISOString() ?? null,
    anonymizeEligibleAt: eligibleAt?.toISOString() ?? null,
    canCancelDeletion,
  };
}

async function enqueueErasureContinueWhenEligible(userId: string, eligibleAt: Date): Promise<void> {
  const existing = await prisma.dataLifecycleJob.findFirst({
    where: {
      type: "erasure_continue",
      subjectType: "user",
      subjectId: userId,
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.dataLifecycleJob.create({
    data: {
      type: "erasure_continue",
      subjectType: "user",
      subjectId: userId,
      status: "pending",
      notBefore: eligibleAt,
      payload: { reason: "account_erasure_grace_30d" },
    },
  });
}

export async function getErasureBlockers(userId: string): Promise<ErasureBlocker[]> {
  const user = await loadErasureContext(userId);
  if (!user) return [{ code: "ALREADY_INACTIVE", message: "Account not found" }];

  const blockers: ErasureBlocker[] = [];

  if (user.role === "MANAGER" && user.business && !user.business.deletedAt) {
    blockers.push({
      code: "SOLE_BUSINESS_OWNER",
      message:
        "Transfer business ownership or soft-close the business before account erasure can proceed.",
    });
    const sub = user.business.subscription?.status;
    if (sub && ["trialing", "active", "past_due", "unpaid", "incomplete"].includes(sub)) {
      blockers.push({
        code: "ACTIVE_SUBSCRIPTION",
        message: "Settle or cancel the business subscription before erasure.",
      });
    }
  }

  if (user.employee) {
    const pendingTips = await prisma.transaction.count({
      where: {
        employeeId: user.employee.id,
        status: "pending",
      },
    });
    if (pendingTips > 0) {
      blockers.push({
        code: "PENDING_TIP_PAYMENT",
        message: "Wait until pending tip payments reach a terminal status.",
      });
    }

    const tipIds = (
      await prisma.transaction.findMany({
        where: { employeeId: user.employee.id },
        select: { id: true },
        take: 5000,
      })
    ).map((t) => t.id);
    if (tipIds.length > 0) {
      const openDisputes = await prisma.tipRefund.count({
        where: {
          tipId: { in: tipIds },
          status: { in: ["needs_response", "pending"] },
        },
      });
      if (openDisputes > 0) {
        blockers.push({
          code: "OPEN_DISPUTE",
          message: "Resolve open tip disputes before erasure.",
        });
      }
    }
  }

  return blockers;
}

export async function getErasureStatus(userId: string): Promise<ErasureStatus> {
  const user = await loadErasureContext(userId);
  if (!user) {
    return {
      userId,
      role: "UNKNOWN",
      isActive: false,
      accountStatus: null,
      employeeDeleted: null,
      blockers: [{ code: "ALREADY_INACTIVE", message: "Account not found" }],
      lifecyclePhase: "blocked",
      erasureLifecycleState: "DEACTIVATED",
      deletionRequestedAt: null,
      deletionCancelUntil: null,
      anonymizeEligibleAt: null,
      canCancelDeletion: false,
    };
  }

  const canAuth = user.isActive && user.accountStatus === "active";
  const blockers = canAuth ? await getErasureBlockers(userId) : [];
  let lifecyclePhase: ErasureStatus["lifecyclePhase"] = "active";
  if (!canAuth) lifecyclePhase = "access_revoked";
  else if (blockers.length > 0) lifecyclePhase = "blocked";

  return {
    userId: user.id,
    role: user.role,
    isActive: user.isActive,
    accountStatus: user.accountStatus,
    employeeDeleted: user.employee ? user.employee.isDeleted : null,
    blockers,
    lifecyclePhase,
    ...clocksFor(user),
  };
}

/**
 * Safe Art. 17 foundation: revoke access + soft-remove employee membership.
 * Does NOT call prisma.user.delete. Does NOT delete tip rows.
 */
export async function requestAccountErasure(userId: string): Promise<ErasureRequestResult> {
  const user = await loadErasureContext(userId);
  if (!user) {
    throw new Error("Not allowed");
  }

  if (!user.isActive || user.accountStatus !== "active") {
    const status = await getErasureStatus(userId);
    return {
      ok: true,
      status,
      message: "Account access is already revoked.",
    };
  }

  const blockers = await getErasureBlockers(userId);
  // Manager with live business cannot complete foundation erasure yet.
  if (blockers.some((b) => b.code === "SOLE_BUSINESS_OWNER" || b.code === "ACTIVE_SUBSCRIPTION")) {
    return {
      ok: false,
      status: {
        userId: user.id,
        role: user.role,
        isActive: true,
        accountStatus: user.accountStatus,
        employeeDeleted: user.employee?.isDeleted ?? null,
        blockers,
        lifecyclePhase: "blocked",
        ...clocksFor(user),
      },
      message: "Erasure cannot proceed until blockers are resolved.",
    };
  }

  if (blockers.some((b) => b.code === "PENDING_TIP_PAYMENT" || b.code === "OPEN_DISPUTE")) {
    return {
      ok: false,
      status: {
        userId: user.id,
        role: user.role,
        isActive: true,
        accountStatus: user.accountStatus,
        employeeDeleted: user.employee?.isDeleted ?? null,
        blockers,
        lifecyclePhase: "blocked",
        ...clocksFor({
          ...user,
          anonymizedAt: user.anonymizedAt,
          legalHold: user.legalHold,
          legalHoldCategories: user.legalHoldCategories ?? [],
        }),
      },
      message: "Erasure cannot proceed until payment/dispute blockers are resolved.",
    };
  }

  const now = new Date();

  // Slice E: former manager (no live Business) may enter erasure_pending after ownership transfer.
  if (user.role === "MANAGER" && (!user.business || user.business.deletedAt)) {
    await prisma.user.update({
      where: { id: userId },
      data: userErasurePendingData(now),
    });
    await terminateUserSessions(userId);
    await enqueueErasureContinueWhenEligible(userId, addUtcDays(now, ACCOUNT_ERASURE_GRACE_DAYS));
    await writeAuditLog({
      userId,
      action: "user.erasure_requested",
      metadata: JSON.stringify({
        actorId: userId,
        resourceType: "user",
        resourceId: userId,
        phase: "access_revoked_foundation",
        role: "MANAGER",
      }),
    });
    const status = await getErasureStatus(userId);
    return {
      ok: true,
      status,
      message: "Account access revoked. Business ownership was already transferred or closed.",
    };
  }

  if (user.role !== "EMPLOYEE" || !user.employee) {
    throw new Error("Not allowed");
  }

  await prisma.$transaction([
    prisma.employee.update({
      where: { id: user.employee.id },
      data: {
        isDeleted: true,
        deletedAt: now,
        isActive: false,
        activationStatus: "pending_activation",
      },
    }),
    prisma.employeeActivationToken.deleteMany({ where: { employeeId: user.employee.id } }),
    prisma.user.update({
      where: { id: userId },
      data: userErasurePendingData(now),
    }),
  ]);

  await terminateUserSessions(userId);
  await enqueueErasureContinueWhenEligible(userId, addUtcDays(now, ACCOUNT_ERASURE_GRACE_DAYS));

  await writeAuditLog({
    userId,
    action: "user.erasure_requested",
    metadata: JSON.stringify({
      actorId: userId,
      resourceType: "user",
      resourceId: userId,
      employeeId: user.employee.id,
      businessId: user.employee.businessId,
      phase: "access_revoked_foundation",
      deletionCancelUntilDays: 14,
      anonymizeEligibleDays: 30,
    }),
  });

  const status = await getErasureStatus(userId);
  return {
    ok: true,
    status,
    message:
      "Account access revoked. Membership removed. Financial tip records retained for the business.",
  };
}

export class ErasureCancelError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "EXPIRED" | "PRECONDITION" | "INVALID_CREDENTIALS",
  ) {
    super(message);
    this.name = "ErasureCancelError";
  }
}

async function cancelErasureJobs(userId: string): Promise<void> {
  await prisma.dataLifecycleJob.updateMany({
    where: {
      subjectType: "user",
      subjectId: userId,
      type: { in: ["erasure_continue", "anonymize_user"] },
      status: { in: ["pending", "running", "skipped_legal_hold", "failed"] },
    },
    data: {
      status: "cancelled",
      completedAt: new Date(),
      lastError: "erasure_cancelled_within_14_day_window",
    },
  });
}

/**
 * Reverse account erasure within the 14-day cancellation window.
 * Does not restore access when a legal hold is in force (account stays deactivated).
 * Financial rows are never deleted by erasure or cancel.
 */
export async function cancelAccountErasure(userId: string, now = new Date()): Promise<ErasureStatus> {
  const user = await loadErasureContext(userId);
  if (!user) throw new ErasureCancelError("Account not found", "NOT_FOUND");
  if (user.anonymizedAt || user.accountStatus === "anonymized" || user.accountStatus === "closed") {
    throw new ErasureCancelError("Erasure has already completed and cannot be cancelled", "PRECONDITION");
  }
  if (user.accountStatus !== "erasure_pending") {
    return getErasureStatus(userId);
  }
  const cancelUntil = resolveDeletionCancelUntil(user);
  if (!cancelUntil || now.getTime() >= cancelUntil.getTime()) {
    throw new ErasureCancelError(
      "The 14-day deletion cancellation window has expired",
      "EXPIRED",
    );
  }

  const holdActive = user.legalHold === true;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: holdActive
        ? {
            deletionRequestedAt: null,
            deletionCancelUntil: null,
            anonymizeEligibleAt: null,
            accountStatus: "deactivated",
            isActive: false,
          }
        : userErasureCancelledData(),
    });
    if (user.employee?.isDeleted) {
      await tx.employee.update({
        where: { id: user.employee.id },
        data: {
          isDeleted: false,
          deletedAt: null,
          isActive: true,
          activationStatus: "active",
        },
      });
    }
  });
  await cancelErasureJobs(userId);
  await writeAuditLog({
    userId,
    action: "user.erasure_cancelled",
    metadata: JSON.stringify({
      actorId: userId,
      resourceType: "user",
      resourceId: userId,
      legalHoldRemains: holdActive,
      cancellationWindowDays: 14,
      accountErasureGraceDays: 30,
    }),
  });
  return getErasureStatus(userId);
}

function normalizeEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * Credential-based cancel — sessions are terminated on erasure, so this is the
 * supported reverse path. Does not issue a session; caller must sign in after success
 * (unless a legal hold keeps the account deactivated).
 */
export async function cancelAccountErasureByCredentials(input: {
  email: string;
  password: string;
}): Promise<ErasureStatus> {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, accountStatus: true },
  });
  if (!user || !user.passwordHash) {
    throw new ErasureCancelError("Invalid email or password", "INVALID_CREDENTIALS");
  }
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    throw new ErasureCancelError("Invalid email or password", "INVALID_CREDENTIALS");
  }
  if (user.accountStatus !== "erasure_pending") {
    throw new ErasureCancelError("Invalid email or password", "INVALID_CREDENTIALS");
  }
  return cancelAccountErasure(user.id);
}

