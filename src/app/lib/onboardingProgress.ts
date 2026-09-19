import type { BusinessInfo } from "./api";
import type { OnboardingStep } from "../components/business/BusinessOnboardingProgress";

export type { OnboardingStep };

/** Mirrors backend `inferManagerOnboardingStep`. */
export function inferOnboardingStepFromProfile(profile: {
  name?: string | null;
  type?: string | null;
  registeredAddress?: string | null;
  contactPhone?: string | null;
} | null | undefined): OnboardingStep {
  if (!profile) return 1;
  const nameOk = (profile.name ?? "").trim().length > 1;
  const typeOk = Boolean((profile.type ?? "").trim());
  if (!nameOk || !typeOk) return 1;

  const address = (profile.registeredAddress ?? "").trim();
  if (address.length <= 3) return 2;

  const phone = (profile.contactPhone ?? "").trim();
  if (!phone) return 2;

  return 3;
}

export function resolveResumeOnboardingStep(
  profile: BusinessInfo | null | undefined,
  serverStep?: number | null,
): OnboardingStep {
  const inferred = profile ? inferOnboardingStepFromProfile(profile) : 1;
  const fromApi =
    typeof serverStep === "number" && serverStep >= 1 && serverStep <= 3
      ? (serverStep as OnboardingStep)
      : inferred;
  return Math.max(inferred, fromApi) as OnboardingStep;
}

/** Clear onboarding completion flag alias for guards. */
export function isOnboardingCompleted(user: {
  role?: string;
  hasCompletedOnboarding?: boolean;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.role !== "business") return true;
  return user.hasCompletedOnboarding === true;
}
