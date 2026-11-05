/**
 * Proves the separated rate-limit architecture: isolation between traffic classes, financial
 * protection, Redis correctness and failure behaviour. Uses the real middleware; no database.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";

process.env.JWT_SECRET ||= "rate-limit-runtime-secret-rate-limit-runtime";
process.env.SEC_API_TRAFFIC_CLASSES_ENABLED = "true";
delete process.env.REDIS_URL;

const { authenticatedApiRateLimit } = await import("../src/middleware/securityRateLimit.middleware.js");
const { classifyApiTraffic } = await import("../src/lib/apiTrafficClass.js");
const { apiTrafficRateLimits, securityRateLimits } = await import("../src/config/securityRateLimit.config.js");
const { signJwt } = await import("../src/lib/jwtConfig.js");
const { refreshCookieName } = await import("../src/services/refreshToken.service.js");
const store = await import("../src/utils/rateLimitStore.js");

const WINDOW_MS = 15 * 60 * 1000;
const token = (sub: string) => signJwt({ sub, role: "MANAGER", type: "access" }, "1h");

/** Each server gets its own IP so scenarios stay independent inside one process. */
function serve(ip: string): Promise<{ url: string; close: () => Promise<void> }> {
  const app: Express = express();
  app.use((req, _res, next) => {
    Object.defineProperty(req, "ip", { value: ip });
    next();
  });
  app.use("/api", authenticatedApiRateLimit);
  app.use("/api", (_req, res) => res.json({ ok: true }));
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

type Call = { method?: string; path: string; bearer?: string; cookie?: string };

async function hit(url: string, call: Call): Promise<Response> {
  const headers: Record<string, string> = {};
  if (call.bearer) headers.authorization = `Bearer ${call.bearer}`;
  if (call.cookie) headers.cookie = call.cookie;
  return fetch(url + call.path, { method: call.method ?? "GET", headers });
}

async function hitUntilBlocked(url: string, call: Call, cap: number): Promise<number> {
  for (let i = 1; i <= cap; i++) {
    const res = await hit(url, call);
    if (res.status === 429) return i;
  }
  return 0;
}

// --- Classification ---
const expected: Array<[string, string, string]> = [
  ["POST", "/api/auth/refresh", "sessionRefresh"],
  ["POST", "/api/auth/signin", "auth"],
  ["POST", "/api/me/connect/instant-payout", "instantPayout"],
  ["POST", "/api/me/employee-connect/instant-payout", "instantPayout"],
  ["PATCH", "/api/me/connect/bank-payout-schedule", "financialWrite"],
  ["PATCH", "/api/me/employee-connect/bank-payout-schedule", "financialWrite"],
  ["PATCH", "/api/me/connect/employee-tip-payout-mode", "financialWrite"],
  ["POST", "/api/me/connect/tip-distribution/batches", "financialWrite"],
  ["POST", "/api/me/billing/checkout", "financialWrite"],
  ["POST", "/api/me/billing/cancel", "financialWrite"],
  ["POST", "/api/business/physical-qr/orders/abc/checkout", "financialWrite"],
  ["POST", "/api/business/ownership/transfer", "financialWrite"],
  ["POST", "/api/platform/scheduled-payout-operations/a/b/reconcile", "financialWrite"],
  ["GET", "/api/business/me/stats", "dashboardRead"],
  ["GET", "/api/me/connect/financial-summary", "dashboardRead"],
  ["POST", "/api/me/notifications/setup/evaluate", "dashboardRead"],
  ["GET", "/api/business/qr-analytics", "analyticsRead"],
  ["POST", "/api/qr/scan", "publicTipping"],
  ["GET", "/api/staff/anna", "publicTipping"],
  ["POST", "/api/payments/create-tip-session", "publicTipping"],
  ["GET", "/api/tipping-context/abc", "publicTipping"],
  ["GET", "/api/employees/some-public-slug", "publicTipping"],
  ["GET", "/api/employees/me", "dashboardRead"],
  ["GET", "/api/product-reviews", "ordinary"],
];
for (const [method, path, want] of expected) {
  assert.equal(classifyApiTraffic({ method, path }), want, `${method} ${path}`);
}
assert.equal(
  classifyApiTraffic({ method: "GET", path: "/api/business/me/stats", query: { scope: "analytics" } }),
  "analyticsRead",
);
// A financial GET is a read: limits must not block viewing balances as if it were a payout.
assert.equal(classifyApiTraffic({ method: "GET", path: "/api/me/billing" }), "dashboardRead");

// Every money-moving write declared in the route files must land in a protected class.
const routesDir = join(dirname(fileURLToPath(import.meta.url)), "../src/routes");
const mounts: Record<string, string[]> = {
  "connect.routes.ts": ["/api/me"],
  "employeeConnect.routes.ts": ["/api/me"],
  "billing.routes.ts": ["/api/me"],
  "physicalQr.routes.ts": ["/api/business/physical-qr"],
};
const moneyWord = /payout|billing|checkout|tip-distribution|account-link|login-link/i;
const safelyNotMoney = /\/(sync|reconcile-status)$/;
let moneyRoutes = 0;
for (const file of readdirSync(routesDir)) {
  const prefixes = mounts[file];
  if (!prefixes) continue;
  const source = readFileSync(join(routesDir, file), "utf8");
  for (const match of source.matchAll(/router\.(post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
    const [, method, route] = match;
    for (const prefix of prefixes) {
      const path = prefix + route.replace(/:[^/]+/g, "x");
      if (!moneyWord.test(path) || safelyNotMoney.test(path)) continue;
      moneyRoutes++;
      const cls = classifyApiTraffic({ method: method!.toUpperCase(), path });
      assert.ok(cls === "financialWrite" || cls === "instantPayout", `${method} ${path} is unprotected: ${cls}`);
    }
  }
}
assert.ok(moneyRoutes >= 10, `expected to find the money routes, found ${moneyRoutes}`);

// --- Traffic isolation ---
{
  const venue = await serve("10.0.0.1");
  const limit = apiTrafficRateLimits.publicTipping.ip.max;
  const blockedAt = await hitUntilBlocked(venue.url, { path: "/api/staff/anna" }, limit + 2);
  assert.equal(blockedAt, limit + 1, "public tipping is itself limited");

  const manager = token("isolation-manager");
  assert.equal((await hit(venue.url, { path: "/api/business/me/stats", bearer: manager })).status, 200, "dashboard survives guest traffic");
  assert.equal((await hit(venue.url, { method: "POST", path: "/api/auth/refresh" })).status, 200, "refresh survives guest traffic");
  await venue.close();
}
{
  const shared = await serve("10.0.0.2");
  const attacker = await hitUntilBlocked(shared.url, { path: "/api/product-reviews", bearer: "forged.jwt.value" }, apiTrafficRateLimits.ordinary.ip.max + 2);
  assert.equal(attacker, apiTrafficRateLimits.ordinary.ip.max + 1, "forged tokens stay limited");
  assert.equal((await hit(shared.url, { method: "POST", path: "/api/auth/refresh" })).status, 200, "refresh survives forged-token flood");
  assert.equal((await hit(shared.url, { path: "/api/business/me/stats", bearer: token("victim") })).status, 200, "dashboard survives forged-token flood");
  await shared.close();
}
{
  // Refresh has its own session limit, so a stolen cookie cannot be hammered.
  const refresh = await serve("10.0.0.3");
  const cookie = `${refreshCookieName()}=stolen-cookie-value`;
  const max = apiTrafficRateLimits.sessionRefresh.session.max;
  assert.equal(await hitUntilBlocked(refresh.url, { method: "POST", path: "/api/auth/refresh", cookie }, max + 2), max + 1);
  const other = `${refreshCookieName()}=another-session`;
  assert.equal((await hit(refresh.url, { method: "POST", path: "/api/auth/refresh", cookie: other })).status, 200, "other sessions unaffected");
  await refresh.close();
}
{
  // Reads, analytics and writes use separate buckets for the same user.
  const server = await serve("10.0.0.4");
  const user = token("bucket-user");
  const burst = apiTrafficRateLimits.analyticsRead.burst.max;
  assert.equal(await hitUntilBlocked(server.url, { path: "/api/business/qr-analytics", bearer: user }, burst + 2), burst + 1);
  assert.equal((await hit(server.url, { path: "/api/business/me/stats", bearer: user })).status, 200, "analytics does not consume dashboard reads");
  assert.equal((await hit(server.url, { path: "/api/business/qr-analytics", bearer: token("other-user") })).status, 200, "users are isolated");
  await server.close();
}

// --- Financial writes ---
{
  const server = await serve("10.0.0.5");
  const user = token("payout-user");
  const payoutMax = apiTrafficRateLimits.instantPayout.user.max;
  const payout = { method: "POST", path: "/api/me/connect/instant-payout", bearer: user };
  assert.equal(await hitUntilBlocked(server.url, payout, payoutMax + 2), payoutMax + 1, "instant payout strict limit");

  const res = await hit(server.url, payout);
  assert.equal(res.status, 429);
  assert.match(((await res.json()) as { message: string }).message, /payment or payout/);

  const writeMax = apiTrafficRateLimits.financialWrite.user.max;
  assert.equal(
    await hitUntilBlocked(server.url, { method: "POST", path: "/api/me/billing/checkout", bearer: user }, writeMax + 2),
    writeMax + 1,
    "billing write limit, independent of payouts",
  );
  assert.equal((await hit(server.url, { path: "/api/me/connect/financial-summary", bearer: user })).status, 200, "limited writer can still read");

  const sameIpOtherUser = token("other-payout-user");
  assert.equal((await hit(server.url, { ...payout, bearer: sameIpOtherUser })).status, 200, "one user cannot block another's payout");
  await server.close();
}
{
  // Reads cannot consume the financial budget: a dashboard burst leaves payouts available.
  const server = await serve("10.0.0.6");
  const user = token("busy-reader");
  for (let i = 0; i < 40; i++) await hit(server.url, { path: "/api/business/me/stats", bearer: user });
  assert.equal((await hit(server.url, { method: "POST", path: "/api/me/connect/instant-payout", bearer: user })).status, 200);
  await server.close();
}
assert.ok(apiTrafficRateLimits.instantPayout.user.max < securityRateLimits.authenticatedApi.user.max);

// Concurrency: the limit holds exactly under simultaneous requests, so no extra payout attempt runs.
{
  const server = await serve("10.0.0.7");
  const user = token("concurrent-payout");
  const results = await Promise.all(
    Array.from({ length: 25 }, () => hit(server.url, { method: "POST", path: "/api/me/connect/instant-payout", bearer: user })),
  );
  assert.equal(results.filter((r) => r.status === 200).length, apiTrafficRateLimits.instantPayout.user.max);
  await server.close();
}

// --- Flag off: behaviour is exactly the legacy limiter ---
{
  process.env.SEC_API_TRAFFIC_CLASSES_ENABLED = "false";
  const server = await serve("10.0.0.8");
  const user = token("legacy-user");
  const max = securityRateLimits.authenticatedApi.user.max;
  assert.equal(await hitUntilBlocked(server.url, { path: "/api/business/me/stats", bearer: user }, max + 2), max + 1, "legacy user limit unchanged");
  const res = await hit(server.url, { path: "/api/business/qr-analytics", bearer: user });
  assert.equal(res.status, 429, "legacy single bucket still shared across paths");
  await server.close();
  process.env.SEC_API_TRAFFIC_CLASSES_ENABLED = "true";
}

// --- Redis behaviour, against a client that models TTLs ---
type Entry = { count: number; expiresAt: number | null };

function fakeRedis(shared: Map<string, Entry>, clock: { now: number }) {
  return {
    failing: false,
    eval(_script: string, _keys: number, key: string, windowMs: string) {
      if (this.failing) return Promise.reject(new Error("connection lost"));
      const ms = Number(windowMs);
      let entry = shared.get(key);
      if (entry?.expiresAt != null && entry.expiresAt <= clock.now) entry = undefined;
      const next: Entry = entry ?? { count: 0, expiresAt: null };
      next.count += 1;
      if (next.count === 1 || next.expiresAt == null) next.expiresAt = clock.now + ms;
      shared.set(key, next);
      return Promise.resolve([next.count, next.expiresAt - clock.now]);
    },
    get(key: string) {
      return Promise.resolve(shared.has(key) ? String(shared.get(key)!.count) : null);
    },
    pttl(key: string) {
      const entry = shared.get(key);
      return Promise.resolve(entry?.expiresAt != null ? entry.expiresAt - clock.now : -2);
    },
    quit: () => Promise.resolve("OK"),
    on: () => undefined,
  };
}

{
  const clock = { now: 1_000_000 };
  const shared = new Map<string, Entry>();
  const client = fakeRedis(shared, clock);
  store.setRateLimitRedisClientForTests(client);
  const check = (key: string, extra?: { failClosed?: boolean }) =>
    store.checkAndIncrementLimitDistributed({ key, maxPerWindow: 2, windowMs: WINDOW_MS, nowMs: clock.now, ...extra });

  await check("retry-after");
  clock.now += 10 * 60 * 1000;
  await check("retry-after");
  const blocked = await check("retry-after");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.resetAtMs - clock.now, 5 * 60 * 1000, "Retry-After is the real remaining window");

  // A key left with no expiry must repair itself rather than block for ever.
  shared.set("stuck", { count: 99, expiresAt: null });
  const stuck = await check("stuck");
  assert.equal(stuck.allowed, false);
  assert.equal(shared.get("stuck")!.expiresAt, clock.now + WINDOW_MS, "expiry repaired");
  clock.now += WINDOW_MS + 1;
  assert.equal((await check("stuck")).allowed, true, "no indefinite lockout");

  // Two instances sharing storage see one count.
  const instanceA = fakeRedis(shared, clock);
  const instanceB = fakeRedis(shared, clock);
  store.setRateLimitRedisClientForTests(instanceA);
  assert.equal((await check("multi")).allowed, true);
  store.setRateLimitRedisClientForTests(instanceB);
  assert.equal((await check("multi")).allowed, true);
  store.setRateLimitRedisClientForTests(instanceA);
  assert.equal((await check("multi")).allowed, false, "limit holds across instances");

  // Reads degrade to local counting; financial checks refuse instead.
  const down = fakeRedis(shared, clock);
  down.failing = true;
  store.setRateLimitRedisClientForTests(down);
  assert.equal((await check("redis-down-read")).allowed, true, "reads keep working");
  const refused = await check("redis-down-money", { failClosed: true });
  assert.equal(refused.allowed, false, "financial checks fail closed");
  assert.equal(refused.storeUnavailable, true);
  assert.equal(refused.resetAtMs - clock.now, store.RATE_LIMIT_STORE_UNAVAILABLE_RETRY_MS, "short retry, not a long lockout");

  // Recovery: once storage returns, the same key is allowed again.
  const recovered = fakeRedis(new Map(), clock);
  store.setRateLimitRedisClientForTests(recovered);
  assert.equal((await check("redis-down-money", { failClosed: true })).allowed, true, "no lockout after recovery");
  store.setRateLimitRedisClientForTests(null);
}

// --- Users sharing a proxy address ---
{
  const shared = await serve("198.51.100.77");
  const first = signJwt({ sub: "shared-user-1", role: "MANAGER", type: "access" }, "5m");
  const second = signJwt({ sub: "shared-user-2", role: "MANAGER", type: "access" }, "5m");
  const blockedAt = await hitUntilBlocked(shared.url, { path: "/api/business/me/stats", bearer: first }, apiTrafficRateLimits.dashboardRead.burst.max + 5);
  assert.ok(blockedAt > 0, "one user reaches their own limit");
  const other = await hit(shared.url, { path: "/api/business/me/stats", bearer: second });
  assert.notEqual(other.status, 429, "two signed-in users behind one proxy stay independent");
  const refreshAfter = await hit(shared.url, { method: "POST", path: "/api/auth/refresh", cookie: `${refreshCookieName()}=abc` });
  assert.notEqual(refreshAfter.status, 429, "refresh still works while dashboard reads are limited");
  const tip = await hit(shared.url, { method: "POST", path: "/api/payments/create-tip-session" });
  assert.notEqual(tip.status, 429, "public tipping has its own budget");
  await shared.close();
}

console.log("rate-limit-traffic-classes: ok");
process.exit(0);
