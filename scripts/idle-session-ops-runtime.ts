/**
 * Checkpoint 6 — Suppress resume + dirty/unsaved grace unit checks.
 * Run: npm run test:idle-session-ops
 */
import {
  armIdleSession,
  beginIdleSuppress,
  endIdleSuppress,
  evaluateIdleDeadlines,
  getIdleRemainingMs,
  getIdleSessionSnapshot,
  openUnsavedGrace,
  resetIdleSessionStoreForTests,
} from "../src/app/lib/idleSessionStore";
import {
  isIdleDirty,
  registerIdleDirty,
  resetIdleDirtyRegistryForTests,
  unregisterIdleDirty,
} from "../src/app/lib/idleDirtyRegistry";
import { withIdleSuppress, withIdleSuppressSync } from "../src/app/lib/idleSuppress";
import { IDLE_TIMEOUT_MS, UNSAVED_GRACE_MS } from "../src/app/lib/idleSessionConfig";

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

function testDirtyRegistry(): boolean {
  resetIdleDirtyRegistryForTests();
  let ok = true;
  ok = assert(isIdleDirty() === false, "dirty starts clean") && ok;
  registerIdleDirty("business-profile");
  ok = assert(isIdleDirty() === true, "register marks dirty") && ok;
  registerIdleDirty("business-profile");
  ok = assert(isIdleDirty() === true, "duplicate register stable") && ok;
  unregisterIdleDirty("business-profile");
  ok = assert(isIdleDirty() === false, "unregister clears dirty") && ok;
  return ok;
}

async function testWithIdleSuppress(): Promise<boolean> {
  resetIdleSessionStoreForTests();
  const t0 = 110_000_000;
  armIdleSession(t0);
  let ok = true;

  await withIdleSuppress("unit-test", async () => {
    ok = assert(getIdleSessionSnapshot().suppressCount === 1, "async suppress count 1") && ok;
    await Promise.resolve();
  });
  ok = assert(getIdleSessionSnapshot().suppressCount === 0, "async suppress released") && ok;

  withIdleSuppressSync("unit-sync", () => {
    ok = assert(getIdleSessionSnapshot().suppressCount === 1, "sync suppress count 1") && ok;
  });
  ok = assert(getIdleSessionSnapshot().suppressCount === 0, "sync suppress released") && ok;
  return ok;
}

function testHardLogoutDeferredWhenDirty(): boolean {
  resetIdleSessionStoreForTests();
  resetIdleDirtyRegistryForTests();
  const t0 = 120_000_000;
  armIdleSession(t0);
  registerIdleDirty("form");
  let ok = true;

  // Guard owns dirty→grace; store still reports hard-logout. Emulate guard decision:
  const evalAt = t0 + IDLE_TIMEOUT_MS;
  const action = evaluateIdleDeadlines(evalAt).action;
  ok = assert(action === "hard-logout", "store reports hard-logout at deadline") && ok;
  ok = assert(isIdleDirty() === true, "dirty still true at deadline") && ok;

  openUnsavedGrace(evalAt);
  ok = assert(getIdleSessionSnapshot().phase === "unsaved-grace", "grace phase opened") && ok;
  ok =
    assert(
      evaluateIdleDeadlines(evalAt + UNSAVED_GRACE_MS - 1).action === "none",
      "during grace no logout yet",
    ) && ok;
  ok =
    assert(
      evaluateIdleDeadlines(evalAt + UNSAVED_GRACE_MS).action === "unsaved-grace-expired",
      "grace end → unsaved-grace-expired",
    ) && ok;
  return ok;
}

function testSuppressResumeRemaining(): boolean {
  resetIdleSessionStoreForTests();
  const t0 = 130_000_000;
  armIdleSession(t0);
  const tFreeze = t0 + 12 * 60 * 1000;
  beginIdleSuppress(tFreeze);
  const remaining = getIdleSessionSnapshot().frozenRemainingMs;
  let ok = true;
  ok = assert(remaining === 3 * 60 * 1000, "freeze at 3m remaining") && ok;
  ok = assert(evaluateIdleDeadlines(t0 + IDLE_TIMEOUT_MS).action === "suppressed", "suppressed at hard stop") && ok;
  const tResume = tFreeze + 2 * 60 * 1000;
  endIdleSuppress(tResume);
  ok = assert(getIdleRemainingMs(tResume) === 3 * 60 * 1000, "resume keeps 3m") && ok;
  return ok;
}

async function main(): Promise<void> {
  const syncSuites = [testDirtyRegistry, testHardLogoutDeferredWhenDirty, testSuppressResumeRemaining];
  let failed = false;
  for (const suite of syncSuites) {
    try {
      if (!suite()) failed = true;
    } catch (err) {
      failed = true;
      fail(`suite threw: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      resetIdleSessionStoreForTests();
      resetIdleDirtyRegistryForTests();
    }
  }

  try {
    if (!(await testWithIdleSuppress())) failed = true;
  } catch (err) {
    failed = true;
    fail(`async suite threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    resetIdleSessionStoreForTests();
  }

  for (const line of results) console.log(line);
  if (failed || results.some((r) => r.startsWith("FAIL:"))) {
    console.error("\nidle-session-ops: FAILED");
    process.exit(1);
  }
  console.log("\nidle-session-ops: PASSED");
}

void main();
