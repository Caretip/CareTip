/**
 * Cloudflare origin protection: configuration safety, constant-time check, HTTP and Socket.IO enforcement,
 * the health exemption, and unchanged webhook / internal-job / CORS / auth behaviour behind it.
 * Disposable database only (webhook claim store, job). No network beyond loopback, no real secrets.
 * Run: node scripts/safe-test.mjs test:origin-protection
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cors from "cors";
import Stripe from "stripe";

if (process.env.CARETIP_TEST_ISOLATION !== "1") throw new Error("disposable database only (run through safe-test)");
delete process.env.REDIS_URL;
console.info = () => {};

// Test-only values, generated per run (never real secrets).
const ORIGIN = randomBytes(24).toString("base64url"); // 32 chars
const ORIGIN_PREV = randomBytes(24).toString("base64url");
const PLATFORM_WH = "whsec_" + randomBytes(16).toString("hex");
const CONNECT_WH = "whsec_" + randomBytes(16).toString("hex");
const CRON = randomBytes(24).toString("hex");
process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_WH;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_WH;
process.env.CRON_SECRET = CRON;

const op = await import("../src/lib/originProtection.js");
const { trustedClientIp } = await import("../src/lib/clientIp.js");
const { corsMiddlewareOptions } = await import("../src/config/cors.js");
const { default: stripeWebhookRoutes } = await import("../src/webhooks/stripe.webhook.js");
const { default: internalJobsRoutes } = await import("../src/routes/internalJobs.routes.js");
const { default: meRoutes } = await import("../src/routes/settings.routes.js"); // mounted at /api/me in index.ts
const healthController = await import("../src/controllers/health.controller.js");
const { initSocketServer, closeSocketServer } = await import("../src/socket/socketServer.js");
const { scrubSentryEvent } = await import("../src/instrument/sentryScrub.js");
const { prisma } = await import("../src/prisma.js");
const { io: ioClient } = await import("socket.io-client");
const { requestIdMiddleware } = await import("../src/middleware/requestId.middleware.js");

// App wired in the same order as src/index.ts.
const app = express();
app.use(requestIdMiddleware);
app.use(op.originProtectionMiddleware);
app.use("/api/webhooks", express.raw({ type: "application/json" }), stripeWebhookRoutes);
app.use(cors(corsMiddlewareOptions));
app.use(express.json());
app.get("/api/health", healthController.getApiHealth);
app.use("/api/internal/jobs", internalJobsRoutes);
app.use("/api/me", meRoutes);
app.get("/__probe", (req, res) => res.json({ headerNames: Object.keys(req.headers), clientIp: trustedClientIp(req) }));
app.get("/health", (_req, res) => res.json({ status: "ok" })); // same public body as src/index.ts
const server = createServer(app);
initSocketServer(server, app);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const H = op.ORIGIN_PROTECTION_HEADER;
async function call(method: string, path: string, headers: Record<string, string> = {}, body?: string | Buffer) {
  const r = await fetch(base + path, { method, headers, body });
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}
const withOrigin = (h: Record<string, string> = {}) => ({ ...h, [H]: ORIGIN });
/** fetch() cannot set Host; node:http can (simulates a request addressed to the Render hostname). */
function callWithHost(method: string, path: string, host: string, headers: Record<string, string> = {}): Promise<number> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: { ...headers, host } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

let checks = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  checks++;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const stripe = new Stripe("sk_test_origin_protection_unit");
function signed(secret: string, event: Record<string, unknown>) {
  const payload = JSON.stringify({ object: "event", api_version: "2024-06-20", created: Math.floor(Date.now() / 1000), livemode: false, ...event });
  return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}

const enforceEnv = { ORIGIN_PROTECTION_MODE: "enforce", ORIGIN_PROTECTION_SECRET: ORIGIN, CRON_SECRET: CRON };

// ── Configuration safety ──
await test("config: default is off; deploying the code changes nothing", () => {
  const c = op.resolveOriginProtectionConfig({});
  assert.equal(c.mode, "off");
  assert.deepEqual(c.fatal, []);
});
await test("config: enforce without a secret, with a short secret, or reusing CRON_SECRET stops startup", () => {
  assert.ok(op.resolveOriginProtectionConfig({ ORIGIN_PROTECTION_MODE: "enforce" }).fatal.length > 0);
  assert.ok(op.resolveOriginProtectionConfig({ ORIGIN_PROTECTION_MODE: "enforce", ORIGIN_PROTECTION_SECRET: "short" }).fatal.length > 0);
  assert.ok(op.resolveOriginProtectionConfig({ ORIGIN_PROTECTION_MODE: "enforce", ORIGIN_PROTECTION_SECRET: CRON, CRON_SECRET: CRON }).fatal.length > 0);
});
await test("config: an unrecognised mode stops startup (a typo never means 'unprotected')", () => {
  assert.ok(op.resolveOriginProtectionConfig({ ORIGIN_PROTECTION_MODE: "enforced", ORIGIN_PROTECTION_SECRET: ORIGIN }).fatal.length > 0);
});
await test("config: report without a secret warns and behaves as off (reporting never breaks traffic)", () => {
  const c = op.resolveOriginProtectionConfig({ ORIGIN_PROTECTION_MODE: "report" });
  assert.equal(c.mode, "off");
  assert.deepEqual(c.fatal, []);
  assert.ok(c.warnings.some((w) => w.includes("OFF")));
});
await test("config: no secret value in any message, summary or fingerprint", () => {
  const msgs = [
    ...op.resolveOriginProtectionConfig({ ORIGIN_PROTECTION_MODE: "enforce", ORIGIN_PROTECTION_SECRET: ORIGIN.slice(0, 10) }).fatal,
    op.describeOriginProtection(op.resolveOriginProtectionConfig(enforceEnv)),
    op.secretFingerprint(ORIGIN),
  ].join("\n");
  assert.ok(!msgs.includes(ORIGIN) && !msgs.includes(ORIGIN.slice(0, 10)), "secret leaked into a message");
});

// ── 4. Constant-time comparison ──
await test("4. comparison is constant-time (SHA-256 + timingSafeEqual), handles any length, rejects repeats", () => {
  const src = readFileSync(new URL("../src/lib/originProtection.ts", import.meta.url), "utf8");
  assert.ok(src.includes("safeSecretEqual(raw, secret)"), "uses safeSecretEqual");
  assert.ok(!/raw\s*===\s*secret|secret\s*===\s*raw/.test(src), "no direct string comparison");
  const safe = readFileSync(new URL("../src/lib/safeCompare.ts", import.meta.url), "utf8");
  assert.ok(safe.includes("timingSafeEqual") && safe.includes("sha256"));
  for (const bad of ["", "x", ORIGIN + "x", ORIGIN.slice(1), "a".repeat(10_000)]) {
    assert.equal(op.checkAndStripOriginHeader({ [H]: bad }, [ORIGIN]), false);
  }
  assert.equal(op.checkAndStripOriginHeader({ [H]: [ORIGIN, ORIGIN] as unknown as string }, [ORIGIN]), false, "repeated header");
  assert.equal(op.checkAndStripOriginHeader({ [H]: ORIGIN }, [ORIGIN]), true);
});

// ── 11. Enforcement disabled preserves behaviour ──
op.configureOriginProtection({});
await test("11. off: requests without the header behave exactly as before", async () => {
  assert.equal((await call("GET", "/api/me/settings")).status, 401, "auth still answers");
  assert.equal((await call("GET", "/health")).status, 200);
  const bad = signed(PLATFORM_WH, { id: `evt_op_${Date.now()}_a`, type: "customer.created", data: { object: { id: "cus_x", object: "customer" } } });
  assert.equal((await call("POST", "/api/webhooks/stripe", { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" }, bad.payload)).status, 400);
});
await test("11. off: a stray header is still removed before route handlers", async () => {
  const r = JSON.parse((await call("GET", "/__probe", withOrigin())).text);
  assert.ok(!r.headerNames.includes(H));
});

// ── 12, 1–3. Enforcement ──
op.configureOriginProtection(enforceEnv);
const reportLines: string[] = [];
op.__setOriginProtectionReporterForTests((l) => reportLines.push(l));

await test("2. enforce: missing header → 403 on API, webhook, internal job and CORS preflight", async () => {
  for (const [m, p] of [["GET", "/api/me/settings"], ["POST", "/api/webhooks/stripe"], ["POST", "/api/webhooks/stripe-connect"], ["POST", "/api/internal/jobs/purge-mobile-web-handoff"], ["OPTIONS", "/api/me/settings"], ["POST", "/api/health"]] as const) {
    const r = await call(m, p, { origin: "https://caretip.de", "access-control-request-method": "GET" });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
});
await test("3. enforce: incorrect header → 403; body reveals nothing", async () => {
  const r = await call("GET", "/api/me/settings", { [H]: ORIGIN.slice(0, -1) + "x" });
  assert.equal(r.status, 403);
  assert.equal(r.text, JSON.stringify({ message: "Forbidden" }));
  assert.equal(r.headers.get("cache-control"), "no-store");
});
await test("12. enforce: direct-origin requests (Render hostname, no header) are rejected", async () => {
  assert.equal(await callWithHost("GET", "/api/me/settings", "caretip.onrender.com"), 403);
  assert.equal(await callWithHost("GET", "/api/me/settings", "api.caretip.de"), 403, "custom domain reached directly at the origin");
  assert.equal(await callWithHost("GET", "/api/me/settings", "caretip.onrender.com", { [H]: ORIGIN }), 401, "with the secret the host does not matter");
});
await test("1. enforce: correct header → request continues normally (auth answers 401, not 403)", async () => {
  assert.equal((await call("GET", "/api/me/settings", withOrigin())).status, 401);
});
await test("rotation: the previous secret is accepted while both are configured", async () => {
  op.configureOriginProtection({ ...enforceEnv, ORIGIN_PROTECTION_SECRET_PREVIOUS: ORIGIN_PREV });
  assert.equal((await call("GET", "/api/me/settings", { [H]: ORIGIN_PREV })).status, 401);
  op.configureOriginProtection(enforceEnv);
  op.__setOriginProtectionReporterForTests((l) => reportLines.push(l));
  assert.equal((await call("GET", "/api/me/settings", { [H]: ORIGIN_PREV })).status, 403, "rejected once removed");
});
await test("enforce: header removed after verification; never visible to route handlers", async () => {
  const r = JSON.parse((await call("GET", "/__probe", withOrigin())).text);
  assert.ok(!r.headerNames.includes(H));
});

// ── 8. Health ──
await test("8. health: GET/HEAD /health and /api/health answer without the header (Render checker)", async () => {
  assert.equal((await call("GET", "/health")).status, 200);
  assert.equal((await call("HEAD", "/health")).status, 200);
  const api = await call("GET", "/api/health");
  assert.equal(api.status, 200, api.text);
  // Never the secret-protected diagnostic (proxy chain, instance); redis appears only outside production.
  assert.ok(!api.text.includes("proxy") && !api.text.includes("instance"), "public body only");
});
await test("8. health: the exemption is exact (no prefix, no other method)", async () => {
  assert.equal((await call("GET", "/health/x")).status, 403);
  assert.equal((await call("GET", "/api/healthz")).status, 403);
  assert.equal((await call("POST", "/health")).status, 403);
});

// ── 5–7. Webhooks and jobs keep their own verification behind the header ──
await test("5. Stripe platform webhook: correct origin + bad signature → 400; valid signature → 200", async () => {
  const ev = signed(PLATFORM_WH, { id: `evt_op_${Date.now()}_p`, type: "customer.created", data: { object: { id: "cus_x", object: "customer" } } });
  const bad = await call("POST", "/api/webhooks/stripe", withOrigin({ "content-type": "application/json", "stripe-signature": "t=1,v1=bad" }), ev.payload);
  assert.equal(bad.status, 400, "signature still verified");
  const ok = await call("POST", "/api/webhooks/stripe", withOrigin({ "content-type": "application/json", "stripe-signature": ev.header }), ev.payload);
  assert.equal(ok.status, 200, ok.text);
});
await test("6. Stripe Connect webhook: platform-signed event refused; Connect-signed event → 200", async () => {
  const ev = signed(CONNECT_WH, { id: `evt_op_${Date.now()}_c`, type: "account.updated", data: { object: { id: "acct_x", object: "account" } } });
  const wrongSecret = signed(PLATFORM_WH, { id: `evt_op_${Date.now()}_w`, type: "account.updated", data: { object: { id: "acct_x", object: "account" } } });
  const bad = await call("POST", "/api/webhooks/stripe-connect", withOrigin({ "content-type": "application/json", "stripe-signature": wrongSecret.header }), wrongSecret.payload);
  assert.equal(bad.status, 400, "each endpoint keeps its own secret");
  const ok = await call("POST", "/api/webhooks/stripe-connect", withOrigin({ "content-type": "application/json", "stripe-signature": ev.header }), ev.payload);
  assert.equal(ok.status, 200, ok.text);
});
await test("7. internal job: correct origin + wrong cron secret → 401; correct cron secret → 200", async () => {
  const bad = await call("POST", "/api/internal/jobs/purge-mobile-web-handoff", withOrigin({ "x-cron-secret": "nope" }));
  assert.equal(bad.status, 401);
  const ok = await call("POST", "/api/internal/jobs/purge-mobile-web-handoff", withOrigin({ "x-cron-secret": CRON }));
  assert.equal(ok.status, 200, ok.text);
});

// ── 10. CORS unchanged ──
async function preflight(origin: string, extra: Record<string, string> = {}) {
  const r = await call("OPTIONS", "/api/me/settings", { origin, "access-control-request-method": "GET", ...extra });
  return { status: r.status, acao: r.headers.get("access-control-allow-origin"), acac: r.headers.get("access-control-allow-credentials") };
}
await test("10. CORS: with the header, preflights match the unprotected behaviour exactly", async () => {
  const protectedAllowed = await preflight("https://caretip.de", withOrigin());
  const protectedEvil = await preflight("https://evil.example", withOrigin());
  op.configureOriginProtection({});
  const plainAllowed = await preflight("https://caretip.de");
  const plainEvil = await preflight("https://evil.example");
  op.configureOriginProtection(enforceEnv);
  op.__setOriginProtectionReporterForTests((l) => reportLines.push(l));
  assert.deepEqual(protectedAllowed, plainAllowed);
  assert.deepEqual(protectedEvil, plainEvil);
  assert.equal(protectedAllowed.acao, "https://caretip.de");
  assert.equal(protectedEvil.acao, null);
});

// ── Client address ──
await test("client address: CF-Connecting-IP is used only for verified requests", async () => {
  const verified = JSON.parse((await call("GET", "/__probe", withOrigin({ "cf-connecting-ip": "203.0.113.9" }))).text);
  assert.equal(verified.clientIp, "203.0.113.9");
  op.configureOriginProtection({ ...enforceEnv, ORIGIN_PROTECTION_MODE: "report" });
  const spoofed = JSON.parse((await call("GET", "/__probe", { "cf-connecting-ip": "203.0.113.66" })).text);
  assert.notEqual(spoofed.clientIp, "203.0.113.66", "unverified CF-Connecting-IP ignored");
  op.configureOriginProtection(enforceEnv);
  op.__setOriginProtectionReporterForTests((l) => reportLines.push(l));
});

// ── 9. Socket.IO ──
function socketAttempt(transports: string[], headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    const s = ioClient(base, { transports, extraHeaders: headers, reconnection: false, timeout: 4000, forceNew: true });
    const done = (r: string) => {
      s.close();
      resolve(r);
    };
    s.on("connect", () => done("connected"));
    s.on("connect_error", (e: Error) => done(e.message === "Unauthorized" ? "reached-auth" : "refused"));
  });
}
await test("9. Socket.IO enforce: handshake without/with wrong header refused (polling and websocket)", async () => {
  for (const t of [["polling"], ["websocket"]]) {
    assert.equal(await socketAttempt(t), "refused", `${t} no header`);
    assert.equal(await socketAttempt(t, { [H]: "wrong-wrong-wrong-wrong-wrong-wrong" }), "refused", `${t} wrong header`);
  }
});
await test("9. Socket.IO enforce: correct header passes to the normal auth step (polling and websocket)", async () => {
  for (const t of [["polling"], ["websocket"]]) {
    assert.equal(await socketAttempt(t, { [H]: ORIGIN }), "reached-auth", `${t}`);
  }
});
await test("9. Socket.IO off: unchanged (reaches the normal auth step without a header)", async () => {
  op.configureOriginProtection({});
  assert.equal(await socketAttempt(["polling"]), "reached-auth");
  op.configureOriginProtection(enforceEnv);
  op.__setOriginProtectionReporterForTests((l) => reportLines.push(l));
});

// ── Report mode ──
await test("report: nothing blocked; one summary line by category, no secret or address", async () => {
  op.configureOriginProtection({ ...enforceEnv, ORIGIN_PROTECTION_MODE: "report" });
  const lines: string[] = [];
  op.__setOriginProtectionReporterForTests((l) => lines.push(l));
  assert.equal(await callWithHost("GET", "/api/me/settings", "caretip.onrender.com"), 401, "not blocked");
  assert.equal((await call("POST", "/api/webhooks/stripe", { "stripe-signature": "t=1,v1=x", "content-type": "application/json" }, "{}")).status, 400, "not blocked; signature still checked");
  await call("GET", "/health");
  op.flushOriginProtectionCounts();
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^\[origin-protection\] mode=report \d+s would reject\/exempt: /);
  assert.match(lines[0]!, /missing:other@render_host=1/);
  assert.match(lines[0]!, /missing:stripe_webhook@/);
  assert.match(lines[0]!, /exempt_health:health@/);
  assert.ok(!lines[0]!.includes(ORIGIN) && !lines[0]!.includes("127.0.0.1"));
});

// ── Successful-validation evidence (validation=accepted) ──
/** node:http request with a chosen Host; returns status and the X-Request-Id the API answered with. */
function hostCall(method: string, path: string, host: string, headers: Record<string, string> = {}): Promise<{ status: number; requestId: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: { ...headers, host } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, requestId: String(res.headers["x-request-id"] ?? "") }));
    });
    req.on("error", reject);
    req.end();
  });
}
/**
 * Stand-in for Cloudflare's edge: a loopback proxy that applies the Transform Rule exactly as configured
 * ("Set static" X-CareTip-Origin-Secret, overwriting any client value; only when Host is api.caretip.de),
 * adds CF-Ray, and forwards to the API. The client never knows the secret.
 */
const edge = createServer((creq, cres) => {
  const headers = { ...creq.headers };
  if (String(headers.host ?? "").replace(/:\d+$/, "") === "api.caretip.de") headers[H] = ORIGIN; // Set static (overwrite)
  headers["cf-ray"] = "8f00000000000abc-AMS";
  const { port } = server.address() as AddressInfo;
  const preq = httpRequest({ host: "127.0.0.1", port, method: creq.method, path: creq.url, headers }, (pres) => {
    cres.writeHead(pres.statusCode ?? 502, pres.headers);
    pres.pipe(cres);
  });
  preq.on("error", () => {
    cres.writeHead(502);
    cres.end();
  });
  creq.pipe(preq);
});
await new Promise<void>((r) => edge.listen(0, "127.0.0.1", r));
function viaEdge(method: string, path: string, host: string, headers: Record<string, string> = {}): Promise<{ status: number; requestId: string }> {
  const { port } = edge.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: { ...headers, host } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, requestId: String(res.headers["x-request-id"] ?? "") }));
    });
    req.on("error", reject);
    req.end();
  });
}
const reportEnv = { ...enforceEnv, ORIGIN_PROTECTION_MODE: "report" };
let evidence: string[] = [];
/** Fresh configuration + capture, as after a deploy (rate-limit state starts empty). */
function freshReport(env: Record<string, string> = reportEnv) {
  op.configureOriginProtection(env);
  evidence = [];
  op.__setOriginProtectionReporterForTests((l) => evidence.push(l));
}
const accepted = () => evidence.filter((l) => l.includes("validation=accepted"));
const allEvidence: string[] = [];
const keep = () => allEvidence.push(...evidence);

await test("accepted config: default 600 s, 0 disables, bad value warns and uses the default, clamped 10–86400", () => {
  assert.equal(op.resolveOriginProtectionConfig(reportEnv).acceptedLogIntervalMs, 600_000);
  assert.equal(op.resolveOriginProtectionConfig({ ...reportEnv, ORIGIN_PROTECTION_ACCEPTED_LOG_INTERVAL_S: "0" }).acceptedLogIntervalMs, 0);
  assert.equal(op.resolveOriginProtectionConfig({ ...reportEnv, ORIGIN_PROTECTION_ACCEPTED_LOG_INTERVAL_S: "3" }).acceptedLogIntervalMs, 10_000);
  assert.equal(op.resolveOriginProtectionConfig({ ...reportEnv, ORIGIN_PROTECTION_ACCEPTED_LOG_INTERVAL_S: "999999" }).acceptedLogIntervalMs, 86_400_000);
  const bad = op.resolveOriginProtectionConfig({ ...reportEnv, ORIGIN_PROTECTION_ACCEPTED_LOG_INTERVAL_S: "ten" });
  assert.equal(bad.acceptedLogIntervalMs, 600_000);
  assert.equal(bad.mode, "report", "a bad interval never changes the mode or the secrets");
  assert.equal(bad.fatal.length, 0);
  assert.match(bad.warnings.join(" "), /ORIGIN_PROTECTION_ACCEPTED_LOG_INTERVAL_S/);
  assert.match(op.describeOriginProtection(op.resolveOriginProtectionConfig(reportEnv)), / accepted_log=600s$/);
  assert.equal(op.describeOriginProtection(op.resolveOriginProtectionConfig({})), "[origin-protection] mode=off", "off summary unchanged");
});

await test("evidence 1+4: correct secret on api.caretip.de → one validation=accepted line (api_host, report, request id)", async () => {
  freshReport();
  const r = await hostCall("GET", "/api/me/settings?token=abc", "api.caretip.de", { [H]: ORIGIN, "cf-ray": "8f0000000000aaaa-FRA", authorization: "Bearer x.y.z", cookie: "refresh=secretcookie" });
  assert.equal(r.status, 401, "auth still answers");
  assert.deepEqual(accepted(), [
    `[origin-protection] validation=accepted mode=report host=api_host category=other transport=http cf_ray=8f0000000000aaaa-FRA request_id=${r.requestId} accepted_since_last_line=0`,
  ]);
  op.flushOriginProtectionCounts();
  assert.equal(evidence.length, 1, "no missing/invalid counted for an accepted request");
  keep();
});

await test("evidence 5: fake client header overwritten by the (simulated) Cloudflare Set static rule is accepted", async () => {
  freshReport();
  const r = await viaEdge("GET", "/api/me/settings", "api.caretip.de", { [H]: "deliberately-wrong-caretip-test-20261127", "x-request-id": "origin-verify-20261127-01" });
  assert.equal(r.status, 401);
  assert.equal(r.requestId, "origin-verify-20261127-01", "client-chosen id is echoed for correlation");
  assert.deepEqual(accepted(), [
    "[origin-protection] validation=accepted mode=report host=api_host category=other transport=http cf_ray=8f00000000000abc-AMS request_id=origin-verify-20261127-01 accepted_since_last_line=0",
  ]);
  op.flushOriginProtectionCounts();
  assert.ok(!evidence.some((l) => /invalid:|missing:/.test(l)), "no invalid or missing outcome");
  keep();
});

await test("evidence 2+3: missing and incorrect headers keep the existing counts and produce no accepted line", async () => {
  freshReport();
  assert.equal((await hostCall("GET", "/api/me/settings", "api.caretip.de")).status, 401, "report: not blocked");
  assert.equal((await hostCall("GET", "/api/me/settings", "api.caretip.de", { [H]: "deliberately-wrong-caretip-test-20261127" })).status, 401);
  assert.equal(accepted().length, 0);
  op.flushOriginProtectionCounts();
  assert.equal(evidence.length, 1);
  assert.match(evidence[0]!, /^\[origin-protection\] mode=report \d+s would reject\/exempt: invalid:other@api_host=1 missing:other@api_host=1$/);
  keep();
});

await test("evidence 6: direct Render requests are distinguished (render_host), with and without the secret", async () => {
  freshReport();
  await hostCall("GET", "/api/me/settings", "caretip.onrender.com");
  await viaEdge("GET", "/api/me/settings", "caretip.onrender.com", { [H]: "fake" }); // rule does not match this host
  assert.equal(accepted().length, 0);
  await hostCall("GET", "/api/me/settings", "caretip.onrender.com", { [H]: ORIGIN });
  await hostCall("GET", "/api/me/settings", "api.caretip.de", { [H]: ORIGIN });
  const a = accepted();
  assert.equal(a.length, 2, "separate rate limit per host label");
  assert.match(a[0]!, / host=render_host /);
  assert.match(a[1]!, / host=api_host /);
  op.flushOriginProtectionCounts();
  assert.match(evidence.find((l) => l.includes("would reject"))!, /invalid:other@render_host=1 missing:other@render_host=1$/);
  keep();
});

await test("evidence 10: rate limit — one line per host label per interval, suppressed count carried, 0 disables", async () => {
  freshReport({ ...reportEnv, ORIGIN_PROTECTION_ACCEPTED_LOG_INTERVAL_S: "60" });
  const t0 = 1_900_000_000_000;
  const req = () => ({ method: "GET", path: "/api/me/settings", headers: { host: "api.caretip.de", [H]: ORIGIN } as Record<string, string> });
  assert.equal(op.decideOriginRequest(req(), t0, "rid-00000001"), "allow");
  for (let i = 1; i <= 5; i++) op.decideOriginRequest(req(), t0 + i * 1000);
  assert.equal(accepted().length, 1, "suppressed inside the interval");
  op.decideOriginRequest(req(), t0 + 60_000, "rid-00000002");
  assert.equal(accepted().length, 2);
  assert.match(accepted()[1]!, /request_id=rid-00000002 accepted_since_last_line=5$/);
  assert.match(accepted()[0]!, /cf_ray=none request_id=rid-00000001 accepted_since_last_line=0$/);
  // Unsafe CF-Ray / request id values are never echoed.
  freshReport();
  op.decideOriginRequest({ method: "GET", path: "/x", headers: { host: "api.caretip.de", [H]: ORIGIN, "cf-ray": "abc\n[origin-protection] forged" } }, t0, "bad id with spaces");
  assert.match(accepted()[0]!, /cf_ray=none request_id=none /);
  freshReport({ ...reportEnv, ORIGIN_PROTECTION_ACCEPTED_LOG_INTERVAL_S: "0" });
  await hostCall("GET", "/api/me/settings", "api.caretip.de", { [H]: ORIGIN });
  assert.equal(accepted().length, 0, "disabled");
  keep();
});

await test("evidence 7: health exemption unchanged (no header → exempt count, never an accepted line)", async () => {
  freshReport();
  assert.equal((await hostCall("GET", "/health", "caretip.onrender.com")).status, 200);
  assert.equal((await hostCall("HEAD", "/api/health", "caretip.onrender.com")).status, 200);
  assert.equal(accepted().length, 0);
  op.flushOriginProtectionCounts();
  assert.match(evidence[0]!, /exempt_health:health@render_host=2$/);
  freshReport({ ...enforceEnv });
  assert.equal((await hostCall("POST", "/health", "caretip.onrender.com")).status, 403, "enforce: still exact GET/HEAD only");
  keep();
});

await test("evidence 8: internal Cron job still needs its own secret after origin acceptance (report and enforce)", async () => {
  for (const env of [reportEnv, enforceEnv]) {
    freshReport(env);
    assert.equal((await viaEdge("POST", "/api/internal/jobs/purge-mobile-web-handoff", "api.caretip.de", { "x-cron-secret": "nope" })).status, 401);
    assert.equal((await viaEdge("POST", "/api/internal/jobs/purge-mobile-web-handoff", "api.caretip.de", { "x-cron-secret": CRON })).status, 200);
    assert.match(accepted()[0]!, new RegExp(`validation=accepted mode=${env.ORIGIN_PROTECTION_MODE} host=api_host category=internal_job transport=http`));
    keep();
  }
});

await test("evidence: Socket.IO acceptance is logged as transport=socket; enforce rejections unchanged", async () => {
  freshReport(enforceEnv);
  assert.equal(await socketAttempt(["polling"], { [H]: ORIGIN }), "reached-auth");
  assert.equal(await socketAttempt(["websocket"]), "refused");
  assert.match(accepted()[0]!, /validation=accepted mode=enforce host=other_host category=socket transport=socket /);
  keep();
});

await test("evidence 9: no secret, header value, fingerprint, path, query, address, cookie or token in any line", () => {
  assert.ok(allEvidence.length >= 8, `collected ${allEvidence.length} lines`);
  const forbidden = [ORIGIN, ORIGIN_PREV, CRON, op.secretFingerprint(ORIGIN), "deliberately-wrong", "/api/me/settings", "token=abc", "127.0.0.1", "secretcookie", "Bearer", "x.y.z", "purge-mobile-web-handoff"];
  for (const line of allEvidence) for (const f of forbidden) assert.ok(!line.includes(f), `a line contained a forbidden value (${forbidden.indexOf(f)})`);
});
edge.close();
op.configureOriginProtection(enforceEnv);

// ── Sentry ──
await test("Sentry: the header is filtered from event payloads", () => {
  const scrubbed = scrubSentryEvent({ request: { headers: { [H]: ORIGIN, "user-agent": "x" } } }) as { request: { headers: Record<string, string> } };
  assert.notEqual(scrubbed.request.headers[H], ORIGIN);
  assert.equal(scrubbed.request.headers["user-agent"], "x");
});

await closeSocketServer().catch(() => {});
server.close();
await prisma.$disconnect();
console.log(failures.length ? `\n${failures.length} of ${checks} failed` : `\norigin-protection: ok (${checks} checks)`);
process.exit(failures.length ? 1 : 0);
