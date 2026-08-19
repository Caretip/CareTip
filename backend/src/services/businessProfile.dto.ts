import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";
import { sanitizeIanaTimezone } from "../utils/businessTime.js";
import type {
  BusinessSubscriptionTier,
  KycVerificationStatus,
  OnboardingVerificationStatus,
  SubscriptionPlanKey,
} from "@prisma/client";
import { getSponsoredProgrammeDefinition } from "../config/sponsoredAccess.config.js";
import type { SubscriptionEntitlementState } from "./subscriptionEntitlement.service.js";
import {
  toPublicGuestBrandingDto,
  type PublicGuestBrandingDto,
} from "./businessBranding.dto.js";

/** Fields safe for unauthenticated tipping / QR landing consumers. */
export type PublicBusinessProfileDto = {
  businessId: string;
  businessName: string;
  slug: string;
  logo: string | null;
  coverImage: string | null;
  publicLocation: string | null;
  description: string | null;
  /** Legacy aliases used by the SPA tipping flow. */
  id: string;
  name: string;
  location: string | null;
  type: string | null;
  /** Guest-facing premium branding (tier-resolved server-side). */
  branding: PublicGuestBrandingDto;
};

/** Manager-authenticated profile (includes operational fields). */
export type ManagerBusinessProfileDto = PublicBusinessProfileDto & {
  /** IANA venue timezone for dashboard / Activity Center calendar labels. */
  timezone: string;
  onboardingVerificationStatus: OnboardingVerificationStatus;
  kycVerificationStatus: KycVerificationStatus;
  /** Mirrored tier when entitled; null when status is none. */
  subscriptionTier: BusinessSubscriptionTier | null;
  /** Authoritative lifecycle from entitlement resolver. */
  subscriptionStatus: SubscriptionEntitlementState["status"];
  plan: SubscriptionPlanKey | null;
  hasActiveSubscription: boolean;
  /** Resolved capability keys — same source as backend enforcement. */
  capabilities: SubscriptionEntitlementState["capabilities"];
  limits: SubscriptionEntitlementState["limits"];
  accessSource: SubscriptionEntitlementState["accessSource"];
  sponsoredProgrammeKey: string | null;
  sponsoredProgrammeLabelKey: string | null;
  employeeCount: number;
  contactPhone: string | null;
  legalContactName: string | null;
  contactEmail: string | null;
  registeredAddress: string | null;
  website: string | null;
};

type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  businessType: string | null;
  location: string | null;
  registeredAddress: string | null;
  timezone?: string | null;
  onboardingVerificationStatus: OnboardingVerificationStatus;
  kycVerificationStatus: KycVerificationStatus;
  subscriptionTier: BusinessSubscriptionTier | null;
  contactPhone: string | null;
  legalContactName: string | null;
  contactEmail: string | null;
  website: string | null;
  logoPath: string | null;
  bannerImagePath: string | null;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
  welcomeMessage: string | null;
  thankYouMessage: string | null;
  brandDisplayName: string | null;
  brandTagline: string | null;
  qrTemplate: string;
  qrBorderStyle: string;
  qrShape: string;
  qrAccentColor: string | null;
  qrBackgroundColor: string | null;
};

export function toPublicBusinessProfileDto(
  business: BusinessRow,
  effectiveTier?: BusinessSubscriptionTier | null,
  opts?: { employeeCount?: never },
): PublicBusinessProfileDto {
  void opts;
  const logo = absolutizePublicMediaPath(business.logoPath ?? null);
  const publicLocation = business.location ?? null;
  const branding = toPublicGuestBrandingDto(business, effectiveTier);
  return {
    businessId: business.id,
    businessName: business.name,
    slug: business.slug,
    logo,
    coverImage: branding.bannerImagePath,
    publicLocation,
    description: business.businessType ?? null,
    id: business.id,
    name: business.name,
    location: publicLocation,
    type: business.businessType ?? null,
    branding,
  };
}

export function toManagerBusinessProfileDto(
  business: BusinessRow,
  employeeCount: number,
  entitlements: SubscriptionEntitlementState,
): ManagerBusinessProfileDto {
  const sponsoredDef =
    entitlements.accessSource === "sponsored" && entitlements.sponsoredProgrammeKey
      ? getSponsoredProgrammeDefinition(entitlements.sponsoredProgrammeKey)
      : null;
  return {
    ...toPublicBusinessProfileDto(business, entitlements.subscriptionTier),
    timezone: sanitizeIanaTimezone(business.timezone),
    onboardingVerificationStatus: business.onboardingVerificationStatus,
    kycVerificationStatus: business.kycVerificationStatus,
    subscriptionTier: entitlements.subscriptionTier,
    subscriptionStatus: entitlements.status,
    plan: entitlements.plan,
    hasActiveSubscription: entitlements.hasActiveEntitlements,
    capabilities: entitlements.capabilities,
    limits: entitlements.limits,
    accessSource: entitlements.accessSource,
    sponsoredProgrammeKey: entitlements.sponsoredProgrammeKey,
    sponsoredProgrammeLabelKey: sponsoredDef?.labelKey ?? null,
    employeeCount,
    contactPhone: business.contactPhone ?? null,
    legalContactName: business.legalContactName ?? null,
    contactEmail: business.contactEmail ?? null,
    registeredAddress: business.registeredAddress ?? null,
    website: business.website ?? null,
  };
}

/** Sensitive keys that must never appear on the public business-by-id API. */
export const MANAGER_ONLY_BUSINESS_FIELDS = [
  "timezone",
  "onboardingVerificationStatus",
  "kycVerificationStatus",
  "subscriptionTier",
  "subscriptionStatus",
  "plan",
  "hasActiveSubscription",
  "capabilities",
  "limits",
  "accessSource",
  "sponsoredProgrammeKey",
  "sponsoredProgrammeLabelKey",
  "employeeCount",
  "contactPhone",
  "legalContactName",
  "contactEmail",
  "registeredAddress",
  "website",
] as const;

export function publicDtoHasSensitiveFields(dto: Record<string, unknown>): boolean {
  return MANAGER_ONLY_BUSINESS_FIELDS.some((k) => dto[k] !== undefined);
}
