/**
 * POST /api/auth/refresh must accept a refresh token only. An access token (Bearer) is a short-lived
 * credential: it must never be exchanged for a new session, least of all after its own session ended.
 * Real Express app + database. Disposable database only:
 *   CARETIP_ISOLATED_POSTGRES_URL=... node scripts/safe-test.mjs test:auth-refresh-bearer
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}

const { prisma } = await import("../src/prisma.js");
const { refresh, logout } = await import("../src/controllers/auth.controller.js");
const { issueRefreshToken, revokeAllRefreshTokensForUser } = await import("../src/services/refreshToken.service.js");
const { authResultForUserId } = await import("../src/services/auth.service.js");
const { buildImpersonationJwtPayload, signJwt } = await import("../src/lib/jwtConfig.js");

const app = express();
app.use(express.json());
app.post("/refresh", (req, res) => void refresh(req, res));
app.post("/logout", (req, res) => void logout(req, res));
const server = http.createServer(app).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Out = { status: number; token?: string; cookie: string | null; mirrored: string | null };
async function post(path: string, opts: { cookie?: string; bearer?: string } = {}): Promise<Out> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.cookie ? { Cookie: `caretip_refresh=${opts.cookie}` } : {}),
      ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
    },
    body: "{}",
  });
  const set = res.headers.get("set-cookie") ?? "";
  const value = /caretip_refresh=([^;]*)/.exec(set)?.[1] || null;
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  return { status: res.status, token: body.token, cookie: value, mirrored: res.headers.get("x-caretip-refresh") || null };
}

const id = `bearer-${randomUUID()}`;
await prisma.user.create({ data: { id, email: `${id}@test.local`, role: "MANAGER", emailVerified: true } });
const sessions = () => prisma.refreshToken.count({ where: { userId: id, revokedAt: null } });
async function signIn() {
  const rt = await issueRefreshToken(id);
  const result = await authResultForUserId(id, { refreshSessionId: rt.id });
  return { id: rt.id, refresh: rt.token, access: result.token };
}

const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
}
const refused = (out: Out, before: number, after: number) => {
  assert.equal(out.status, 401, `status ${out.status}`);
  assert.ok(!out.token && !out.cookie && !out.mirrored, "no credential issued");
  assert.equal(after, before, `active sessions ${before} -> ${after}`);
};

try {
  await test("access token alone (live session) is not exchanged for a session", async () => {
    const s = await signIn();
    const before = await sessions();
    refused(await post("/refresh", { bearer: s.access }), before, await sessions());
  });
  await test("access token after sign-out", async () => {
    const s = await signIn();
    await post("/logout", { cookie: s.refresh });
    const before = await sessions();
    refused(await post("/refresh", { bearer: s.access }), before, await sessions());
  });
  await test("access token beside a refused refresh cookie", async () => {
    const s = await signIn();
    await post("/logout", { cookie: s.refresh });
    const before = await sessions();
    refused(await post("/refresh", { cookie: s.refresh, bearer: s.access }), before, await sessions());
  });
  await test("access token after every session was revoked (password change, token version bump)", async () => {
    const s = await signIn();
    await revokeAllRefreshTokensForUser(id);
    refused(await post("/refresh", { bearer: s.access }), 0, await sessions());
  });
  await test("support-view (impersonation) token cannot become the customer's own session", async () => {
    const admin = await signIn();
    const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { authTokenVersion: true } });
    const token = signJwt(
      buildImpersonationJwtPayload({
        targetUserId: id,
        platformAdminUserId: "admin",
        authTokenVersion: user.authTokenVersion,
        refreshSessionId: admin.id,
      }),
      "15m",
    );
    const before = await sessions();
    refused(await post("/refresh", { bearer: token }), before, await sessions());
  });
  await test("the refresh cookie still works, with or without an access token beside it (mobile sends both)", async () => {
    const s = await signIn();
    const a = await post("/refresh", { cookie: s.refresh, bearer: s.access });
    assert.equal(a.status, 200);
    assert.ok(a.token && a.cookie && a.cookie !== s.refresh, "rotated");
    assert.equal(a.mirrored, a.cookie && decodeURIComponent(a.cookie), "native clients get the mirrored token");
    const b = await post("/refresh", { cookie: a.cookie! });
    assert.equal(b.status, 200);
  });
  await test("a response lost in transit still recovers inside the grace window", async () => {
    const s = await signIn();
    assert.equal((await post("/refresh", { cookie: s.refresh })).status, 200);
    assert.equal((await post("/refresh", { cookie: s.refresh })).status, 200);
  });
  await test("sign-out with only the access token still ends that session", async () => {
    const s = await signIn();
    assert.equal((await post("/logout", { bearer: s.access })).status, 200);
    assert.equal((await post("/refresh", { cookie: s.refresh })).status, 401);
  });
} finally {
  await prisma.refreshToken.deleteMany({ where: { userId: id } });
  await prisma.user.delete({ where: { id } });
  await prisma.$disconnect();
  server.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nauth-refresh-bearer-runtime: ok (8 scenarios)");
process.exit(failures.length ? 1 : 0);
