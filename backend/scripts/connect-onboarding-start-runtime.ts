/**
 * POST /api/me/connect/account-link: real routes, middleware, service, Stripe SDK and database against a
 * local fake Stripe server. Disposable database only:
 *   CARETIP_ISOLATED_POSTGRES_URL=... node scripts/safe-test.mjs test:connect-onboarding-start
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
process.env.FRONTEND_URL = "https://app.example.test";

// ---------- fake Stripe ----------
type Reply = { status: number; body: unknown } | "hang" | "drop";
type Call = { method: string; path: string; body: Record<string, unknown>; key?: string; version?: string };
let calls: Call[] = [];
let onCreate: (c: Call) => Reply | null = () => null;
let onLink: (c: Call) => Reply | null = () => null;
const byKey = new Map<string, { body: string; id: string }>();
const accounts = new Set<string>();
let seq = 0;
const run = randomUUID().slice(0, 8);
const stripe = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const path = (req.url ?? "").split("?")[0]!;
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw || "{}") as Record<string, unknown>; } catch { /* form-encoded v1 */ }
    const call: Call = { method: req.method ?? "", path, body, key: req.headers["idempotency-key"] as string, version: req.headers["stripe-version"] as string };
    calls.push(call);
    const send = (r: Reply) => {
      if (r === "hang") return;
      if (r === "drop") return void req.socket.destroy();
      res.writeHead(r.status, { "content-type": "application/json", "request-id": `req_fake_${calls.length}` });
      res.end(JSON.stringify(r.body));
    };
    if (req.method === "POST" && path === "/v2/core/accounts") {
      const override = onCreate(call);
      if (override) return send(override);
      const seen = call.key ? byKey.get(call.key) : undefined;
      if (seen && seen.body !== raw) return send({ status: 400, body: { error: { type: "idempotency_error", code: "idempotency_error", message: "Keys for idempotent requests can only be used with the same parameters" } } });
      const id = seen?.id ?? `acct_1Fake${run}${String(++seq).padStart(8, "0")}`;
      if (call.key) byKey.set(call.key, { body: raw, id });
      accounts.add(id);
      return send({ status: 200, body: { id, object: "v2.core.account", dashboard: "express", applied_configurations: ["merchant", "recipient"] } });
    }
    if (req.method === "POST" && path === "/v2/core/account_links") {
      return send(onLink(call) ?? { status: 200, body: { object: "v2.core.account_link", url: "https://connect.stripe.com/setup/e/fake" } });
    }
    const id = path.split("/").pop()!;
    if (req.method === "GET" && path.startsWith("/v2/core/accounts/") && accounts.has(id)) {
      return send({ status: 200, body: { id, object: "v2.core.account", applied_configurations: ["merchant", "recipient"] } });
    }
    if (req.method === "GET" && path.startsWith("/v1/accounts/") && accounts.has(id)) {
      return send({ status: 200, body: { id, object: "account", charges_enabled: false, payouts_enabled: false, details_submitted: false, created: 1, requirements: {} } });
    }
    send({ status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing", message: "No such resource" } } });
  });
}).listen(0, "127.0.0.1");
await new Promise((r) => stripe.once("listening", r));

const { prisma } = await import("../src/prisma.js");
const { getStripeClient } = await import("../src/services/stripe.service.js");
const client = getStripeClient() as unknown as { _setApiField(k: string, v: unknown): void };
client._setApiField("host", "127.0.0.1");
client._setApiField("port", (stripe.address() as AddressInfo).port);
client._setApiField("protocol", "http");
client._setApiField("timeout", 1500);
client._setApiField("maxNetworkRetries", 0);
const { default: connectRoutes } = await import("../src/routes/connect.routes.js");
const { authResultForUserId } = await import("../src/services/auth.service.js");
const { issueRefreshToken } = await import("../src/services/refreshToken.service.js");

const app = express();
app.use(express.json());
app.use("/api/me", connectRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function owner(data: Record<string, unknown> = {}, role: "MANAGER" | "EMPLOYEE" = "MANAGER") {
  const tag = randomUUID().slice(0, 12);
  const user = await prisma.user.create({
    data: {
      email: `cos-${tag}@test.local`, role, emailVerified: true, hasCompletedOnboarding: true, onboardingCompletedAt: new Date(),
      ...(role === "MANAGER" ? { business: { create: { name: `Café Straße ${tag}`, slug: `cos-${tag}`, ...data } } } : {}),
    },
    include: { business: true },
  });
  const rt = await issueRefreshToken(user.id);
  const session = await authResultForUserId(user.id, { refreshSessionId: rt.id });
  return { userId: user.id, businessId: user.business?.id ?? "", token: session.token };
}
async function start(token?: string, body: unknown = {}) {
  const res = await fetch(`${base}/api/me/connect/account-link`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text || "{}") as { url?: string; code?: string; message?: string } };
}
const stored = async (id: string) => (await prisma.business.findUniqueOrThrow({ where: { id } })).stripeAccountId;
const creates = () => calls.filter((c) => c.method === "POST" && c.path === "/v2/core/accounts");
const links = () => calls.filter((c) => c.path === "/v2/core/account_links");

/** Built at runtime so secret scanners do not flag a fake key. */
const FAKE_KEY = ["sk", "live", "SECRETSECRET"].join("_");
const failures: string[] = [];
let count = 0;
async function test(name: string, fn: () => Promise<void>) {
  count++;
  calls = [];
  onCreate = () => null;
  onLink = () => null;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n").slice(0, 2).join(" ") : e}`);
  }
}

await test("success: one account, saved to the owner's business, hosted link with fixed https return URLs", async () => {
  const o = await owner();
  const out = await start(o.token);
  assert.equal(out.status, 200, out.text);
  assert.equal(out.body.url, "https://connect.stripe.com/setup/e/fake");
  assert.equal(creates().length, 1);
  const id = await stored(o.businessId);
  assert.ok(id && accounts.has(id));
  assert.ok(!out.text.includes(id), "account id is not sent to the browser");
  const link = links()[0]!.body as { account: string; use_case: { account_onboarding: Record<string, unknown> } };
  assert.equal(link.account, id);
  assert.equal(link.use_case.account_onboarding.return_url, "https://app.example.test/dashboard/stripe/connect?connect=return");
  assert.equal(link.use_case.account_onboarding.refresh_url, "https://app.example.test/dashboard/stripe/connect?connect=refresh");
  assert.deepEqual(link.use_case.account_onboarding.configurations, ["merchant", "recipient"]);
});
await test("create request: Accounts v2, DE, express, platform responsibilities, owner metadata, complete UTF-8 body", async () => {
  const o = await owner();
  await start(o.token);
  const c = creates()[0]!;
  assert.equal(c.version, "2026-07-29.dahlia");
  assert.equal(c.key, `connect_express:${o.businessId}`);
  const b = c.body as { dashboard: string; display_name: string; identity: unknown; defaults: unknown; metadata: unknown };
  assert.equal(b.dashboard, "express");
  assert.ok(b.display_name.startsWith("Café Straße"));
  assert.deepEqual(b.identity, { country: "de" });
  assert.deepEqual(b.defaults, { responsibilities: { fees_collector: "application", losses_collector: "application" } });
  assert.deepEqual(b.metadata, { caretip_business_id: o.businessId });
});
await test("existing account is reused", async () => {
  const o = await owner();
  await start(o.token);
  const id = await stored(o.businessId);
  calls = [];
  assert.equal((await start(o.token)).status, 200);
  assert.equal(creates().length, 0);
  assert.equal(await stored(o.businessId), id);
});
for (const [label, status, error] of [
  ["platform profile not completed (live)", 400, { type: "invalid_request_error", message: "Please review the responsibilities of managing losses for connected accounts at https://dashboard.stripe.com/settings/connect/platform-profile." }],
  ["Connect not enabled for the platform", 400, { type: "invalid_request_error", code: "platform_registration_required", message: "You can only create new accounts if you've signed up for Connect. " + ["rk", "live", "SECRETSECRET"].join("_") }],
  ["key without permission", 403, { type: "invalid_request_error", code: "forbidden", message: "The provided key '" + FAKE_KEY + "' does not have access" }],
  ["invalid key", 401, { type: "authentication_error", message: "Invalid API Key provided: " + FAKE_KEY }],
  ["Stripe outage", 500, { type: "api_error", message: "internal" }],
  ["Stripe rate limit", 429, { type: "rate_limit_error", code: "rate_limit", message: "slow down" }],
] as const) {
  await test(`rejected: ${label} -> clean error, nothing saved, no secret shown, retry works once fixed`, async () => {
    const o = await owner();
    onCreate = () => ({ status, body: { error } });
    const out = await start(o.token);
    assert.equal(out.status, 502);
    assert.equal(out.body.code, "STRIPE_ACCOUNT_CREATE_FAILED");
    assert.ok(!/SECRET|sk_live|rk_live|dashboard\.stripe|acct_/.test(out.text), out.text);
    assert.equal(await stored(o.businessId), null);
    assert.equal(links().length, 0);
    onCreate = () => null;
    assert.equal((await start(o.token)).status, 200);
    assert.ok(await stored(o.businessId));
  });
}
await test("platform rejection: the server log holds Stripe's reason, code and request ID", async () => {
  const o = await owner();
  onCreate = () => ({ status: 400, body: { error: { type: "invalid_request_error", code: "platform_x", message: "REASON-TEXT platform-profile" } } });
  const lines: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void lines.push(a.map((x) => (x instanceof Error ? `${x.message}` : JSON.stringify(x))).join(" "));
  try { await start(o.token); } finally { console.error = original; }
  const line = lines.find((l) => l.includes("stripeConnect.v2.accounts.create"));
  assert.ok(line, lines.join("|"));
  for (const part of ["REASON-TEXT", "platform_x", "req_fake_", o.businessId]) assert.ok(line.includes(part), `${part} missing: ${line}`);
});
for (const mode of ["hang", "drop"] as const) {
  await test(`network ${mode}: clean error, nothing saved; retry reuses the same key (no second account)`, async () => {
    const o = await owner();
    onCreate = () => mode;
    const out = await start(o.token);
    assert.equal(out.status, 502);
    assert.equal(await stored(o.businessId), null);
    const key = creates()[0]!.key;
    onCreate = () => null;
    assert.equal((await start(o.token)).status, 200);
    assert.ok(creates().every((c) => c.key === key));
  });
}
await test("reply lost after Stripe created the account: the retry gets the SAME account", async () => {
  const o = await owner();
  let first = true;
  onCreate = (c) => {
    if (!first) return null;
    first = false;
    byKey.set(c.key!, { body: JSON.stringify(c.body), id: `acct_1FakeLOST${run}` });
    accounts.add(`acct_1FakeLOST${run}`);
    return "drop";
  };
  // The SDK may already repeat the dropped request itself (same key).
  await start(o.token);
  assert.equal((await start(o.token)).status, 200);
  assert.equal(await stored(o.businessId), `acct_1FakeLOST${run}`);
});
await test("database cannot save the account: error, then the retry binds the same account", async () => {
  const o = await owner();
  await prisma.$executeRawUnsafe(`ALTER TABLE businesses ADD CONSTRAINT test_no_acct CHECK (id <> '${o.businessId}' OR stripe_account_id IS NULL) NOT VALID`);
  try {
    const out = await start(o.token);
    assert.ok(out.status >= 400, String(out.status));
    assert.ok(!/constraint|prisma|acct_/i.test(out.text), out.text);
    assert.equal(await stored(o.businessId), null);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE businesses DROP CONSTRAINT test_no_acct`);
  }
  const made = [...accounts].length;
  assert.equal((await start(o.token)).status, 200);
  assert.equal([...accounts].length, made, "no second Stripe account");
});
await test("link creation fails: account kept, the retry only makes a new link", async () => {
  const o = await owner();
  onLink = () => ({ status: 400, body: { error: { type: "invalid_request_error", message: "Livemode requests must always be redirected via HTTPS." } } });
  const out = await start(o.token);
  assert.equal(out.status, 502);
  assert.equal(out.body.code, "STRIPE_ACCOUNT_LINK_FAILED");
  const id = await stored(o.businessId);
  assert.ok(id);
  onLink = () => null;
  assert.equal((await start(o.token)).status, 200);
  assert.equal(creates().length, 1);
  assert.equal(await stored(o.businessId), id);
});
await test("eight clicks at once: one Stripe account", async () => {
  const o = await owner();
  const outs = await Promise.all(Array.from({ length: 8 }, () => start(o.token)));
  assert.ok(outs.every((x) => x.status === 200), outs.map((x) => x.status).join());
  assert.equal(creates().length, 1);
});
await test("two server instances at once (no shared queue): same key, one account, one binding", async () => {
  const { __setSerializeConnectEnsureForTests } = await import("../src/services/stripeConnect.service.js");
  const o = await owner();
  __setSerializeConnectEnsureForTests(false);
  try {
    const before = accounts.size;
    const outs = await Promise.all(Array.from({ length: 4 }, () => start(o.token)));
    assert.ok(outs.every((x) => x.status === 200), outs.map((x) => x.status).join());
    assert.equal(accounts.size, before + 1);
  } finally {
    __setSerializeConnectEnsureForTests(true);
  }
});
await test("stored account unknown to Stripe (other mode): refused, never replaced", async () => {
  const id = `acct_1Gone${randomUUID().slice(0, 8)}`;
  const o = await owner({ stripeAccountId: id });
  const out = await start(o.token);
  assert.equal(out.status, 502);
  assert.equal(creates().length, 0);
  assert.equal(await stored(o.businessId), id);
});
await test("no token, bad token, employee: refused before Stripe", async () => {
  const e = await owner({}, "EMPLOYEE");
  for (const [t, s] of [[undefined, 401], ["bad.token.x", 401], [e.token, 403]] as const) assert.equal((await start(t)).status, s);
  assert.equal(calls.length, 0);
});
await test("another tenant: ids in the body never steer the request", async () => {
  const a = await owner();
  const b = await owner();
  const out = await start(b.token, { businessId: a.businessId, stripeAccountId: "acct_1Fake00000001" });
  assert.equal(await stored(a.businessId), null);
  assert.ok(out.status >= 400 || (await stored(b.businessId)) !== "acct_1Fake00000001");
});
await test("closed business and legal hold: refused before Stripe", async () => {
  for (const d of [{ deletedAt: new Date() }, { legalHold: true }]) {
    const o = await owner(d);
    assert.ok((await start(o.token)).status >= 400);
  }
  assert.equal(creates().length, 0);
});
await test("business renamed while an earlier attempt is unresolved at Stripe: refused, never a second account", async () => {
  const o = await owner();
  let first = true;
  onCreate = (c) => {
    if (!first) return null;
    first = false;
    byKey.set(c.key!, { body: JSON.stringify(c.body), id: `acct_1FakeRENAMED${run}` });
    return { status: 400, body: { error: { type: "invalid_request_error", message: "platform-profile" } } };
  };
  assert.equal((await start(o.token)).status, 502);
  await prisma.business.update({ where: { id: o.businessId }, data: { name: "New name" } });
  const out = await start(o.token);
  // Known limit: Stripe rejects the same key with a changed name until the key expires.
  assert.equal(out.body.code, "STRIPE_ACCOUNT_CREATE_FAILED");
  assert.equal(await stored(o.businessId), null);
  assert.ok(creates().every((c) => c.key === creates()[0]!.key));
});

server.close();
stripe.closeAllConnections();
stripe.close();
await prisma.$disconnect();
console.log(failures.length ? `\n${failures.length} of ${count} failed` : `\nconnect-onboarding-start-runtime: ok (${count} scenarios)`);
process.exit(failures.length ? 1 : 0);
