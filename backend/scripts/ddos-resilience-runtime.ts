/**
 * Application-layer DDoS / abuse resilience checks (disposable database only).
 * Run: node scripts/safe-test.mjs test:ddos-resilience
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

if (process.env.CARETIP_TEST_ISOLATION !== "1") throw new Error("ddos-resilience runs against a disposable database only");
// No real Stripe, legal provider, OpenAI or Valkey in this run: everything must stay local.
for (const k of ["STRIPE_SECRET_KEY", "REDIS_URL", "OPENAI_API_KEY", "IT_RECHT_API_TOKEN", "LEGAL_WEBHOOK_SECRET"]) delete process.env[k];
process.env.CRON_SECRET = ["ddos", "resilience", "cron", "test"].join("-");
process.env.LANDING_AI_DAILY_MAX_CALLS = "3";

const express = (await import("express")).default;
const { io: ioClient } = await import("socket.io-client");
const { prisma } = await import("../src/prisma.js");
const clientIp = await import("../src/lib/clientIp.js");
const store = await import("../src/utils/rateLimitStore.js");
const httpErrors = await import("../src/utils/httpErrors.js");
const { isPlausibleCheckoutSessionId } = await import("../src/lib/stripeCheckoutSessionId.js");
const landingAi = await import("../src/services/landingAi.service.js");
const health = await import("../src/controllers/health.controller.js");
const timeouts = await import("../src/lib/httpServerTimeouts.js");
const { installProcessErrorHandlers } = await import("../src/lib/processErrorHandlers.js");
const socketServer = await import("../src/socket/socketServer.js");

let count = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  count++;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── client addresses ──
await test("IPv4 rate-limit key is the address itself", () => {
  assert.equal(clientIp.rateLimitIp({ ip: "203.0.113.7" }), "203.0.113.7");
  assert.equal(clientIp.rateLimitIp({ ip: "::ffff:198.51.100.4" }), "198.51.100.4");
});
await test("IPv6 rate-limit key is the /64 network (rotation inside a /64 shares one bucket)", () => {
  const a = clientIp.rateLimitIp({ ip: "2001:db8:abcd:12::1" });
  const b = clientIp.rateLimitIp({ ip: "2001:0db8:abcd:0012:ffff:eeee:dddd:cccc" });
  assert.equal(a, "2001:0db8:abcd:0012::/64");
  assert.equal(a, b);
  assert.notEqual(a, clientIp.rateLimitIp({ ip: "2001:db8:abcd:13::1" }), "a different /64 is a different bucket");
  assert.equal(clientIp.rateLimitIp({ ip: "::1" }), "0000:0000:0000:0000::/64");
  assert.equal(clientIp.expandIPv6("1:2:3"), null);
  assert.equal(clientIp.expandIPv6("1::2::3"), null);
  assert.equal(clientIp.rateLimitIp({ ip: "not-an-ip" }), "unknown");
});
await test("Socket.IO handshake address uses Express's trust-proxy rule: a forged X-Forwarded-For prefix is ignored", () => {
  const app = express();
  app.set("trust proxy", 1);
  const raw = { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, socket: { remoteAddress: "10.0.0.1" } } as unknown as IncomingMessage;
  assert.equal(clientIp.rateLimitIpForRawRequest(app, raw), "203.0.113.9", "the address the trusted proxy appended");
  const direct = express();
  assert.equal(clientIp.rateLimitIpForRawRequest(direct, raw), "10.0.0.1", "no trusted proxy: the socket address");
  assert.equal(clientIp.rateLimitIpForRawRequest(null, raw), "10.0.0.1");
});

// ── Valkey client bounds ──
await test("Valkey command and connect timeouts are bounded, with safe env clamps", () => {
  assert.equal(store.redisCommandTimeoutMs({}), 500);
  assert.equal(store.redisCommandTimeoutMs({ RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS: "250" }), 250);
  assert.equal(store.redisCommandTimeoutMs({ RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS: "0" }), 500, "0 would mean no timeout");
  assert.equal(store.redisCommandTimeoutMs({ RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS: "999999" }), 500);
  assert.equal(store.redisConnectTimeoutMs({}), 3000);
});

// ── Sentry quota ──
await test("Sentry: at most 10 events per error context per minute; other contexts unaffected", () => {
  const t0 = 1_000_000;
  let sent = 0;
  for (let i = 0; i < 50; i++) if (httpErrors.allowSentryEvent("stripe.webhook.verify", t0 + i)) sent++;
  assert.equal(sent, httpErrors.SENTRY_EVENTS_PER_CONTEXT_PER_MINUTE);
  assert.equal(httpErrors.allowSentryEvent("other.context", t0), true);
  assert.equal(httpErrors.allowSentryEvent("stripe.webhook.verify", t0 + 61_000), true, "next minute allowed again");
});

// ── Stripe session ids ──
await test("checkout session id shape: real-looking ids pass, made-up ones do not", () => {
  assert.ok(isPlausibleCheckoutSessionId("cs_test_a0px9nMHb2R5dDWE29Xyz"));
  assert.ok(isPlausibleCheckoutSessionId("cs_live_b1Q2w3E4r5T6y7U8i9O0pAaSsDd"));
  for (const bad of ["", "abc", "cs_test_", "cs_test_short", "pi_123456789012345", "cs_test_../../x123456", "cs_live_aaaaaaaaaa%00"]) {
    assert.equal(isPlausibleCheckoutSessionId(bad), false, bad);
  }
});

// ── Landing AI budget ──
await test("Landing AI: global daily cap on paid model calls (LANDING_AI_DAILY_MAX_CALLS)", async () => {
  const now = Date.UTC(2031, 0, 1, 12);
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await landingAi.withinLandingAiDailyBudget(now));
  assert.deepEqual(results, [true, true, true, false]);
  assert.equal(await landingAi.withinLandingAiDailyBudget(now + 24 * 3600_000), true, "a new UTC day starts a new budget");
  assert.equal(landingAi.landingAiDailyMaxCalls({ LANDING_AI_DAILY_MAX_CALLS: "0" }), 0, "0 switches paid calls off");
  assert.equal(landingAi.landingAiDailyMaxCalls({}), 2000);
});

// ── Health probe ──
await test("Health: concurrent and repeated checks share one database probe per 5 s", async () => {
  const original = prisma.$queryRaw.bind(prisma);
  let calls = 0;
  (prisma as unknown as { $queryRaw: unknown }).$queryRaw = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return [{ "?column?": 1 }];
  };
  try {
    health.resetHealthProbeCacheForTests();
    const all = await Promise.all(Array.from({ length: 200 }, () => health.probeDatabase()));
    assert.ok(all.every((r) => r === "connected"));
    assert.equal(calls, 1, `queries: ${calls}`);
    await health.probeDatabase(Date.now() + health.HEALTH_DB_PROBE_TTL_MS + 10);
    assert.equal(calls, 2, "a new probe after the interval");
  } finally {
    (prisma as unknown as { $queryRaw: unknown }).$queryRaw = original;
    health.resetHealthProbeCacheForTests();
  }
});

// ── HTTP server timeouts ──
await test("HTTP server: header (20 s) and request (120 s) timeouts below Node defaults", () => {
  const server = createServer();
  timeouts.applyHttpServerTimeouts(server);
  assert.equal(server.headersTimeout, 20_000, "below Node's 60 s default");
  assert.ok(server.headersTimeout > server.keepAliveTimeout, "Node requires headersTimeout > keepAliveTimeout");
  assert.equal(server.requestTimeout, 120_000, "below Node's 300 s default");
});

// ── Process handlers ──
await test("unhandled promise rejection is logged, the process keeps running", async () => {
  installProcessErrorHandlers();
  assert.ok(process.listenerCount("unhandledRejection") >= 1);
  void Promise.reject(new Error("deliberate unhandled rejection (test)"));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(true, "still alive");
});

// ── HTTP: real routers on a local server ──
const app = express();
app.set("trust proxy", false);
app.use(express.json());
const { default: internalJobsRoutes } = await import("../src/routes/internalJobs.routes.js");
const { default: paymentRoutes } = await import("../src/routes/payment.routes.js");
const { default: legalRoutes } = await import("../src/routes/legal.routes.js");
app.use("/api/internal/jobs", internalJobsRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/legal", legalRoutes);
const server = createServer(app);
const io = socketServer.initSocketServer(server, app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

await test("internal jobs: unauthenticated calls get 401 and write no audit row; authorised runs are recorded", async () => {
  const before = await prisma.auditLog.count({ where: { action: "internal_job.run" } });
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${base}/api/internal/jobs/purge-mobile-web-handoff`, { method: "POST" });
    assert.equal(r.status, 401);
  }
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await prisma.auditLog.count({ where: { action: "internal_job.run" } }), before, "no rows for 401s");
  const ok = await fetch(`${base}/api/internal/jobs/purge-mobile-web-handoff`, { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET! } });
  assert.equal(ok.status, 200, await ok.text());
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await prisma.auditLog.count({ where: { action: "internal_job.run" } }), before + 1, "the real run is recorded");
});

await test("tip-session lookup: a made-up id is refused before Stripe (same 400 answer)", async () => {
  const r = await fetch(`${base}/api/payments/tip-session/not-a-session`);
  assert.equal(r.status, 400);
  const real = await fetch(`${base}/api/payments/tip-session/cs_test_a0px9nMHb2R5dDWE29Xyz`);
  assert.equal(real.status, 503, "a plausible id passes the shape check (Stripe is not configured in this run)");
});

await test("tip-session lookup: capped per session (150 / 15 min), other sessions unaffected", async () => {
  const id = "cs_test_capcheckSession0123456789";
  let first429 = -1;
  for (let i = 1; i <= 155; i++) {
    const r = await fetch(`${base}/api/payments/tip-session/${id}`);
    if (r.status === 429 && first429 < 0) first429 = i;
  }
  assert.equal(first429, 151);
  const other = await fetch(`${base}/api/payments/tip-session/cs_test_otherSession9876543210`);
  assert.equal(other.status, 503);
});

await test("legal webhook: own limit (30 / 15 min per address) before the 15 MB body is read", async () => {
  let first429 = -1;
  for (let i = 1; i <= 33; i++) {
    const r = await fetch(`${base}/api/legal/webhook`, { method: "POST", headers: { "content-type": "text/xml" }, body: "<api><action>getversion</action></api>" });
    if (r.status === 429 && first429 < 0) first429 = i;
  }
  assert.equal(first429, 31);
});

await test("Socket.IO: inbound message size capped at 16 KB", () => {
  const opts = (io as unknown as { engine: { opts: { maxHttpBufferSize: number } } }).engine.opts;
  assert.equal(opts.maxHttpBufferSize, 16 * 1024);
});

await test("Socket.IO: handshakes limited per address (120 / 5 min) before any auth or database work", async () => {
  const attempt = () =>
    new Promise<string>((resolve) => {
      const s = ioClient(base, { transports: ["websocket"], reconnection: false, timeout: 5000 });
      s.on("connect", () => { s.close(); resolve("connected"); });
      s.on("connect_error", (e) => { s.close(); resolve(e.message); });
    });
  const messages: string[] = [];
  for (let i = 0; i < 122; i++) messages.push(await attempt());
  const limited = messages.findIndex((m) => /Too many connection attempts/.test(m));
  assert.equal(limited, 120, `first limited attempt index ${limited}; first message: ${messages[0]}`);
  assert.ok(!/Too many/.test(messages[0]!), "early attempts reach normal auth (and fail it: no token)");
});

io.close();
await new Promise((r) => server.close(() => r(undefined)));
await prisma.$disconnect();
console.log(failures.length ? `\n${failures.length} of ${count} failed` : `\nddos-resilience: ok (${count} checks)`);
process.exit(failures.length ? 1 : 0);
