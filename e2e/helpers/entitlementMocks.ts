/** Premium-tier profile shapes so dashboard e2e can exercise advanced analytics fetches. */

export const PREMIUM_BUSINESS_PROFILE = {
  id: "e2e-biz-row",
  name: "E2E Business",
  logo: null,
  verificationStatus: "verified" as const,
  subscriptionTier: "premium" as const,
  hasActiveSubscription: true,
  accessSource: "subscription" as const,
  subscriptionStatus: "active" as const,
};

export const PREMIUM_EMPLOYEE_PROFILE = {
  id: "e2e-emp-row",
  name: "E2E Staff",
  slug: "e2e-staff",
  businessSlug: "e2e-venue",
  businessName: "E2E Venue",
  businessLogo: null,
  avatar: null,
  emailVerified: true,
  subscriptionTier: "premium" as const,
  hasActiveSubscription: true,
  accessSource: "subscription" as const,
  subscriptionStatus: "active" as const,
};
