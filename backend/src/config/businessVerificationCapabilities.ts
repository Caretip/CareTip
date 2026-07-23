import type { BusinessVerificationStatus, OnboardingVerificationStatus } from "@prisma/client";
import { isKycRequiredForReceiveTips } from "./mvpVerificationPolicy.js";

/** Product capabilities gated by admin review — not dashboard access. */
export type BusinessVerificationCapability =
  | "setup"
  | "qrCodes"
  | "activateTipping"
  | "receiveTips";

export type BusinessVerificationCapabilityFlags = {
  /** Venue setup: staff, locations, tables, profile, dashboard, invites. */
  canAccessSetupFeatures: boolean;
  /** Production QR URLs / slug regeneration for public guest flows. */
  canGenerateQrCodes: boolean;
  /** Public tipping surfaces (QR landing, staff directory) may activate. */
  canActivateTipping: boolean;
  /**
   * Stripe checkout and tip ledger acceptance.
   * Policy A: while MVP KYC is disabled, follows onboarding approval (same as QR / activate tipping).
   * When KYC is re-enabled via MVP flags, requires KYC verified again.
   */
  canReceiveTips: boolean;
};

export const GO_LIVE_REQUIRED_CODE = "GO_LIVE_REQUIRED" as const;
export const GO_LIVE_REQUIRED_MESSAGE =
  "This feature is available after your venue is approved to go live.";

export const ONBOARDING_APPROVAL_REQUIRED_CODE = "ONBOARDING_APPROVAL_REQUIRED" as const;
export const ONBOARDING_APPROVAL_REQUIRED_MESSAGE =
  "Your business verification is still in progress. QR codes can be generated after your onboarding has been approved.";

type ResolveOpts = {
  impersonating?: boolean;
  superAdmin?: boolean;
  /** Platform onboarding review — gates public QR / venue exposure / MVP tip checkout. */
  onboardingVerificationStatus?: OnboardingVerificationStatus | null;
};

/** Admin-approved onboarding (or legacy rows without a status column value). */
export function isOnboardingApprovedForPublicGoLive(
  status: OnboardingVerificationStatus | null | undefined,
): boolean {
  return status == null || status === "approved";
}

/**
 * Setup vs go-live capabilities.
 * Dashboard access is not gated here — only public QR exposure and live tipping.
 *
 * Single go-live SSOT while MVP KYC is disabled:
 * QR + activate tipping + receive tips all follow onboarding approval.
 */
export function resolveBusinessVerificationCapabilities(
  kycStatus: BusinessVerificationStatus | null | undefined,
  opts?: ResolveOpts,
): BusinessVerificationCapabilityFlags {
  if (opts?.impersonating || opts?.superAdmin) {
    return {
      canAccessSetupFeatures: true,
      canGenerateQrCodes: true,
      canActivateTipping: true,
      canReceiveTips: true,
    };
  }

  const onboardingApproved = isOnboardingApprovedForPublicGoLive(opts?.onboardingVerificationStatus);
  const kycVerified = kycStatus === "verified";
  const hasBusiness = kycStatus != null;
  const canReceiveTips = isKycRequiredForReceiveTips() ? kycVerified : onboardingApproved;

  return {
    canAccessSetupFeatures: hasBusiness && kycStatus !== "rejected",
    canGenerateQrCodes: onboardingApproved,
    canActivateTipping: onboardingApproved,
    canReceiveTips,
  };
}

export function hasBusinessVerificationCapability(
  kycStatus: BusinessVerificationStatus | null | undefined,
  capability: Exclude<BusinessVerificationCapability, "setup">,
  opts?: ResolveOpts,
): boolean {
  const flags = resolveBusinessVerificationCapabilities(kycStatus, opts);
  switch (capability) {
    case "qrCodes":
      return flags.canGenerateQrCodes;
    case "activateTipping":
      return flags.canActivateTipping;
    case "receiveTips":
      return flags.canReceiveTips;
    default:
      return false;
  }
}
