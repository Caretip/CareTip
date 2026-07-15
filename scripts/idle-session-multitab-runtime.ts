/**
 * Checkpoint 5 — Multi-tab idle sync unit checks.
 * Run: npm run test:idle-session-multitab
 */
import {
  armIdleSession,
  getIdleSessionSnapshot,
  resetIdleSessionStoreForTests,
} from "../src/app/lib/idleSessionStore";
import { applyIdleChannelMessage } from "../src/app/lib/idleSessionSync";
import { IDLE_TIMEOUT_MS } from "../src/app/lib/idleSessionConfig";

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

function testRemoteActivityExtends(): boolean {
  resetIdleSessionStoreForTests();
  const t0 = 90_000_000;
  armIdleSession(t0);
  let ok = true;

  const applied = applyIdleChannelMessage(
    { type: "activity", ts: t0 + 60_000 },
    { tabId: "A", onRemoteLogout: () => undefined },
  );
  ok = assert(applied === "activity", "remote activity applied") && ok;
  ok = assert(getIdleSessionSnapshot().lastActivityAt === t0 + 60_000, "lastActivityAt maxed") && ok;

  const ignored = applyIdleChannelMessage(
    { type: "activity", ts: t0 + 10_000 },
    { tabId: "A", onRemoteLogout: () => undefined },
  );
  ok = assert(ignored === "ignored", "older remote activity ignored") && ok;
  return ok;
}

function testRemoteStayClearsWarning(): boolean {
  resetIdleSessionStoreForTests();
  const t0 = 91_000_000;
  armIdleSession(t0);
  let ok = true;

  applyIdleChannelMessage(
    { type: "warning", logoutAt: t0 + IDLE_TIMEOUT_MS },
    { tabId: "B", onRemoteLogout: () => undefined },
  );
  ok = assert(getIdleSessionSnapshot().phase === "idle-warning", "remote warning opens phase") && ok;

  const stayAt = t0 + 14 * 60 * 1000;
  const stay = applyIdleChannelMessage(
    { type: "stay", ts: stayAt },
    { tabId: "B", onRemoteLogout: () => undefined },
  );
  ok = assert(stay === "stay", "remote stay applied") && ok;
  ok = assert(getIdleSessionSnapshot().phase === "none", "stay clears warning phase") && ok;
  ok = assert(getIdleSessionSnapshot().lastActivityAt === stayAt, "stay updates activity") && ok;
  return ok;
}

function testRemoteLogoutCallsHandlerOnce(): boolean {
  resetIdleSessionStoreForTests();
  armIdleSession(100_000_000);
  let calls = 0;
  let ok = true;
  const result = applyIdleChannelMessage(
    { type: "logout", ts: Date.now(), leaderId: "leader-1" },
    {
      tabId: "follower",
      onRemoteLogout: () => {
        calls += 1;
      },
    },
  );
  ok = assert(result === "logout", "remote logout result") && ok;
  ok = assert(calls === 1, "remote logout invokes handler") && ok;

  const echo = applyIdleChannelMessage(
    { type: "logout", ts: Date.now(), leaderId: "self" },
    {
      tabId: "self",
      onRemoteLogout: () => {
        calls += 1;
      },
    },
  );
  ok = assert(echo === "ignored", "own leaderId logout ignored") && ok;
  ok = assert(calls === 1, "echo does not re-invoke logout") && ok;
  return ok;
}

function main(): void {
  const suites = [testRemoteActivityExtends, testRemoteStayClearsWarning, testRemoteLogoutCallsHandlerOnce];
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
    console.error("\nidle-session-multitab: FAILED");
    process.exit(1);
  }
  console.log("\nidle-session-multitab: PASSED");
}

main();
