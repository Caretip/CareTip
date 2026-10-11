/**
 * Facebook provider attempt state machine (unit checks).
 * Run: npx tsx src/app/lib/facebookProviderAttempt.runtime.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyFacebookPhaseIfCurrent,
  beginFacebookAttempt,
  FACEBOOK_OAUTH_IDLE,
  facebookProviderShowsLoading,
  facebookShowsConnectingStatus,
  facebookShowsFailureStatus,
} from "./facebookProviderAttempt";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

let state = FACEBOOK_OAUTH_IDLE;
const a1 = beginFacebookAttempt(state);
assert.equal(a1.attemptId, 1);
assert.equal(a1.phase, "loading");
assert.equal(facebookProviderShowsLoading(a1), true);
assert.equal(facebookShowsConnectingStatus(a1), true);
assert.equal(facebookShowsFailureStatus(a1), false);

state = applyFacebookPhaseIfCurrent(a1, 1, "redirecting");
assert.equal(state.phase, "redirecting");
assert.equal(facebookProviderShowsLoading(state), true);

state = applyFacebookPhaseIfCurrent(state, 1, "timeout", "timeout");
assert.equal(state.phase, "timeout");
assert.equal(facebookProviderShowsLoading(state), false);
assert.equal(facebookShowsFailureStatus(state), true);

state = applyFacebookPhaseIfCurrent(state, 2, "error", "provider_error");
assert.equal(state.phase, "timeout", "stale attempt must not overwrite");

state = applyFacebookPhaseIfCurrent(state, 1, "success");
assert.equal(state.phase, "success");
state = applyFacebookPhaseIfCurrent(state, 1, "idle");
assert.deepEqual(state, FACEBOOK_OAUTH_IDLE);

state = applyFacebookPhaseIfCurrent(beginFacebookAttempt(state), 1, "cancelled");
assert.equal(state.phase, "cancelled");
assert.equal(facebookShowsFailureStatus(state), false);

const row = read("src/app/components/auth/OAuthProviderRow.tsx");
assert.ok(row.includes("FacebookOAuthInlineStatus"));
assert.ok(!row.includes("FacebookOAuthRecoveryNotice"));
assert.ok(row.includes("onStall:"));
assert.ok(row.includes("armStallTimer"));
assert.ok(row.includes('e.kind === "cancelled"'));

const inline = read("src/app/components/auth/FacebookOAuthInlineStatus.tsx");
assert.ok(inline.includes('caretip-facebook-oauth-inline'));
assert.ok(inline.includes("facebookConnecting"));

console.log("facebookProviderAttempt-runtime: all passed");
