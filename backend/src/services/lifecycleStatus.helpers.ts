import type { AccountStatus, BusinessLifecycle } from "@prisma/client";
import {
  ACCOUNT_ERASURE_GRACE_DAYS,
  DELETION_CANCELLATION_DAYS,
} from "./retentionPolicy.constants.js";
import { addUtcDays } from "./retentionCalendar.js";

/** Compat: isActive true only when account is fully active. */
export function isActiveForAccountStatus(status: AccountStatus): boolean {
  return status === "active";
}

export function accountStatusForDeactivate(): AccountStatus {
  return "deactivated";
}

export function accountStatusForErasurePending(): AccountStatus {
  return "erasure_pending";
}

export function businessLifecycleForSoftClose(): BusinessLifecycle {
  return "soft_closed";
}

/** Dual-write payload when revoking access (deactivate / soft-remove). */
export function userAccessRevokedData(_now = new Date()) {
  return {
    isActive: false as const,
    accountStatus: accountStatusForDeactivate(),
    // do not clear deletionRequestedAt if already set
  };
}

/**
 * Dual clocks from a deletion request instant. Periods are the approved constants:
 * 14-day cancel vs 30-day anonymize eligibility. Do not merge them.
 */
export function computeErasureClocksFromRequestedAt(deletionRequestedAt: Date) {
  return {
    deletionCancelUntil: addUtcDays(deletionRequestedAt, DELETION_CANCELLATION_DAYS),
    anonymizeEligibleAt: addUtcDays(deletionRequestedAt, ACCOUNT_ERASURE_GRACE_DAYS),
  };
}

/**
 * Immediate deactivation + both erasure clocks:
 * - deletionCancelUntil = now + 14 days (cancellation window)
 * - anonymizeEligibleAt = now + 30 days (irreversible profile anonymization eligibility)
 * These MUST remain distinct.
 */
export function userErasurePendingData(now = new Date()) {
  const clocks = computeErasureClocksFromRequestedAt(now);
  return {
    isActive: false as const,
    accountStatus: accountStatusForErasurePending(),
    deletionRequestedAt: now,
    deletionCancelUntil: clocks.deletionCancelUntil,
    anonymizeEligibleAt: clocks.anonymizeEligibleAt,
  };
}

export function userErasureCancelledData() {
  return {
    isActive: true as const,
    accountStatus: "active" as AccountStatus,
    deletionRequestedAt: null,
    deletionCancelUntil: null,
    anonymizeEligibleAt: null,
  };
}

export function accountStatusForAnonymized(): AccountStatus {
  return "anonymized";
}

export function accountStatusForClosed(): AccountStatus {
  return "closed";
}

export function userAccessRestoredData() {
  return {
    isActive: true as const,
    accountStatus: "active" as AccountStatus,
  };
}

export type ErasureLifecycleState =
  | "ACTIVE"
  | "DEACTIVATED"
  | "ERASURE_REQUESTED"
  | "ERASURE_CANCELLATION_WINDOW"
  | "ERASURE_ELIGIBLE"
  | "ANONYMIZED"
  | "LEGAL_HOLD";

export function resolveDeletionCancelUntil(user: {
  deletionRequestedAt: Date | null;
  deletionCancelUntil: Date | null;
}): Date | null {
  if (user.deletionCancelUntil) return user.deletionCancelUntil;
  if (user.deletionRequestedAt) return addUtcDays(user.deletionRequestedAt, DELETION_CANCELLATION_DAYS);
  return null;
}

export function resolveAnonymizeEligibleAt(user: {
  deletionRequestedAt: Date | null;
  anonymizeEligibleAt: Date | null;
}): Date | null {
  if (user.anonymizeEligibleAt) return user.anonymizeEligibleAt;
  if (user.deletionRequestedAt) return addUtcDays(user.deletionRequestedAt, ACCOUNT_ERASURE_GRACE_DAYS);
  return null;
}

export function deriveErasureLifecycleState(
  user: {
    accountStatus: AccountStatus | string;
    anonymizedAt: Date | null;
    legalHold: boolean;
    legalHoldCategories: string[];
    deletionRequestedAt: Date | null;
    deletionCancelUntil: Date | null;
    anonymizeEligibleAt: Date | null;
  },
  now = new Date(),
): ErasureLifecycleState {
  if (user.accountStatus === "anonymized" || user.accountStatus === "closed" || user.anonymizedAt) {
    return "ANONYMIZED";
  }
  const cats = (user.legalHoldCategories ?? []).map((c) => c.trim().toLowerCase());
  const profileHeld = user.legalHold && (cats.length === 0 || cats.includes("profile"));
  if (user.accountStatus === "erasure_pending" && profileHeld) {
    return "LEGAL_HOLD";
  }
  if (user.accountStatus === "erasure_pending") {
    const cancelUntil = resolveDeletionCancelUntil(user);
    const eligibleAt = resolveAnonymizeEligibleAt(user);
    if (cancelUntil && now.getTime() < cancelUntil.getTime()) {
      return "ERASURE_CANCELLATION_WINDOW";
    }
    if (eligibleAt && now.getTime() >= eligibleAt.getTime()) {
      return "ERASURE_ELIGIBLE";
    }
    return "ERASURE_REQUESTED";
  }
  if (user.accountStatus === "active") return "ACTIVE";
  return "DEACTIVATED";
}
