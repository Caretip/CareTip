/**
 * Login lockout through the real controllers and a disposable database.
 * Run: CARETIP_ISOLATED_POSTGRES_URL=postgresql://...@127.0.0.1:PORT/db node scripts/safe-test.mjs test:login-lockout-endpoint
 */
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import { prisma } from "../src/prisma.ts";
import * as authController from "../src/controllers/auth.controller.ts";
import {
  __resetLoginLockoutMemoryForTests,
  __setLoginLockoutClockForTests,
} from "../src/services/loginLockout.service.ts";
import { __setSendResendEmailOutcomeFnForTests } from "../src/services/resendClient.ts";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
process.env.FRONTEND_URL = "https://caretip.example";
console.info = () => {};
console.warn = () => {};
__setSendResendEmailOutcomeFnForTests(async () => ({ kind: "sent", messageId: "m" }));

const MIN = 60_000;
let clock = Date.now();
__setLoginLockoutClockForTests(() => clock);

type Captured = { status: number; body: Record<string, unknown>; headers: Record<string, string> };

function call(
  handler: (req: Request, res: Response) => unknown,
  body: Record<string, unknown>,
): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    const out: Captured = { status: 200, body: {}, headers };
    const reqHeaders: Record<string, string> = {
      origin: "https://caretip.example",
      "user-agent": "lockout-test",
      "accept-language": "en",
    };
    const req = {
      body,
      headers: reqHeaders,
      cookies: {},
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      get: (n: string) => reqHeaders[n.toLowerCase()],
      header: (n: string) => reqHeaders[n.toLowerCase()],
      query: {},
      params: {},
      protocol: "https",
      secure: true,
      path: "/api/auth/signin",
      originalUrl: "/api/auth/signin",
    } as unknown as Request;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(out);
      }
    };
    const res = {
      status(c: number) { out.status = c; return this; },
      json(b: Record<string, unknown>) { out.body = b; finish(); return this; },
      send(b: unknown) { out.body = { raw: b }; finish(); return this; },
      end() { finish(); return this; },
      setHeader(k: string, v: string) { headers[k.toLowerCase()] = String(v); return this; },
      getHeader(k: string) { return headers[k.toLowerCase()]; },
      append() { return this; },
      cookie() { return this; },
      clearCookie() { return this; },
      set(k: string, v: string) { headers[k.toLowerCase()] = String(v); return this; },
      locals: {},
    } as unknown as Response;
    Promise.resolve(handler(req, res)).then(() => setTimeout(finish, 0), reject);
  });
}

const tag = `lockout-${Date.now()}`;
const email = `${tag}@example.test`;
const unverifiedEmail = `${tag}-unverified@example.test`;
const ghost = `${tag}-nobody@example.test`;
const password = "Correct-Horse-9";
const passwordHash = await bcrypt.hash(password, 10);

const user = await prisma.user.create({
  data: { email, role: "MANAGER", passwordHash, emailVerified: true, preferredLocale: "en" },
});
const business = await prisma.business.create({ data: { name: "Lockout Café", slug: tag, userId: user.id } });
const unverified = await prisma.user.create({
  data: { email: unverifiedEmail, role: "MANAGER", passwordHash, emailVerified: false },
});

const login = (e: string, p: string, extra: Record<string, unknown> = {}) =>
  call(authController.login, { email: e, password: p, ...extra });

let passed = 0;
const check = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
};

try {
  await check("wrong password and unknown email answer identically, then both lock on the 5th try", async () => {
    for (let i = 1; i <= 5; i += 1) {
      const real = await login(email, "wrong-password");
      const none = await login(ghost, "wrong-password");
      assert.equal(real.status, none.status, `attempt ${i} status`);
      assert.deepEqual(real.body, none.body, `attempt ${i} body`);
      if (i < 5) {
        assert.equal(real.status, 401);
      } else {
        assert.equal(real.status, 429);
        assert.equal(real.body.code, "LOGIN_TEMPORARILY_LOCKED");
        assert.equal(real.body.retryAfterSeconds, 300);
        assert.equal(real.headers["retry-after"], "300");
        assert.deepEqual(Object.keys(real.body).sort(), ["code", "message", "retryAfterSeconds"]);
      }
    }
  });

  await check("the correct password is refused while locked", async () => {
    clock += 2 * MIN;
    const r = await login(email, password);
    assert.equal(r.status, 429);
    assert.equal(r.body.retryAfterSeconds, 180);
  });

  await check("German request locale gets German copy", async () => {
    const r = await login(email, password, { locale: "de" });
    assert.match(String(r.body.message), /vorübergehend gesperrt.*in 3 Minuten/);
  });

  await check("password reset stays available during the lock", async () => {
    const r = await call(authController.forgotPassword, { email });
    assert.ok(r.status < 400, `forgot-password status ${r.status}`);
  });

  await check("resend-verification shares the lock (it also checks passwords)", async () => {
    const r = await call(authController.resendVerificationEmail, { email, password });
    assert.equal(r.status, 429);
    assert.equal(r.body.code, "LOGIN_TEMPORARILY_LOCKED");
  });

  await check("after 5 minutes the correct password signs in", async () => {
    clock += 3 * MIN;
    const r = await login(email, password);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await check("success reset the history: 4 failures later still do not lock", async () => {
    for (let i = 0; i < 4; i += 1) assert.equal((await login(email, "nope")).status, 401);
    assert.equal((await login(email, password)).status, 200);
  });

  await check("second round locks for 10 minutes", async () => {
    for (let i = 0; i < 5; i += 1) await login(email, "nope");
    clock += 5 * MIN;
    for (let i = 0; i < 4; i += 1) assert.equal((await login(email, "nope")).status, 401);
    const fifth = await login(email, "nope");
    assert.equal(fifth.status, 429);
    assert.equal(fifth.body.retryAfterSeconds, 600);
    clock += 9 * MIN;
    assert.equal((await login(email, password)).status, 429);
    clock += MIN;
    assert.equal((await login(email, password)).status, 200);
  });

  await check("correct password on an unverified account resets the count (no false lock)", async () => {
    for (let i = 0; i < 4; i += 1) await login(unverifiedEmail, "nope");
    const ok = await login(unverifiedEmail, password);
    assert.equal(ok.status, 403);
    assert.equal(ok.body.code, "EMAIL_NOT_VERIFIED");
    assert.equal((await login(unverifiedEmail, "nope")).status, 401, "count restarted");
  });

  await check("email case differences share one lockout", async () => {
    __resetLoginLockoutMemoryForTests();
    for (let i = 0; i < 5; i += 1) await login(i % 2 ? email.toUpperCase() : ` ${email} `, "nope");
    assert.equal((await login(email, password)).status, 429);
    clock += 5 * MIN;
  });

  console.log(`login-lockout-endpoint-runtime: ok (${passed} checks)`);
} finally {
  __setSendResendEmailOutcomeFnForTests(null);
  await prisma.refreshToken?.deleteMany?.({ where: { userId: { in: [user.id, unverified.id] } } }).catch(() => undefined);
  await prisma.business.delete({ where: { id: business.id } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [user.id, unverified.id] } } }).catch(() => undefined);
  await prisma.$disconnect();
}
