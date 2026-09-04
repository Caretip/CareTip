/**
 * Business TOTP login enforcement (source + unit contracts).
 * Run: npm run test:business-2fa-login (from backend/)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAllowedAccessJwtType,
} from "../src/lib/jwtConfig.js";
import { userIdFromAccessTokenForRefresh } from "../src/lib/accessTokenRefresh.js";
import {
  needsMfaLoginChallenge,
  mfaSetupRequiredForLogin,
  userIdFromPendingMfaLoginToken,
  signPendingMfaLoginToken,
  isPendingMfaLoginJwt,
  verifyTotpCode,
  parsePendingMfaLoginToken,
  consumeMfaChallengeJti,
  normalizeLoginTotp,
  MFA_LOGIN_PENDING_PURPOSE,
} from "../src/services/mfaLogin.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

async function main() {
  const controller = read("src/controllers/auth.controller.ts");
  const middleware = read("src/middleware/auth.middleware.ts");
  const printWeb = read("../src/app/components/AuthPage.tsx");
  const oauthApi = read("../src/app/lib/api.ts");
  const oauthSvc = read("src/services/oauthAuth.service.ts");
  const authRoutes = read("src/routes/auth.routes.ts");
  const accessRefresh = read("src/lib/accessTokenRefresh.ts");

  if (
    controller.includes("needsMfaLoginChallenge(user)") &&
    controller.includes("loadUserForMfaVerify") &&
    controller.includes("jsonMfaLoginChallenge")
  ) {
    pass("password login challenges any account with 2FA enabled, not only platform admin");
  } else {
    fail("auth.controller password login must use needsMfaLoginChallenge + loadUserForMfaVerify");
  }

  if (controller.includes("needsMfaLoginChallenge(oauthMfaUser)")) {
    pass("OAuth login challenges 2FA-enabled accounts before issuing a refresh session");
  } else {
    fail("OAuth must not issue a full session when 2FA is enabled");
  }

  if (
    controller.includes("loginMfaSetup") &&
    controller.includes("loadPlatformAdminForMfaLogin") &&
    !controller.slice(controller.indexOf("export async function loginMfaSetup"), controller.indexOf("export async function loginMfaEnable")).includes("loadUserForMfaVerify")
  ) {
    pass("login-time authenticator setup remains platform-admin only");
  } else {
    fail("login MFA setup must stay admin-only");
  }

  if (middleware.includes("isPendingMfaLoginJwt")) {
    pass("auth middleware rejects pending MFA JWTs as access tokens");
  } else {
    fail("auth middleware must reject mfa_login_pending tokens");
  }

  if (printWeb.includes("pendingMfaToken") && printWeb.includes("auth.page.mfaSubtitle") && printWeb.includes("handleMfaSubmit")) {
    pass("Business web login shows authenticator step after password/OAuth challenge");
  } else {
    fail("AuthPage desktop MFA step missing");
  }

  if (oauthApi.includes("isMfaLoginChallenge(raw)")) {
    pass("oauthAPI preserves MFA challenge payloads without treating them as sessions");
  } else {
    fail("oauthAPI must detect mfaRequired before parseAuthResponsePayload");
  }

  if (controller.includes("consumeMfaChallengeJti") && controller.includes("MFA_INVALID_CODE")) {
    pass("login MFA consumes challenge jti and returns structured invalid-code errors");
  } else {
    fail("login MFA must consume jti and use MFA_INVALID_CODE");
  }

  if (controller.includes("isOAuthMfaPending") && oauthSvc.includes("mfaPending: true")) {
    pass("OAuth defers session mint until after MFA when 2FA is enabled");
  } else {
    fail("OAuth must return mfaPending without minting an access JWT");
  }

  if (
    oauthSvc.includes("needsMfaLoginChallenge") &&
    oauthSvc.indexOf("needsMfaLoginChallenge") < oauthSvc.indexOf("authResultForUserRecord(sessionUser)")
  ) {
    pass("OAuth login path checks MFA before authResultForUserRecord");
  } else {
    fail("OAuth login must not mint access JWT before MFA check");
  }

  if (authRoutes.includes("mfaLoginChallengeRateLimit") && authRoutes.includes("/2fa/setup")) {
    pass("login MFA and 2FA setup are rate-limited");
  } else {
    fail("MFA rate limits must cover login challenge and setup");
  }

  if (printWeb.includes("classifyMfaVerifyFailure") && printWeb.includes("auth.page.mfaInvalidCode")) {
    pass("AuthPage keeps MFA step and maps invalid TOTP to safe copy");
  } else {
    fail("AuthPage MFA error handling missing");
  }

  if (
    controller.includes("resolveCurrentRefreshSessionId") &&
    controller.includes("revokeOtherRefreshTokensForUser") &&
    controller.includes("sessionRequiredForMfaChange")
  ) {
    pass("enabling 2FA requires an owned current session then revokes other refresh sessions");
  } else {
    fail("MFA enable must identify the current session before revoking others");
  }

  if (
    controller.includes("Two-factor authentication is already enabled.") &&
    controller.includes("needsMfaLoginChallenge(activatedMfa)")
  ) {
    pass("setup cannot silently replace an enrolled authenticator; activation respects MFA");
  } else {
    fail("factor-change and activation MFA gates missing");
  }

  const schema = read("prisma/schema.prisma");
  if (schema.includes("model ConsumedMfaChallenge") && schema.includes("consumed_mfa_challenges")) {
    pass("MFA challenge consume is a unique database row (multi-instance safe)");
  } else {
    fail("distributed jti consume must use a unique ConsumedMfaChallenge record");
  }

  if (!needsMfaLoginChallenge({ role: "MANAGER", isPlatformAdmin: false, twoFactorEnabled: false })) {
    pass("Business without 2FA does not require TOTP");
  } else fail("Business without 2FA must log in normally");

  if (needsMfaLoginChallenge({ role: "MANAGER", isPlatformAdmin: false, twoFactorEnabled: true })) {
    pass("Business with 2FA requires TOTP challenge");
  } else fail("Business with 2FA must require TOTP");

  if (!mfaSetupRequiredForLogin({ role: "MANAGER", isPlatformAdmin: false, twoFactorEnabled: true })) {
    pass("Enabled Business 2FA is verify, not setup-at-login");
  } else fail("Enabled Business 2FA must not require login setup");

  const pending = signPendingMfaLoginToken("biz-user-1");
  const parsed = parsePendingMfaLoginToken(pending);
  if (parsed.ok && parsed.userId === "biz-user-1" && parsed.jti.length > 8) {
    pass("pending MFA token is scoped to the user and carries a jti");
  } else fail("pending MFA token round-trip");

  if (userIdFromPendingMfaLoginToken(pending) === "biz-user-1") {
    pass("pending MFA token user id extractor");
  } else fail("pending MFA token user id extractor");

  if (userIdFromPendingMfaLoginToken("not-a-jwt") == null) {
    pass("invalid pending MFA token is rejected");
  } else fail("invalid challenge token must not resolve a user");

  if (isPendingMfaLoginJwt({ purpose: "mfa_login_pending" }) && isAllowedAccessJwtType(undefined)) {
    pass("pending MFA purpose is distinct from access JWT type");
  } else fail("JWT purpose/type contract");

  if (!isAllowedAccessJwtType(MFA_LOGIN_PENDING_PURPOSE)) {
    pass("pending MFA JWT type is not an allowed access type");
  } else fail("pending MFA type must not pass isAllowedAccessJwtType");

  if (accessRefresh.includes("isPendingMfaLoginJwt") && userIdFromAccessTokenForRefresh(pending) == null) {
    pass("refresh Bearer fallback rejects pending MFA tokens");
  } else fail("pending MFA JWT must not mint a refresh session");

  if (normalizeLoginTotp("12 3456") === "123456" && normalizeLoginTotp("12345") == null && normalizeLoginTotp("abcdef") == null) {
    pass("TOTP input is normalized to exactly six digits");
  } else fail("normalizeLoginTotp contract");

  if (!verifyTotpCode("JBSWY3DPEHPK3PXP", "111111")) {
    pass("invalid TOTP is rejected");
  } else fail("invalid TOTP must be rejected");

  if (parsed.ok) {
    const first = await consumeMfaChallengeJti(parsed.jti);
    const second = await consumeMfaChallengeJti(parsed.jti);
    if (first === "consumed" && second === "already_used") pass("MFA challenge jti cannot be reused");
    else fail(`challenge jti must be single-use after consume (got ${first}, ${second})`);
  } else {
    fail("cannot test jti consume without a valid pending token");
  }

  const concurrentToken = signPendingMfaLoginToken("biz-user-concurrent");
  const concurrentParsed = parsePendingMfaLoginToken(concurrentToken);
  if (concurrentParsed.ok) {
    const raced = await Promise.all([
      consumeMfaChallengeJti(concurrentParsed.jti),
      consumeMfaChallengeJti(concurrentParsed.jti),
    ]);
    const wins = raced.filter((r) => r === "consumed").length;
    const used = raced.filter((r) => r === "already_used").length;
    if (wins === 1 && used === 1) pass("concurrent jti consume allows exactly one winner");
    else fail(`concurrent jti consume must not succeed twice (got ${raced.join(",")})`);
  } else {
    fail("cannot test concurrent jti consume");
  }

  const failed = results.filter((r) => r.startsWith("FAIL:")).length;
  console.log(results.join("\n"));
  console.log(failed === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed === 0 ? 0 : 1);
}

void main();
