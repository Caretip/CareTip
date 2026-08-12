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

export type OAuthProvider = "google" | "apple" | "facebook";

export type OAuthRequest = {
  provider?: OAuthProvider;
  idToken: string;
  isLogin: boolean;
  intendedRole?: UserRole;
  name?: string;
  inviteCode?: string;
  locale?: AppLocale;
  timeZone?: string;
};

export type LinkedOAuthAccount = {
  provider: OAuthProvider;
  emailAtLink: string | null;
  linkedAt: string;
};

export type LinkedOAuthAccountsResponse = {
  providers: LinkedOAuthAccount[];
  hasPassword: boolean;
};

export type LinkOAuthResult = {
  provider: OAuthProvider;
  linked: true;
};

export type UnlinkOAuthResult = {
  provider: OAuthProvider;
  unlinked: true;
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
  /** Local secrets exist but backend has not validated the session (offline / timeout). */
  | "session_recovery"
  | "error";

export type RegisterRole = "business" | "employee";

export type RegisterRequest = {
  email: string;
  password: string;
  name?: string;
  role: RegisterRole;
  inviteCode?: string;
  locale?: AppLocale;
};

export type RegisterPendingResponse = {
  requiresEmailVerification: true;
  email: string;
  role: RegisterRole;
  user?: AuthUser;
};

export type MessageResponse = {
  ok: boolean;
  message: string;
};

export type InviteValidation = {
  /** Backend contract: `{ ok: true | false }` from GET /api/business/invite/validate */
  ok: boolean;
  businessName?: string;
  businessId?: string;
  businessSlug?: string;
  businessLocation?: string | null;
  message?: string;
};
