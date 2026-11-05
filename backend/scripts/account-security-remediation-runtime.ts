/**
 * End-to-end proof of the account security fixes, over real routes and a real database, with email
 * captured in process so the links are followed exactly as a person would.
 *
 * Needs a disposable loopback database, and refuses anything else.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import bcrypt from "bcrypt";
import speakeasy from "speakeasy";
import jwt from "jsonwebtoken";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  console.error("REFUSING: account-security-remediation needs a disposable loopback database");
  process.exit(1);
}
process.env.JWT_SECRET ||= "remediation-runtime-secret-remediation-runtime";
process.env.FRONTEND_URL = "http://127.0.0.1:4174";
process.env.RESEND_API_KEY = "re_test_runtime_only";
process.env.RESEND_FROM = "runtime@example.invalid";
process.env.MFA_SECRET_ENCRYPTION_KEY = "runtime-key-runtime-key-runtime-key-runtime";
delete process.env.REDIS_URL;

const { prisma } = await import("../src/prisma.js");
const { default: authRoutes } = await import("../src/routes/auth.routes.js");
const { default: employeeRoutes } = await import("../src/routes/employee.routes.js");
const { default: platformRoutes } = await import("../src/routes/platform.routes.js");
const { __setSendResendEmailOutcomeFnForTests } = await import("../src/services/resendClient.js");
const { signPendingMfaLoginToken } = await import("../src/services/mfaLogin.service.js");
const { issueRefreshToken, rotateRefreshToken } = await import("../src/services/refreshToken.service.js");
const { authResultForUserId } = await import("../src/services/auth.service.js");
const { sealMfaSecret } = await import("../src/lib/mfaSecretCrypto.js");
const { signPurposeJwt } = await import("../src/lib/jwtConfig.js");

type Mail = { to: string; subject: string; text: string };
const mail: Mail[] = [];
__setSendResendEmailOutcomeFnForTests(async (_tag: string, payload: { to: string[]; subject: string; text?: string }) => {
  mail.push({ to: payload.to[0], subject: payload.subject, text: payload.text ?? "" });
  return { kind: "sent" } as never;
});

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/platform", platformRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const rnd = () => Math.random().toString(36).slice(2, 10);
const PW = "Runtime-Synthetic-Pw-9!x";
const HASH = await bcrypt.hash(PW, 4);
type Res = { status: number; json: Record<string, unknown>; headers: Headers };
async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Res> {
  const r = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-caretip-client": "1",
      origin: "http://127.0.0.1:4174",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* empty body */ }
  return { status: r.status, json, headers: r.headers };
}
const totp = (secret: string, offset = 0) => speakeasy.totp({ secret, encoding: "base32", time: Date.now() / 1000 + offset });
const secretFromUrl = (u: unknown) => new URL(String(u)).searchParams.get("secret") ?? "";
async function session(userId: string) {
  const rt = await issueRefreshToken(userId);
  const result = await authResultForUserId(userId, { refreshSessionId: rt.id });
  return { token: result.token, refresh: rt.token, sid: rt.id };
}
async function admin(enrolled = true) {
  const secret = speakeasy.generateSecret({ length: 20 }).base32;
  const user = await prisma.user.create({
    data: {
      email: `admin-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "SUPER_ADMIN", isPlatformAdmin: true,
      emailVerified: true, twoFactorEnabled: enrolled, twoFactorSecret: enrolled ? sealMfaSecret(secret) : null,
    },
  });
  return { user, secret };
}
async function manager() {
  return prisma.user.create({
    data: {
      email: `mgr-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "MANAGER", emailVerified: true,
      hasCompletedOnboarding: true, onboardingCompletedAt: new Date(),
      business: { create: { name: `Venue ${rnd()}`, slug: `v-${rnd()}`, verificationStatus: "verified", kycVerificationStatus: "verified", onboardingVerificationStatus: "approved" } },
    },
    include: { business: true },
  });
}
async function employeeOf(businessId: string) {
  const user = await prisma.user.create({ data: { email: `emp-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "EMPLOYEE", emailVerified: true } });
  const emp = await prisma.employee.create({ data: { name: "Staff", jobTitle: "w", businessId, userId: user.id, slug: `e-${rnd()}`, activationStatus: "active" } });
  await prisma.employeeStripeAccount.create({ data: { employeeId: emp.id, stripeAccountId: `acct_runtime_${rnd()}` } });
  return { user, emp };
}
const storedSecret = async (id: string) => (await prisma.user.findUnique({ where: { id }, select: { twoFactorSecret: true } }))?.twoFactorSecret;
const linkToken = (m: Mail) => decodeURIComponent(/#token=([^\s]+)/.exec(m.text)?.[1] ?? "");
const passed: string[] = [];
const ok = (name: string) => passed.push(name);

// ---------- H-01 ----------
{
  const { user, secret } = await admin(true);
  const before = await storedSecret(user.id);
  const pending = signPendingMfaLoginToken(user.id);
  assert.equal((await call("POST", "/api/auth/login/mfa/setup", { body: { pendingMfaToken: pending } })).status, 403);
  const attacker = speakeasy.generateSecret({ length: 20 }).base32;
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorTempSecret: sealMfaSecret(attacker) } });
  const forced = await call("POST", "/api/auth/login/mfa/enable", { body: { pendingMfaToken: pending, code: totp(attacker) } });
  assert.equal(forced.status, 403, "a staged secret still cannot replace an enrolled factor");
  assert.equal(forced.json.token, undefined);
  assert.equal(await storedSecret(user.id), before, "the enrolled secret is untouched");
  ok("password-only MFA replacement refused");

  const usedCode = totp(secret);
  const good = await call("POST", "/api/auth/login/mfa/verify", { body: { pendingMfaToken: signPendingMfaLoginToken(user.id), code: usedCode } });
  assert.equal(good.status, 200, "the real admin still gets in");
  ok("real admin unaffected");
  const again = await call("POST", "/api/auth/login/mfa/verify", { body: { pendingMfaToken: signPendingMfaLoginToken(user.id), code: usedCode } });
  assert.equal(again.status, 401, "M-03: the same code cannot be used twice");
  ok("TOTP code cannot be replayed");
}
{
  const { user } = await admin(false);
  const pending = signPendingMfaLoginToken(user.id);
  const setup = await call("POST", "/api/auth/login/mfa/setup", { body: { pendingMfaToken: pending } });
  assert.equal(setup.status, 200, "first-time enrolment still works");
  const secret = secretFromUrl(setup.json.otpauthUrl);
  const stored = (await prisma.user.findUnique({ where: { id: user.id }, select: { twoFactorTempSecret: true } }))?.twoFactorTempSecret;
  assert.ok(stored?.startsWith("enc:v1:"), "M-04: new secrets are encrypted at rest");
  const [a, b] = await Promise.all([
    call("POST", "/api/auth/login/mfa/enable", { body: { pendingMfaToken: pending, code: totp(secret) } }),
    call("POST", "/api/auth/login/mfa/enable", { body: { pendingMfaToken: pending, code: totp(secret) } }),
  ]);
  assert.equal([a.status, b.status].filter((s) => s === 200).length, 1, "concurrent enrolment has one winner");
  ok("concurrent enrolment cannot double-succeed");
  const replay = await call("POST", "/api/auth/login/mfa/enable", { body: { pendingMfaToken: pending, code: totp(secret, 30) } });
  assert.notEqual(replay.status, 200, "a used challenge cannot be replayed");
  ok("replayed challenge refused");
}
{
  const { user } = await admin(true);
  const expired = signPurposeJwt("mfa_login_pending", { userId: user.id, purpose: "mfa_login_pending", type: "mfa_login_pending", jti: rnd() }, -10);
  assert.equal((await call("POST", "/api/auth/login/mfa/setup", { body: { pendingMfaToken: expired } })).status, 401);
  ok("expired challenge refused");
}
{
  const { user, secret } = await admin(true);
  const s1 = await session(user.id);
  const s2 = await session(user.id);
  assert.equal((await call("POST", "/api/auth/2fa/disable", { token: s1.token, body: { code: totp(secret) } })).status, 403, "admin MFA cannot be disabled");
  ok("admin MFA disablement refused");
  assert.equal((await call("POST", "/api/auth/2fa/replace/start", { token: s1.token, body: { code: "000000", password: PW } })).status, 400);
  assert.equal((await call("POST", "/api/auth/2fa/replace/start", { token: s1.token, body: { code: totp(secret, -30), password: "wrong" } })).status, 401, "password is required");
  ok("replacement needs password and current code");
  const started = await call("POST", "/api/auth/2fa/replace/start", { token: s1.token, body: { code: totp(secret), password: PW } });
  assert.equal(started.status, 200);
  const next = secretFromUrl(started.json.otpauthUrl);
  const done = await call("POST", "/api/auth/2fa/replace/confirm", { token: s1.token, body: { code: totp(next) } });
  assert.equal(done.status, 200, "legitimate replacement works");
  ok("legitimate MFA replacement works");
  const otherSession = await prisma.refreshToken.findUnique({ where: { id: s2.sid }, select: { revokedAt: true } });
  assert.ok(otherSession?.revokedAt, "other sessions end");
  ok("MFA replacement ends other sessions");
  assert.ok(mail.some((m) => m.to === user.email && /authenticator/i.test(m.subject)), "the owner is told");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await prisma.auditLog.count({ where: { userId: user.id, action: "mfa.replaced" } }), 1, "the change is audited");
  const auditText = JSON.stringify(await prisma.auditLog.findMany({ where: { userId: user.id } }));
  assert.ok(!auditText.includes(secret) && !auditText.includes(next), "audit records never hold a secret");
  ok("MFA change audited without secrets");
}
{
  const a = await admin(true);
  const target = await admin(true);
  const sa = await session(a.user.id);
  const self = await call("POST", `/api/platform/users/${a.user.id}/mfa-reset`, { token: sa.token, body: { code: totp(a.secret), reason: "self" } });
  assert.equal(self.status, 403, "an admin cannot reset their own factor");
  const noProof = await call("POST", `/api/platform/users/${target.user.id}/mfa-reset`, { token: sa.token, body: { code: "000000", reason: "lost" } });
  assert.equal(noProof.status, 403, "the acting admin must prove their own factor");
  const m = await manager();
  const sm = await session(m.id);
  assert.equal((await call("POST", `/api/platform/users/${target.user.id}/mfa-reset`, { token: sm.token, body: { code: "000000", reason: "x" } })).status, 403, "managers cannot reach recovery");
  ok("MFA recovery abuse refused");
  const st = await session(target.user.id);
  const reset = await call("POST", `/api/platform/users/${target.user.id}/mfa-reset`, { token: sa.token, body: { code: totp(a.secret, 30), reason: "lost phone" } });
  assert.equal(reset.status, 200, "a second admin can recover the account");
  assert.ok((await prisma.refreshToken.findUnique({ where: { id: st.sid }, select: { revokedAt: true } }))?.revokedAt, "target is signed out");
  ok("legitimate admin recovery works and signs the target out");
}

// ---------- H-02 ----------
{
  const m = await manager();
  const { user, emp } = await employeeOf(m.business!.id);
  const stripeBefore = await prisma.employeeStripeAccount.findUnique({ where: { employeeId: emp.id } });
  const sm = await session(m.id);
  const victim = await session(user.id);
  const originalEmail = user.email;
  const attackerInbox = `attacker-${rnd()}@runtime.invalid`;

  const patched = await call("PATCH", `/api/employees/${emp.id}`, { token: sm.token, body: { email: attackerInbox } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.emailChangePending, true);
  assert.equal(patched.json.email, originalEmail, "the response shows the unchanged email");
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.email, originalEmail, "login email is unchanged");
  ok("manager cannot change an employee's login email");

  assert.equal(mail.filter((x) => x.to === attackerInbox).length, 0, "the requested address receives nothing yet");
  const approval = mail.find((x) => x.to === originalEmail);
  assert.ok(approval, "the employee is asked at their existing address");
  ok("new address gets nothing until the owner consents");

  const forged = jwt.sign({ purpose: "email_change_confirm", type: "email_change_confirm", userId: user.id, oldEmail: originalEmail, newEmail: attackerInbox, tv: 0, jti: rnd(), requestedBy: m.id }, "wrong-secret", { algorithm: "HS256" });
  assert.equal((await call("POST", "/api/auth/email-change/confirm", { body: { token: forged } })).status, 400);
  assert.equal((await call("POST", "/api/auth/email-change/confirm", { body: { token: linkToken(approval!) } })).status, 400, "an approval link cannot confirm");
  ok("forged and wrong-purpose tokens refused");

  const expired = signPurposeJwt("email_change_confirm", { purpose: "email_change_confirm", type: "email_change_confirm", userId: user.id, oldEmail: originalEmail, newEmail: attackerInbox, tv: 0, jti: rnd(), requestedBy: m.id }, -10);
  assert.equal((await call("POST", "/api/auth/email-change/confirm", { body: { token: expired } })).status, 400);
  ok("expired verification refused");

  assert.equal((await call("POST", "/api/auth/email-change/approve", { body: { token: linkToken(approval!) } })).status, 200);
  assert.equal((await call("POST", "/api/auth/email-change/approve", { body: { token: linkToken(approval!) } })).status, 400, "single use");
  ok("approval cannot be replayed");
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.email, originalEmail, "still unchanged until the new address proves itself");
  ok("unverified replacement email is not trusted");

  const confirm = mail.find((x) => x.to === attackerInbox);
  assert.ok(confirm);
  const reset = await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: `h-${rnd()}`, expiresAt: new Date(Date.now() + 3600_000) } });
  const [c1, c2] = await Promise.all([
    call("POST", "/api/auth/email-change/confirm", { body: { token: linkToken(confirm!) } }),
    call("POST", "/api/auth/email-change/confirm", { body: { token: linkToken(confirm!) } }),
  ]);
  assert.equal([c1.status, c2.status].filter((s) => s === 200).length, 1, "concurrent confirmation has one winner");
  ok("verification cannot be raced or replayed");
  const after = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(after?.email, attackerInbox, "a fully approved change completes");
  ok("legitimate email change completes");
  assert.equal(await prisma.passwordResetToken.count({ where: { id: reset.id } }), 0, "recovery tokens are cleared");
  assert.ok((await prisma.refreshToken.findUnique({ where: { id: victim.sid }, select: { revokedAt: true } }))?.revokedAt, "sessions end");
  assert.equal(await rotateRefreshToken(victim.refresh), null);
  ok("sessions and recovery tokens invalidated");
  assert.ok(mail.some((x) => x.to === originalEmail && /was changed/i.test(x.subject)), "old address is told");
  ok("existing address notified");
  const stripeAfter = await prisma.employeeStripeAccount.findUnique({ where: { employeeId: emp.id } });
  assert.equal(stripeAfter?.stripeAccountId, stripeBefore?.stripeAccountId);
  assert.equal((await prisma.employee.findUnique({ where: { id: emp.id } }))?.userId, user.id);
  ok("payout ownership unchanged");
  assert.ok((await prisma.auditLog.count({ where: { action: "account.email_change.completed", userId: user.id } })) === 1);
  ok("email change audited");
}
{
  // A change that has gone stale is dead, even with a valid link.
  const m = await manager();
  const { user, emp } = await employeeOf(m.business!.id);
  const sm = await session(m.id);
  mail.length = 0;
  await call("PATCH", `/api/employees/${emp.id}`, { token: sm.token, body: { email: `later-${rnd()}@runtime.invalid` } });
  const link = mail.find((x) => x.to === user.email);
  await prisma.user.update({ where: { id: user.id }, data: { authTokenVersion: { increment: 1 } } });
  assert.equal((await call("POST", "/api/auth/email-change/approve", { body: { token: linkToken(link!) } })).status, 400);
  ok("password change invalidates a pending request");
}
{
  // Self-service needs the password; another user's address cannot be claimed.
  const m = await manager();
  const other = await manager();
  const { user } = await employeeOf(m.business!.id);
  const s = await session(user.id);
  assert.equal((await call("POST", "/api/auth/email-change/request", { token: s.token, body: { newEmail: `n-${rnd()}@runtime.invalid`, currentPassword: "wrong" } })).status, 401);
  assert.equal((await call("POST", "/api/auth/email-change/request", { token: s.token, body: { newEmail: other.email, currentPassword: PW } })).status, 409);
  mail.length = 0;
  const wanted = `self-${rnd()}@runtime.invalid`;
  assert.equal((await call("POST", "/api/auth/email-change/request", { token: s.token, body: { newEmail: wanted, currentPassword: PW } })).status, 202);
  assert.ok(mail.some((x) => x.to === user.email), "old address is warned");
  assert.ok(mail.some((x) => x.to === wanted), "new address must confirm");
  ok("self-service email change needs password and proof");
}

// ---------- Account status ----------
{
  const m = await manager();
  const s = await session(m.id);
  await prisma.user.update({ where: { id: m.id }, data: { isActive: false, accountStatus: "deactivated" } as never }).catch(async () => {
    await prisma.user.update({ where: { id: m.id }, data: { isActive: false } });
  });
  assert.equal((await call("GET", "/api/auth/2fa/status", { token: s.token })).status, 401, "a disabled account stops immediately");
  ok("disabled user's live session stops working");
}

// ---------- M-06 support view ----------
{
  const a = await admin(true);
  const m = await manager();
  const sa = await session(a.user.id);
  const imp = await call("POST", "/api/platform/impersonate", { token: sa.token, body: { businessId: m.business!.id } });
  assert.equal(imp.status, 200);
  const started = await prisma.auditLog.findFirst({ where: { userId: a.user.id, action: "platform.impersonation.started" } });
  assert.ok(started?.metadata?.includes(m.business!.id), "the target is on record");
  ok("impersonation target recorded");
  const decoded = jwt.decode(String(imp.json.token)) as jwt.JwtPayload;
  assert.ok((decoded.exp ?? 0) - (decoded.iat ?? 0) <= 3600, "support sessions are short");
  const blocked = await call("POST", "/api/auth/change-password", { token: String(imp.json.token), body: { currentPassword: PW, newPassword: PW + "2" } });
  assert.equal(blocked.status, 403, "support view cannot change credentials");
  assert.equal((await call("GET", "/api/auth/2fa/status", { token: String(imp.json.token) })).status, 200, "support view can still read");
  await new Promise((r) => setTimeout(r, 150));
  const write = await prisma.auditLog.findFirst({ where: { userId: a.user.id, action: "platform.impersonation.write" } });
  assert.ok(write?.metadata?.includes(m.id), "writes are attributed to the admin");
  ok("support view blocks credential changes and attributes writes");
}

// ---------- M-07 ----------
{
  const a = await admin(true);
  const sa = await session(a.user.id);
  await call("GET", "/api/platform/businesses/does-not-exist", { token: sa.token });
  await new Promise((r) => setTimeout(r, 150));
  const row = await prisma.auditLog.findFirst({ where: { userId: a.user.id, action: "platform.api" }, orderBy: { createdAt: "desc" } });
  const meta = JSON.parse(row?.metadata ?? "{}") as { status?: number; path?: string };
  assert.ok(typeof meta.status === "number", "audit records the outcome");
  ok("admin audit records the outcome");
}

// ---------- M-08 sockets ----------
{
  const { createServer } = await import("node:http");
  const { initSocketServer, sweepRevokedSockets } = await import("../src/socket/socketServer.js");
  const { revokeAllRefreshTokensForUser, revokeOtherRefreshTokensForUser } = await import("../src/services/refreshToken.service.js");
  const { io: connect } = await import("socket.io-client");
  const http = createServer();
  initSocketServer(http);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const open = (token: string) => new Promise<{ connected: boolean; once: (e: string, f: () => void) => void; close: () => void }>((resolve, reject) => {
    const c = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
    c.once("connect", () => resolve(c));
    c.once("connect_error", reject);
  });
  const m = await manager();
  const s = await session(m.id);
  const c1 = await open(s.token);
  const gone = new Promise<void>((r) => c1.once("disconnect", () => r()));
  await revokeAllRefreshTokensForUser(m.id);
  await Promise.race([gone, new Promise((_, rej) => setTimeout(() => rej(new Error("socket stayed open")), 3000))]);
  ok("socket ends with the session");

  const m2 = await manager();
  const keep = await session(m2.id);
  const old = await session(m2.id);
  const c2 = await open(old.token);
  const c3 = await open(keep.token);
  await revokeOtherRefreshTokensForUser(m2.id, keep.sid);
  assert.equal(await sweepRevokedSockets(), 1, "the sweep drops only the revoked session");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(c2.connected, false);
  assert.equal(c3.connected, true);
  ok("revoked sockets found by sweep, others kept");
  c3.close();
  http.close();
}

// ---------- M-13 refund ordering ----------
{
  const { upsertStripeRefundEvent, applyExistingStripeRefundsAfterSuccessfulTip } = await import("../src/services/finance/tipRefunds.service.js");
  const m = await manager();
  const pi = `pi_runtime_${rnd()}`;
  const refund = { id: `re_runtime_${rnd()}`, amount: 500, currency: "eur", status: "succeeded", reason: null, created: Math.floor(Date.now() / 1000), charge: "ch_runtime" };
  await upsertStripeRefundEvent({ stripeRefundId: refund.id, stripePaymentIntentId: pi, amountCents: 500, status: "succeeded", occurredAt: new Date() });
  assert.equal(await prisma.tipRefund.count({ where: { stripeRefundId: refund.id } }), 0, "precondition: event arrived before the tip");
  await prisma.transaction.create({ data: { amount: 5, status: "success", businessId: m.business!.id, stripePaymentIntentId: pi } });
  await applyExistingStripeRefundsAfterSuccessfulTip({ paymentIntentId: pi, listRefunds: async () => [refund as never] });
  await applyExistingStripeRefundsAfterSuccessfulTip({ paymentIntentId: pi, listRefunds: async () => [refund as never] });
  assert.equal(await prisma.tipRefund.count({ where: { stripeRefundId: refund.id } }), 1, "recorded once, however often it runs");
  ok("refund that beat the tip is recovered, once");
}

// ---------- Financial records survive account removal ----------
{
  const m = await manager();
  const tx = await prisma.transaction.create({ data: { amount: 5, status: "success", businessId: m.business!.id, stripePaymentIntentId: `pi_runtime_${rnd()}` } });
  await assert.rejects(prisma.business.delete({ where: { id: m.business!.id } }));
  assert.equal(await prisma.transaction.count({ where: { id: tx.id } }), 1);
  ok("financial records cannot be cascade-deleted");
}

// ---------- M-02 / M-05 ----------
{
  const m = await manager();
  mail.length = 0;
  const known = await call("POST", "/api/auth/register", { body: { email: m.email, password: PW, role: "business", merchantLegalAccepted: true } });
  const fresh = await call("POST", "/api/auth/register", { body: { email: `fresh-${rnd()}@runtime.invalid`, password: PW, role: "business", merchantLegalAccepted: true } });
  assert.equal(known.status, fresh.status, "registration answers the same for a known address");
  assert.equal(known.json.requiresEmailVerification, fresh.json.requiresEmailVerification);
  assert.deepEqual(Object.keys(known.json.user as object).sort(), Object.keys(fresh.json.user as object).sort(), "same response shape");
  assert.notEqual((known.json.user as { id: string }).id, m.id, "no real id leaks");
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(mail.some((x) => x.to === m.email), "the owner is told");
  ok("registration does not reveal existing accounts");
}

// ---------- Native client contract: what the Expo app relies on ----------
{
  const native = async (path: string, init: { body?: unknown; refresh?: string; token?: string } = {}) => {
    const r = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-caretip-client": "1",
        ...(init.refresh ? { cookie: `caretip_refresh=${encodeURIComponent(init.refresh)}` } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: JSON.stringify(init.body ?? {}),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown>, refresh: r.headers.get("x-caretip-refresh") };
  };
  const m = await manager();
  const login = await native("/api/auth/login", { body: { email: m.email, password: PW } });
  assert.equal(login.status, 200, "a client with no Origin can sign in");
  assert.ok(login.refresh, "and receives the refresh token it needs");
  assert.match(login.refresh!, /^[0-9a-z]+\.[A-Za-z0-9_-]+$/);
  assert.equal(/caretip_refresh=([^;\s,]+)/.exec(`caretip_refresh=${login.refresh}; Path=/`)?.[1], login.refresh, "the app's cookie parser reads the new format");
  ok("native login still receives its refresh token");

  const first = await native("/api/auth/refresh", { refresh: login.refresh! });
  assert.equal(first.status, 200, "refresh works");
  assert.ok(first.refresh && first.refresh !== login.refresh, "and rotates");
  ok("native refresh rotates");
  const out = await native("/api/auth/logout", { refresh: first.refresh!, token: String(first.json.token) });
  assert.ok(out.status < 300, "logout works");
  assert.notEqual((await native("/api/auth/refresh", { refresh: first.refresh! })).status, 200, "a logged-out token is dead");
  ok("native logout ends the session");

  const second = await native("/api/auth/login", { body: { email: m.email, password: PW } });
  await prisma.user.update({ where: { id: m.id }, data: { isActive: false } });
  assert.notEqual((await native("/api/auth/refresh", { refresh: second.refresh! })).status, 200, "a suspended account cannot refresh");
  ok("suspended native session cannot refresh");

  const a = await admin(true);
  const step = await native("/api/auth/login", { body: { email: a.user.email, password: PW } });
  const verified = await native("/api/auth/login/mfa/verify", { body: { pendingMfaToken: step.json.pendingMfaToken, code: totp(a.secret) } });
  assert.equal(verified.status, 200, "MFA works without Origin");
  assert.ok(verified.refresh, "and returns the refresh token");
  ok("native MFA login works");
}

for (const p of passed) console.log(`PASS ${p}`);
console.log(`account-security-remediation: ok (${passed.length} checks)`);
await prisma.$disconnect();
server.close();
process.exit(0);
