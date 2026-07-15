/**
 * Checkpoint 1 — Idle session core infrastructure unit checks.
 * Run: npm run test:idle-session-infra
 */
import {
  ACTIVITY_THROTTLE_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_BEFORE_MS,
  UNSAVED_GRACE_MS,
  computeIdleDeadlines,
  getIdleWarningOffsetMs,
  parseIdleEnvFlag,
} from "../src/app/lib/idleSessionConfig";
import { parseIdleChannelMessageForTests } from "../src/app/lib/idleSessionChannel";
import { formatIdleCountdownTitleForTests } from "../src/app/lib/idleDocumentTitle";
import {
  emitIdleLogout,
  emitIdleLogoutManual,
  emitIdleSessionExtended,
  emitIdleWarningShown,
  setIdleAnalyticsSinkForTests,
} from "../src/app/lib/idleSessionAnalytics";
import {
  applyRemoteIdleActivity,
  armIdleSession,
  beginIdleLogout,
  beginIdleSuppress,
  disarmIdleSession,
  endIdleLogout,
  endIdleSuppress,
  evaluateIdleDeadlines,
  forceReleaseIdleSuppressIfStale,
  getIdleDeadlines,
  getIdleRemainingMs,
  getIdleSessionSnapshot,
  openIdleWarning,
  openUnsavedGrace,
  resetIdleSessionStoreForTests,
  touchIdleActivity,
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

function testConfig(): boolean {
  let ok = true;
  ok =
    assert(IDLE_TIMEOUT_MS === 900_000, "IDLE_TIMEOUT_MS is 15m") &&
    assert(IDLE_WARNING_BEFORE_MS === 120_000, "IDLE_WARNING_BEFORE_MS is 120s") &&
    assert(UNSAVED_GRACE_MS === 60_000, "UNSAVED_GRACE_MS is 60s") &&
    assert(ACTIVITY_THROTTLE_MS === 30_000, "ACTIVITY_THROTTLE_MS is 30s") &&
    assert(getIdleWarningOffsetMs() === 13 * 60 * 1000, "warning offset is 13m") &&
    ok;

  const d = computeIdleDeadlines(1_000_000);
  ok =
    assert(d.logoutAt === 1_000_000 + IDLE_TIMEOUT_MS, "logoutAt = last + 15m") &&
    assert(d.warningAt === 1_000_000 + 13 * 60 * 1000, "warningAt = last + 13m") &&
    ok;

  ok =
    assert(parseIdleEnvFlag(undefined) === false, "flag unset → false") &&
    assert(parseIdleEnvFlag("") === false, "flag empty → false") &&
    assert(parseIdleEnvFlag("false") === false, "flag false → false") &&
    assert(parseIdleEnvFlag("true") === true, "flag true → true") &&
    assert(parseIdleEnvFlag("1") === true, "flag 1 → true") &&
    assert(parseIdleEnvFlag("YES") === true, "flag YES → true") &&
    ok;

  return ok;
}

function testStoreArmTouchThrottle(): boolean {
  resetIdleSessionStoreForTests();
  let ok = true;

  const t0 = 10_000_000;
  armIdleSession(t0);
  ok = assert(getIdleSessionSnapshot().armed === true, "arm sets armed") && ok;
  ok = assert(getIdleSessionSnapshot().lastActivityAt === t0, "arm sets lastActivityAt") && ok;

  const touched = touchIdleActivity(t0 + 1_000);
  ok = assert(touched === false, "throttle blocks write within 30s") && ok;
  ok = assert(getIdleSessionSnapshot().lastActivityAt === t0, "throttled write unchanged") && ok;

  const forced = touchIdleActivity(t0 + 2_000, { force: true });
  ok = assert(forced === true, "force bypasses throttle") && ok;
  ok = assert(getIdleSessionSnapshot().lastActivityAt === t0 + 2_000, "force updates activity") && ok;

  const afterThrottle = touchIdleActivity(t0 + 2_000 + ACTIVITY_THROTTLE_MS);
  ok = assert(afterThrottle === true, "write allowed after throttle window") && ok;

  openIdleWarning(t0 + IDLE_TIMEOUT_MS);
  const duringWarning = touchIdleActivity(t0 + 3_000);
  ok = assert(duringWarning === true, "warning-open bypasses throttle") && ok;
  ok = assert(getIdleSessionSnapshot().phase === "none", "touch clears warning phase") && ok;

  disarmIdleSession();
  ok = assert(getIdleSessionSnapshot().armed === false, "disarm clears armed") && ok;
  ok = assert(touchIdleActivity(Date.now()) === false, "touch ignored when disarmed") && ok;

  return ok;
}

function testStoreSuppressResume(): boolean {
  resetIdleSessionStoreForTests();
  let ok = true;
  const t0 = 20_000_000;
  armIdleSession(t0);

  // Advance 10 minutes into the idle window, then suppress.
  const tSuppress = t0 + 10 * 60 * 1000;
  beginIdleSuppress(tSuppress);
  const frozen = getIdleSessionSnapshot().frozenRemainingMs;
  ok = assert(frozen === 5 * 60 * 1000, "freeze remaining = 5m") && ok;
  ok = assert(getIdleSessionSnapshot().suppressCount === 1, "suppress count 1") && ok;

  beginIdleSuppress(tSuppress + 1000);
  ok = assert(getIdleSessionSnapshot().suppressCount === 2, "refcount increments") && ok;

  endIdleSuppress(tSuppress + 2000);
  ok = assert(getIdleSessionSnapshot().suppressCount === 1, "refcount decrements") && ok;
  ok = assert(getIdleSessionSnapshot().frozenRemainingMs === frozen, "still frozen until zero") && ok;

  const tResume = tSuppress + 60_000;
  const { resumed, remainingMs } = endIdleSuppress(tResume);
  ok = assert(resumed === true, "resume when count hits 0") && ok;
  ok = assert(remainingMs === 5 * 60 * 1000, "resume keeps frozen remaining") && ok;
  ok =
    assert(
      getIdleRemainingMs(tResume) === 5 * 60 * 1000,
      "after resume, remaining budget unchanged by wall pause",
    ) && ok;

  // Fresh suppress then failsafe release
  beginIdleSuppress(tResume);
  const stale = forceReleaseIdleSuppressIfStale(tResume + 2 * 60 * 60 * 1000 + 1);
  ok = assert(stale === true, "failsafe releases stale suppress") && ok;
  ok = assert(getIdleSessionSnapshot().suppressCount === 0, "failsafe clears count") && ok;

  return ok;
}

function testStoreDeadlinesAndLogoutGate(): boolean {
  resetIdleSessionStoreForTests();
  let ok = true;
  const t0 = 30_000_000;
  armIdleSession(t0);
  const { warningAt, logoutAt } = getIdleDeadlines();

  ok = assert(evaluateIdleDeadlines(warningAt - 1).action === "none", "before warning → none") && ok;
  ok =
    assert(evaluateIdleDeadlines(warningAt).action === "open-warning", "at warning → open-warning") &&
    ok;
  openIdleWarning(logoutAt);
  ok =
    assert(
      evaluateIdleDeadlines(warningAt + 1_000).action === "none",
      "already warning → no re-open",
    ) && ok;

  beginIdleSuppress(warningAt + 2_000);
  ok = assert(evaluateIdleDeadlines(logoutAt).action === "suppressed", "suppress blocks logout") && ok;
  endIdleSuppress(warningAt + 3_000);

  // Re-arm clean clock for hard logout check
  resetIdleSessionStoreForTests();
  armIdleSession(t0);
  ok = assert(evaluateIdleDeadlines(logoutAt).action === "hard-logout", "at logoutAt → hard-logout") && ok;

  ok = assert(beginIdleLogout() === true, "beginIdleLogout first call ok") && ok;
  ok = assert(beginIdleLogout() === false, "beginIdleLogout single-flight") && ok;
  endIdleLogout();
  ok = assert(beginIdleLogout() === true, "beginIdleLogout after end ok") && ok;
  endIdleLogout();

  openUnsavedGrace(t0);
  ok =
    assert(
      getIdleSessionSnapshot().phase === "unsaved-grace" &&
        getIdleSessionSnapshot().unsavedGraceEndsAt === t0 + UNSAVED_GRACE_MS,
      "unsaved grace sets phase + endsAt",
    ) && ok;
  ok =
    assert(
      evaluateIdleDeadlines(t0 + UNSAVED_GRACE_MS).action === "unsaved-grace-expired",
      "grace expiry detected",
    ) && ok;

  applyRemoteIdleActivity(t0 + 50_000);
  ok = assert(getIdleSessionSnapshot().lastActivityAt === t0 + 50_000, "remote activity max") && ok;
  ok = assert(applyRemoteIdleActivity(t0 + 10_000) === false, "older remote ignored") && ok;

  return ok;
}

function testChannelParse(): boolean {
  let ok = true;
  ok =
    assert(
      parseIdleChannelMessageForTests({ type: "activity", ts: 1 })?.type === "activity",
      "parse activity",
    ) && ok;
  ok =
    assert(
      parseIdleChannelMessageForTests({ type: "stay", ts: 2 })?.type === "stay",
      "parse stay",
    ) && ok;
  ok =
    assert(
      parseIdleChannelMessageForTests({ type: "warning", logoutAt: 3 })?.type === "warning",
      "parse warning",
    ) && ok;
  ok =
    assert(
      parseIdleChannelMessageForTests({ type: "logout", ts: 4, leaderId: "a" })?.type === "logout",
      "parse logout",
    ) && ok;
  ok =
    assert(parseIdleChannelMessageForTests({ type: "activity" }) === null, "reject bad activity") &&
    ok;
  ok =
    assert(
      parseIdleChannelMessageForTests(JSON.stringify({ type: "activity", ts: 9 }))?.ts === 9,
      "parse JSON string",
    ) && ok;
  return ok;
}

function testDocumentTitleFormat(): boolean {
  return assert(
    formatIdleCountdownTitleForTests(120) === "(120) CareTip" &&
      formatIdleCountdownTitleForTests(1) === "(1) CareTip" &&
      formatIdleCountdownTitleForTests(0) === "(0) CareTip",
    "title countdown format",
  );
}

function testAnalyticsOutcomeHelpers(): boolean {
  const seen: string[] = [];
  setIdleAnalyticsSinkForTests((event) => {
    seen.push(event);
  });
  emitIdleWarningShown({ remaining_ms: 120_000 });
  emitIdleSessionExtended({ via: "stay" });
  emitIdleLogout();
  emitIdleLogoutManual();
  setIdleAnalyticsSinkForTests(null);

  return assert(
    seen.join(",") ===
      "idle_warning_shown,idle_session_extended,idle_logout,idle_logout_manual",
    "analytics emits four outcome events",
  );
}

function main(): void {
  const suites = [
    testConfig,
    testStoreArmTouchThrottle,
    testStoreSuppressResume,
    testStoreDeadlinesAndLogoutGate,
    testChannelParse,
    testDocumentTitleFormat,
    testAnalyticsOutcomeHelpers,
  ];

  let failed = false;
  for (const suite of suites) {
    try {
      if (!suite()) failed = true;
    } catch (err) {
      failed = true;
      fail(`suite threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const line of results) {
    console.log(line);
  }

  if (failed || results.some((r) => r.startsWith("FAIL:"))) {
    console.error("\nidle-session-infra: FAILED");
    process.exit(1);
  }

  console.log("\nidle-session-infra: PASSED");
}

main();
