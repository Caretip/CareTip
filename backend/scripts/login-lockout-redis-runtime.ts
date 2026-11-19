/**
 * Login lockout Lua scripts against a real, disposable Redis on loopback.
 * Redis supplies the clock (TIME), so expiry is simulated by moving the stored lock time.
 * Run: CARETIP_TEST_REDIS_URL=redis://127.0.0.1:PORT npm run test:login-lockout-redis
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Redis from "ioredis";
import {
  __resetLoginLockoutMemoryForTests,
  beginLoginAttempt,
  recordLoginFailure,
  recordLoginSuccess,
} from "../src/services/loginLockout.service.ts";
import { setRateLimitRedisClientForTests } from "../src/utils/rateLimitStore.ts";
import { describeRedisEngine, engineSupportsLockoutScripts } from "../src/lib/redisEngine.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.CARETIP_TEST_REDIS_URL?.trim() ?? "";
if (!/^redis:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) {
  console.error("REFUSING: set CARETIP_TEST_REDIS_URL to a disposable loopback Redis (redis://127.0.0.1:PORT)");
  process.exit(1);
}
console.warn = () => {};
console.info = () => {};

const redis = new Redis(url, { maxRetriesPerRequest: 1 });

// Child mode: another application process recording failures for one email.
if (process.argv[2] === "child") {
  setRateLimitRedisClientForTests(redis as never);
  const email = process.argv[3]!;
  const n = Number(process.argv[4]);
  for (let i = 0; i < n; i += 1) {
    const b = await beginLoginAttempt(email);
    if (b.allowed) await recordLoginFailure(b.ticket);
  }
  redis.disconnect();
  process.exit(0);
}

const engine = describeRedisEngine(await redis.info("server"));
console.log(`engine: ${engine.engine} ${engine.version ?? "?"} (redis-compatible ${engine.redisCompatVersion ?? "?"})`);
const expectEngine = process.env.CARETIP_EXPECT_ENGINE?.trim();
const expectVersion = process.env.CARETIP_EXPECT_ENGINE_VERSION?.trim();
if (expectEngine && engine.engine !== expectEngine) throw new Error(`expected ${expectEngine}, got ${engine.engine}`);
if (expectVersion && engine.version !== expectVersion) throw new Error(`expected version ${expectVersion}, got ${engine.version}`);
if (!engineSupportsLockoutScripts(engine)) throw new Error("engine too old for the lockout scripts (needs Redis 5+ or Valkey)");
setRateLimitRedisClientForTests(redis as never);
const MIN = 60_000;

const keyFor = (email: string) =>
  `auth:lockout:v1:{${crypto.createHash("sha256").update(email).digest("hex").slice(0, 32)}}`;

async function failTimes(email: string, n: number) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const b = await beginLoginAttempt(email);
    out.push(b.allowed ? await recordLoginFailure(b.ticket) : { refused: true as const, retryAfterMs: b.retryAfterMs });
  }
  return out;
}
/** Make the current lock look expired, the way Redis TIME passing would. */
async function expireLock(email: string) {
  await redis.hset(keyFor(email), "u", "1");
}

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    __resetLoginLockoutMemoryForTests(); // prove state lives in Redis, not process memory
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}
const email = () => `redis-${crypto.randomBytes(4).toString("hex")}@example.test`;

try {
  await check("4 failures do not lock; the 5th locks for 5 minutes (Redis clock)", async () => {
    const e = email();
    const r = await failTimes(e, 5);
    assert.ok(r.slice(0, 4).every((x) => "locked" in x && !x.locked));
    const last = r[4];
    assert.ok("locked" in last && last.locked && last.newlyLocked && last.level === 1);
    assert.ok(last.retryAfterMs > 5 * MIN - 2000 && last.retryAfterMs <= 5 * MIN);
    const b = await beginLoginAttempt(e);
    assert.ok(!b.allowed && b.retryAfterMs > 4 * MIN);
    const ttl = await redis.pttl(keyFor(e));
    assert.ok(ttl > 5 * MIN, "state key has a bounded expiry");
  });

  await check("after expiry, 5 more failures lock for 10 minutes; later rounds stay at 10", async () => {
    const e = email();
    await failTimes(e, 5);
    await expireLock(e);
    const second = await failTimes(e, 5);
    const last2 = second[4];
    assert.ok("locked" in last2 && last2.locked && last2.level === 2);
    assert.ok(last2.retryAfterMs > 10 * MIN - 2000);
    await expireLock(e);
    const third = (await failTimes(e, 5))[4];
    assert.ok("locked" in third && third.locked && third.level === 2 && third.retryAfterMs <= 10 * MIN);
  });

  await check("success clears the state in Redis", async () => {
    const e = email();
    await failTimes(e, 4);
    const b = await beginLoginAttempt(e);
    assert.ok(b.allowed);
    if (b.allowed) await recordLoginSuccess(b.ticket);
    assert.equal(await redis.exists(keyFor(e)), 0);
  });

  await check("12 simultaneous attempts: exactly 5 may check a password, one lock", async () => {
    const e = email();
    const begins = await Promise.all(Array.from({ length: 12 }, () => beginLoginAttempt(e)));
    const allowed = begins.filter((b) => b.allowed);
    assert.equal(allowed.length, 5);
    const results = await Promise.all(allowed.map((b) => (b.allowed ? recordLoginFailure(b.ticket) : null)));
    assert.equal(results.filter((r) => r && r.locked && r.newlyLocked).length, 1);
  });

  await check("a second 'instance' (fresh memory) sees the same lock", async () => {
    const e = email();
    await failTimes(e, 3);
    __resetLoginLockoutMemoryForTests();
    await failTimes(e, 2);
    assert.equal((await beginLoginAttempt(e)).allowed, false);
  });

  await check("Valkey INFO is recognised by server_name/valkey_version, not redis_version", async () => {
    const sample = "# Server\r\nredis_version:7.2.4\r\nserver_name:valkey\r\nvalkey_version:8.1.4\r\nredis_mode:standalone\r\n";
    const e = describeRedisEngine(sample);
    assert.deepEqual(e, { engine: "valkey", version: "8.1.4", redisCompatVersion: "7.2.4" });
    assert.equal(engineSupportsLockoutScripts(e), true);
    assert.equal(engineSupportsLockoutScripts(describeRedisEngine("redis_version:4.0.9\r\n")), false);
  });

  await check("two separate application processes share one lockout", async () => {
    const e = email();
    const self = fileURLToPath(import.meta.url);
    const tsx = path.resolve(path.dirname(self), "../node_modules/tsx/dist/cli.mjs");
    for (const n of [3, 2]) {
      const r = spawnSync(process.execPath, [tsx, self, "child", e, String(n)], { env: process.env, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    }
    assert.equal((await beginLoginAttempt(e)).allowed, false, "3 failures in one process + 2 in another lock the account");
  });

  await check("a restart does not reset the lock (state lives in the store)", async () => {
    const e = email();
    await failTimes(e, 5);
    __resetLoginLockoutMemoryForTests();
    setRateLimitRedisClientForTests(null);
    setRateLimitRedisClientForTests(redis as never);
    assert.equal((await beginLoginAttempt(e)).allowed, false);
  });

  console.log(`login-lockout-redis-runtime: ok (${passed} checks against real Redis)`);
} finally {
  setRateLimitRedisClientForTests(null);
  const keys = await redis.keys("auth:lockout:v1:*");
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
}
