/**
 * Account erasure-request foundation (GDPR lifecycle Slice B).
 * Never hard-deletes User when tips may exist — no prisma.user.delete Art. 17 path.
 */

import { prisma } from "../prisma.js";
import { writeAuditLog } from "./audit.service.js";
import { terminateUserSessions } from "./accountAccess.service.js";
import { userErasurePendingData } from "./lifecycleStatus.helpers.js";

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
      employee: { select: { id: true, isDeleted: true, businessId: true } },
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
    prisma.user.update({
      where: { id: userId },
      data: userErasurePendingData(now),
    }),
  ]);

  await terminateUserSessions(userId);

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
