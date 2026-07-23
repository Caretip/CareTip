import type { OnboardingVerificationStatus } from "./api";
import type { BusinessAccountStatus } from "../hooks/useAuth";
import { isKycRequiredForReceiveTips } from "./mvpVerificationPolicy";

export type BusinessVerificationUiStatus =
  | BusinessAccountStatus
  | "pending"
  | "verified"
  | "rejected"
  | null
  | undefined;

export type BusinessVerificationCapabilityFlags = {
  canAccessSetupFeatures: boolean;
  canGenerateQrCodes: boolean;
  canActivateTipping: boolean;
  canReceiveTips: boolean;
};

function normalizeKycStatus(
  status: BusinessVerificationUiStatus,
): "pending" | "verified" | "rejected" | null {
  if (status === "APPROVED" || status === "verified") return "verified";
  if (status === "REJECTED" || status === "rejected") return "rejected";
  if (status === "PENDING" || status === "pending") return "pending";
  return null;
}

/** Platform onboarding approval — gates QR generation and public venue exposure. */
export function isOnboardingApprovedForPublicGoLive(
  status: OnboardingVerificationStatus | null | undefined,
): boolean {
  return status == null || status === "approved";
}

/** Mirrors backend `resolveBusinessVerificationCapabilities` for UI gating. */
export function resolveBusinessVerificationCapabilities(
  kycStatus: BusinessVerificationUiStatus,
  opts?: {
    impersonating?: boolean;
    onboardingVerificationStatus?: OnboardingVerificationStatus | null;
  },
): BusinessVerificationCapabilityFlags {
  if (opts?.impersonating) {
    return {
      canAccessSetupFeatures: true,
      canGenerateQrCodes: true,
      canActivateTipping: true,
      canReceiveTips: true,
    };
  }

  const onboardingApproved = isOnboardingApprovedForPublicGoLive(opts?.onboardingVerificationStatus);
  const normalized = normalizeKycStatus(kycStatus);
  const kycVerified = normalized === "verified";
  const canReceiveTips = isKycRequiredForReceiveTips() ? kycVerified : onboardingApproved;

  return {
    canAccessSetupFeatures: normalized != null && normalized !== "rejected",
    canGenerateQrCodes: onboardingApproved,
    canActivateTipping: onboardingApproved,
    canReceiveTips,
  };
}

export function canUseProductionQr(
  onboardingStatus: OnboardingVerificationStatus | null | undefined,
  impersonating?: boolean,
): boolean {
  if (impersonating) return true;
  return isOnboardingApprovedForPublicGoLive(onboardingStatus);
}

export type QrStudioVerificationPhase = "in_review" | "action_required" | "rejected";

/** QR Studio onboarding review empty state. */
export function resolveQrStudioVerificationPhase(
  onboardingStatus: OnboardingVerificationStatus | null | undefined,
): QrStudioVerificationPhase {
  if (onboardingStatus === "rejected") return "rejected";
  if (onboardingStatus === "submitted" || onboardingStatus === "draft") {
    return "in_review";
  }
  return "action_required";
}
