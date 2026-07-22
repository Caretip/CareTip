/**
 * Normalize cached auth user JSON so route guards do not trust stale or legacy shapes.
 */

import type { AuthResponse } from "./api";
import { parseUser, type User, type UserRole } from "../hooks/useAuth";

const API_ROLES = new Set(["MANAGER", "EMPLOYEE", "SUPER_ADMIN"]);

function isUiUserRole(role: unknown): role is UserRole {
  return (
    role === "business" ||
    role === "employee" ||
    role === "platform_admin" ||
    role === "admin" ||
    role === "user"
  );
}

/** Re-parse localStorage user payloads (API shape or persisted UI `User`). */
export function normalizeStoredUser(raw: unknown): User | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.id !== "string" || typeof o.email !== "string" || typeof o.role !== "string") {
    return null;
  }

  if (API_ROLES.has(o.role)) {
    return parseUser(o as AuthResponse["user"]);
  }

  if (!isUiUserRole(o.role)) return null;

  const emailVerified =
    typeof o.emailVerified === "boolean"
      ? o.emailVerified
      : typeof o.isVerified === "boolean"
        ? o.isVerified
        : o.role === "platform_admin" || o.role === "admin";

  const hasCompletedOnboarding =
    o.role === "business"
      ? o.hasCompletedOnboarding === true
      : true;

  const onboardingStepRaw = o.onboardingStep;
  const onboardingStep =
    o.role === "business" &&
    typeof onboardingStepRaw === "number" &&
    onboardingStepRaw >= 1 &&
    onboardingStepRaw <= 3
      ? (onboardingStepRaw as 1 | 2 | 3)
      : undefined;

  const onboardingVerificationStatus =
    o.onboardingVerificationStatus === "draft" ||
    o.onboardingVerificationStatus === "submitted" ||
    o.onboardingVerificationStatus === "approved" ||
    o.onboardingVerificationStatus === "rejected"
      ? o.onboardingVerificationStatus
      : undefined;

  const kycVerificationStatus =
    o.kycVerificationStatus === "not_started" ||
    o.kycVerificationStatus === "awaiting_upload" ||
    o.kycVerificationStatus === "pending_review" ||
    o.kycVerificationStatus === "verified" ||
    o.kycVerificationStatus === "rejected"
      ? o.kycVerificationStatus
      : undefined;

  return {
    id: o.id,
    name: typeof o.name === "string" ? o.name : o.email,
    email: o.email,
    role: o.role,
    emailVerified,
    isVerified: emailVerified,
    hasCompletedOnboarding,
    onboardingCompleted: hasCompletedOnboarding,
    onboardingStep,
    businessId: typeof o.businessId === "string" ? o.businessId : undefined,
    employeeId: typeof o.employeeId === "string" ? o.employeeId : undefined,
    businessName:
      typeof o.businessName === "string"
        ? o.businessName
        : o.role === "business" && typeof o.name === "string"
          ? o.name
          : undefined,
    avatar: typeof o.avatar === "string" ? o.avatar : undefined,
    status: o.status as User["status"],
    impersonation: o.impersonation === true,
    impersonatedBy: typeof o.impersonatedBy === "string" ? o.impersonatedBy : undefined,
    preferredLocale: typeof o.preferredLocale === "string" ? o.preferredLocale : null,
    onboardingVerificationStatus,
    kycVerificationStatus,
  };
}
