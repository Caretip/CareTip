/**
 * Security hardening regression — memory token contract, MFA login gate, headers.
 * Run: npm run test:security-hardening (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { isExpiredAccessTokenRefreshAllowed } from "../src/lib/accessTokenRefresh.js";
import {
  isPlatformAdminAccount,
  needsMfaLoginChallenge,
  mfaSetupRequiredForLogin,
  signPendingMfaLoginToken,
  userIdFromPendingMfaLoginToken,
  isPendingMfaLoginJwt,
  verifyTotpCode,
} from "../src/services/mfaLogin.service.js";
import * as authService from "../src/services/auth.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function main() {
  if (process.env.NODE_ENV === "production" && isExpiredAccessTokenRefreshAllowed()) {
    fail("expired access token refresh must be disabled in production by default");
  } else {
    pass("expired access token refresh gated for production");
  }

  if (!isPlatformAdminAccount({ role: "SUPER_ADMIN", isPlatformAdmin: true })) {
    fail("platform admin detector");
  } else {
    pass("platform admin detector");
  }

  if (isPlatformAdminAccount({ role: "MANAGER", isPlatformAdmin: false })) {
    fail("manager must not be platform admin");
  } else {
    pass("manager excluded from platform admin MFA gate");
  }

  const token = signPendingMfaLoginToken("user-test-123");
  const uid = userIdFromPendingMfaLoginToken(token);
  if (uid !== "user-test-123") {
    fail("pending MFA token round-trip");
  } else {
    pass("pending MFA token round-trip");
  }

  const secret = "JBSWY3DPEHPK3PXP";
  if (!verifyTotpCode(secret, "000000")) {
    pass("TOTP rejects invalid code");
  } else {
    fail("TOTP should reject invalid code");
  }

  if (needsMfaLoginChallenge({ role: "MANAGER", isPlatformAdmin: false, twoFactorEnabled: true })) {
    pass("manager with 2FA enabled requires login challenge");
  } else {
    fail("manager with 2FA enabled must require login challenge");
  }

  if (needsMfaLoginChallenge({ role: "MANAGER", isPlatformAdmin: false, twoFactorEnabled: false })) {
    fail("manager without 2FA must not require login challenge");
  } else {
    pass("manager without 2FA skips login challenge");
  }

  if (needsMfaLoginChallenge({ role: "EMPLOYEE", isPlatformAdmin: false, twoFactorEnabled: false })) {
    fail("employee without 2FA must not require login challenge");
  } else {
    pass("employee without 2FA skips login challenge");
  }

  if (!needsMfaLoginChallenge({ role: "SUPER_ADMIN", isPlatformAdmin: true, twoFactorEnabled: false })) {
    fail("platform admin without 2FA must still challenge (setup)");
  } else {
    pass("platform admin always challenges at login");
  }

  if (mfaSetupRequiredForLogin({ role: "MANAGER", isPlatformAdmin: false, twoFactorEnabled: true })) {
    fail("business 2FA login must not force authenticator setup at sign-in");
  } else {
    pass("business 2FA login is verify-only after enrollment");
  }

  const pendingDecoded = { purpose: "mfa_login_pending" as const };
  if (!isPendingMfaLoginJwt(pendingDecoded)) {
    fail("pending MFA JWT detector");
  } else {
    pass("pending MFA JWT is not treated as an access token purpose");
  }

  if (typeof authService.validateLoginCredentials !== "function") {
    fail("validateLoginCredentials export missing");
  } else {
    pass("validateLoginCredentials exported for MFA login split");
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
