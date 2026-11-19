/**
 * Progressive login lockout: thresholds, durations, expiry, reset, concurrency, shared state.
 * No network or database. A controllable clock replaces real waiting.
 * Run: npm run test:login-lockout
 *
 * The Redis path is exercised with a fake client that reproduces the Lua scripts in JS
 * (same approach as rate-limit-traffic-classes-runtime). The scripts themselves still need a
 * real Redis to verify end to end.
 */
import assert from "node:assert/strict";
import {
  LOCKOUT_BEGIN_SCRIPT,
  LOCKOUT_FAILURE_SCRIPT,
  LOCKOUT_RELEASE_SCRIPT,
  LOCKOUT_SUCCESS_SCRIPT,
  __resetLoginLockoutMemoryForTests,
  __setLoginLockoutClockForTests,
  beginLoginAttempt,
  loginLockedMessage,
  recordLoginFailure,
  recordLoginSuccess,
  releaseLoginAttempt,
} from "../src/services/loginLockout.service.ts";
import { setRateLimitRedisClientForTests } from "../src/utils/rateLimitStore.ts";

console.warn = () => {};
console.info = () => {};

const MIN = 60_000;
let clock = 1_800_000_000_000;
__setLoginLockoutClockForTests(() => clock);

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL [${mode}]: ${name}`);
    throw err;
  }
}

async function fail(email: string) {
  const b = await beginLoginAttempt(email);
  if (!b.allowed) return { refused: true as const, retryAfterMs: b.retryAfterMs };
  return { refused: false as const, result: await recordLoginFailure(b.ticket) };
}

async function failTimes(email: string, n: number) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(await fail(email));
  return out;
}

async function succeed(email: string) {
  const b = await beginLoginAttempt(email);
  if (!b.allowed) return { refused: true as const };
  return { refused: false as const, ...(await recordLoginSuccess(b.ticket)) };
}

/* ---------- Fake Redis reproducing the Lua scripts, with a controllable TIME ---------- */

type Hash = Map<string, string>;
function createFakeRedis() {
  const hashes = new Map<string, Hash>();
  const zsets = new Map<string, Map<string, number>>();
  const h = (k: string) => hashes.get(k) ?? hashes.set(k, new Map()).get(k)!;
  const z = (k: string) => zsets.get(k) ?? zsets.set(k, new Map()).get(k)!;
  const num = (v: string | undefined) => Number(v ?? "0");
  return {
    calls: 0,
    async eval(script: string, _n: number, key: string, pKey: string, ...argv: Array<string | number>) {
      this.calls += 1;
      const now = clock;
      const a = argv.map(String);
      if (script === LOCKOUT_BEGIN_SCRIPT) {
        const u = num(h(key).get("u"));
        if (u > now) return [1, u - now];
        const ttl = Number(a[2]);
        for (const [t, s] of z(pKey)) if (s <= now - ttl) z(pKey).delete(t);
        if (num(h(key).get("f")) + z(pKey).size >= Number(a[1])) return [2, ttl];
        z(pKey).set(a[0], now);
        return [0, 0];
      }
      if (script === LOCKOUT_FAILURE_SCRIPT) {
        z(pKey).delete(a[0]);
        let level = num(h(key).get("l"));
        const u = num(h(key).get("u"));
        if (u > now) return [1, level, u - now];
        const f = num(h(key).get("f")) + 1;
        if (f >= Number(a[1])) {
          level = Math.min(level + 1, Number(a[5]));
          const duration = level === 1 ? Number(a[3]) : Number(a[4]);
          h(key).set("f", "0").set("l", String(level)).set("u", String(now + duration));
          zsets.delete(pKey);
          return [2, level, duration];
        }
        h(key).set("f", String(f)).set("l", String(level));
        return [0, level, 0];
      }
      if (script === LOCKOUT_SUCCESS_SCRIPT) {
        z(pKey).delete(a[0]);
        const level = num(h(key).get("l"));
        hashes.delete(key);
        return level;
      }
      if (script === LOCKOUT_RELEASE_SCRIPT) {
        z(pKey).delete(a[0]);
        return 1;
      }
      throw new Error("unexpected script");
    },
    async get() { return null; },
    async pttl() { return -2; },
    async quit() { return "OK"; },
    on() { return this; },
  };
}

/* ---------- Same behaviour suite for both stores ---------- */

let mode = "memory";
async function suite(label: string) {
  mode = label;
  let n = 0;
  const email = () => `user${(n += 1)}-${label}@example.test`;

  await check("4 failures do not lock; the 5th locks for 5 minutes", async () => {
    const e = email();
    const first4 = await failTimes(e, 4);
    assert.ok(first4.every((r) => !r.refused && !r.result.locked));
    const fifth = await fail(e);
    assert.ok(!fifth.refused && fifth.result.locked && fifth.result.newlyLocked);
    assert.equal(fifth.refused ? 0 : fifth.result.locked ? fifth.result.retryAfterMs : 0, 5 * MIN);
  });

  await check("sign-in is refused during the 5-minute lock, even with the right password", async () => {
    const e = email();
    await failTimes(e, 5);
    clock += 4 * MIN;
    const r = await succeed(e);
    assert.equal(r.refused, true);
    const b = await beginLoginAttempt(e);
    assert.ok(!b.allowed && b.retryAfterMs === MIN);
    clock += MIN;
  });

  await check("after the lock expires, sign-in is allowed again", async () => {
    const e = email();
    await failTimes(e, 5);
    clock += 5 * MIN;
    const r = await succeed(e);
    assert.equal(r.refused, false);
    assert.equal(!r.refused && r.hadLockout, true, "success after a lockout is reported for logging");
  });

  await check("5 more failures after the first lock lock for 10 minutes", async () => {
    const e = email();
    await failTimes(e, 5);
    clock += 5 * MIN;
    const second = await failTimes(e, 5);
    assert.ok(second.slice(0, 4).every((r) => !r.refused && !r.result.locked));
    const last = second[4];
    assert.ok(!last.refused && last.result.locked && last.result.level === 2);
    assert.equal(!last.refused && last.result.locked ? last.result.retryAfterMs : 0, 10 * MIN);
    clock += 9 * MIN;
    assert.equal((await beginLoginAttempt(e)).allowed, false, "still locked at 9 minutes");
    clock += MIN;
    assert.equal((await succeed(e)).refused, false, "open again at 10 minutes");
  });

  await check("later rounds stay at 10 minutes (no unlimited escalation)", async () => {
    const e = email();
    for (let round = 1; round <= 4; round += 1) {
      const r = await failTimes(e, 5);
      const last = r[4];
      assert.ok(!last.refused && last.result.locked);
      const expected = round === 1 ? 5 * MIN : 10 * MIN;
      assert.equal(!last.refused && last.result.locked ? last.result.retryAfterMs : 0, expected);
      clock += expected;
    }
  });

  await check("a successful sign-in resets the count and the level", async () => {
    const e = email();
    await failTimes(e, 5);
    clock += 5 * MIN;
    await failTimes(e, 3);
    assert.equal((await succeed(e)).refused, false);
    const after = await failTimes(e, 5);
    assert.ok(after.slice(0, 4).every((r) => !r.refused && !r.result.locked));
    const last = after[4];
    assert.equal(!last.refused && last.result.locked ? last.result.retryAfterMs : 0, 5 * MIN, "back to level 1");
    clock += 5 * MIN;
  });

  await check("concurrent attempts cannot run more than 5 password checks", async () => {
    const e = email();
    const begins = await Promise.all(Array.from({ length: 12 }, () => beginLoginAttempt(e)));
    const allowed = begins.filter((b) => b.allowed);
    assert.equal(allowed.length, 5, "only five attempts may check a password at once");
    const results = await Promise.all(
      allowed.map((b) => (b.allowed ? recordLoginFailure(b.ticket) : Promise.reject(new Error("x")))),
    );
    assert.equal(results.filter((r) => r.locked && r.newlyLocked).length, 1);
    assert.equal((await beginLoginAttempt(e)).allowed, false);
    clock += 5 * MIN;
  });

  await check("an attempt that ends without a credential result does not count", async () => {
    const e = email();
    await failTimes(e, 4);
    const b = await beginLoginAttempt(e);
    assert.ok(b.allowed);
    if (b.allowed) await releaseLoginAttempt(b.ticket);
    const r = await fail(e);
    assert.ok(!r.refused && r.result.locked, "the release left the count at 4");
    clock += 5 * MIN;
  });

  await check("a crashed attempt frees its slot after 30 seconds", async () => {
    const e = email();
    await failTimes(e, 4);
    const stuck = await beginLoginAttempt(e);
    assert.ok(stuck.allowed);
    assert.equal((await beginLoginAttempt(e)).allowed, false, "slot held while in flight");
    clock += 31_000;
    assert.equal((await beginLoginAttempt(e)).allowed, true, "slot released after the pending TTL");
    clock += 5 * MIN;
  });

  await check("email case and spacing map to one account (caller normalizes)", async () => {
    // The controller passes normalizeLoginEmail(); the same normalized value must share state.
    const e = email();
    await failTimes(e, 5);
    assert.equal((await beginLoginAttempt(e)).allowed, false);
    clock += 5 * MIN;
  });
}

await suite("memory");

const fake = createFakeRedis();
setRateLimitRedisClientForTests(fake as never);
await suite("redis");

await check("redis mode keeps no state in process memory (shared across instances)", async () => {
  const e = "shared@example.test";
  await failTimes(e, 3);
  __resetLoginLockoutMemoryForTests(); // a second instance starts with empty memory
  await failTimes(e, 2);
  assert.equal((await beginLoginAttempt(e)).allowed, false, "lock seen after memory reset");
  assert.ok(fake.calls > 0);
  clock += 5 * MIN;
});

await check("if Redis fails mid-flight, the memory fallback still enforces the lock", async () => {
  const broken = { ...createFakeRedis(), async eval() { throw new Error("ECONNRESET"); } };
  setRateLimitRedisClientForTests(broken as never);
  const e = "fallback@example.test";
  await failTimes(e, 5);
  assert.equal((await beginLoginAttempt(e)).allowed, false);
  clock += 5 * MIN;
});
setRateLimitRedisClientForTests(null);

await check("lock message is localized and does not expose counters", () => {
  const en = loginLockedMessage("en", 4 * MIN + 1);
  const de = loginLockedMessage("de", 60_000);
  assert.equal(
    en,
    "Sign-in is temporarily locked after too many failed attempts. Please try again in 5 minutes or reset your password.",
  );
  assert.equal(
    de,
    "Die Anmeldung ist wegen zu vieler fehlgeschlagener Versuche vorübergehend gesperrt. Bitte versuchen Sie es in 1 Minute erneut oder setzen Sie Ihr Passwort zurück.",
  );
  assert.doesNotMatch(en + de, /attempt \d|Versuch \d|level|redis/i);
});

console.log(`login-lockout-runtime: ok (${passed} checks)`);
