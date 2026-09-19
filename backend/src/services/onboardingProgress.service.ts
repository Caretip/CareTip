/**
 * Onboarding progress is derived from saved business profile fields.
 * Completion (`hasCompletedOnboarding`) is set only when the manager explicitly finishes step 3.
 */

export type OnboardingStep = 1 | 2 | 3;

export type BusinessProfileForOnboarding = {
  name: string;
  businessType?: string | null;
  registeredAddress?: string | null;
  /** E.164 contact phone — required before finishing new onboarding. */
  contactPhone?: string | null;
};

export function inferManagerOnboardingStep(
  business: BusinessProfileForOnboarding | null | undefined,
): OnboardingStep {
  if (!business) return 1;
  const nameOk = business.name.trim().length > 1;
  const typeOk = Boolean(business.businessType?.trim());
  if (!nameOk || !typeOk) return 1;

  const address = business.registeredAddress?.trim() ?? "";
  if (address.length <= 3) return 2;

  const phone = business.contactPhone?.trim() ?? "";
  if (!phone) return 2;

  return 3;
}

export function managerProfileReadyToFinish(business: BusinessProfileForOnboarding | null | undefined): boolean {
  return inferManagerOnboardingStep(business) >= 3;
}

/** Profile no longer satisfies step 3 — user should not keep a completion flag from legacy auto-sync. */
export function managerProfileIncompleteForCompletedFlag(
  business: BusinessProfileForOnboarding | null | undefined,
): boolean {
  return inferManagerOnboardingStep(business) < 3;
}
