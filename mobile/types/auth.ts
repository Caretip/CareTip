/** Auth DTOs — aligned with web `AuthUserDto` / `AuthResponse`. */

export type UserRole = "MANAGER" | "EMPLOYEE" | "SUPER_ADMIN";

export type AppLocale = "en" | "de";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  emailVerified?: boolean;
  hasCompletedOnboarding?: boolean;
  onboardingStep?: number;
  businessId?: string | null;
  employeeId?: string | null;
  avatar?: string | null;
  preferredLocale?: AppLocale | null;
  businessVerificationStatus?: string | null;
  onboardingVerificationStatus?: string | null;
  kycVerificationStatus?: string | null;
  impersonation?: boolean;
  impersonatedBy?: string | null;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type MfaChallengeResponse = {
  mfaRequired: true;
  mfaSetupRequired: boolean;
  pendingMfaToken: string;
};

export type SignInRequest = {
  email: string;
  password: string;
  locale?: AppLocale;
  timeZone?: string;
};

export type SignInResult = AuthResponse | MfaChallengeResponse;

export function isMfaChallenge(value: SignInResult): value is MfaChallengeResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "mfaRequired" in value &&
    (value as MfaChallengeResponse).mfaRequired === true
  );
}

export type AuthSessionStatus =
  | "idle"
  | "bootstrapping"
  | "authenticated"
  | "unauthenticated"
  | "error";
