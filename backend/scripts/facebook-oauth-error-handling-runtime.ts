/**
 * Facebook OAuth redirect error-handling regression (state + redirect mapping).
 * Run: npm run test:facebook-oauth-error-handling
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "../src/prisma.js";
import {
  consumeFacebookOAuthState,
  createFacebookOAuthState,
  FacebookOAuthStateError,
  hashFacebookOAuthStateIdForLog,
  logFacebookOAuthStateRejection,
  resolveFacebookOAuthStateCompleteError,
} from "../src/services/oauth/facebookOAuthRedirect.service.js";
import { resolveFacebookOAuthAuthCompleteError } from "../src/lib/facebookOAuthRedirectCompleteErrors.js";
import * as oauthAuthService from "../src/services/oauthAuth.service.js";
import { FACEBOOK_OAUTH_LOG_PREFIX } from "../src/services/oauth/facebookOAuthDiagnostic.js";

const results: string[] = [];
function pass(msg: string) {
  results.push(`PASS: ${msg}`);
  console.log(`✓ ${msg}`);
}
function fail(msg: string) {
  results.push(`FAIL: ${msg}`);
  console.error(`✗ ${msg}`);
}

function expectStateError(fn: () => Promise<unknown>, code: FacebookOAuthStateError["code"]) {
  return fn().then(
    () => {
      fail(`Expected FacebookOAuthStateError(${code})`);
    },
    (e) => {
      if (e instanceof FacebookOAuthStateError && e.code === code) {
        pass(`FacebookOAuthStateError reason=${code}`);
      } else {
        fail(`Unexpected error for ${code}: ${e instanceof Error ? e.name : String(e)}`);
      }
    },
  );
}

async function main() {
  assert.equal(resolveFacebookOAuthStateCompleteError("consumed"), "already_processed");
  assert.equal(resolveFacebookOAuthStateCompleteError("missing"), "state_invalid");
  assert.equal(resolveFacebookOAuthStateCompleteError("expired"), "state_invalid");
  assert.equal(resolveFacebookOAuthStateCompleteError("invalid"), "state_invalid");
  pass("resolveFacebookOAuthStateCompleteError mapping");

  const rawState = "super-secret-oauth-state-value-for-log-test";
  const hash = hashFacebookOAuthStateIdForLog(rawState);
  assert.equal(hash.length, 8);
  assert.equal(hash, createHash("sha256").update(rawState, "utf8").digest("hex").slice(0, 8));
  const logs: string[] = [];
  const prevInfo = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    logFacebookOAuthStateRejection(rawState, "consumed", "fb_web_test_corr");
  } finally {
    console.info = prevInfo;
  }
  const joined = logs.join("\n");
  assert.ok(joined.includes(FACEBOOK_OAUTH_LOG_PREFIX));
  assert.ok(joined.includes("facebook_oauth_state_failed"));
  assert.ok(joined.includes('"reason":"consumed"'));
  assert.ok(joined.includes('"stateIdHash":"' + hash + '"'));
  assert.ok(!joined.includes(rawState));
  pass("logFacebookOAuthStateRejection never logs raw state");

  const existsErr = new oauthAuthService.OAuthAccountExistsError();
  assert.ok(existsErr instanceof oauthAuthService.OAuthSignInFailedError);
  assert.equal(resolveFacebookOAuthAuthCompleteError(existsErr), "account_exists");
  assert.equal(
    resolveFacebookOAuthAuthCompleteError(new oauthAuthService.OAuthSignInFailedError()),
    "sign_in_failed",
  );
  assert.equal(
    resolveFacebookOAuthAuthCompleteError(new oauthAuthService.OAuthEmailRequiredError()),
    "email_required",
  );
  pass("resolveFacebookOAuthAuthCompleteError mapping");

  const tag = `fb-oauth-err-${Date.now()}`;
  const correlationId = `fb_web_${tag}`;
  let stateId: string | null = null;

  try {
    const created = await createFacebookOAuthState({
      payload: {
        version: 1,
        flow: "signup",
        correlationId,
        isLogin: false,
        intendedRole: "MANAGER",
        returnPath: "/signup",
      },
    });
    stateId = created.stateId;
    await consumeFacebookOAuthState(stateId);
    pass("first state consume succeeds");
    await expectStateError(() => consumeFacebookOAuthState(stateId!), "consumed");

    await expectStateError(() => consumeFacebookOAuthState(`missing-${tag}`), "missing");

    const expired = await createFacebookOAuthState({
      payload: {
        version: 1,
        flow: "signup",
        correlationId: `${correlationId}-exp`,
        isLogin: false,
        intendedRole: "MANAGER",
        returnPath: "/signup",
      },
    });
    await prisma.facebookOAuthState.update({
      where: { id: expired.stateId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expectStateError(() => consumeFacebookOAuthState(expired.stateId), "expired");

    await expectStateError(() => consumeFacebookOAuthState(""), "invalid");

    const dupEmail = `${tag}-exists@caretip-test.local`;
    let dupUserId: string | null = null;
    dupUserId = (
      await prisma.user.create({
        data: {
          email: dupEmail,
          passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
          role: "MANAGER",
          emailVerified: true,
          business: { create: { name: `${tag} venue`, slug: `${tag}-slug` } },
        },
      })
    ).id;
    const beforeUsers = await prisma.user.count({ where: { email: dupEmail } });
    const beforeOAuth = await prisma.oAuthAccount.count({ where: { emailAtLink: dupEmail } });
    try {
      await oauthAuthService.authenticateWithOAuth(
        "facebook",
        { idToken: "invalid-token", isLogin: false, intendedRole: "MANAGER" },
        { facebookDiagnosticId: correlationId },
      );
      fail("authenticateWithOAuth should reject invalid token before signup writes");
    } catch (e) {
      if (e instanceof oauthAuthService.OAuthAccountExistsError) {
        fail("Should not reach email check with invalid token");
      } else {
        pass("signup with invalid token fails before persistence (no duplicate user/oauth)");
      }
    }
    const afterUsers = await prisma.user.count({ where: { email: dupEmail } });
    const afterOAuth = await prisma.oAuthAccount.count({ where: { emailAtLink: dupEmail } });
    assert.equal(beforeUsers, afterUsers);
    assert.equal(beforeOAuth, afterOAuth);
    pass("existing email fixture unchanged without successful OAuth verify");

    if (dupUserId) {
      await prisma.business.deleteMany({ where: { userId: dupUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: dupUserId } }).catch(() => {});
    }
  } finally {
    if (stateId) {
      await prisma.facebookOAuthState.delete({ where: { id: stateId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => r.startsWith("FAIL"));
  if (failed.length) {
    console.error(`\n${failed.length} failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll ${results.filter((r) => r.startsWith("PASS")).length} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
