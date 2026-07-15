/**
 * Checkpoint 4 — Auth gate + idle logout latch unit checks (no browser auth).
 * Run: npm run test:idle-session-auth-gate
 */
import { parseIdleEnvFlag } from "../src/app/lib/idleSessionConfig";
import {
  beginIdleLogout,
  endIdleLogout,
  isIdleLogoutInFlight,
  resetIdleSessionStoreForTests,
} from "../src/app/lib/idleSessionStore";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function assert(condition: boolean, message: string): boolean {
  if (condition) {
    pass(message);
    return true;
  }
  fail(message);
  return false;
}

/** Mirror IdleSessionController activation rules for unit verification. */
function canArmIdleSession(input: {
  flagEnabled: boolean;
  authStatus: string;
  sessionValidated: boolean;
  user: { id: string } | null;
  logoutTransitionActive: boolean;
}): boolean {
  if (!input.flagEnabled) return false;
  if (input.authStatus !== "authenticated") return false;
  if (!input.sessionValidated) return false;
  if (!input.user) return false;
  if (input.logoutTransitionActive) return false;
  return true;
}

function testActivationGate(): boolean {
  let ok = true;
  const base = {
    flagEnabled: true,
    authStatus: "authenticated",
    sessionValidated: true,
    user: { id: "u1" },
    logoutTransitionActive: false,
  };
  ok = assert(canArmIdleSession(base) === true, "fully authenticated arms") && ok;
  ok = assert(canArmIdleSession({ ...base, flagEnabled: false }) === false, "flag off → no arm") && ok;
  ok =
    assert(canArmIdleSession({ ...base, authStatus: "anonymous" }) === false, "anonymous → no arm") &&
    ok;
  ok =
    assert(
      canArmIdleSession({ ...base, authStatus: "initializing" }) === false,
      "initializing → no arm",
    ) && ok;
  ok =
    assert(canArmIdleSession({ ...base, sessionValidated: false }) === false, "unvalidated → no arm") &&
    ok;
  ok = assert(canArmIdleSession({ ...base, user: null }) === false, "null user → no arm") && ok;
  ok =
    assert(
      canArmIdleSession({ ...base, logoutTransitionActive: true }) === false,
      "logout transition → no arm",
    ) && ok;
  return ok;
}

function testFlagDefaultOff(): boolean {
  return assert(parseIdleEnvFlag(undefined) === false, "flag default (unset) is off");
}

function testIdleLogoutBlocksRefreshLatch(): boolean {
  resetIdleSessionStoreForTests();
  let ok = true;
  ok = assert(isIdleLogoutInFlight() === false, "latch starts false") && ok;
  ok = assert(beginIdleLogout() === true, "begin latch") && ok;
  ok = assert(isIdleLogoutInFlight() === true, "latch true during logout") && ok;
  ok = assert(beginIdleLogout() === false, "single-flight blocks second logout") && ok;
  endIdleLogout();
  ok = assert(isIdleLogoutInFlight() === false, "end clears latch") && ok;
  return ok;
}

function main(): void {
  const suites = [testActivationGate, testFlagDefaultOff, testIdleLogoutBlocksRefreshLatch];
  let failed = false;
  for (const suite of suites) {
    try {
      if (!suite()) failed = true;
    } catch (err) {
      failed = true;
      fail(`suite threw: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      resetIdleSessionStoreForTests();
    }
  }
  for (const line of results) console.log(line);
  if (failed || results.some((r) => r.startsWith("FAIL:"))) {
    console.error("\nidle-session-auth-gate: FAILED");
    process.exit(1);
  }
  console.log("\nidle-session-auth-gate: PASSED");
}

main();
