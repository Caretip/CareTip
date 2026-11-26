/**
 * Account-lockout denial-of-service protection (trusted sign-in devices), end to end over HTTP
 * against the real auth routes and a disposable database. Runs on process memory, or on a real
 * disposable Redis when CARETIP_ISOLATED_REDIS_URL is set (then also checks shared state).
 *
 *   node scripts/safe-test.mjs test:login-lockout-device
 *   CARETIP_ISOLATED_REDIS_URL=redis://127.0.0.1:PORT node scripts/safe-test.mjs test:login-lockout-device
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import bcrypt from "bcrypt";
import express from "express";
import { OAuth2Client } from "google-auth-library";

if (process.env.CARETIP_TEST_ISOLATION !== "1") throw new Error("disposable database only (run through safe-test)");
const withRedis = Boolean(process.env.REDIS_URL?.trim());
if (withRedis && !/^redis:\/\/127\.0\.0\.1:\d+$/.test(process.env.REDIS_URL!.trim())) throw new Error("REDIS_URL must be a loopback disposable Redis");

process.env.FRONTEND_URL = "http://127.0.0.1:4174";
process.env.RESEND_API_KEY = "re_test_runtime_only";
process.env.RESEND_FROM = "runtime@example.invalid";
const AUDIENCE = "lockout-test.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_ID = AUDIENCE;
process.env.GOOGLE_CLIENT_IDS = "";

// Google ID tokens signed by a local key (no network).
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
(OAuth2Client.prototype as unknown as Record<string, unknown>).getFederatedSignonCertsAsync = async () => ({
  certs: { test: keys.publicKey.export({ type: "spki", format: "pem" }) },
  format: "PEM",
});
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function googleIdToken(sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: "RS256", kid: "test", typ: "JWT" })}.${b64({ iss: "https://accounts.google.com", aud: AUDIENCE, iat: now, exp: now + 600, email_verified: true, name: "Lockout Test", sub, email })}`;
  return `${data}.${createSign("RSA-SHA256").update(data).sign(keys.privateKey).toString("base64url")}`;
}

const { prisma } = await import("../src/prisma.js");
const { default: authRoutes } = await import("../src/routes/auth.routes.js");
const { __setSendResendEmailOutcomeFnForTests } = await import("../src/services/resendClient.js");
const lockout = await import("../src/services/loginLockout.service.js");
const device = await import("../src/services/trustedLoginDevice.service.js");
const store = await import("../src/utils/rateLimitStore.js");

const mail: Array<{ to: string; text: string }> = [];
__setSendResendEmailOutcomeFnForTests(async (_tag: string, payload: { to: string[]; text?: string; html?: string }) => {
  mail.push({ to: payload.to[0]!, text: `${payload.text ?? ""} ${payload.html ?? ""}` });
  return { kind: "sent" } as never;
});
console.warn = () => {};
console.info = () => {};

const app = express();
app.set("trust proxy", 1); // the test plays Render's proxy: X-Forwarded-For carries the client address
app.use(express.json());
app.use("/api/auth", authRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const tag = randomUUID().slice(0, 8);
let n = 0;
const PW = "Lockout-Synthetic-Pw-9!x";
const HASH = await bcrypt.hash(PW, 4);
let ipSeq = 1;
const freshIp = () => `198.51.${100 + Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

type Res = { status: number; body: Record<string, unknown>; deviceCookie?: string; setCookie?: string };
async function post(path: string, body: unknown, opts: { ip?: string; cookie?: string } = {}): Promise<Res> {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-caretip-client": "1",
      origin: "http://127.0.0.1:4174",
      "x-forwarded-for": opts.ip ?? freshIp(),
      ...(opts.cookie ? { cookie: `${device.TRUSTED_DEVICE_COOKIE}=${opts.cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const set = r.headers.get("set-cookie") ?? "";
  const m = new RegExp(`${device.TRUSTED_DEVICE_COOKIE}=([^;]+)`).exec(set);
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(await r.text()); } catch { /* empty */ }
  return { status: r.status, body: json, deviceCookie: m?.[1], setCookie: set };
}
const login = (email: string, password: string, opts: { ip?: string; cookie?: string } = {}) => post("/api/auth/login", { email, password }, opts);
const isLocked = (r: Res) => r.status === 429 && r.body.code === lockout.LOGIN_TEMPORARILY_LOCKED_CODE;
const isRateLimited = (r: Res) => r.status === 429 && r.body.code !== lockout.LOGIN_TEMPORARILY_LOCKED_CODE;

async function manager() {
  const email = `lock-${tag}-${++n}@runtime.invalid`;
  const user = await prisma.user.create({
    data: {
      email, passwordHash: HASH, role: "MANAGER", emailVerified: true, hasCompletedOnboarding: true, onboardingCompletedAt: new Date(),
      business: { create: { name: `Venue ${tag}-${n}`, slug: `lock-${tag}-${n}`, onboardingVerificationStatus: "approved" } },
    },
  });
  return { user, email };
}

let count = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  count++;
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (err) {
    failures.push(name);
    process.stdout.write(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

await test("repeated wrong passwords (no trusted device): 5 failures lock the email; even the right password then waits", async () => {
  const { email } = await manager();
  const ip = freshIp();
  const out: Res[] = [];
  for (let i = 0; i < 5; i++) out.push(await login(email, "wrong-password-1", { ip }));
  assert.deepEqual(out.slice(0, 4).map((r) => r.status), [401, 401, 401, 401]);
  assert.ok(isLocked(out[4]!), `5th: ${out[4]!.status} ${String(out[4]!.body.code)}`);
  assert.ok(isLocked(await login(email, PW, { ip: freshIp() })), "correct password from a new browser is still refused during the lock");
});

await test("attack on a known email from 25 rotating addresses cannot lock out the owner's trusted browser", async () => {
  const { email } = await manager();
  const first = await login(email, PW);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.deviceCookie, "a correct password issues the trusted-device cookie");
  const results: Res[] = [];
  for (let i = 0; i < 25; i++) results.push(await login(email, `guess-${i}`, { ip: freshIp() }));
  assert.ok(results.some(isLocked), "the email-wide lock still engages against a distributed attack (IP rotation does not help)");
  assert.ok(results.slice(-3).every((r) => isLocked(r) || isRateLimited(r)), "the attack stays blocked");
  const owner = await login(email, PW, { cookie: first.deviceCookie });
  assert.equal(owner.status, 200, `owner on trusted browser: ${owner.status} ${JSON.stringify(owner.body)}`);
});

await test("a trusted-device cookie for another email, or a tampered one, gives no exemption", async () => {
  const a = await manager();
  const b = await manager();
  const cookieA = (await login(a.email, PW)).deviceCookie!;
  for (let i = 0; i < 5; i++) await login(b.email, "wrong", { ip: freshIp() });
  assert.ok(isLocked(await login(b.email, PW, { cookie: cookieA })), "A's cookie does not unlock B");
  const tampered = cookieA.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  assert.equal(device.verifyTrustedDeviceToken(tampered, a.email), null);
  assert.equal(device.verifyTrustedDeviceToken(cookieA, b.email), null);
  assert.ok(device.verifyTrustedDeviceToken(cookieA, a.email));
});

await test("failures on a trusted browser lock only that browser (stolen cookie still limited)", async () => {
  const { email } = await manager();
  const cookie = (await login(email, PW)).deviceCookie!;
  const out: Res[] = [];
  for (let i = 0; i < 5; i++) out.push(await login(email, "wrong", { cookie, ip: freshIp() }));
  assert.ok(isLocked(out[4]!), "device-scoped lock after 5 failures");
  const otherBrowser = await login(email, PW, { ip: freshIp() });
  assert.equal(otherBrowser.status, 200, "the email-wide state was not touched by the device's failures");
});

await test("legitimate login after an attack ends: the lock expires, history clears on success", async () => {
  const { email } = await manager();
  // Use the service directly with a controlled clock (memory) or the real Redis TTLs: begin/fail 5x.
  for (let i = 0; i < 5; i++) {
    const b = await lockout.beginLoginAttempt(email);
    if (b.allowed) await lockout.recordLoginFailure(b.ticket);
  }
  assert.ok(isLocked(await login(email, PW, { ip: freshIp() })));
  await lockout.clearLoginLockout(email); // what a completed reset does; the TTL path is covered by test:login-lockout
  const ok = await login(email, PW, { ip: freshIp() });
  assert.equal(ok.status, 200);
});

await test("account recovery: a completed password reset lifts the email-wide lock; the new password works on any device", async () => {
  const { email } = await manager();
  for (let i = 0; i < 5; i++) await login(email, "wrong", { ip: freshIp() });
  assert.ok(isLocked(await login(email, PW, { ip: freshIp() })));
  mail.length = 0;
  const fp = await post("/api/auth/forgot-password", { email }, { ip: freshIp() });
  assert.equal(fp.status, 200);
  const link = mail.find((m) => m.to === email)?.text.match(/reset-password\/([A-Za-z0-9%_-]+)/)?.[1];
  assert.ok(link, "reset email sent");
  const NEW_PW = "Recovered-Synthetic-Pw-7!y";
  const rp = await post("/api/auth/reset-password", { token: decodeURIComponent(link!), password: NEW_PW }, { ip: freshIp() });
  assert.equal(rp.status, 200, JSON.stringify(rp.body));
  const after = await login(email, NEW_PW, { ip: freshIp() });
  assert.equal(after.status, 200, `after reset: ${after.status} ${JSON.stringify(after.body)}`);
});

await test("forgot-password answers the same for registered and unknown emails during a lock (no enumeration)", async () => {
  const { email } = await manager();
  for (let i = 0; i < 5; i++) await login(email, "wrong", { ip: freshIp() });
  const known = await post("/api/auth/forgot-password", { email }, { ip: freshIp() });
  const unknown = await post("/api/auth/forgot-password", { email: `nobody-${tag}@runtime.invalid` }, { ip: freshIp() });
  assert.equal(known.status, unknown.status);
  assert.deepEqual(known.body, unknown.body);
  const lockedKnown = await login(email, "x", { ip: freshIp() });
  for (let i = 0; i < 5; i++) await login(`ghost-${tag}@runtime.invalid`, "wrong", { ip: freshIp() });
  const lockedUnknown = await login(`ghost-${tag}@runtime.invalid`, "x", { ip: freshIp() });
  assert.equal(lockedKnown.status, lockedUnknown.status, "an unregistered email locks the same way");
  assert.equal(lockedKnown.body.code, lockedUnknown.body.code);
});

await test("Google sign-in is not affected by a password lockout", async () => {
  const { user, email } = await manager();
  const sub = `gsub-${tag}-${n}`;
  await prisma.oAuthAccount.create({ data: { userId: user.id, provider: "google", subject: sub, emailAtLink: email } });
  for (let i = 0; i < 6; i++) await login(email, "wrong", { ip: freshIp() });
  assert.ok(isLocked(await login(email, PW, { ip: freshIp() })));
  const g = await post("/api/auth/oauth", { provider: "google", idToken: googleIdToken(sub, email), isLogin: true }, { ip: freshIp() });
  assert.equal(g.status, 200, `google: ${g.status} ${JSON.stringify(g.body)}`);
  assert.ok(typeof g.body.token === "string");
});

await test("concurrent wrong attempts: at most 5 password checks per round, then locked; the trusted browser still signs in", async () => {
  const { email } = await manager();
  const cookie = (await login(email, PW)).deviceCookie!;
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => login(email, `c-${i}`, { ip: freshIp() })));
  const checked = burst.filter((r) => r.status === 401).length;
  assert.ok(checked <= 5, `password checks in the burst: ${checked}`);
  assert.ok(burst.filter((r) => r.status === 429).length >= 15);
  const owner = await Promise.all([login(email, PW, { cookie }), login(email, PW, { cookie })]);
  assert.ok(owner.every((r) => r.status === 200), owner.map((r) => r.status).join(","));
});

await test("device cookie attributes: HttpOnly, SameSite=Lax, Path=/api/auth, host-only, 180 days", async () => {
  const { email } = await manager();
  const r = await login(email, PW);
  const line = (r.setCookie ?? "").split(/,(?=\s*\w+=)/).find((c) => c.trim().startsWith(`${device.TRUSTED_DEVICE_COOKIE}=`)) ?? "";
  assert.ok(/;\s*HttpOnly/i.test(line), line);
  assert.ok(/;\s*SameSite=Lax/i.test(line), line);
  assert.ok(/;\s*Path=\/api\/auth(;|$)/i.test(line), line);
  assert.ok(!/;\s*Domain=/i.test(line), "host-only (no Domain)");
  assert.ok(/Max-Age=15552000/i.test(line), line);
});

await test("password reset retires every earlier device cookie (incl. many minted during a compromise)", async () => {
  const { email } = await manager();
  const minted: string[] = [];
  for (let i = 0; i < 3; i++) minted.push((await login(email, PW)).deviceCookie!);
  assert.equal(new Set(minted).size, 3, "each fresh browser gets its own device");
  mail.length = 0;
  await post("/api/auth/forgot-password", { email });
  // Sign-in alerts for the three logins arrive asynchronously too: pick the reset email itself.
  const resetMail = mail.find((m) => m.to === email && /reset-password\//.test(m.text));
  assert.ok(resetMail, "reset email sent");
  const token = decodeURIComponent(resetMail!.text.match(/reset-password\/([A-Za-z0-9%_-]+)/)![1]!);
  const NEW_PW = "After-Reset-Synthetic-Pw-5!z";
  assert.equal((await post("/api/auth/reset-password", { token, password: NEW_PW })).status, 200);
  // The old cookies now count as untrusted: their failures hit the email-wide lockout together.
  const results: Res[] = [];
  for (const c of minted) for (let i = 0; i < 2; i++) results.push(await login(email, `guess-${i}`, { cookie: c, ip: freshIp() }));
  assert.ok(results.some(isLocked), "6 failures across 3 stale cookies reach the single email-wide lock (no separate budgets)");
  assert.ok(isLocked(await login(email, NEW_PW, { cookie: minted[0] })), "a stale cookie gives no exemption from that lock");
});

if (withRedis) {
  await test("multi-instance: lock state lives in Redis (survives losing this instance's memory); device state is separate", async () => {
    const { email } = await manager();
    const cookie = (await login(email, PW)).deviceCookie!;
    for (let i = 0; i < 5; i++) await login(email, "wrong", { ip: freshIp() });
    lockout.__resetLoginLockoutMemoryForTests(); // another instance has no local memory of this
    assert.ok(isLocked(await login(email, PW, { ip: freshIp() })), "email-wide lock read back from Redis");
    assert.equal((await login(email, PW, { cookie })).status, 200, "trusted device unaffected");
    const client = (await store.getRateLimitRedisClient()) as { keys(p: string): Promise<string[]> } | null;
    assert.ok(client, "Redis client in use");
    const keys = await client!.keys("auth:lockout:v1:*");
    assert.ok(keys.some((k) => !k.includes("}:d:")) && keys.some((k) => k.includes("}:d:")), "email-wide and device-scoped keys both in Redis");
  });
}

server.close();
await store.closeRateLimitStore().catch(() => {});
await prisma.$disconnect();
console.log(failures.length ? `\n${failures.length} of ${count} failed` : `\nlogin-lockout-device: ok (${count} checks, ${withRedis ? "real Redis" : "memory store"})`);
process.exit(failures.length ? 1 : 0);
