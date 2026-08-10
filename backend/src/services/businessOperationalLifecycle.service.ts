import type { BusinessOperationalStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { writeAuditLog } from "./audit.service.js";
import { parseReviewHistory } from "./businessVerificationWorkflow.service.js";
import { invalidatePlatformDashboardCache } from "./platform.service.js";
import { emitPlatformDataUpdated } from "../socket/socketEmitters.js";

export type OperationalStatusAction = "active" | "suspended" | "inactive";

function actionToOperationalStatus(action: OperationalStatusAction): BusinessOperationalStatus {
  return action;
}

export async function updateBusinessOperationalStatus(
  businessId: string,
  action: OperationalStatusAction,
  opts?: { reviewNote?: string | null; adminUserId?: string },
): Promise<void> {
  const previous = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      userId: true,
      operationalStatus: true,
      operationalReviewHistory: true,
      deletedAt: true,
      onboardingVerificationStatus: true,
    },
  });
  if (!previous || previous.deletedAt) {
    throw new Error("Business not found");
  }

  const nextStatus = actionToOperationalStatus(action);
  if (previous.operationalStatus === nextStatus) {
    return;
  }

  if (action === "active" && previous.onboardingVerificationStatus !== "approved") {
    throw new Error("Cannot reactivate a business that has not completed onboarding approval");
  }

  const note = opts?.reviewNote?.trim() || null;
  const history = parseReviewHistory(previous.operationalReviewHistory);
  history.push({ status: nextStatus, at: new Date().toISOString(), note });

  const ownerShouldBeActive = nextStatus === "active";

  await prisma.$transaction(async (tx) => {
    await tx.business.update({
      where: { id: businessId },
      data: {
        operationalStatus: nextStatus,
        operationalStatusChangedAt: new Date(),
        operationalReviewHistory: history,
      },
    });
    const { userAccessRestoredData, userAccessRevokedData } = await import(
      "./lifecycleStatus.helpers.js"
    );
    await tx.user.update({
      where: { id: previous.userId },
      data: ownerShouldBeActive ? userAccessRestoredData() : userAccessRevokedData(),
    });
  });

  if (!ownerShouldBeActive) {
    const { terminateUserSessions } = await import("./accountAccess.service.js");
    await terminateUserSessions(previous.userId);
  }

  if (opts?.adminUserId) {
    await writeAuditLog({
      userId: opts.adminUserId,
      action: `business.operational_status.${nextStatus}`,
      metadata: JSON.stringify({
        businessId,
        // Structured ids preferred (lifecycle Amendment A3); name kept for legacy admin ops until audit rewrite.
        resourceType: "business",
        resourceId: businessId,
        previousStatus: previous.operationalStatus,
        nextStatus,
        note,
      }),
    });
  }

  invalidatePlatformDashboardCache();
  emitPlatformDataUpdated("business_operational_status");
}

export type SoftDeleteEligibility = {
  eligible: boolean;
  reason?: string;
};

export async function assessSoftDeleteEligibility(businessId: string): Promise<SoftDeleteEligibility> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      deletedAt: true,
      onboardingVerificationStatus: true,
      subscription: { select: { status: true } },
      _count: { select: { transactions: true } },
    },
  });
  if (!business || business.deletedAt) {
    return { eligible: false, reason: "Business not found" };
  }

  const onboarding = business.onboardingVerificationStatus;
  if (onboarding !== "draft" && onboarding !== "rejected") {
    return {
      eligible: false,
      reason: "Only draft or rejected onboarding requests can be removed from the verification queue",
    };
  }

  if (business._count.transactions > 0) {
    return {
      eligible: false,
      reason: "Cannot remove a business that has payment or tip records",
    };
  }

  const subStatus = business.subscription?.status;
  if (subStatus === "active" || subStatus === "trialing" || subStatus === "past_due") {
    return {
      eligible: false,
      reason: "Cannot remove a business with an active subscription",
    };
  }

  return { eligible: true };
}

/**
 * Soft-delete invalid/fake onboarding requests — preserves audit history and related FK integrity.
 */
export async function softDeleteBusinessForAdmin(
  businessId: string,
  opts?: { reason?: string | null; adminUserId?: string },
): Promise<void> {
  const eligibility = await assessSoftDeleteEligibility(businessId);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason ?? "Business cannot be removed");
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, userId: true },
  });
  if (!business) {
    throw new Error("Business not found");
  }

  const reason = opts?.reason?.trim() || null;
  const deletedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const { userAccessRevokedData, businessLifecycleForSoftClose } = await import(
      "./lifecycleStatus.helpers.js"
    );
    await tx.business.update({
      where: { id: businessId },
      data: {
        deletedAt,
        operationalStatus: "inactive",
        operationalStatusChangedAt: deletedAt,
        lifecycleStatus: businessLifecycleForSoftClose(),
      },
    });
    await tx.user.update({
      where: { id: business.userId },
      data: userAccessRevokedData(),
    });
  });

  {
    const { terminateUserSessions } = await import("./accountAccess.service.js");
    await terminateUserSessions(business.userId);
  }

  if (opts?.adminUserId) {
    await writeAuditLog({
      userId: opts.adminUserId,
      action: "business.soft_deleted",
      metadata: JSON.stringify({
        businessId,
        resourceType: "business",
        resourceId: businessId,
        reason,
        deletedAt: deletedAt.toISOString(),
      }),
    });
  }

  invalidatePlatformDashboardCache();
  emitPlatformDataUpdated("business_soft_deleted");
}
