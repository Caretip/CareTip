/**
 * Auth / onboarding UX: back targets, session copy, invite errors.
 *
 *   npx tsx scripts/auth-onboarding-ux-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatOnboardingError,
  formatUserFacingError,
  isAuthenticationError,
  isBusinessNotFoundError,
} from "../utils/userFacingError";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

const t = (key: string) => key;

function axiosLike(status: number, message: string, code?: string) {
  return {
    response: {
      status,
      data: { message, code },
    },
    message: `Request failed with status code ${status}`,
  };
}

function runSource(): void {
  const onboarding = read("features/auth/BusinessOnboardingScreen.tsx");
  assert.match(onboarding, /BackHandler\.addEventListener/);
  assert.match(onboarding, /hardwareBackPress/);
  assert.match(onboarding, /formatOnboardingError/);
  assert.match(onboarding, /auth\.onboardingDetailsSaved/);
  assert.match(onboarding, /auth\.onboardingReady/);
  assert.match(onboarding, /auth\.backToSignIn/);
  assert.match(onboarding, /inFlightRef/);
  assert.doesNotMatch(onboarding, /\/\* profile may not exist yet \*\//);

  const layout = read("app/(auth)/_layout.tsx");
  assert.match(layout, /currentRoute === "onboarding"/);
  assert.match(layout, /gestureEnabled:\s*false/);
  assert.match(layout, /Redirect href=\{\"\/\(auth\)\/login\"\}/);

  const accept = read("features/auth/AcceptInviteScreen.tsx");
  assert.match(accept, /\/\(auth\)\/join/);
  assert.doesNotMatch(accept, /router\.replace\("\/\(auth\)\/login"\)/);

  const forgot = read("features/auth/ForgotPasswordScreen.tsx");
  assert.match(forgot, /router\.canGoBack\(\)/);

  const register = read("features/auth/RegisterScreen.tsx");
  assert.match(register, /disabled=\{busy\}/);

  const join = read("features/auth/JoinScreen.tsx");
  assert.match(join, /disabled=\{isSubmitting\}/);

  const expiry = read("components/providers/SessionExpiryBridge.tsx");
  assert.match(expiry, /showErrorToast/);
  assert.match(expiry, /errors\.unauthorized/);
  assert.match(expiry, /sessionManager\.signOut/);
}

function runErrors(): void {
  const invite = axiosLike(400, "Invalid or expired invite code");
  assert.equal(formatUserFacingError(invite, "fallback", t), "auth.inviteInvalid");
  assert.doesNotMatch(formatUserFacingError(invite, "fallback", t), /400/);
  assert.doesNotMatch(formatUserFacingError(invite, "fallback", t), /Request failed/i);

  const session = axiosLike(401, "Authentication required", "AUTH_REQUIRED");
  assert.equal(isAuthenticationError(session), true);
  assert.equal(formatOnboardingError(session, t), "auth.onboardingSessionExpired");
  assert.equal(formatUserFacingError(session, "fallback", t), "errors.unauthorized");

  const missing = axiosLike(404, "Business not found", "BUSINESS_NOT_FOUND");
  assert.equal(isBusinessNotFoundError(missing), true);
  assert.equal(formatOnboardingError(missing, t), "auth.onboardingBusinessUnavailable");
  assert.equal(formatUserFacingError(missing, "fallback", t), "errors.notFound");

  const offline = {
    message: "Network Error",
    code: "ERR_NETWORK",
  };
  assert.equal(formatOnboardingError(offline, t), "errors.offline");
  assert.doesNotMatch(formatOnboardingError(offline, t), /Network Error/i);

  const prisma = new Error("prisma unique constraint");
  assert.equal(formatOnboardingError(prisma, t), "auth.onboardingSaveFailed");
  assert.doesNotMatch(formatOnboardingError(prisma, t), /prisma/i);

  const registered = axiosLike(400, "Email already registered");
  assert.equal(formatUserFacingError(registered, "fallback", t), "auth.registerFailed");
}

function main(): void {
  runSource();
  runErrors();
  console.log("auth-onboarding-ux-runtime: OK");
}

main();
