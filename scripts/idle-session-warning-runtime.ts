/**
 * Checkpoint 3 — Idle warning flow (Stay + title countdown) unit checks.
 * Run: npm run test:idle-session-warning
 */
import {
  beginIdleDocumentTitleCountdown,
  endIdleDocumentTitleCountdown,
  isIdleDocumentTitleCountdownActive,
  resetIdleDocumentTitleForTests,
} from "../src/app/lib/idleDocumentTitle";
import {
  armIdleSession,
  getIdleDeadlines,
  getIdleSessionSnapshot,
  getSecondsUntilDeadline,
  openIdleWarning,
  resetIdleSessionStoreForTests,
} from "../src/app/lib/idleSessionStore";
import {
  performIdleStaySignedIn,
  syncIdleWarningDocumentTitle,
} from "../src/app/lib/idleSessionWarningFlow";
import { IDLE_WARNING_BEFORE_MS } from "../src/app/lib/idleSessionConfig";
import en from "../src/i18n/locales/en.json";
import de from "../src/i18n/locales/de.json";

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

/** Minimal document.title stub for Node. */
function installDocumentStub(initial = "CareTip"): () => void {
  const doc = {
    title: initial,
  };
  (globalThis as { document?: { title: string } }).document = doc;
  return () => {
    delete (globalThis as { document?: unknown }).document;
    resetIdleDocumentTitleForTests();
  };
}

function testI18nKeys(): boolean {
  const keys = [
    "warningTitle",
    "warningBody",
    "staySignedIn",
    "logOutNow",
    "countdownLive",
    "unsavedTitle",
    "unsavedBody",
    "logOutAnyway",
  ] as const;
  let ok = true;
  for (const key of keys) {
    ok = assert(typeof en.idleSession[key] === "string" && en.idleSession[key].length > 0, `en idleSession.${key}`) && ok;
    ok = assert(typeof de.idleSession[key] === "string" && de.idleSession[key].length > 0, `de idleSession.${key}`) && ok;
  }
  ok = assert(en.idleSession.warningBody.includes("{{seconds}}"), "en body has seconds interpolator") && ok;
  return ok;
}

function testCountdownFromLogoutAt(): boolean {
  const t0 = 70_000_000;
  const logoutAt = t0 + 15 * 60 * 1000;
  const atWarning = logoutAt - IDLE_WARNING_BEFORE_MS;
  const seconds = getSecondsUntilDeadline(logoutAt, atWarning);
  return assert(seconds === 120, "at warning start, seconds remaining = 120");
}

function testStaySignedInFlow(): boolean {
  resetIdleSessionStoreForTests();
  const cleanup = installDocumentStub("CareTip — Dashboard");
  let ok = true;

  const t0 = 80_000_000;
  armIdleSession(t0);
  const { logoutAt } = getIdleDeadlines();
  openIdleWarning(logoutAt);
  syncIdleWarningDocumentTitle(true, 120);
  ok = assert(isIdleDocumentTitleCountdownActive(), "title countdown active while warning open") && ok;
  ok = assert(String(document.title).startsWith("(120)"), "title prefixed with (120)") && ok;

  const stayAt = t0 + 14 * 60 * 1000;
  const { extended } = performIdleStaySignedIn(stayAt);
  ok = assert(extended === true, "Stay extends session") && ok;
  ok = assert(getIdleSessionSnapshot().phase === "none", "Stay clears warning phase") && ok;
  ok = assert(getIdleSessionSnapshot().lastActivityAt === stayAt, "Stay updates lastActivityAt") && ok;
  ok = assert(!isIdleDocumentTitleCountdownActive(), "Stay restores title countdown off") && ok;
  ok = assert(document.title === "CareTip — Dashboard", "Stay restores previous title") && ok;

  cleanup();
  return ok;
}

function testTitleTickUpdates(): boolean {
  resetIdleSessionStoreForTests();
  const cleanup = installDocumentStub("CareTip");
  let ok = true;
  beginIdleDocumentTitleCountdown(120);
  syncIdleWarningDocumentTitle(true, 119);
  ok = assert(document.title === "(119) CareTip", "title tick updates to 119") && ok;
  syncIdleWarningDocumentTitle(false, 0);
  ok = assert(document.title === "CareTip", "closing warning restores title") && ok;
  ok = assert(!isIdleDocumentTitleCountdownActive(), "countdown inactive after close") && ok;
  endIdleDocumentTitleCountdown();
  cleanup();
  return ok;
}

function main(): void {
  const suites = [testI18nKeys, testCountdownFromLogoutAt, testStaySignedInFlow, testTitleTickUpdates];
  let failed = false;
  for (const suite of suites) {
    try {
      if (!suite()) failed = true;
    } catch (err) {
      failed = true;
      fail(`suite threw: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      resetIdleSessionStoreForTests();
      resetIdleDocumentTitleForTests();
    }
  }

  for (const line of results) console.log(line);

  if (failed || results.some((r) => r.startsWith("FAIL:"))) {
    console.error("\nidle-session-warning: FAILED");
    process.exit(1);
  }
  console.log("\nidle-session-warning: PASSED");
}

main();
