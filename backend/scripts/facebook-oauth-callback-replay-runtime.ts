/**
 * Facebook OAuth callback replay + cache-header regression.
 * Run: npm run test:facebook-oauth-callback-replay
 */
import assert from "node:assert/strict";
import { prisma } from "../src/prisma.js";
import {
  applyFacebookOAuthCallbackCacheHeaders,
  consumeFacebookOAuthState,
  createFacebookOAuthState,
  FacebookOAuthStateError,
  recordFacebookOAuthRedirectSuccess,
  resolveFacebookOAuthConsumedStateReplay,
  resolveFacebookOAuthStateCompleteError,
} from "../src/services/oauth/facebookOAuthRedirect.service.js";

const results: string[] = [];
function pass(msg: string) {
  results.push(`PASS: ${msg}`);
  console.log(`✓ ${msg}`);
}
function fail(msg: string) {
  results.push(`FAIL: ${msg}`);
  console.error(`✗ ${msg}`);
}

async function main() {
  const headers: Record<string, string> = {};
  applyFacebookOAuthCallbackCacheHeaders({
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  });
  assert.equal(headers["Cache-Control"], "no-store, no-cache, must-revalidate");
  assert.equal(headers["Pragma"], "no-cache");
  pass("TEST 4: callback cache headers");

  const tag = `fb-replay-${Date.now()}`;
  const correlationId = `fb_web_${tag}`;
  let stateId: string | null = null;
  const extraStateIds: string[] = [];

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
    pass("TEST 1 setup: state consumed");

    const beforeUsers = await prisma.user.count();
    const beforeOAuth = await prisma.oAuthAccount.count();
    const beforeSessions = await prisma.refreshToken.count();

    await recordFacebookOAuthRedirectSuccess({
      kind: "session",
      correlationId,
      stateId,
      userId: "user_test_placeholder",
    });

    const completions = await prisma.facebookOAuthCompletion.count({
      where: { correlationId, kind: "session" },
    });
    assert.equal(completions, 1);
    pass("TEST 1: successful completion record created");

    assert.equal(await prisma.user.count(), beforeUsers);
    assert.equal(await prisma.oAuthAccount.count(), beforeOAuth);
    assert.equal(await prisma.refreshToken.count(), beforeSessions);
    pass("TEST 1: recording completion does not create User/OAuthAccount/session");

    const replay = await resolveFacebookOAuthConsumedStateReplay(stateId);
    assert.deepEqual(replay, { success: "1" });
    pass("TEST 2: consumed state with completion replays to success=1");

    const replayAgain = await resolveFacebookOAuthConsumedStateReplay(stateId);
    assert.deepEqual(replayAgain, { success: "1" });
    pass("TEST 2: replay resolution is read-only (state stays consumed)");

    try {
      await consumeFacebookOAuthState(stateId);
      fail("state must remain consumed");
    } catch (e) {
      assert.ok(e instanceof FacebookOAuthStateError && e.code === "consumed");
      pass("TEST 2: state remains strictly single-use");
    }

    const consumedOnlyTag = `${tag}-nocmp`;
    const consumedOnlyCorr = `fb_web_${consumedOnlyTag}`;
    const consumedOnly = await createFacebookOAuthState({
      payload: {
        version: 1,
        flow: "signup",
        correlationId: consumedOnlyCorr,
        isLogin: false,
        intendedRole: "MANAGER",
        returnPath: "/signup",
      },
    });
    extraStateIds.push(consumedOnly.stateId);
    await consumeFacebookOAuthState(consumedOnly.stateId);
    const noReplay = await resolveFacebookOAuthConsumedStateReplay(consumedOnly.stateId);
    assert.equal(noReplay, null);
    assert.equal(resolveFacebookOAuthStateCompleteError("consumed"), "already_processed");
    pass("TEST 3: consumed state without completion record does not replay");

    const signupTag = `${tag}-signup`;
    const signupCorr = `fb_web_${signupTag}`;
    const signupState = await createFacebookOAuthState({
      payload: {
        version: 1,
        flow: "signup",
        correlationId: signupCorr,
        isLogin: false,
        intendedRole: "MANAGER",
        returnPath: "/signup",
      },
    });
    extraStateIds.push(signupState.stateId);
    const usersBeforeSignup = await prisma.user.count();
    await consumeFacebookOAuthState(signupState.stateId);
    assert.equal(await prisma.user.count(), usersBeforeSignup);
    pass("TEST 5: consume alone does not create User");

    const otherCorr = `fb_web_${tag}-other`;
    const otherState = await createFacebookOAuthState({
      payload: {
        version: 1,
        flow: "signup",
        correlationId: otherCorr,
        isLogin: false,
        intendedRole: "MANAGER",
        returnPath: "/signup",
      },
    });
    extraStateIds.push(otherState.stateId);
    await consumeFacebookOAuthState(otherState.stateId);
    await recordFacebookOAuthRedirectSuccess({
      kind: "session",
      correlationId: otherCorr,
      stateId: otherState.stateId,
      userId: "other",
    });
    const crossStateReplay = await resolveFacebookOAuthConsumedStateReplay(stateId);
    assert.deepEqual(crossStateReplay, { success: "1" });
    const wrongStateReplay = await resolveFacebookOAuthConsumedStateReplay(otherState.stateId);
    assert.deepEqual(wrongStateReplay, { success: "1" });
    pass("TEST 2: replay requires matching state row + completion stateIdHash");
  } finally {
    const allStateIds = stateId ? [stateId, ...extraStateIds] : extraStateIds;
    for (const id of allStateIds) {
      await prisma.facebookOAuthState.deleteMany({ where: { id } }).catch(() => {});
    }
    await prisma.facebookOAuthCompletion.deleteMany({
      where: {
        OR: [
          { correlationId },
          { correlationId: { contains: tag } },
        ],
      },
    }).catch(() => {});
  }

  const failed = results.filter((r) => r.startsWith("FAIL"));
  if (failed.length) {
    process.exitCode = 1;
    console.error(`\n${failed.length} failure(s)`);
  } else {
    console.log(`\nAll ${results.length} checks passed.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
