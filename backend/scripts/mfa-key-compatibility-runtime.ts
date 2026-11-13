/**
 * Proves what happens to existing MFA enrolments for every state of MFA_SECRET_ENCRYPTION_KEY, and
 * that the reseal tool is safe, over the real login route and a real database.
 *
 * Clears MFA columns in its database, so it needs a disposable loopback database and refuses anything else.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import express from "express";
import bcrypt from "bcrypt";
import speakeasy from "speakeasy";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("REFUSING: mfa-key-compatibility needs a disposable loopback database");
  process.exit(1);
}
const K1 = "key-one-key-one-key-one-key-one-key-one";
const K2 = "key-two-key-two-key-two-key-two-key-two";
const K9 = "key-nine-key-nine-key-nine-key-nine-key";
process.env.JWT_SECRET ||= "mfa-compat-secret-mfa-compat-secret-mfa-compat";
process.env.FRONTEND_URL = "http://127.0.0.1:4174";
process.env.MFA_SECRET_ENCRYPTION_KEY = K1;
delete process.env.MFA_SECRET_ENCRYPTION_KEY_PREVIOUS;
delete process.env.REDIS_URL;

const { prisma } = await import("../src/prisma.js");
const { default: authRoutes } = await import("../src/routes/auth.routes.js");
const { signPendingMfaLoginToken } = await import("../src/services/mfaLogin.service.js");
const { reviewProductionConfig } = await import("../src/config/productionConfig.js");
const { sealMfaSecret, openMfaSecret, isSealedMfaSecret, mfaKeyFingerprint } = await import("../src/lib/mfaSecretCrypto.js");

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

await prisma.user.updateMany({ data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorTempSecret: null } });

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rnd = () => Math.random().toString(36).slice(2, 10);
const HASH = await bcrypt.hash("Runtime-Synthetic-Pw-9!x", 4);
const newSecret = () => speakeasy.generateSecret({ length: 20 }).base32;
const useKey = (key?: string, previous?: string) => {
  if (key) process.env.MFA_SECRET_ENCRYPTION_KEY = key;
  else delete process.env.MFA_SECRET_ENCRYPTION_KEY;
  if (previous) process.env.MFA_SECRET_ENCRYPTION_KEY_PREVIOUS = previous;
  else delete process.env.MFA_SECRET_ENCRYPTION_KEY_PREVIOUS;
};
const sealWith = (key: string, plain: string) => {
  useKey(key);
  return sealMfaSecret(plain);
};
const user = (stored: string, role: "SUPER_ADMIN" | "EMPLOYEE" = "SUPER_ADMIN", temp: string | null = null) =>
  prisma.user.create({
    data: {
      email: `mfa-${rnd()}@runtime.invalid`, passwordHash: HASH, role, isPlatformAdmin: role === "SUPER_ADMIN",
      emailVerified: true, twoFactorEnabled: true, twoFactorSecret: stored, twoFactorTempSecret: temp,
    },
  });
const stored = async (id: string) =>
  prisma.user.findUniqueOrThrow({ where: { id }, select: { twoFactorSecret: true, twoFactorTempSecret: true } });
const code = (secret: string, offset = 0) =>
  speakeasy.totp({ secret, encoding: "base32", time: Date.now() / 1000 + offset });
async function login(id: string, totp: string) {
  const r = await fetch(`${base}/api/auth/login/mfa/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-caretip-client": "1", origin: "http://127.0.0.1:4174" },
    body: JSON.stringify({ pendingMfaToken: signPendingMfaLoginToken(id), code: totp }),
  });
  const json = (await r.json().catch(() => ({}))) as { token?: string };
  return { status: r.status, token: json.token };
}
function reseal(key: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, MFA_SECRET_ENCRYPTION_KEY: key, CARETIP_TEST_ISOLATION: "1" };
  delete env.MFA_SECRET_ENCRYPTION_KEY_PREVIOUS;
  const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/mfa-secret-reseal.ts", ...args], {
    cwd: backendRoot, env, encoding: "utf8",
  });
  const line = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => l.startsWith("{")).pop() ?? "{}";
  return { exit: r.status, out: JSON.parse(line) as Record<string, unknown> };
}
const fingerprintOf = (key: string) => {
  useKey(key);
  return mfaKeyFingerprint() as string;
};
const passed: string[] = [];
const ok = (name: string) => passed.push(name);

try {
  // Startup
  // A valid JWT_SECRET (required in production since SEC-08) so these checks isolate the MFA key rules.
  const STARTUP_JWT_SECRET = "k7Qm2vX9pL4sT8wZ1nB6cR3yH5jF0dGaE-uVoIqWe_Ys"; // test-only fixture
  const fatal = (env: NodeJS.ProcessEnv) =>
    reviewProductionConfig({ JWT_SECRET: STARTUP_JWT_SECRET, ...env }).fatal.join(" ");
  assert.match(fatal({ NODE_ENV: "production", RENDER: "true" }), /MFA_SECRET_ENCRYPTION_KEY/);
  assert.match(fatal({ NODE_ENV: "production", RENDER: "true", MFA_SECRET_ENCRYPTION_KEY: "too-short" }), /MFA_SECRET_ENCRYPTION_KEY/);
  assert.equal(fatal({ NODE_ENV: "production", RENDER: "true", MFA_SECRET_ENCRYPTION_KEY: K1 }), "");
  assert.match(fatal({ RENDER: "true", MFA_SECRET_ENCRYPTION_KEY: K1 }), /NODE_ENV/);
  assert.equal(fatal({}), "", "local development is not blocked");
  ok("startup stops on a missing or short key, and only in production");

  // Existing plaintext enrolment, key present
  useKey(K1);
  const plain = newSecret();
  const legacy = await user(plain);
  const first = await login(legacy.id, code(plain));
  assert.equal(first.status, 200, "an existing enrolment keeps working");
  const upgraded = (await stored(legacy.id)).twoFactorSecret as string;
  assert.ok(isSealedMfaSecret(upgraded), "and is encrypted by that login");
  assert.equal(openMfaSecret(upgraded), plain, "with the same secret, so the authenticator app is unchanged");
  assert.equal((await login(legacy.id, code(plain))).status, 401, "replay stays blocked across the upgrade");
  assert.equal((await login(legacy.id, code(plain, 30))).status, 200, "and the next code works");
  ok("plaintext enrolment survives, upgrades on login, needs no re-enrolment");

  // Plaintext enrolment, no key (local development)
  useKey(undefined);
  const noKeySecret = newSecret();
  const noKey = await user(noKeySecret, "EMPLOYEE");
  assert.equal((await login(noKey.id, code(noKeySecret))).status, 200);
  assert.equal((await stored(noKey.id)).twoFactorSecret, noKeySecret, "stays as it was");
  ok("plaintext enrolment works unchanged without a key");

  // Sealed enrolment, wrong key
  const sealedSecret = newSecret();
  const sealedValue = sealWith(K1, sealedSecret);
  const sealedUser = await user(sealedValue);
  useKey(K2);
  const wrong = await login(sealedUser.id, code(sealedSecret));
  assert.ok(wrong.status >= 500, `a wrong key fails closed, got ${wrong.status}`);
  assert.equal(wrong.token, undefined, "and never issues a session");
  assert.equal((await stored(sealedUser.id)).twoFactorSecret, sealedValue, "the record is untouched");
  ok("wrong key: login refused, no session, record untouched");

  // Sealed enrolment, key missing
  useKey(undefined);
  const missing = await login(sealedUser.id, code(sealedSecret));
  assert.ok(missing.status >= 500 && !missing.token, "a missing key fails closed");
  assert.equal((await stored(sealedUser.id)).twoFactorSecret, sealedValue);
  ok("missing key: login refused, record untouched");

  // Correct key put back: no harm done, not locked out by the failures above
  useKey(K1);
  assert.equal((await login(sealedUser.id, code(sealedSecret))).status, 200, "the correct key recovers fully");
  ok("restoring the correct key recovers without re-enrolment or lockout");

  // Rotation
  useKey(K2, K1);
  assert.equal((await login(sealedUser.id, code(sealedSecret, 30))).status, 200, "old-key rows still work during rotation");
  const rotated = (await stored(sealedUser.id)).twoFactorSecret as string;
  assert.notEqual(rotated, sealedValue, "and move to the new key");
  useKey(K1);
  assert.throws(() => openMfaSecret(rotated), "the old key no longer opens it");
  ok("rotation keeps enrolments working and moves them to the new key");

  // Production never writes plaintext
  useKey(undefined);
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";
  assert.throws(() => sealMfaSecret(newSecret()), /MFA_SECRET_ENCRYPTION_KEY/);
  env.NODE_ENV = nodeEnv;
  ok("production refuses to store a secret unencrypted");

  // Reseal: start clean
  await prisma.user.updateMany({ data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorTempSecret: null } });
  useKey(K1);
  const a = newSecret();
  const b = newSecret();
  const t = newSecret();
  const sealedB = sealMfaSecret(b);
  const plainUser = await user(a, "SUPER_ADMIN", t);
  const alreadySealed = await user(sealedB, "EMPLOYEE");
  const before = [await stored(plainUser.id), await stored(alreadySealed.id)];
  const snapshot = async () => [await stored(plainUser.id), await stored(alreadySealed.id)];

  const dry = reseal(K1);
  assert.equal(dry.exit, 0);
  assert.equal(dry.out.pending, 2, "counts the plaintext secret and temp secret");
  assert.equal(dry.out.updated, 0);
  assert.deepEqual(await snapshot(), before, "a dry run writes nothing");
  ok("dry run reports counts and writes nothing");

  const fp = fingerprintOf(K1);
  assert.equal(dry.out.keyFingerprint, fp);
  assert.ok(!JSON.stringify(dry.out).includes(K1) && !JSON.stringify(dry.out).includes(a), "output holds no secrets");
  assert.notEqual(fingerprintOf(K2), fp);
  assert.equal(reseal(K1, "--apply").exit, 1, "--apply without a fingerprint is refused");
  assert.equal(reseal(K2, "--apply", `--key-fingerprint=${fp}`).exit, 1, "a mistyped key is refused");
  assert.deepEqual(await snapshot(), before, "and nothing changed");
  ok("--apply is refused unless the key matches the running service");

  const applied = reseal(K1, "--apply", `--key-fingerprint=${fp}`);
  assert.equal(applied.exit, 0);
  assert.equal(applied.out.updated, 2);
  const after = await stored(plainUser.id);
  useKey(K1);
  assert.equal(openMfaSecret(after.twoFactorSecret as string), a);
  assert.equal(openMfaSecret(after.twoFactorTempSecret as string), t);
  assert.equal((await stored(alreadySealed.id)).twoFactorSecret, sealedB, "sealed rows are left alone");
  assert.equal(reseal(K1).out.pending, 0, "safe to repeat");
  assert.equal((await login(plainUser.id, code(a))).status, 200, "the user still logs in");
  ok("--apply encrypts secret and temp secret, is repeatable, login still works");

  // A row this key can't open
  const foreignSecret = newSecret();
  const foreign = sealWith(K9, foreignSecret);
  useKey(K1);
  const foreignUser = await user(foreign, "EMPLOYEE");
  const extraSecret = newSecret();
  const extra = await user(extraSecret, "EMPLOYEE");
  const mixed = reseal(K1, "--apply", `--key-fingerprint=${fp}`);
  assert.equal(mixed.exit, 1, "an unreadable row is reported");
  assert.equal(mixed.out.unreadable, 1);
  assert.equal((await stored(foreignUser.id)).twoFactorSecret, foreign, "and left untouched");
  assert.ok(isSealedMfaSecret((await stored(extra.id)).twoFactorSecret as string), "other rows still complete");
  await prisma.user.update({ where: { id: foreignUser.id }, data: { twoFactorSecret: null, twoFactorEnabled: false } });
  ok("unreadable rows are reported and never overwritten");

  // Rollback to code without encryption
  const sealedNow = (await stored(extra.id)).twoFactorSecret as string;
  const oldCodeAccepts = (secret: string, token: string) =>
    speakeasy.totp.verify({ secret, encoding: "base32", token, window: 1, digits: 6, step: 30, algorithm: "sha1" });
  assert.equal(oldCodeAccepts(sealedNow, code(extraSecret)), false, "the previous release can't use a sealed value");
  const dryRestore = reseal(K1, "--restore-plaintext");
  assert.ok(Number(dryRestore.out.pending) >= 1);
  assert.equal((await stored(extra.id)).twoFactorSecret, sealedNow, "restore dry run writes nothing");
  assert.equal(reseal(K1, "--restore-plaintext", "--apply").exit, 1, "restore also needs the fingerprint");
  const restored = reseal(K1, "--restore-plaintext", "--apply", `--key-fingerprint=${fp}`);
  assert.equal(restored.exit, 0);
  const back = (await stored(extra.id)).twoFactorSecret as string;
  assert.equal(back, extraSecret, "exactly the original value");
  assert.equal(oldCodeAccepts(back, code(extraSecret)), true, "so the previous release works again");
  ok("rollback: previous release fails on sealed rows, restore mode returns them exactly");

  for (const p of passed) console.log(`PASS ${p}`);
  console.log(`mfa-key-compatibility: ok (${passed.length} checks)`);
} finally {
  server.close();
  await prisma.$disconnect();
}
process.exit(0);
