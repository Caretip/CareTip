/**
 * Support-assisted employee recovery, end to end, over real routes and a real database, with email
 * captured in process so the links are followed as a person would. Needs a disposable loopback DB.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import bcrypt from "bcrypt";
import speakeasy from "speakeasy";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("REFUSING: account-recovery needs a disposable loopback database");
  process.exit(1);
}
process.env.JWT_SECRET ||= "recovery-runtime-secret-recovery-runtime-secret";
process.env.FRONTEND_URL = "http://127.0.0.1:4174";
process.env.RESEND_API_KEY = "re_test_runtime_only";
process.env.RESEND_FROM = "runtime@example.invalid";
process.env.MFA_SECRET_ENCRYPTION_KEY = "runtime-key-runtime-key-runtime-key-runtime";
delete process.env.REDIS_URL;

const { prisma } = await import("../src/prisma.js");
const { default: authRoutes } = await import("../src/routes/auth.routes.js");
const { default: platformRoutes } = await import("../src/routes/platform.routes.js");
const { __setSendResendEmailOutcomeFnForTests } = await import("../src/services/resendClient.js");
const { issueRefreshToken } = await import("../src/services/refreshToken.service.js");
const { authResultForUserId } = await import("../src/services/auth.service.js");
const { sealMfaSecret } = await import("../src/lib/mfaSecretCrypto.js");
const { buildDsarExportPackage, exportPackageContainsSecrets } = await import("../src/services/dsarExport.service.js");
const { signPurposeJwt } = await import("../src/lib/jwtConfig.js");

type Mail = { to: string; subject: string; text: string };
const mail: Mail[] = [];
__setSendResendEmailOutcomeFnForTests(async (_t: string, p: { to: string[]; subject: string; text?: string }) => {
  mail.push({ to: p.to[0], subject: p.subject, text: p.text ?? "" });
  return { kind: "sent" } as never;
});

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/platform", platformRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const rnd = () => Math.random().toString(36).slice(2, 10);
const HASH = await bcrypt.hash("Runtime-Synthetic-Pw-9!x", 4);

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", "x-caretip-client": "1", origin: "http://127.0.0.1:4174", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, json, text };
}
const session = async (id: string) => { const rt = await issueRefreshToken(id); return { token: (await authResultForUserId(id, { refreshSessionId: rt.id })).token, sid: rt.id }; };
async function admin() {
  const secret = speakeasy.generateSecret({ length: 20 }).base32;
  const user = await prisma.user.create({ data: { email: `admin-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "SUPER_ADMIN", isPlatformAdmin: true, emailVerified: true, twoFactorEnabled: true, twoFactorSecret: sealMfaSecret(secret) } });
  secretsOwner.set(secret, user.id);
  return { user, secret, ...(await session(user.id)) };
}
/** Each review step needs a fresh code. Replay protection burns used ones, so the test clears its own. */
const secretsOwner = new Map<string, string>();
async function code(secret: string): Promise<string> {
  const id = secretsOwner.get(secret);
  if (id) await prisma.consumedMfaChallenge.deleteMany({ where: { jti: { startsWith: `totp:${id}:` } } });
  return speakeasy.totp({ secret, encoding: "base32" });
}
async function employee() {
  const m = await prisma.user.create({ data: { email: `mgr-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "MANAGER", emailVerified: true, hasCompletedOnboarding: true, onboardingCompletedAt: new Date(), business: { create: { name: `V ${rnd()}`, slug: `v-${rnd()}` } } }, include: { business: true } });
  const user = await prisma.user.create({ data: { email: `emp-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "EMPLOYEE", emailVerified: true } });
  const emp = await prisma.employee.create({ data: { name: "Staff", jobTitle: "w", businessId: m.business!.id, userId: user.id, slug: `e-${rnd()}`, activationStatus: "active" } });
  await prisma.employeeStripeAccount.create({ data: { employeeId: emp.id, stripeAccountId: `acct_runtime_${rnd()}` } });
  const tip = await prisma.transaction.create({ data: { amount: 5, status: "success", businessId: m.business!.id, employeeId: emp.id, stripePaymentIntentId: `pi_runtime_${rnd()}` } });
  return { m, user, emp, tip };
}
const linkToken = (m: Mail) => decodeURIComponent(/#token=([^\s]+)/.exec(m.text)?.[1] ?? "");
const passed: string[] = [];
const ok = (n: string) => passed.push(n);
const request = (loginEmail: string, replacementEmail: string) => call("POST", "/api/auth/account-recovery/request", { body: { loginEmail, replacementEmail, statement: "I lost my old mailbox" } });
const open = (userId: string) => prisma.accountRecoveryRequest.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
async function toIdentityReview(userEmail: string, replacement: string) {
  await request(userEmail, replacement);
  const m = mail.find((x) => x.to === replacement);
  await call("POST", "/api/auth/account-recovery/confirm", { body: { token: linkToken(m!) } });
}

const a1 = await admin();
const a2 = await admin();

// Enumeration
{
  const { user } = await employee();
  const known = await request(user.email, `new-${rnd()}@runtime.invalid`);
  const unknown = await request(`nobody-${rnd()}@runtime.invalid`, `new-${rnd()}@runtime.invalid`);
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.equal(known.text, unknown.text, "the form cannot reveal accounts");
  ok("request does not reveal accounts");
}
// Only employees
{
  const { m } = await employee();
  await request(m.email, `new-${rnd()}@runtime.invalid`);
  assert.equal(await prisma.accountRecoveryRequest.count({ where: { userId: m.id } }), 0, "managers cannot use this");
  await request(a1.user.email, `new-${rnd()}@runtime.invalid`);
  assert.equal(await prisma.accountRecoveryRequest.count({ where: { userId: a1.user.id } }), 0, "admins cannot use this");
  ok("manager and admin accounts cannot use recovery");
}
// Concurrency and repeats
{
  const { user } = await employee();
  await Promise.all(Array.from({ length: 6 }, () => request(user.email, `new-${rnd()}@runtime.invalid`)));
  assert.equal(await prisma.accountRecoveryRequest.count({ where: { userId: user.id } }), 1, "one open request per account");
  ok("concurrent and repeated requests create one");
}
// Full happy path with every refusal along the way
{
  const { m, user, emp, tip } = await employee();
  const old = user.email;
  const replacement = `recovered-${rnd()}@runtime.invalid`;
  const victim = await session(user.id);
  const stripeBefore = await prisma.employeeStripeAccount.findUnique({ where: { employeeId: emp.id } });
  mail.length = 0;
  await request(old, replacement);
  const row = await open(user.id);
  assert.equal(row.status, "awaiting_email_proof");
  assert.equal(mail.filter((x) => x.to === old).length, 0);

  const early = await call("POST", `/api/platform/account-recovery/${row.id}/verify-identity`, { token: a1.token, body: { code: await code(a1.secret), method: "video_call", evidenceRef: "T-1" } });
  assert.equal(early.status, 409, "unproven replacement cannot be reviewed");
  ok("review needs a proven replacement address");

  const confirm = mail.find((x) => x.to === replacement)!;
  assert.equal((await call("POST", "/api/auth/account-recovery/confirm", { body: { token: linkToken(confirm) } })).status, 200);
  assert.equal((await call("POST", "/api/auth/account-recovery/confirm", { body: { token: linkToken(confirm) } })).status, 400, "single use");
  ok("confirmation link cannot be replayed");
  assert.ok(mail.some((x) => x.to === old && /recover/i.test(x.subject)), "existing address is warned");
  ok("existing address is warned");

  const sm = await session(m.id);
  assert.equal((await call("GET", "/api/platform/account-recovery", { token: sm.token })).status, 403, "managers cannot see the queue");
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: sm.token, body: { code: "000000", reason: "x" } })).status, 403);
  const se = await session(user.id);
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: se.token, body: { code: "000000", reason: "x" } })).status, 403);
  ok("managers and employees cannot review");

  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/verify-identity`, { token: a1.token, body: { code: await code(a1.secret), method: "guess", evidenceRef: "T-1" } })).status, 400);
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/verify-identity`, { token: a1.token, body: { code: await code(a1.secret), method: "video_call" } })).status, 400);
  ok("identity method and evidence are required");
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/verify-identity`, { token: a1.token, body: { code: "000000", method: "video_call", evidenceRef: "T-1" } })).status, 403, "reviewer proves their factor");
  ok("reviewer must prove their own factor");
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: a2.token, body: { code: await code(a2.secret), reason: "skip" } })).status, 409, "approval cannot skip identity review");
  ok("approval cannot skip identity review");
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/verify-identity`, { token: a1.token, body: { code: await code(a1.secret), method: "video_call", evidenceRef: "T-1" } })).status, 200);

  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: a1.token, body: { code: await code(a1.secret), reason: "self" } })).status, 403, "same admin cannot approve");
  ok("the same admin cannot verify and approve");
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: a2.token, body: { code: await code(a2.secret), reason: "ok" } })).status, 409, "cooling-off holds");
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.email, old);
  ok("cooling-off period is enforced");

  await prisma.accountRecoveryRequest.update({ where: { id: row.id }, data: { eligibleAt: new Date(Date.now() - 1000) } });
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: a2.token, body: { code: await code(a2.secret) } })).status, 400, "a reason is required");
  const [c1, c2] = await Promise.all([
    call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: a2.token, body: { code: await code(a2.secret), reason: "identity confirmed" } }),
    call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: a2.token, body: { code: await code(a2.secret), reason: "identity confirmed" } }),
  ]);
  assert.equal([c1.status, c2.status].filter((s) => s === 200).length, 1, "one approval wins");
  ok("concurrent approval has one winner");

  const after = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(after?.email, replacement);
  assert.equal(after?.id, user.id, "same account");
  ok("legitimate recovery completes");
  assert.ok((await prisma.refreshToken.findUnique({ where: { id: victim.sid }, select: { revokedAt: true } }))?.revokedAt, "sessions end");
  ok("sessions end on recovery");
  assert.equal((await prisma.employeeStripeAccount.findUnique({ where: { employeeId: emp.id } }))?.stripeAccountId, stripeBefore?.stripeAccountId);
  assert.equal((await prisma.employee.findUnique({ where: { id: emp.id } }))?.userId, user.id);
  assert.equal((await prisma.transaction.findUnique({ where: { id: tip.id } }))?.employeeId, emp.id);
  ok("employment, tips and payout links unchanged");
  const done = await prisma.accountRecoveryRequest.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(done.identityVerifiedById, a1.user.id);
  assert.equal(done.approvedById, a2.user.id);
  assert.ok(done.identityVerifiedAt && done.approvedAt && done.approvalReason);
  const audit = await prisma.auditLog.findFirst({ where: { action: "account.recovery.completed", userId: a2.user.id } });
  assert.ok(audit?.metadata?.includes(a1.user.id), "both reviewers are on record");
  ok("reviewers, times and reason are recorded");
  assert.ok(mail.some((x) => x.to === old && /was changed/i.test(x.subject)));
  ok("both addresses told of completion");
}
// Cancel by the existing address
{
  const { user } = await employee();
  const replacement = `c-${rnd()}@runtime.invalid`;
  mail.length = 0;
  await toIdentityReview(user.email, replacement);
  const warning = mail.find((x) => x.to === user.email)!;
  assert.equal((await call("POST", "/api/auth/account-recovery/cancel", { body: { token: linkToken(warning) } })).status, 200);
  assert.equal((await open(user.id)).status, "cancelled");
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.email, user.email);
  ok("existing address can cancel");
}
// Reject, expiry, stale account, replacement taken
{
  const { user } = await employee();
  mail.length = 0;
  await toIdentityReview(user.email, `r-${rnd()}@runtime.invalid`);
  const row = await open(user.id);
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/reject`, { token: a1.token, body: {} })).status, 400);
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/reject`, { token: a1.token, body: { reason: "failed identity check" } })).status, 200);
  assert.equal((await open(user.id)).rejectedById, a1.user.id);
  ok("rejection is recorded with a reason");
}
{
  const { user } = await employee();
  const replacement = `x-${rnd()}@runtime.invalid`;
  mail.length = 0;
  await request(user.email, replacement);
  const row = await open(user.id);
  await prisma.accountRecoveryRequest.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const m = mail.find((x) => x.to === replacement)!;
  assert.equal((await call("POST", "/api/auth/account-recovery/confirm", { body: { token: linkToken(m) } })).status, 400, "expired request");
  const expiredLink = signPurposeJwt("account_recovery_confirm", { purpose: "account_recovery_confirm", requestId: row.id, jti: rnd() }, -10);
  assert.equal((await call("POST", "/api/auth/account-recovery/confirm", { body: { token: expiredLink } })).status, 400, "expired link");
  ok("expired request and link refused");
}
{
  const { user } = await employee();
  const replacement = `t-${rnd()}@runtime.invalid`;
  mail.length = 0;
  await toIdentityReview(user.email, replacement);
  const row = await open(user.id);
  await call("POST", `/api/platform/account-recovery/${row.id}/verify-identity`, { token: a1.token, body: { code: await code(a1.secret), method: "employer_confirmation", evidenceRef: "T-2" } });
  await prisma.accountRecoveryRequest.update({ where: { id: row.id }, data: { eligibleAt: new Date(Date.now() - 1000) } });
  await prisma.user.create({ data: { email: replacement, passwordHash: HASH, role: "EMPLOYEE", emailVerified: true } });
  assert.equal((await call("POST", `/api/platform/account-recovery/${row.id}/approve`, { token: a2.token, body: { code: await code(a2.secret), reason: "ok" } })).status, 409, "taken address");
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.email, user.email);
  assert.equal((await open(user.id)).status, "awaiting_approval", "the failed change rolled back completely");
  ok("a taken replacement rolls back atomically");
}

{
  const { user } = await employee();
  const replacement = `d-${rnd()}@runtime.invalid`;
  mail.length = 0;
  await toIdentityReview(user.email, replacement);
  const row = await open(user.id);
  await prisma.accountRecoveryRequest.update({
    where: { id: row.id },
    data: { identityEvidenceRef: "TICKET-INTERNAL", identityVerifiedById: a1.user.id, approvalReason: "INTERNAL-NOTE" },
  });
  const pkg = await buildDsarExportPackage(user.id);
  const exported = pkg.accountRecoveryRequests as Array<Record<string, unknown>>;
  assert.equal(exported.length, 1, "the subject's request is in their export");
  assert.equal(exported[0].replacementEmail, replacement);
  assert.equal(exported[0].status, row.status);
  const text = JSON.stringify(exported);
  assert.ok(!text.includes("TICKET-INTERNAL") && !text.includes("INTERNAL-NOTE") && !text.includes(a1.user.id), "staff records stay out");
  assert.equal(exportPackageContainsSecrets(pkg), false);
  const other = await buildDsarExportPackage((await employee()).user.id);
  assert.deepEqual(other.accountRecoveryRequests, [], "nobody else's request appears");
  ok("DSAR export holds the subject's request and no staff records");
}

for (const p of passed) console.log(`PASS ${p}`);
console.log(`account-recovery: ok (${passed.length} checks)`);
await prisma.$disconnect();
server.close();
process.exit(0);
