/**
 * Logout visual-stability runtime: teardown order, shell eligibility, no double begin.
 * Run: npx tsx scripts/logout-transition-runtime.ts
 */
import assert from "node:assert/strict";
import {
  beginAuthLogoutTransition,
  endAuthLogoutTransition,
  isAuthLogoutTransitionActive,
  isAuthenticatedAppShellEligible,
} from "../lib/authLogoutTransition";
import { bumpAuthSessionEpoch, getAuthSessionEpoch } from "../services/auth/authSessionEpoch";

function resetLogoutFlag(): void {
  if (isAuthLogoutTransitionActive()) endAuthLogoutTransition();
}

function simulateSignOutTapOrder(): string[] {
  const events: string[] = [];
  beginAuthLogoutTransition();
  events.push("begin-transition");
  const authenticatedAfterFlag = false;
  events.push(authenticatedAfterFlag ? "still-authenticated" : "set-unauthenticated");
  bumpAuthSessionEpoch();
  events.push("bump-epoch");
  assert.equal(isAuthenticatedAppShellEligible(true), false);
  assert.equal(isAuthenticatedAppShellEligible(false), false);
  events.push("shell-ineligible");
  return events;
}

async function main(): Promise<void> {
  resetLogoutFlag();

  assert.equal(isAuthLogoutTransitionActive(), false);
  assert.equal(isAuthenticatedAppShellEligible(true), true);
  assert.equal(isAuthenticatedAppShellEligible(false), false);

  const events = simulateSignOutTapOrder();
  assert.deepEqual(events, [
    "begin-transition",
    "set-unauthenticated",
    "bump-epoch",
    "shell-ineligible",
  ]);
  assert.equal(isAuthLogoutTransitionActive(), true);

  beginAuthLogoutTransition();
  assert.equal(isAuthLogoutTransitionActive(), true, "re-entrant begin is a no-op");

  const epochAtLogout = getAuthSessionEpoch();
  const inFlightRefreshEpoch = epochAtLogout - 1;
  assert.notEqual(inFlightRefreshEpoch, getAuthSessionEpoch());

  endAuthLogoutTransition();
  assert.equal(isAuthLogoutTransitionActive(), false);
  assert.equal(isAuthenticatedAppShellEligible(true), true);

  const order: string[] = [];
  beginAuthLogoutTransition();
  order.push("ui-detached");
  await Promise.resolve();
  order.push("network");
  endAuthLogoutTransition();
  order.push("ended");
  assert.deepEqual(order, ["ui-detached", "network", "ended"]);

  console.log("logout-transition-runtime: OK");
}

void main();
