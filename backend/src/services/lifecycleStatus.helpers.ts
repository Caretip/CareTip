import type { AccountStatus, BusinessLifecycle } from "@prisma/client";

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
export function userAccessRevokedData(now = new Date()) {
  return {
    isActive: false as const,
    accountStatus: accountStatusForDeactivate(),
    // do not clear deletionRequestedAt if already set
  };
}

export function userErasurePendingData(now = new Date()) {
  return {
    isActive: false as const,
    accountStatus: accountStatusForErasurePending(),
    deletionRequestedAt: now,
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
