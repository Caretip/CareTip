/**
 * GDPR Slice E — Business ownership transfer (1:1 owner model).
 * Successor must be a pure MANAGER account (no Employee row, no other Business).
 * Ownership change + business.ownership_transferred audit are fail-closed in one transaction.
 */

import { prisma } from "../prisma.js";

export class OwnershipTransferError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "TOMBSTONED"
      | "LEGAL_HOLD"
      | "INVALID_SUCCESSOR"
      | "CONFLICT"
      | "AUDIT_FAILED",
  ) {
    super(message);
    this.name = "OwnershipTransferError";
  }
}

export type TransferOwnershipInput = {
  businessId: string;
  successorUserId: string;
  actorUserId: string;
  /** owner = current Business.userId; platform = SUPER_ADMIN path */
  source: "owner" | "platform";
};

export type TransferOwnershipResult = {
  businessId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
  stripeCustomerId: string | null;
};

async function assertSuccessorEligible(successorUserId: string, currentOwnerUserId: string) {
  const successor = await prisma.user.findUnique({
    where: { id: successorUserId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      accountStatus: true,
      isPlatformAdmin: true,
      employee: { select: { id: true, businessId: true } },
      business: { select: { id: true } },
    },
  });
  if (!successor) {
    throw new OwnershipTransferError("Successor user not found", "INVALID_SUCCESSOR");
  }
  if (successor.id === currentOwnerUserId) {
    throw new OwnershipTransferError("Successor must be a different user", "INVALID_SUCCESSOR");
  }
  if (successor.isPlatformAdmin || successor.role === "SUPER_ADMIN") {
    throw new OwnershipTransferError("Successor cannot be a platform administrator", "INVALID_SUCCESSOR");
  }
  if (successor.role !== "MANAGER") {
    throw new OwnershipTransferError(
      "Successor must be a MANAGER account without an Employee membership",
      "INVALID_SUCCESSOR",
    );
  }
  if (successor.employee) {
    throw new OwnershipTransferError(
      "Successor must not have an Employee row (1:1 owner invariant)",
      "INVALID_SUCCESSOR",
    );
  }
  if (successor.business) {
    throw new OwnershipTransferError("Successor already owns a Business", "INVALID_SUCCESSOR");
  }
  if (successor.accountStatus !== "active" || successor.isActive !== true) {
    throw new OwnershipTransferError("Successor account is not active", "INVALID_SUCCESSOR");
  }
  return successor;
}

/**
 * Reassign Business.userId. Preserves stripeCustomerId. Does not create multi-business membership.
 * Fail-closed: Business update rolls back if the ownership-transfer audit row cannot be written.
 */
export async function transferBusinessOwnership(
  input: TransferOwnershipInput,
): Promise<TransferOwnershipResult> {
  const businessId = String(input.businessId ?? "").trim();
  const successorUserId = String(input.successorUserId ?? "").trim();
  const actorUserId = String(input.actorUserId ?? "").trim();
  if (!businessId || !successorUserId || !actorUserId) {
    throw new OwnershipTransferError("businessId, successorUserId, and actor are required", "FORBIDDEN");
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      userId: true,
      stripeCustomerId: true,
      lifecycleStatus: true,
      legalHold: true,
      deletedAt: true,
      name: true,
    },
  });
  if (!business) {
    throw new OwnershipTransferError("Business not found", "NOT_FOUND");
  }
  if (business.lifecycleStatus === "tombstoned") {
    throw new OwnershipTransferError("Cannot transfer a tombstoned Business", "TOMBSTONED");
  }
  if (business.legalHold) {
    throw new OwnershipTransferError("Cannot transfer a Business under legal hold", "LEGAL_HOLD");
  }

  if (input.source === "owner") {
    if (business.userId !== actorUserId) {
      throw new OwnershipTransferError("Only the current owner can transfer this Business", "FORBIDDEN");
    }
  }

  await assertSuccessorEligible(successorUserId, business.userId);

  const previousOwnerUserId = business.userId;
  const preservedStripeCustomerId = business.stripeCustomerId;

  const updated = await prisma.$transaction(async (tx) => {
    const locked = await tx.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        userId: true,
        stripeCustomerId: true,
        lifecycleStatus: true,
        legalHold: true,
      },
    });
    if (!locked) {
      throw new OwnershipTransferError("Business not found", "NOT_FOUND");
    }
    if (locked.userId !== previousOwnerUserId) {
      throw new OwnershipTransferError("Ownership changed concurrently; retry", "CONFLICT");
    }
    if (locked.lifecycleStatus === "tombstoned") {
      throw new OwnershipTransferError("Cannot transfer a tombstoned Business", "TOMBSTONED");
    }
    if (locked.legalHold) {
      throw new OwnershipTransferError("Cannot transfer a Business under legal hold", "LEGAL_HOLD");
    }

    const successorStillFree = await tx.user.findUnique({
      where: { id: successorUserId },
      select: {
        role: true,
        employee: { select: { id: true } },
        business: { select: { id: true } },
      },
    });
    if (
      !successorStillFree ||
      successorStillFree.role !== "MANAGER" ||
      successorStillFree.employee ||
      successorStillFree.business
    ) {
      throw new OwnershipTransferError("Successor is no longer eligible", "INVALID_SUCCESSOR");
    }

    const row = await tx.business.update({
      where: { id: businessId },
      data: {
        userId: successorUserId,
        stripeCustomerId: locked.stripeCustomerId,
      },
      select: {
        id: true,
        userId: true,
        stripeCustomerId: true,
      },
    });

    // Amendment A3 — structured IDs only; fail-closed with the ownership update.
    try {
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: "business.ownership_transferred",
          metadata: JSON.stringify({
            actorId: actorUserId,
            resourceType: "business",
            resourceId: businessId,
            previousOwnerUserId,
            newOwnerUserId: successorUserId,
            source: input.source,
            stripeCustomerIdPreserved: Boolean(preservedStripeCustomerId),
          }),
        },
      });
    } catch {
      throw new OwnershipTransferError(
        "Ownership transfer aborted: durable audit record could not be written",
        "AUDIT_FAILED",
      );
    }

    return row;
  });

  try {
    const { notifyBusinessOwnershipTransferred } = await import("./push/notification.triggers.js");
    notifyBusinessOwnershipTransferred({
      businessId,
      businessName: business.name,
      previousOwnerUserId,
      newOwnerUserId: successorUserId,
    });
  } catch {
    /* notification best-effort */
  }

  return {
    businessId: updated.id,
    previousOwnerUserId,
    newOwnerUserId: updated.userId,
    stripeCustomerId: updated.stripeCustomerId,
  };
}

/** Owner self-serve: never trust client businessId — resolve from actor's owned Business. */
export async function transferOwnershipAsOwner(
  ownerUserId: string,
  successorUserId: string,
  /** Ignored for tenancy — accepted only to detect client tampering attempts in tests/logs. */
  clientBusinessId?: string | null,
): Promise<TransferOwnershipResult> {
  const owned = await prisma.business.findUnique({
    where: { userId: ownerUserId },
    select: { id: true },
  });
  if (!owned) {
    throw new OwnershipTransferError("You do not own a Business", "NOT_FOUND");
  }
  if (clientBusinessId && String(clientBusinessId).trim() && String(clientBusinessId).trim() !== owned.id) {
    throw new OwnershipTransferError(
      "businessId does not match your owned Business",
      "FORBIDDEN",
    );
  }
  return transferBusinessOwnership({
    businessId: owned.id,
    successorUserId,
    actorUserId: ownerUserId,
    source: "owner",
  });
}
