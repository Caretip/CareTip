/**
 * Google sign-up, sign-in and legal acceptance: real controllers + database, Google's signing keys
 * replaced by a test key. Disposable database only:
 *   CARETIP_ISOLATED_POSTGRES_URL=... node scripts/safe-test.mjs test:google-oauth-signup
 */
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { LegalDocumentType } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
const AUDIENCE = "signup-test.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_ID = AUDIENCE;
process.env.GOOGLE_CLIENT_IDS = "";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
(OAuth2Client.prototype as unknown as Record<string, unknown>).getFederatedSignonCertsAsync = async () => ({
  certs: { test: keys.publicKey.export({ type: "spki", format: "pem" }) },
  format: "PEM",
});
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
type Who = { sub: string; email: string };
function idToken(who: Who, claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: "RS256", kid: "test", typ: "JWT" })}.${b64({
    iss: "https://accounts.google.com", aud: AUDIENCE, iat: now, exp: now + 600, email_verified: true, name: "Test Person", ...who, ...claims,
  })}`;
  return `${data}.${createSign("RSA-SHA256").update(data).sign(keys.privateKey).toString("base64url")}`;
}

const { prisma } = await import("../src/prisma.js");
const auth = await import("../src/controllers/auth.controller.js");
const oauthService = await import("../src/services/oauthAuth.service.js");
const { registerBusiness } = await import("../src/services/auth.service.js");
const { sealGoogleRedirectHandoff, GOOGLE_REDIRECT_HANDOFF_TTL_MS } = await import("../src/services/oauth/googleOAuthRedirect.service.js");
const { MERCHANT_LEGAL_ACCEPTANCE_ACTION, hasMerchantLegalAcceptance } = await import("../src/lib/merchantLegalAcceptance.js");
const { careTipControlledPdfSha256 } = await import("../src/lib/caretipControlledLegalDocs.js");

const app = express();
app.use(express.json());
app.post("/oauth", (q, s) => void auth.oauth(q, s));
app.post("/register", (q, s) => void auth.register(q, s));
app.post("/login", (q, s) => void auth.login(q, s));
app.post("/refresh", (q, s) => void auth.refresh(q, s));
const server = http.createServer(app).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Body = { token?: string; message?: string; code?: string; user?: { id: string; email: string; role: string } };
async function post(path: string, body: unknown, cookie?: string) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", ...(cookie ? { Cookie: `caretip_refresh=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie") ?? "";
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Body, cookie: /caretip_refresh=([^;]+)/.exec(set)?.[1], set };
}
const tag = randomUUID().slice(0, 8);
let n = 0;
const person = (): Who => ({ sub: `gsub-${tag}-${++n}`, email: `gs-${tag}-${n}@test.local` });
const signup = (token: string, extra: Record<string, unknown> = {}) =>
  post("/oauth", { provider: "google", idToken: token, isLogin: false, intendedRole: "MANAGER", merchantLegalAccepted: true, locale: "en", ...extra });
const login = (token: string) => post("/oauth", { provider: "google", idToken: token, isLogin: true });
const usersWith = (email: string) => prisma.user.count({ where: { email } });
const acceptances = (userId: string) =>
  prisma.auditLog.findMany({ where: { userId, action: MERCHANT_LEGAL_ACCEPTANCE_ACTION }, orderBy: { createdAt: "asc" } });

async function setDoc(type: LegalDocumentType, language: string, version: string) {
  await prisma.legalDocument.upsert({
    where: { type_language: { type, language } },
    create: { type, language, title: type, contentHtml: "<p>x</p>", version },
    update: { version },
  });
}
for (const lang of ["de", "en"]) {
  await setDoc(LegalDocumentType.terms_conditions, lang, `terms-${lang}-1`);
  await setDoc(LegalDocumentType.privacy_policy, lang, `privacy-${lang}-1`);
}

const failures: string[] = [];
let count = 0;
async function test(name: string, fn: () => Promise<void>) {
  count++;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
}
async function refused(who: Who, out: { status: number; body: Body; cookie?: string }, status: number) {
  assert.equal(out.status, status, `status ${out.status} ${out.body.message}`);
  assert.ok(!out.body.token && !out.cookie, "no session issued");
  assert.equal(await usersWith(who.email), 0, "no account left behind");
}

await test("new user: one account, one session, one acceptance with the exact document versions", async () => {
  const who = person();
  const out = await signup(idToken(who));
  assert.equal(out.status, 201, out.body.message);
  assert.ok(out.body.token && out.cookie && /HttpOnly/i.test(out.set));
  const user = await prisma.user.findUniqueOrThrow({ where: { email: who.email }, include: { business: true, oauthAccounts: true } });
  assert.equal(user.role, "MANAGER");
  assert.equal(user.emailVerified, true);
  assert.equal(user.oauthAccounts.length, 1);
  assert.equal(user.oauthAccounts[0]!.subject, who.sub);
  const rows = await acceptances(user.id);
  assert.equal(rows.length, 1);
  const m = JSON.parse(rows[0]!.metadata ?? "{}") as Record<string, string>;
  assert.equal(m.termsVersion, "terms-en-1");
  assert.equal(m.privacyVersion, "privacy-en-1");
  assert.equal(m.dpaContentSha256, careTipControlledPdfSha256("avv", "en"));
  assert.equal(m.plvContentSha256, careTipControlledPdfSha256("plv", "en"));
  assert.equal(m.businessId, user.business!.id);
  assert.equal(m.context, "merchant_oauth_signup");
  assert.ok(Math.abs(Date.now() - Date.parse(m.acceptedAt!)) < 60_000);
});
await test("German sign-up records the German versions", async () => {
  const who = person();
  const out = await signup(idToken(who), { locale: "de" });
  const m = JSON.parse((await acceptances(out.body.user!.id))[0]!.metadata ?? "{}") as Record<string, string>;
  assert.equal(m.termsVersion, "terms-de-1");
  assert.equal(m.plvContentSha256, careTipControlledPdfSha256("plv", "de"));
});
await test("phone redirect hand-off: same result as the popup token", async () => {
  const who = person();
  const out = await signup(sealGoogleRedirectHandoff(idToken(who)));
  assert.equal(out.status, 201, out.body.message);
  assert.equal((await acceptances(out.body.user!.id)).length, 1);
});
for (const [label, value] of [["missing", undefined], ["false", false], ["the text false", "false"], ["0", 0], ["null", null]] as const) {
  await test(`acceptance ${label}: refused, nothing created`, async () => {
    const who = person();
    const out = await signup(idToken(who), { merchantLegalAccepted: value });
    await refused(who, out, 400);
    assert.equal(out.body.code, "MERCHANT_LEGAL_ACCEPTANCE_REQUIRED");
  });
}
await test("the service itself refuses a business account without acceptance (not only the controller)", async () => {
  const who = person();
  await assert.rejects(
    oauthService.authenticateWithOAuth("google", { idToken: idToken(who), isLogin: false, intendedRole: "MANAGER" }),
    (e: unknown) => (e as { code?: string }).code === "MERCHANT_LEGAL_ACCEPTANCE_REQUIRED",
  );
  assert.equal(await usersWith(who.email), 0);
});
await test("if the acceptance cannot be stored, no account is created (Google and email)", async () => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE audit_logs ADD CONSTRAINT test_no_acceptance CHECK (action <> '${MERCHANT_LEGAL_ACCEPTANCE_ACTION}') NOT VALID`,
  );
  try {
    const who = person();
    const out = await signup(idToken(who));
    assert.ok(out.status >= 400 && !out.body.token && !out.cookie);
    assert.equal(await usersWith(who.email), 0);
    assert.equal(await prisma.oAuthAccount.count({ where: { subject: who.sub } }), 0);
    const mail = person();
    const reg = await post("/register", { email: mail.email, password: "Str0ng!Passw0rd", role: "business", merchantLegalAccepted: true });
    assert.ok(reg.status >= 400);
    assert.equal(await usersWith(mail.email), 0);
    // Retrying once storage works again succeeds: nothing half-made is in the way.
    await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs DROP CONSTRAINT test_no_acceptance`);
    assert.equal((await signup(idToken(who))).status, 201);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS test_no_acceptance`);
  }
});
await test("expired Google token", async () => {
  const who = person();
  await refused(who, await signup(idToken(who, { iat: 1_600_000_000, exp: 1_600_000_600 })), 401);
});
await test("expired hand-off", async () => {
  const who = person();
  const out = await signup(sealGoogleRedirectHandoff(idToken(who), Date.now() - GOOGLE_REDIRECT_HANDOFF_TTL_MS - 1000));
  await refused(who, out, 400);
  assert.equal(out.body.code, "GOOGLE_REDIRECT_HANDOFF_INVALID");
});
await test("token for another app, another issuer, or a forged signature", async () => {
  const who = person();
  await refused(who, await signup(idToken(who, { aud: "other.apps.googleusercontent.com" })), 401);
  await refused(who, await signup(idToken(who, { iss: "https://evil.example" })), 401);
  const good = idToken(who);
  await refused(who, await signup(good.slice(0, good.lastIndexOf(".") + 1) + Buffer.alloc(256, 1).toString("base64url")), 401);
});
await test("Google email not verified", async () => {
  const who = person();
  await refused(who, await signup(idToken(who, { email_verified: false })), 401);
});
await test("already registered Google account: uniform refusal, no second account or acceptance", async () => {
  const who = person();
  const first = await signup(idToken(who));
  const again = await signup(idToken(who));
  assert.equal(again.status, 401);
  assert.equal(again.body.code, "OAUTH_SIGN_IN_FAILED");
  assert.ok(!again.body.token && !again.cookie);
  assert.equal(await usersWith(who.email), 1);
  assert.equal((await acceptances(first.body.user!.id)).length, 1);
});
await test("email owned by a password account is never linked, by sign-up or sign-in", async () => {
  const who = person();
  const owner = await prisma.user.create({ data: { email: who.email, passwordHash: "x", role: "MANAGER", emailVerified: true } });
  for (const out of [await signup(idToken(who)), await login(idToken(who))]) {
    assert.equal(out.status, 401);
    assert.equal(out.body.code, "OAUTH_SIGN_IN_FAILED");
    assert.ok(!out.body.token && !out.cookie);
  }
  assert.equal(await prisma.oAuthAccount.count({ where: { userId: owner.id } }), 0);
});
await test("Google subject linked to another user cannot sign up under a new email or be linked elsewhere", async () => {
  const who = person();
  const owner = await signup(idToken(who));
  const other = person();
  const out = await signup(idToken({ sub: who.sub, email: other.email }));
  await refused(other, out, 401);
  const b = await signup(idToken(person()));
  await assert.rejects(oauthService.linkOAuthProviderForUser(b.body.user!.id, "google", idToken(who)));
  // Sign-in follows the Google subject, never the email in the token.
  const signedIn = await login(idToken({ sub: who.sub, email: b.body.user!.email }));
  assert.equal(signedIn.body.user?.id, owner.body.user!.id);
});
await test("demo accounts cannot receive a Google link", async () => {
  const demo = await prisma.user.upsert({ where: { email: "demo@caretip.de" }, create: { email: "demo@caretip.de", role: "MANAGER", emailVerified: true }, update: {} });
  const who = person();
  await assert.rejects(oauthService.linkOAuthProviderForUser(demo.id, "google", idToken(who)), oauthService.OAuthDemoAccountLinkForbiddenError);
  for (const out of [await signup(idToken({ ...who, email: "demo@caretip.de" })), await login(idToken({ ...who, email: "demo@caretip.de" }))]) {
    assert.equal(out.status, 401);
  }
  assert.equal(await prisma.oAuthAccount.count({ where: { userId: demo.id } }), 0);
});
await test("five simultaneous sign-ups: one account, one acceptance, clean refusals", async () => {
  const who = person();
  const outs = await Promise.all(Array.from({ length: 5 }, () => signup(idToken(who))));
  assert.equal(outs.filter((o) => o.status === 201).length, 1);
  for (const o of outs) if (o.status !== 201) assert.equal(o.body.code, "OAUTH_SIGN_IN_FAILED", `${o.status} ${o.body.message}`);
  assert.equal(await usersWith(who.email), 1);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: who.email } });
  assert.equal((await acceptances(user.id)).length, 1);
  assert.equal(await prisma.business.count({ where: { userId: user.id } }), 1);
});
await test("account created but the session cookie never arrived: Google sign-in recovers it", async () => {
  const who = person();
  const created = await signup(idToken(who));
  assert.equal((await post("/refresh", {})).status, 401, "no cookie, no session");
  const back = await login(idToken(who));
  assert.equal(back.status, 200);
  assert.equal(back.body.user?.id, created.body.user!.id);
  assert.equal((await acceptances(created.body.user!.id)).length, 1, "not asked or recorded again");
});
await test("refresh rotates after Google sign-up; simultaneous restores all stay signed in", async () => {
  const { cookie } = await signup(idToken(person()));
  const r = await post("/refresh", {}, cookie);
  assert.equal(r.status, 200);
  assert.ok(r.cookie && r.cookie !== cookie, "rotated");
  const many = await Promise.all(Array.from({ length: 4 }, () => post("/refresh", {}, r.cookie)));
  // 409 = "another restore is rotating right now, retry" (the client does); 401 would sign the user out.
  assert.ok(many.every((m) => m.status === 200 || m.status === 409), many.map((m) => m.status).join());
  const winner = many.find((m) => m.status === 200);
  assert.ok(winner?.cookie);
  assert.equal((await post("/refresh", {}, winner.cookie)).status, 200);
});
await test("inactive and platform-admin accounts cannot use Google", async () => {
  for (const data of [{ isActive: false, role: "MANAGER" as const }, { isActive: true, role: "SUPER_ADMIN" as const }]) {
    const who = person();
    await prisma.user.create({
      data: { email: who.email, emailVerified: true, ...data, oauthAccounts: { create: { provider: "google", subject: who.sub, emailAtLink: who.email } } },
    });
    const out = await login(idToken(who));
    assert.equal(out.status, 401);
    assert.ok(!out.body.token && !out.cookie);
  }
  const admin = person();
  await refused(admin, await signup(idToken(admin), { intendedRole: "SUPER_ADMIN" }), 403);
});
await test("employee sign-up still needs an invitation", async () => {
  const who = person();
  const out = await signup(idToken(who), { intendedRole: "EMPLOYEE" });
  await refused(who, out, 400);
  const bad = await signup(idToken(who), { intendedRole: "EMPLOYEE", inviteCode: "NOPE" });
  await refused(who, bad, 400);
});
await test("an existing acceptance stays valid and is tied to its own user only", async () => {
  const a = await signup(idToken(person()));
  const plain = await prisma.user.create({ data: { email: person().email, role: "MANAGER", emailVerified: true } });
  assert.equal(await hasMerchantLegalAcceptance(a.body.user!.id), true);
  assert.equal(await hasMerchantLegalAcceptance(plain.id), false);
});
await test("after a document update new sign-ups record the new version; earlier records are unchanged", async () => {
  const a = await signup(idToken(person()));
  await setDoc(LegalDocumentType.terms_conditions, "en", "terms-en-2");
  const b = await signup(idToken(person()));
  const version = async (id: string) => (JSON.parse((await acceptances(id))[0]!.metadata ?? "{}") as Record<string, string>).termsVersion;
  assert.equal(await version(a.body.user!.id), "terms-en-1");
  assert.equal(await version(b.body.user!.id), "terms-en-2");
});
await test("email sign-up: needs acceptance, stores it once, still needs email verification", async () => {
  const no = person();
  const refusedOut = await post("/register", { email: no.email, password: "Str0ng!Passw0rd", role: "business" });
  assert.equal(refusedOut.status, 400);
  assert.equal(refusedOut.body.code, "MERCHANT_LEGAL_ACCEPTANCE_REQUIRED");
  assert.equal(await usersWith(no.email), 0);
  const yes = person();
  const body = { email: yes.email, password: "Str0ng!Passw0rd", role: "business", locale: "de", merchantLegalAccepted: true };
  const out = await post("/register", body);
  assert.equal(out.status, 201, out.body.message);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: yes.email } });
  const rows = await acceptances(user.id);
  assert.equal(rows.length, 1);
  assert.equal((JSON.parse(rows[0]!.metadata ?? "{}") as Record<string, string>).termsVersion, "terms-de-1");
  assert.equal(user.emailVerified, false);
  assert.notEqual((await post("/login", { email: yes.email, password: "Str0ng!Passw0rd", intendedRole: "MANAGER" })).status, 200);
  await post("/register", body);
  assert.equal((await acceptances(user.id)).length, 1);
  assert.equal(await usersWith(yes.email), 1);
});
await test("password login still works once verified", async () => {
  const who = person();
  await registerBusiness({ email: who.email, password: "Str0ng!Passw0rd" });
  await prisma.user.update({ where: { email: who.email }, data: { emailVerified: true } });
  const out = await post("/login", { email: who.email, password: "Str0ng!Passw0rd", intendedRole: "MANAGER" });
  assert.equal(out.status, 200, out.body.message);
  assert.ok(out.body.token && out.cookie);
});

server.close();
await prisma.$disconnect();
console.log(failures.length ? `\n${failures.length} of ${count} failed` : `\ngoogle-oauth-signup-runtime: ok (${count} scenarios)`);
process.exit(failures.length ? 1 : 0);
