/**
 * Refresh reliability regressions — real controller, rotation service and auth middleware
 * against an in-memory refresh-token store (no database, no network, no real tokens).
 * Run: npm run test:auth-refresh-reliability (from backend/)
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "reliability-test-secret-not-used-anywhere-else";

const { refresh, authRefreshTestHooks } = await import("../src/controllers/auth.controller.ts");
const {
  REFRESH_ROTATION_GRACE_MS,
  refreshTokenServiceTestHooks,
  rotateRefreshToken,
} = await import("../src/services/refreshToken.service.ts");
const { authMiddleware, authMiddlewareTestHooks } = await import("../src/middleware/auth.middleware.ts");

// ---------------------------------------------------------------------------
// In-memory refresh-token store; every call yields so concurrent requests interleave.
// ---------------------------------------------------------------------------
type Row = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
};
type Op = "findUnique" | "create" | "updateMany" | "deleteMany";

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const tick = () => new Promise<void>((r) => setImmediate(r));
const poolTimeout = () =>
  new Prisma.PrismaClientKnownRequestError("Timed out fetching a new connection from the connection pool", {
    code: "P2024",
    clientVersion: "test",
  });

class Store {
  rows = new Map<string, Row>();
  ops: string[] = [];
  failOn: ((op: Op, args: unknown) => boolean) | null = null;
  private seq = 0;

  private maybeFail(op: Op, args: unknown) {
    this.ops.push(op);
    if (this.failOn?.(op, args)) throw poolTimeout();
  }

  seed(userId: string, opts: Partial<Omit<Row, "id" | "tokenHash" | "userId">> = {}): { id: string; token: string } {
    const token = crypto.randomBytes(24).toString("base64url");
    const id = `seed_${++this.seq}`;
    this.rows.set(id, {
      id,
      tokenHash: sha256(token),
      userId,
      expiresAt: opts.expiresAt ?? new Date(clock() + 7 * 864e5),
      revokedAt: opts.revokedAt ?? null,
      replacedByTokenId: opts.replacedByTokenId ?? null,
    });
    return { id, token };
  }

  active(userId: string): Row[] {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.revokedAt == null);
  }

  byToken(token: string): Row | undefined {
    const h = sha256(token);
    return [...this.rows.values()].find((r) => r.tokenHash === h);
  }

  refreshToken = {
    findUnique: async (args: { where: { tokenHash?: string; id?: string } }) => {
      await tick();
      this.maybeFail("findUnique", args);
      const w = args.where;
      const row = [...this.rows.values()].find((r) => (w.id ? r.id === w.id : r.tokenHash === w.tokenHash));
      return row ? { ...row } : null;
    },
    create: async (args: { data: Omit<Row, "id"> }) => {
      await tick();
      this.maybeFail("create", args);
      const id = `rt_${++this.seq}`;
      this.rows.set(id, { id, ...args.data });
      return { id };
    },
    updateMany: async (args: {
      where: { id?: string; userId?: string; revokedAt: null };
      data: { revokedAt: Date; replacedByTokenId?: string };
    }) => {
      await tick();
      this.maybeFail("updateMany", args);
      let count = 0;
      for (const r of this.rows.values()) {
        if (args.where.id && r.id !== args.where.id) continue;
        if (args.where.userId && r.userId !== args.where.userId) continue;
        if (r.revokedAt != null) continue;
        r.revokedAt = args.data.revokedAt;
        if (args.data.replacedByTokenId) r.replacedByTokenId = args.data.replacedByTokenId;
        count++;
      }
      return { count };
    },
    deleteMany: async (args: { where: { id: string } }) => {
      await tick();
      this.maybeFail("deleteMany", args);
      return { count: this.rows.delete(args.where.id) ? 1 : 0 };
    },
  };
}

let nowMs = Date.UTC(2026, 10, 2, 12, 0, 0);
const clock = () => nowMs;
let store = new Store();

function freshStore(): Store {
  store = new Store();
  refreshTokenServiceTestHooks.setDb(store as never);
  refreshTokenServiceTestHooks.setClock(clock);
  return store;
}

// ---------------------------------------------------------------------------
// Express doubles + log capture
// ---------------------------------------------------------------------------
type CookieCall = { name: string; value: string; opts: Record<string, unknown> };
type Captured = { status: number; body: unknown; cookies: CookieCall[]; headers: Record<string, string> };

function fakeRes(): { res: Response; out: Captured; done: Promise<void> } {
  const out: Captured = { status: 200, body: undefined, cookies: [], headers: {} };
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      resolve();
      return res;
    },
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      out.cookies.push({ name, value, opts });
      return res;
    },
    setHeader(name: string, value: string) {
      out.headers[name] = value;
    },
  };
  return { res: res as unknown as Response, out, done };
}

async function callRefresh(token: string | null): Promise<Captured> {
  const { res, out } = fakeRes();
  const req = { headers: token ? { cookie: `caretip_refresh=${encodeURIComponent(token)}` } : {} } as Request;
  await refresh(req, res);
  return out;
}

const issuedCookie = (out: Captured) => out.cookies.find((c) => c.name === "caretip_refresh" && c.value !== "");
const clearedCookie = (out: Captured) =>
  out.cookies.find((c) => c.name === "caretip_refresh" && c.value === "" && c.opts.maxAge === 0);

const logs: string[] = [];
const realInfo = console.info;
const realWarn = console.warn;
const realError = console.error;
console.info = (...a: unknown[]) => logs.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => logs.push(a.map(String).join(" "));
console.error = (...a: unknown[]) => logs.push(a.map((x) => (x instanceof Error ? x.name : String(x))).join(" "));
const refreshEvents = () =>
  logs
    .filter((l) => l.startsWith('{"event":"auth.refresh"'))
    .map((l) => JSON.parse(l) as { reason: string; status: number; [k: string]: unknown });
const lastReason = () => refreshEvents().at(-1)?.reason;

authRefreshTestHooks.setAuthResultForUserId((async (userId: string, ctx?: { refreshSessionId?: string }) => ({
  token: `access.${ctx?.refreshSessionId}`,
  user: { id: userId, email: "user@example.test", role: "EMPLOYEE" },
})) as never);

const results: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  logs.length = 0;
  freshStore();
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (err) {
    results.push(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const USER = "user_a";

// ---------------------------------------------------------------------------
// Infrastructure failures
// ---------------------------------------------------------------------------
await test("1 lookup failure → 503 retryable, cookie untouched, no reuse event", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const other = s.seed(USER);
  s.failOn = (op) => op === "findUnique";
  const out = await callRefresh(r1.token);
  assert.equal(out.status, 503);
  assert.deepEqual(out.body, { message: (out.body as { message: string }).message, code: "REFRESH_UNAVAILABLE", retryable: true });
  assert.equal(out.cookies.length, 0, "no Set-Cookie at all (neither issue nor delete)");
  assert.equal(s.active(USER).length, 2, "no session revoked");
  assert.equal(lastReason(), "db_error");
  assert.ok(!refreshEvents().some((e) => e.reason === "reuse_detected"));
  s.failOn = null;
  const retry = await callRefresh(r1.token);
  assert.equal(retry.status, 200, "same cookie works once the store recovers");
  assert.ok(s.rows.get(other.id)!.revokedAt == null);
});

await test("2a replacement insert fails → 503 retryable, old token still valid", async () => {
  const s = store;
  const r1 = s.seed(USER);
  s.failOn = (op) => op === "create";
  const out = await callRefresh(r1.token);
  assert.equal(out.status, 503);
  assert.equal((out.body as { retryable: boolean }).retryable, true);
  assert.equal(out.cookies.length, 0);
  assert.equal(s.rows.get(r1.id)!.revokedAt, null, "original token not revoked");
  assert.equal(s.active(USER).length, 1, "no extra active session");
});

await test("2b revoke step fails (outcome unknown) → 503 not retryable, no session-wide revoke", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const other = s.seed(USER);
  s.failOn = (op, args) => op === "updateMany" && (args as { where: { id?: string } }).where.id === r1.id;
  const out = await callRefresh(r1.token);
  assert.equal(out.status, 503);
  assert.equal((out.body as { retryable: boolean }).retryable, false);
  assert.equal(out.cookies.length, 0, "cookie neither replaced nor deleted");
  assert.equal(s.rows.get(other.id)!.revokedAt, null, "other devices untouched");
  assert.equal(lastReason(), "db_error");
});

await test("2c rotation committed then user lookup fails → 503 but new cookie delivered", async () => {
  const s = store;
  const r1 = s.seed(USER);
  authRefreshTestHooks.setAuthResultForUserId((async () => {
    throw poolTimeout();
  }) as never);
  try {
    const out = await callRefresh(r1.token);
    assert.equal(out.status, 503);
    assert.equal((out.body as { retryable: boolean }).retryable, true);
    const issued = issuedCookie(out);
    assert.ok(issued, "replacement cookie is set even though the response is 503");
    assert.equal(issued!.opts.httpOnly, true);
    assert.ok(!clearedCookie(out), "never deleted");
    assert.equal(s.byToken(issued!.value)?.revokedAt, null, "delivered token is the active session");
    assert.equal(s.active(USER).length, 1);
  } finally {
    authRefreshTestHooks.setAuthResultForUserId((async (userId: string, ctx?: { refreshSessionId?: string }) => ({
      token: `access.${ctx?.refreshSessionId}`,
      user: { id: userId, email: "user@example.test", role: "EMPLOYEE" },
    })) as never);
  }
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------
await test("4 two overlapping refreshes with one cookie → one chain, loser 409 without cookie deletion", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const [a, b] = await Promise.all([callRefresh(r1.token), callRefresh(r1.token)]);
  const firstWrite = s.ops.findIndex((o) => o === "updateMany");
  assert.equal(s.ops.slice(0, firstWrite).filter((o) => o === "findUnique").length, 2, "both read before any revoke");
  const winner = a.status === 200 ? a : b;
  const loser = a.status === 200 ? b : a;
  assert.equal(winner.status, 200);
  assert.equal(loser.status, 409);
  assert.equal((loser.body as { code: string }).code, "REFRESH_CONFLICT");
  assert.equal(loser.cookies.length, 0, "loser sends no Set-Cookie, so it cannot delete the winner's cookie");
  const active = s.active(USER);
  assert.equal(active.length, 1, "exactly one active session");
  assert.equal(active[0]!.tokenHash, sha256(issuedCookie(winner)!.value), "the active session is the winner's");
  assert.equal(s.rows.size, 2, "loser's never-issued row is removed");
  assert.ok(refreshEvents().some((e) => e.reason === "rotation_conflict" && e.status === 409));
});

await test("5 response lost after rotation commits → retry recovers without logout", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const otherDevice = s.seed(USER);
  const lost = await callRefresh(r1.token); // committed server-side; browser never sees it
  assert.equal(lost.status, 200);
  nowMs += 5_000;
  const retry = await callRefresh(r1.token);
  assert.equal(retry.status, 200, "old cookie recovers inside the grace window");
  const issued = issuedCookie(retry)!;
  assert.ok(!clearedCookie(retry));
  const userActive = s.active(USER).map((r) => r.id).sort();
  assert.deepEqual(userActive, [otherDevice.id, s.byToken(issued.value)!.id].sort(), "one session per chain");
  assert.ok(s.byToken(issueCookieValue(lost))!.revokedAt, "the lost token is superseded, not left active");
  const ev = refreshEvents().at(-1)!;
  assert.equal(ev.reason, "ok");
  assert.equal(ev.recovered, true);
});

function issueCookieValue(out: Captured): string {
  return issuedCookie(out)!.value;
}

// ---------------------------------------------------------------------------
// Replay and logout
// ---------------------------------------------------------------------------
await test("7 grace boundary: exactly 60s recovers and creates no extra session", async () => {
  const s = store;
  const r1 = s.seed(USER);
  await callRefresh(r1.token);
  const activeBefore = s.active(USER).length;
  nowMs += REFRESH_ROTATION_GRACE_MS;
  const out = await callRefresh(r1.token);
  assert.equal(out.status, 200);
  assert.equal(s.active(USER).length, activeBefore, "recovery replaces the head, no sibling session");
});

await test("7b multi-hop chain recovers to the current head only", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const second = issueCookieValue(await callRefresh(r1.token));
  nowMs += 1_000;
  const third = issueCookieValue(await callRefresh(second));
  nowMs += 1_000;
  const out = await callRefresh(r1.token);
  assert.equal(out.status, 200);
  assert.ok(s.byToken(third)!.revokedAt, "previous head superseded");
  assert.equal(s.active(USER).length, 1);
});

await test("8 replay just outside grace → reuse cascade revokes every session and is logged", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const otherDevice = s.seed(USER);
  await callRefresh(r1.token);
  nowMs += REFRESH_ROTATION_GRACE_MS + 1;
  const out = await callRefresh(r1.token);
  assert.equal(out.status, 401);
  assert.ok(clearedCookie(out), "cookie deleted with matching attributes");
  assert.equal(clearedCookie(out)!.opts.path, "/");
  assert.equal(s.active(USER).length, 0, "all sessions revoked");
  assert.ok(s.rows.get(otherDevice.id)!.revokedAt);
  const ev = refreshEvents().at(-1)!;
  assert.equal(ev.reason, "reuse_detected");
  assert.equal(ev.revokedSessions, 2);
});

await test("8b strict rotateRefreshToken keeps immediate-replay cascade (existing contract)", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const rotated = await rotateRefreshToken(r1.token);
  assert.ok(rotated);
  assert.equal(await rotateRefreshToken(r1.token), null);
  assert.equal(s.active(USER).length, 0);
});

await test("9 logged-out token is never recovered and does not cascade", async () => {
  const s = store;
  const loggedOut = s.seed(USER, { revokedAt: new Date(nowMs - 1_000) });
  const otherDevice = s.seed(USER);
  const rowsBefore = s.rows.size;
  const out = await callRefresh(loggedOut.token);
  assert.equal(out.status, 401);
  assert.ok(clearedCookie(out));
  assert.equal(s.rows.size, rowsBefore, "no session created");
  assert.equal(s.rows.get(otherDevice.id)!.revokedAt, null);
  assert.equal(lastReason(), "revoked_logout");
});

await test("9b replaced token whose chain was then logged out is not recovered", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const second = issueCookieValue(await callRefresh(r1.token));
  s.byToken(second)!.revokedAt = new Date(nowMs + 500); // explicit logout of the head
  nowMs += 1_000;
  const rowsBefore = s.rows.size;
  const out = await callRefresh(r1.token);
  assert.equal(out.status, 401);
  assert.equal(s.rows.size, rowsBefore);
  assert.equal(s.active(USER).length, 0);
  assert.equal(lastReason(), "revoked_logout");
});

await test("10 expired token is not recovered", async () => {
  const s = store;
  const expired = s.seed(USER, { expiresAt: new Date(nowMs - 1) });
  const out = await callRefresh(expired.token);
  assert.equal(out.status, 401);
  assert.equal(s.active(USER).length, 1, "expired row untouched, nothing new");
  assert.equal(lastReason(), "expired");

  const r1 = s.seed("user_b", { expiresAt: new Date(nowMs + 2_000) });
  await callRefresh(r1.token);
  nowMs += 3_000; // inside grace, but r1 itself has expired
  const late = await callRefresh(r1.token);
  assert.equal(late.status, 401, "expired replaced token never revived");
  assert.ok(!issuedCookie(late));
});

await test("16 inactive account cannot restore a session", async () => {
  const s = store;
  const r1 = s.seed(USER);
  authRefreshTestHooks.setAuthResultForUserId((async () => {
    throw new Error("Authentication required");
  }) as never);
  try {
    const out = await callRefresh(r1.token);
    assert.equal(out.status, 401);
    assert.ok(clearedCookie(out));
    assert.ok(!issuedCookie(out));
    assert.equal(lastReason(), "account_unavailable");
  } finally {
    authRefreshTestHooks.setAuthResultForUserId((async (userId: string, ctx?: { refreshSessionId?: string }) => ({
      token: `access.${ctx?.refreshSessionId}`,
      user: { id: userId, email: "user@example.test", role: "EMPLOYEE" },
    })) as never);
  }
});

await test("missing cookie → 401 missing_cookie, no Set-Cookie", async () => {
  const out = await callRefresh(null);
  assert.equal(out.status, 401);
  assert.equal(out.cookies.length, 0);
  assert.equal(lastReason(), "missing_cookie");
});

await test("logs never contain token or cookie values; logging failure cannot break refresh", async () => {
  const s = store;
  const r1 = s.seed(USER);
  const out = await callRefresh(r1.token);
  const next = issueCookieValue(out);
  assert.ok(!logs.some((l) => l.includes(r1.token) || l.includes(next) || l.includes("caretip_refresh=")));
  const saved = console.info;
  console.info = () => {
    throw new Error("log sink down");
  };
  try {
    const again = await callRefresh(next);
    assert.equal(again.status, 200);
  } finally {
    console.info = saved;
  }
});

// ---------------------------------------------------------------------------
// Auth middleware: infrastructure vs invalid credentials
// ---------------------------------------------------------------------------
type MwDb = Parameters<typeof authMiddlewareTestHooks.setDb>[0];
const activeUser = {
  id: USER,
  authTokenVersion: 3,
  isActive: true,
  accountStatus: "active",
  role: "EMPLOYEE",
  emailVerified: true,
  isPlatformAdmin: false,
  hasCompletedOnboarding: true,
  onboardingCompletedAt: null,
};

function mwDb(opts: { fail?: "user" | "session"; userActive?: boolean; sessionRevoked?: boolean }): MwDb {
  return {
    user: {
      findUnique: async () => {
        await tick();
        if (opts.fail === "user") throw poolTimeout();
        return { ...activeUser, isActive: opts.userActive ?? true } as never;
      },
    },
    refreshToken: {
      findUnique: async () => {
        await tick();
        if (opts.fail === "session") throw poolTimeout();
        return { userId: USER, revokedAt: opts.sessionRevoked ? new Date() : null, expiresAt: new Date(Date.now() + 864e5) };
      },
    },
  } as MwDb;
}

function accessJwt(extra: Record<string, unknown> = {}, expiresIn: number | string = "15m"): string {
  return jwt.sign(
    { sub: USER, role: "EMPLOYEE", type: "access", tv: 3, sid: "sess_1", ...extra },
    process.env.JWT_SECRET!,
    { algorithm: "HS256", expiresIn } as jwt.SignOptions,
  );
}

async function callMiddleware(token: string | null): Promise<{ status: number; body: unknown; nextCalled: boolean }> {
  const { res, out, done } = fakeRes();
  let nextCalled = false;
  const nextDone = new Promise<void>((resolve) => {
    authMiddleware(
      { headers: token ? { authorization: `Bearer ${token}` } : {} } as Request,
      res,
      () => {
        nextCalled = true;
        resolve();
      },
    );
  });
  await Promise.race([done, nextDone]);
  return { status: nextCalled ? 200 : out.status, body: out.body, nextCalled };
}

await test("3 middleware: session store failure → 503, invalid credentials keep 401", async () => {
  authMiddlewareTestHooks.setDb(mwDb({ fail: "user" }));
  let r = await callMiddleware(accessJwt());
  assert.equal(r.status, 503);
  assert.equal((r.body as { code: string }).code, "AUTH_UNAVAILABLE");

  authMiddlewareTestHooks.setDb(mwDb({ fail: "session" }));
  r = await callMiddleware(accessJwt());
  assert.equal(r.status, 503, "sid lookup failure is infrastructure too");

  authMiddlewareTestHooks.setDb(mwDb({}));
  r = await callMiddleware(accessJwt());
  assert.ok(r.nextCalled, "valid token passes");

  r = await callMiddleware(accessJwt({}, -10));
  assert.equal(r.status, 401);
  assert.equal((r.body as { code: string }).code, "TOKEN_EXPIRED");

  r = await callMiddleware(`${accessJwt().slice(0, -4)}AAAA`);
  assert.equal(r.status, 401);
  assert.equal((r.body as { code: string }).code, "TOKEN_INVALID");

  r = await callMiddleware(accessJwt({ tv: 2 }));
  assert.equal(r.status, 401);
  assert.equal((r.body as { code: string }).code, "SESSION_STALE", "token version still enforced");

  authMiddlewareTestHooks.setDb(mwDb({ sessionRevoked: true }));
  r = await callMiddleware(accessJwt());
  assert.equal((r.body as { code: string }).code, "SESSION_STALE", "revoked session still rejected");

  authMiddlewareTestHooks.setDb(mwDb({ userActive: false }));
  r = await callMiddleware(accessJwt());
  assert.equal(r.status, 401, "inactive account still rejected");
  authMiddlewareTestHooks.setDb(null);
});

refreshTokenServiceTestHooks.setDb(null);
refreshTokenServiceTestHooks.setClock(null);
authRefreshTestHooks.setAuthResultForUserId(null);
console.info = realInfo;
console.warn = realWarn;
console.error = realError;

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(
  failed.length === 0
    ? `auth-refresh-reliability-runtime: ok (${results.length} scenarios)`
    : `auth-refresh-reliability-runtime: ${failed.length} failed`,
);
process.exit(failed.length === 0 ? 0 : 1);
