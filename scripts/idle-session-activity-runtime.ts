/**
 * Checkpoint 2 — Activity detection + wall-clock scheduler unit checks.
 * Run: npm run test:idle-session-activity
 */
import {
  IDLE_TRUSTED_ACTIVITY_EVENTS,
  bindIdleActivityListeners,
  isTrustedIdleActivityEventType,
} from "../src/app/lib/idleSessionActivity";
import { IDLE_TIMEOUT_MS, ACTIVITY_THROTTLE_MS } from "../src/app/lib/idleSessionConfig";
import { computeIdleScheduleDelays, createIdleSessionScheduler } from "../src/app/lib/idleSessionScheduler";
import {
  armIdleSession,
  beginIdleSuppress,
  disarmIdleSession,
  endIdleSuppress,
  evaluateIdleDeadlines,
  getIdleSessionSnapshot,
  openIdleWarning,
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

function testTrustedEventPolicy(): boolean {
  let ok = true;
  ok =
    assert(
      IDLE_TRUSTED_ACTIVITY_EVENTS.join(",") === "pointerdown,keydown,touchstart",
      "trusted events are pointerdown/keydown/touchstart only",
    ) && ok;

  for (const t of ["scroll", "wheel", "mousemove", "pointermove", "focus", "blur", "visibilitychange"]) {
    ok = assert(!isTrustedIdleActivityEventType(t), `${t} is not trusted activity`) && ok;
  }
  for (const t of IDLE_TRUSTED_ACTIVITY_EVENTS) {
    ok = assert(isTrustedIdleActivityEventType(t), `${t} is trusted`) && ok;
  }
  return ok;
}

class FakeTarget {
  private handlers = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.handlers.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    const event = { type } as Event;
    for (const listener of this.handlers.get(type) ?? []) {
      listener(event);
    }
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

function testBindDetach(): boolean {
  const target = new FakeTarget();
  const seen: string[] = [];
  const binding = bindIdleActivityListeners({
    target: target as unknown as Window,
    onActivity: (event) => {
      seen.push(event.type);
    },
  });

  let ok = true;
  for (const t of IDLE_TRUSTED_ACTIVITY_EVENTS) {
    ok = assert(target.listenerCount(t) === 1, `bound ${t}`) && ok;
  }

  target.dispatch("pointerdown");
  target.dispatch("scroll");
  target.dispatch("keydown");
  target.dispatch("wheel");
  target.dispatch("touchstart");
  target.dispatch("mousemove");

  ok =
    assert(
      seen.join(",") === "pointerdown,keydown,touchstart",
      "only trusted events invoke callback",
    ) && ok;

  binding.detach();
  for (const t of IDLE_TRUSTED_ACTIVITY_EVENTS) {
    ok = assert(target.listenerCount(t) === 0, `detached ${t}`) && ok;
  }

  seen.length = 0;
  target.dispatch("pointerdown");
  ok = assert(seen.length === 0, "detached listener silent") && ok;
  return ok;
}

function testScheduleDelays(): boolean {
  const t0 = 40_000_000;
  const delays = computeIdleScheduleDelays(t0, t0);
  let ok = true;
  ok = assert(delays.warnDelay === 13 * 60 * 1000, "warn delay 13m from now") && ok;
  ok = assert(delays.logoutDelay === IDLE_TIMEOUT_MS, "logout delay 15m from now") && ok;

  const mid = computeIdleScheduleDelays(t0, t0 + 10 * 60 * 1000);
  ok = assert(mid.warnDelay === 3 * 60 * 1000, "warn delay shrinks with wall clock") && ok;
  ok = assert(mid.logoutDelay === 5 * 60 * 1000, "logout delay shrinks with wall clock") && ok;
  return ok;
}

function testThrottleWithActivityPath(): boolean {
  resetIdleSessionStoreForTests();
  armIdleSession(50_000_000);
  let ok = true;
  ok = assert(touchIdleActivity(50_000_000 + 5_000) === false, "throttle still applies") && ok;
  ok =
    assert(
      touchIdleActivity(50_000_000 + ACTIVITY_THROTTLE_MS) === true,
      "activity after throttle window",
    ) && ok;
  disarmIdleSession();
  return ok;
}

function testSchedulerWakePastLogout(): boolean {
  resetIdleSessionStoreForTests();
  const t0 = 60_000_000;
  armIdleSession(t0);

  const evaluations: string[] = [];
  const scheduler = createIdleSessionScheduler({
    onEvaluation: (result) => {
      evaluations.push(result.action);
    },
  });

  let ok = true;
  const before = scheduler.checkNow(t0 + 12 * 60 * 1000);
  ok = assert(before.action === "none", "12m idle → still none (warning at 13m)") && ok;

  const atWarn = evaluateIdleDeadlines(t0 + 13 * 60 * 1000);
  ok = assert(atWarn.action === "open-warning", "13m → open-warning") && ok;
  if (atWarn.action === "open-warning") {
    openIdleWarning(atWarn.logoutAt);
  }

  const past = scheduler.checkNow(t0 + IDLE_TIMEOUT_MS + 5_000);
  ok = assert(past.action === "hard-logout", "wake past logoutAt → hard-logout") && ok;

  // Suppress then wake
  resetIdleSessionStoreForTests();
  armIdleSession(t0);
  beginIdleSuppress(t0 + 14 * 60 * 1000);
  const suppressed = scheduler.checkNow(t0 + IDLE_TIMEOUT_MS);
  ok = assert(suppressed.action === "suppressed", "suppress blocks hard logout on wake") && ok;
  endIdleSuppress(t0 + IDLE_TIMEOUT_MS + 1_000);
  ok =
    assert(
      getIdleSessionSnapshot().suppressCount === 0 &&
        evaluateIdleDeadlines(t0 + IDLE_TIMEOUT_MS + 1_000).action !== "suppressed",
      "after resume suppress cleared",
    ) && ok;

  scheduler.dispose();
  return ok;
}

function main(): void {
  const suites = [
    testTrustedEventPolicy,
    testBindDetach,
    testScheduleDelays,
    testThrottleWithActivityPath,
    testSchedulerWakePastLogout,
  ];

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

  for (const line of results) {
    console.log(line);
  }

  if (failed || results.some((r) => r.startsWith("FAIL:"))) {
    console.error("\nidle-session-activity: FAILED");
    process.exit(1);
  }

  console.log("\nidle-session-activity: PASSED");
}

main();
