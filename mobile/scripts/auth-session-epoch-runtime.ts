/**
 * Regression: stale refresh failures must not invalidate a newer login epoch.
 * Run: npx tsx scripts/auth-session-epoch-runtime.ts
 */
import assert from "node:assert/strict";
import {
  bumpAuthSessionEpoch,
  getAuthSessionEpoch,
} from "../services/auth/authSessionEpoch";

function simulateStaleRefreshFailure(epochAtStart: number): "stale" | "genuine" {
  if (epochAtStart !== getAuthSessionEpoch()) return "stale";
  return "genuine";
}

const before = getAuthSessionEpoch();
assert.equal(simulateStaleRefreshFailure(before), "genuine");

bumpAuthSessionEpoch(); // login / establishAuthenticatedSession
assert.equal(simulateStaleRefreshFailure(before), "stale");
assert.equal(simulateStaleRefreshFailure(getAuthSessionEpoch()), "genuine");

console.log("auth-session-epoch-runtime: OK");
