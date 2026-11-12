/**
 * Security hardening that needs no database: client address rules, secret handling, config review,
 * memory bounds, mode separation and session lifetime.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET ||= "unit-runtime-secret-unit-runtime-secret-unit";
delete process.env.REDIS_URL;

const { resolveTrustProxySetting, resolveClientIp, normalizeIp, forwardedChainDepth, ipPrefixForLog, noteForwardedChain } = await import("../src/lib/clientIp.js");
const { safeSecretEqual } = await import("../src/lib/safeCompare.js");
const { sealMfaSecret, openMfaSecret, isSealedMfaSecret, needsMfaReseal } = await import("../src/lib/mfaSecretCrypto.js");
const { reviewProductionConfig } = await import("../src/config/productionConfig.js");
const { checkAndIncrementLimit, memoryBucketCount, MAX_MEMORY_BUCKETS } = await import("../src/utils/layeredRateLimit.js");
const { isWriteBlockedDuringImpersonation } = await import("../src/lib/impersonationPolicy.js");
const { isStripeEventModeMismatch } = await import("../src/webhooks/stripe.webhook.js");
const { signJwt, verifyJwt, signPurposeJwt, verifyPurposeJwt, isAllowedAccessJwtType } = await import("../src/lib/jwtConfig.js");
const { isDemoEmailVerificationBypassEnabled } = await import("../src/services/emailVerificationBypass.flags.js");
const { qualifiesEmailVerificationBypass } = await import("../src/services/emailVerificationBypass.service.js");
const { INTERNAL_JOBS, BLUEPRINT_JOBS, BLUEPRINT_FORBIDDEN_JOBS } = await import("../src/config/internalJobs.manifest.js");
const refresh = await import("../src/services/refreshToken.service.js");

const withEnv = async (vars: Record<string, string | undefined>, fn: () => void | Promise<void>) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

// --- Client address: real Express behaviour for each proxy shape ---
async function ipSeen(setting: ReturnType<typeof resolveTrustProxySetting>, xff: string | undefined): Promise<string> {
  const app = express();
  if (setting !== false) app.set("trust proxy", setting);
  app.get("/", (req, res) => { res.json({ ip: resolveClientIp(req) }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/`, { headers: xff ? { "x-forwarded-for": xff } : {} });
  const body = (await res.json()) as { ip: string };
  server.close();
  return body.ip;
}

assert.equal(resolveTrustProxySetting({ NODE_ENV: "production" }), 1, "default stays one hop");
assert.equal(resolveTrustProxySetting({ NODE_ENV: "development" }), false, "no proxy trust outside production");
assert.equal(resolveTrustProxySetting({ NODE_ENV: "production", TRUST_PROXY_HOPS: "2" }), 2);
assert.equal(resolveTrustProxySetting({ NODE_ENV: "production", TRUST_PROXY_HOPS: "banana" }), 1, "invalid falls back to the safe default");
assert.equal(resolveTrustProxySetting({ NODE_ENV: "production", TRUST_PROXY_HOPS: "99" }), 1, "out of range falls back");
assert.equal(await ipSeen(1, "1.2.3.4, 203.0.113.7"), "203.0.113.7", "a client cannot spoof with one hop");
assert.equal(await ipSeen(2, "203.0.113.7, 198.51.100.10"), "203.0.113.7", "two hops find the client");
assert.notEqual(await ipSeen(2, "203.0.113.7, 198.51.100.10"), await ipSeen(2, "203.0.113.99, 198.51.100.10"), "two users behind one proxy stay separate");
const cidrs = resolveTrustProxySetting({ NODE_ENV: "production", TRUST_PROXY_CIDRS: "198.51.100.0/24" });
assert.equal(await ipSeen(cidrs, "203.0.113.7, 198.51.100.10"), "203.0.113.7", "CIDR list finds the client behind a known proxy");
assert.equal(await ipSeen(cidrs, "6.6.6.6, 203.0.113.7"), "203.0.113.7", "CIDR list is not spoofable by a direct caller");
assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
assert.equal(normalizeIp("not-an-ip"), null);
assert.equal(resolveClientIp({ ip: "not-an-ip" }), "unknown", "malformed address falls into a shared bucket, not past the limit");
assert.equal(resolveClientIp({ ip: undefined }), "unknown");
assert.equal(forwardedChainDepth({ headers: { "x-forwarded-for": "a, b, c" } }), 3);
assert.equal(ipPrefixForLog("203.0.113.7"), "203.0.113.0/24", "logs never hold a full address");

// Signed proxy: the client address header counts only with a valid signature.
await withEnv({ NETLIFY_PROXY_SIGNATURE_SECRET: "proxy-secret" }, () => {
  const good = jwt.sign({ iss: "netlify" }, "proxy-secret", { algorithm: "HS256" });
  const forged = jwt.sign({ iss: "netlify" }, "guessed", { algorithm: "HS256" });
  const wrongIssuer = jwt.sign({ iss: "someone" }, "proxy-secret", { algorithm: "HS256" });
  const at = (sign: string | undefined, claimed: string | undefined) =>
    resolveClientIp({ ip: "198.51.100.10", headers: { ...(sign ? { "x-nf-sign": sign } : {}), ...(claimed ? { "x-nf-client-connection-ip": claimed } : {}) } });
  assert.equal(at(good, "203.0.113.7"), "203.0.113.7", "a signed request gets its real client address");
  assert.notEqual(at(good, "203.0.113.7"), at(good, "203.0.113.99"), "two users behind Netlify stay separate");
  assert.equal(at(undefined, "6.6.6.6"), "198.51.100.10", "the header alone is ignored");
  assert.equal(at(forged, "6.6.6.6"), "198.51.100.10", "a forged signature is ignored");
  assert.equal(at(wrongIssuer, "6.6.6.6"), "198.51.100.10", "another issuer is ignored");
  assert.equal(at(good, "not-an-ip"), "198.51.100.10", "a malformed address is ignored");
});
await withEnv({ NETLIFY_PROXY_SIGNATURE_SECRET: undefined }, () => {
  const token = jwt.sign({ iss: "netlify" }, "proxy-secret", { algorithm: "HS256" });
  assert.equal(resolveClientIp({ ip: "198.51.100.10", headers: { "x-nf-sign": token, "x-nf-client-connection-ip": "6.6.6.6" } }), "198.51.100.10", "off unless configured");
});

// A test process can never send real mail or hold a live key.
await withEnv({ NODE_ENV: "test", RESEND_API_KEY: "re_synthetic_key" }, async () => {
  const { sendResendEmailWithOutcome } = await import("../src/services/resendClient.js");
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error("no network"); }) as typeof fetch;
  const outcome = await sendResendEmailWithOutcome("unit", { from: "a@example.invalid", to: ["b@example.invalid"], subject: "s", html: "h", text: "t" });
  globalThis.fetch = realFetch;
  assert.equal(called, false, "no request leaves a test process");
  assert.equal(outcome.kind, "not_configured");
});
await withEnv({ NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_live_synthetic" }, async () => {
  const { getStripeClient } = await import("../src/services/stripe.service.js");
  assert.throws(() => getStripeClient(), "a live key is refused under test");
});

// A second proxy shows up in the logs instead of quietly merging clients.
await withEnv({ NODE_ENV: "production", TRUST_PROXY_HOPS: "1", TRUST_PROXY_CIDRS: undefined }, () => {
  assert.equal(noteForwardedChain({ headers: { "x-forwarded-for": "203.0.113.7" } }, 1e12), false);
  assert.equal(noteForwardedChain({ headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.10" } }, 1e12), true, "warns once");
  assert.equal(noteForwardedChain({ headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.10" } }, 1e12 + 1000), false, "and not on every request");
});

// --- Secrets ---
assert.equal(safeSecretEqual("abc", "abc"), true);
assert.equal(safeSecretEqual("abc", "abd"), false);
assert.equal(safeSecretEqual("", ""), false, "an unset secret never authorises");
assert.equal(safeSecretEqual(undefined, undefined), false);

await withEnv({ MFA_SECRET_ENCRYPTION_KEY: "unit-key" }, () => {
  const sealed = sealMfaSecret("JBSWY3DPEHPK3PXP");
  assert.ok(isSealedMfaSecret(sealed));
  assert.ok(!sealed.includes("JBSWY3DPEHPK3PXP"), "stored value does not contain the secret");
  assert.equal(openMfaSecret(sealed), "JBSWY3DPEHPK3PXP");
  assert.equal(openMfaSecret("JBSWY3DPEHPK3PXP"), "JBSWY3DPEHPK3PXP", "legacy plain rows still work");
  assert.throws(() => openMfaSecret(sealed.slice(0, -2) + "AA"), "tampering is detected");
});
{
  let sealed = "";
  await withEnv({ MFA_SECRET_ENCRYPTION_KEY: "one" }, () => { sealed = sealMfaSecret("JBSWY3DPEHPK3PXP"); });
  await withEnv({ MFA_SECRET_ENCRYPTION_KEY: undefined }, () => { assert.throws(() => openMfaSecret(sealed), "no key fails closed"); });
  await withEnv({ MFA_SECRET_ENCRYPTION_KEY: "two" }, () => { assert.throws(() => openMfaSecret(sealed), "wrong key fails closed"); });
}

// --- Key rotation and no silent downgrade ---
await withEnv({ MFA_SECRET_ENCRYPTION_KEY: "old-key", MFA_SECRET_ENCRYPTION_KEY_PREVIOUS: undefined }, async () => {
  const sealed = sealMfaSecret("JBSWY3DPEHPK3PXP");
  await withEnv({ MFA_SECRET_ENCRYPTION_KEY: "new-key", MFA_SECRET_ENCRYPTION_KEY_PREVIOUS: "old-key" }, () => {
    assert.equal(openMfaSecret(sealed), "JBSWY3DPEHPK3PXP", "old values stay readable during rotation");
    assert.equal(needsMfaReseal(sealed), true, "and are flagged for re-encryption");
    assert.equal(needsMfaReseal(sealMfaSecret("JBSWY3DPEHPK3PXP")), false);
  });
});
await withEnv({ NODE_ENV: "production", MFA_SECRET_ENCRYPTION_KEY: undefined }, () => {
  assert.throws(() => sealMfaSecret("JBSWY3DPEHPK3PXP"), "production never stores a secret unencrypted");
});

// --- Production configuration ---
assert.equal(reviewProductionConfig({ RENDER: "true", NODE_ENV: "prod" }).fatal.length, 1, "a typo in NODE_ENV stops a deployed service");
assert.equal(reviewProductionConfig({ RENDER: "true" }).fatal.length, 1, "missing NODE_ENV stops a deployed service");
assert.equal(reviewProductionConfig({ NODE_ENV: "development" }).fatal.length, 0, "local development is unaffected");
const GOOD_JWT = "k7Qm2vX9pL4sT8wZ1nB6cR3yH5jF0dGaE-uVoIqWe_Ys"; // test-only fixture, not a real secret
assert.equal(reviewProductionConfig({ NODE_ENV: "production", JWT_SECRET: GOOD_JWT }).fatal.length, 1, "production cannot start without the MFA key");
assert.equal(reviewProductionConfig({ NODE_ENV: "production", JWT_SECRET: GOOD_JWT, MFA_SECRET_ENCRYPTION_KEY: "short" }).fatal.length, 1, "a short key is refused");
assert.equal(reviewProductionConfig({ NODE_ENV: "production", JWT_SECRET: GOOD_JWT, MFA_SECRET_ENCRYPTION_KEY: "x".repeat(32) }).fatal.length, 0);
// SEC-08: weak JWT_SECRET is fatal in production (missing, < 32 bytes, placeholder, low variety) and never printed.
const prodFatal = (jwtSecret: string | undefined) =>
  reviewProductionConfig({ NODE_ENV: "production", MFA_SECRET_ENCRYPTION_KEY: "x".repeat(32), ...(jwtSecret === undefined ? {} : { JWT_SECRET: jwtSecret }) }).fatal;
for (const [label, value] of [
  ["missing", undefined],
  ["empty", "   "],
  ["short", "short-secret-31-bytes-long-abcd"],
  [".env.example placeholder", "long-random-secret-replace-in-production"],
  ["changeme", "changeme-changeme-changeme-changeme-1"],
  ["your_super_secret_key", "your_super_secret_key_for_jwt_signing_2026"],
  ["repeated character", "a".repeat(64)],
  ["low variety", "abababababababababababababababab12"],
] as const) {
  const f = prodFatal(value);
  assert.ok(f.some((m) => m.startsWith("JWT_SECRET")), `JWT_SECRET ${label} must stop production`);
  if (value?.trim()) assert.ok(!f.join("|").includes(value.trim()), `JWT_SECRET ${label} value printed`);
}
assert.equal(prodFatal(GOOD_JWT).length, 0, "a random 44-char secret is accepted");
assert.equal(prodFatal("0123456789abcdef0123456789abcdef").length, 0, "32 random-looking hex chars are accepted");
assert.equal(reviewProductionConfig({ NODE_ENV: "development" }).fatal.length, 0, "development without JWT_SECRET is not blocked by the production review");
assert.equal(reviewProductionConfig({ NODE_ENV: "test", JWT_SECRET: "short" }).fatal.length, 0, "test runs keep short local secrets");
const prodWarnings = reviewProductionConfig({ RENDER: "true", NODE_ENV: "production", JWT_SECRET: GOOD_JWT, MFA_SECRET_ENCRYPTION_KEY: "x".repeat(32), SEC_API_TRAFFIC_CLASSES_ENABLED: "false", ENABLE_DEMO_BYPASS: "true", STRIPE_SECRET_KEY: "sk_test_x", VITE_GOOGLE_CLIENT_SECRET: "x" }).warnings.join("|");
for (const needle of ["ENABLE_DEMO_BYPASS", "test key", "VITE_GOOGLE_CLIENT_SECRET", "CRON_SECRET", "TRUST_PROXY", "SEC_API_TRAFFIC_CLASSES_ENABLED", "Supabase"]) assert.ok(prodWarnings.includes(needle), needle);
assert.ok(!prodWarnings.includes("sk_test_x"), "values never appear in messages");

// --- Demo bypass ---
await withEnv({ NODE_ENV: "production", ENABLE_DEMO_BYPASS: "true" }, () => {
  assert.equal(isDemoEmailVerificationBypassEnabled(), false, "flag cannot enable it in production");
  assert.equal(qualifiesEmailVerificationBypass({ id: "u", email: "demo@caretip.de", emailVerified: false, role: "MANAGER" }), false);
});
await withEnv({ NODE_ENV: "development", ENABLE_DEMO_BYPASS: "true", EMAIL_VERIFICATION_BYPASS_FIRST_NAMES: undefined }, () => {
  assert.equal(
    qualifiesEmailVerificationBypass({ id: "u", email: "x@example.invalid", emailVerified: false, role: "MANAGER", business: { name: "Bobby Bar" } }),
    false,
    "a user-chosen display name is never enough",
  );
});

// --- Memory fallback ---
const now = Date.now();
for (let i = 0; i < MAX_MEMORY_BUCKETS + 2000; i++) checkAndIncrementLimit({ key: `unique:${i}`, maxPerWindow: 5, windowMs: 60_000, nowMs: now });
assert.ok(memoryBucketCount() <= MAX_MEMORY_BUCKETS, "unique keys cannot grow memory without bound");
checkAndIncrementLimit({ key: "repeat", maxPerWindow: 1, windowMs: 60_000, nowMs: now });
assert.equal(checkAndIncrementLimit({ key: "repeat", maxPerWindow: 1, windowMs: 60_000, nowMs: now }).allowed, false, "limits still apply at the ceiling");

// --- Support view ---
for (const [method, path] of [
  ["POST", "/api/me/connect/instant-payout"],
  ["PATCH", "/api/me/connect/bank-payout-schedule"],
  ["POST", "/api/me/connect/tip-distribution/batches"],
  ["POST", "/api/auth/change-password"],
  ["POST", "/api/auth/2fa/disable"],
  ["POST", "/api/auth/email-change/request"],
  ["POST", "/api/me/deletion-request"],
] as const) assert.equal(isWriteBlockedDuringImpersonation(method, path), true, path);
assert.equal(isWriteBlockedDuringImpersonation("GET", "/api/me/connect/instant-payout"), false, "reads stay available for support");
assert.equal(isWriteBlockedDuringImpersonation("PATCH", "/api/employees/x"), false, "ordinary support edits stay available");
// SEC-2026-11-01: Express routing is case-insensitive and ignores a trailing slash — the block must too.
for (const [method, path] of [
  ["POST", "/API/ME/CONNECT/INSTANT-PAYOUT"],
  ["POST", "/api/me/Connect/instant-payout"],
  ["patch", "/api/ME/connect/bank-payout-schedule"],
  ["POST", "/api/me/Billing/cancel"],
  ["POST", "/api/me//billing/checkout"],
  ["POST", "/api/business/physical-qr/orders/abc/CHECKOUT"],
  ["POST", "/api/me/connect/instant-payout/?x=1"],
  // Policy gaps closed in the same change (change where money goes / who owns the account).
  ["POST", "/api/me/connect/account-link"],
  ["POST", "/api/business/ownership/transfer"],
  ["POST", "/api/mobile/create-billing-session"],
] as const) assert.equal(isWriteBlockedDuringImpersonation(method, path), true, `case/slash variant blocked: ${method} ${path}`);

// --- Stripe mode separation ---
assert.equal(isStripeEventModeMismatch({ livemode: true }, "sk_test_x"), true);
assert.equal(isStripeEventModeMismatch({ livemode: false }, "sk_live_x"), true);
assert.equal(isStripeEventModeMismatch({ livemode: true }, "sk_live_x"), false);
assert.equal(isStripeEventModeMismatch({ livemode: false }, "sk_test_x"), false);

// --- Tokens ---
const issued = jwt.decode(signJwt({ sub: "u" }, "1m")) as jwt.JwtPayload;
assert.equal(issued.iss, "caretip-api");
const foreign = jwt.sign({ sub: "u", iss: "someone-else" }, process.env.JWT_SECRET!, { algorithm: "HS256" });
assert.throws(() => verifyJwt(foreign), "a token from another issuer is refused");
const purposeToken = signPurposeJwt("mfa_login_pending", { userId: "u", purpose: "mfa_login_pending" }, "1m");
assert.throws(() => verifyJwt(purposeToken), "a purpose token can never verify as an access token");
assert.throws(() => verifyPurposeJwt("email_change_confirm", purposeToken), "or as another purpose");
assert.equal(verifyPurposeJwt<{ userId: string }>("mfa_login_pending", purposeToken).userId, "u");
const wrongAudience = jwt.sign({ sub: "u", aud: "someone-else" }, process.env.JWT_SECRET!, { algorithm: "HS256" });
assert.throws(() => verifyJwt(wrongAudience), "a token for another audience is refused");
await withEnv({ NODE_ENV: "production" }, () => {
  const unlabelled = jwt.sign({ sub: "u", type: "access" }, process.env.JWT_SECRET!, { algorithm: "HS256" });
  assert.throws(() => verifyJwt(unlabelled), "production needs issuer and audience");
  assert.ok(verifyJwt(signJwt({ sub: "u", type: "access" }, "1m")).sub, "tokens this server issues pass");
  assert.equal(isAllowedAccessJwtType(undefined), false, "untyped tokens are refused in production");
  assert.equal(isAllowedAccessJwtType("mfa_login_pending"), false);
  assert.equal(isAllowedAccessJwtType("access"), true);
});

// --- Refresh header: native clients only ---
const headersSet: Record<string, string> = {};
const fakeRes = (origin?: string) => ({ cookie: () => undefined, setHeader: (k: string, v: string) => { headersSet[k] = v; }, req: { headers: origin ? { origin } : {} } });
refresh.setRefreshCookie(fakeRes("https://caretip.de"), "tok");
assert.equal(headersSet[refresh.CARETIP_REFRESH_HEADER], undefined, "a browser never receives the token in a readable header");
refresh.setRefreshCookie(fakeRes(), "tok");
assert.equal(headersSet[refresh.CARETIP_REFRESH_HEADER], "tok", "native clients still do");

// --- Absolute session lifetime ---
{
  const rows = new Map<string, { id: string; userId: string; expiresAt: Date; revokedAt: Date | null; replacedByTokenId: string | null; tokenHash: string }>();
  let seq = 0;
  const db = {
    refreshToken: {
      findUnique: async ({ where }: { where: { tokenHash?: string; id?: string } }) => [...rows.values()].find((r) => r.tokenHash === where.tokenHash || r.id === where.id) ?? null,
      create: async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: Date } }) => { const id = `r${++seq}`; rows.set(id, { id, revokedAt: null, replacedByTokenId: null, ...data }); return { id }; },
      updateMany: async ({ where, data }: { where: { id?: string }; data: { revokedAt: Date; replacedByTokenId?: string } }) => { const r = where.id ? rows.get(where.id) : null; if (!r || r.revokedAt) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
      deleteMany: async () => ({ count: 0 }),
    },
  };
  refresh.refreshTokenServiceTestHooks.setDb(db as never);
  const issuedToken = await refresh.issueRefreshTokenWithClient(db as never, "user-1");
  assert.match(issuedToken.token, /^[0-9a-z]+\./, "start time travels in the token");
  let clock = Date.now();
  refresh.refreshTokenServiceTestHooks.setClock(() => clock);
  clock += 24 * 3600 * 1000;
  const first = await refresh.rotateRefreshTokenWithOutcome(issuedToken.token);
  assert.equal(first.kind, "rotated");
  assert.ok(first.kind === "rotated" && first.newToken.split(".")[0] === issuedToken.token.split(".")[0], "rotation keeps the original start");
  clock += refresh.refreshAbsoluteLifetimeMs();
  const tooOld = await refresh.rotateRefreshTokenWithOutcome(first.kind === "rotated" ? first.newToken : "");
  assert.equal(tooOld.kind, "rejected", "a login cannot be extended forever");
  refresh.refreshTokenServiceTestHooks.setDb(null);
  refresh.refreshTokenServiceTestHooks.setClock(null);
}

// --- Job manifest: routes, list and blueprint must agree ---
const here = dirname(fileURLToPath(import.meta.url));
const routes = readFileSync(join(here, "../src/routes/internalJobs.routes.ts"), "utf8");
const blueprint = readFileSync(join(here, "../../render.yaml"), "utf8");
const routePaths = [...routes.matchAll(/router\.post\("\/([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
assert.deepEqual(INTERNAL_JOBS.map((j) => j.path).sort(), routePaths, "every job route is in the manifest");
const declared = [...blueprint.matchAll(/\/api\/internal\/jobs\/([a-z0-9-]+)/g)].map((m) => m[1]).sort();
assert.deepEqual(declared, [...BLUEPRINT_JOBS].sort(), "render.yaml declares exactly the approved jobs, so a push can't create a service");
for (const path of BLUEPRINT_FORBIDDEN_JOBS) {
  assert.ok(routePaths.includes(path), `${path} is a real job`);
  assert.ok(!blueprint.includes(path), `${path} must not be declared in render.yaml`);
}
assert.ok(blueprint.includes("Do not add KYC, tombstone, anonymization, or financial-delete cron services."), "the project rule stays in render.yaml");
for (const job of INTERNAL_JOBS.filter((j) => j.destructive)) assert.ok(job.gate?.includes("DATA_LIFECYCLE_V1"), `${job.path} is gated`);
assert.ok(!/DATA_LIFECYCLE_[A-Z_]*\s*\n\s*value/.test(blueprint), "render.yaml never switches a destructive flag on");

console.log("security-hardening-unit: ok");
process.exit(0);
