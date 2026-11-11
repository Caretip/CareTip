/**
 * First-party API domain (api.caretip.de) — backend checks. No database, Redis or credentials:
 * DATABASE_URL points at an unresolvable `.invalid` host and REDIS_URL is cleared before any app
 * module loads, so an accidental query fails instead of touching shared data.
 * Run: npm run test:first-party-api-domain
 */
process.env.DATABASE_URL = "postgresql://placeholder:placeholder@db.invalid:6543/postgres";
process.env.REDIS_URL = "";
process.env.JWT_SECRET = "first-party-api-domain-placeholder-secret-not-used-anywhere-else";
process.env.AUTH_LOGIN_IP_MAX_PER_15M = "3";
delete process.env.FRONTEND_URL;
delete process.env.CORS_ORIGINS;
delete process.env.NEXT_PUBLIC_APP_URL;
delete process.env.VITE_APP_URL;
delete process.env.FIRST_PARTY_API_HOSTS;
delete process.env.PUBLIC_API_BASE_URL;
delete process.env.API_PUBLIC_URL;
delete process.env.BACKEND_PUBLIC_URL;

import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const express = (await import("express")).default;
const cors = (await import("cors")).default;
const { Server: SocketIoServer } = await import("socket.io");
const { corsMiddlewareOptions, socketCorsOptions, isCorsOriginAllowed } = await import("../src/config/cors.js");
const { requireTrustedOrigin } = await import("../src/middleware/requireTrustedOrigin.middleware.js");
const { loginRateLimit } = await import("../src/middleware/authRateLimit.middleware.js");
const { resolvePublicApiBaseUrl } = await import("../src/config/publicApiBaseUrl.js");
const svc = await import("../src/services/refreshToken.service.js");
const ctrl = await import("../src/controllers/auth.controller.js");
const { signJwt } = await import("../src/lib/jwtConfig.js");
const { authMiddleware, authMiddlewareTestHooks } = await import("../src/middleware/auth.middleware.js");
const { trustedClientIp } = await import("../src/lib/clientIp.js");
const { extractLoginRequestContext } = await import("../src/services/loginNotification.service.js");
const { resolveScanSessionId } = await import("../src/services/qr/qrScanRequestContext.js");
const { createHash } = await import("node:crypto");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results: { id: string; ok: boolean; detail: string }[] = [];
const assert = (cond: unknown, id: string, detail: string) => results.push({ id, ok: Boolean(cond), detail });

function withNodeEnv<T>(env: string, fn: () => T): T {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
}

/** NODE_ENV=production for the whole async call; re-entrant so concurrent calls do not interleave. */
let productionDepth = 0;
let envBeforeProduction: string | undefined;
async function inProduction<T>(fn: () => Promise<T>): Promise<T> {
  if (productionDepth++ === 0) {
    envBeforeProduction = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
  }
  try {
    return await fn();
  } finally {
    if (--productionDepth === 0) {
      if (envBeforeProduction === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = envBeforeProduction;
    }
  }
}

type CookieCall = { name: string; value: string; opts: Record<string, unknown> };
function fakeRes(host?: string) {
  const cookies: CookieCall[] = [];
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    req: { get: (name: string) => (name.toLowerCase() === "host" ? host : undefined) },
    cookie(name: string, value: string, opts: Record<string, unknown>) {
      cookies.push({ name, value, opts });
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return { res, cookies, headers };
}

// --- 3/4: refresh cookie attributes on each host, set and clear match ---
withNodeEnv("production", () => {
  const api = fakeRes("api.caretip.de");
  svc.setRefreshCookie(api.res, "opaque-test-value", { maxAgeMs: 3_600_000 });
  svc.clearRefreshCookie(api.res);
  const [set, clear] = api.cookies;
  assert(set?.name === "caretip_refresh", "cookie", "api.caretip.de: cookie name unchanged");
  assert(
    set?.opts.httpOnly === true && set.opts.secure === true && set.opts.sameSite === "lax" && set.opts.path === "/",
    "cookie",
    "api.caretip.de: HttpOnly, Secure, SameSite=Lax, Path=/",
  );
  assert(!("domain" in (set?.opts ?? {})), "cookie", "api.caretip.de: host-only (no Domain attribute)");
  assert(set?.opts.maxAge === 3_600_000, "cookie", "api.caretip.de: expiry follows the session expiry");
  assert(
    clear?.value === "" &&
      clear.opts.maxAge === 0 &&
      (clear.opts.expires as Date).getTime() === 0 &&
      clear.opts.httpOnly === set?.opts.httpOnly &&
      clear.opts.secure === set?.opts.secure &&
      clear.opts.sameSite === set?.opts.sameSite &&
      clear.opts.path === set?.opts.path &&
      !("domain" in clear.opts),
    "cookie",
    "api.caretip.de: deletion uses the same attributes with Max-Age=0 and epoch expiry",
  );

  const upper = fakeRes("API.CARETIP.DE:443");
  svc.setRefreshCookie(upper.res, "v");
  assert(upper.cookies[0]?.opts.sameSite === "lax", "cookie", "host match ignores case and port");

  const legacy = fakeRes("caretip.onrender.com");
  svc.setRefreshCookie(legacy.res, "v");
  svc.clearRefreshCookie(legacy.res);
  assert(
    legacy.cookies[0]?.opts.sameSite === "none" && legacy.cookies[1]?.opts.sameSite === "none",
    "cookie",
    "caretip.onrender.com (migration period): SameSite=None for set and clear (cross-site SPA)",
  );
  assert(legacy.cookies[0]?.opts.secure === true, "cookie", "onrender host still Secure");

  const spoof = fakeRes("evil.example");
  svc.setRefreshCookie(spoof.res, "v");
  assert(spoof.cookies[0]?.opts.sameSite === "none", "cookie", "unknown host never gets the first-party policy");

  const noReq = fakeRes(undefined);
  svc.setRefreshCookie(noReq.res, "v");
  assert(noReq.cookies[0]?.opts.sameSite === "none", "cookie", "missing Host falls back to the cross-site policy");
});
withNodeEnv("development", () => {
  const dev = fakeRes("localhost:3001");
  svc.setRefreshCookie(dev.res, "v");
  assert(
    dev.cookies[0]?.opts.sameSite === "lax" && dev.cookies[0].opts.secure === false,
    "cookie",
    "development unchanged: SameSite=Lax, not Secure (Vite proxy over http)",
  );
});
{
  process.env.FIRST_PARTY_API_HOSTS = "api.staging.caretip.de";
  const staged = withNodeEnv("production", () => svc.refreshCookieSameSite("api.staging.caretip.de"));
  delete process.env.FIRST_PARTY_API_HOSTS;
  assert(staged === "lax", "cookie", "FIRST_PARTY_API_HOSTS adds extra first-party hosts");
}

// --- HTTP harness ---
async function listen(server: HttpServer): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// --- 5: CORS on a real Express server ---
{
  const app = express();
  app.use(cors(corsMiddlewareOptions));
  app.post("/api/auth/refresh", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  const base = await listen(server);
  const preflight = async (origin: string) =>
    fetch(`${base}/api/auth/refresh`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-caretip-client",
      },
    });
  const canonical = await preflight("https://caretip.de");
  assert(
    canonical.headers.get("access-control-allow-origin") === "https://caretip.de" &&
      canonical.headers.get("access-control-allow-credentials") === "true",
    "cors",
    "https://caretip.de: credentialed CORS allowed with the exact origin echoed",
  );
  const www = await preflight("https://www.caretip.de");
  assert(www.headers.get("access-control-allow-origin") === "https://www.caretip.de", "cors", "https://www.caretip.de allowed");
  for (const bad of ["https://evil.example", "https://caretip.de.evil.example", "http://caretip.de", "null", "https://api.caretip.de.evil.example"]) {
    const r = await preflight(bad);
    assert(!r.headers.get("access-control-allow-origin"), "cors", `rejected: ${bad}`);
  }
  assert(canonical.headers.get("access-control-allow-origin") !== "*", "cors", "never wildcard with credentials");
  server.close();
}
assert(isCorsOriginAllowed("https://caretip.de"), "cors", "isCorsOriginAllowed(canonical)");
assert(
  withNodeEnv("production", () => !isCorsOriginAllowed("http://localhost:5173")),
  "cors",
  "production rejects localhost origins",
);

// --- 6: trusted-origin check ---
function runTrusted(headers: Record<string, string>): number {
  let status = 0;
  const req = { get: (n: string) => headers[n.toLowerCase()] } as never;
  const res = {
    status(code: number) {
      status = code;
      return { json: () => undefined };
    },
  } as never;
  requireTrustedOrigin(req, res, () => {
    status = 200;
  });
  return status;
}
assert(runTrusted({ origin: "https://caretip.de" }) === 200, "origin", "canonical Origin passes");
assert(runTrusted({ origin: "https://evil.example" }) === 403, "origin", "foreign Origin rejected");
assert(runTrusted({ origin: "https://evil.example", "x-caretip-client": "1" }) === 403, "origin", "client header cannot override a foreign Origin");
assert(runTrusted({ referer: "https://caretip.de/dashboard" }) === 200, "origin", "canonical Referer passes when Origin absent");
assert(runTrusted({}) === 403, "origin", "no Origin and no client header rejected");
assert(runTrusted({ "x-caretip-client": "1" }) === 200, "origin", "native client header still accepted without Origin");

// --- 12: client IP behind Render's proxy (trust proxy 1) and real login limiter ---
{
  const { resolveTrustProxySetting } = await import("../src/lib/clientIp.js");
  const indexSrc = readFileSync(path.join(backendRoot, "src/index.ts"), "utf8");
  assert(/configureTrustProxy\(app\)/.test(indexSrc), "ip", "index.ts applies the trust proxy rule");
  assert(resolveTrustProxySetting({ NODE_ENV: "production" }) === 1, "ip", "production defaults to trust proxy = 1 (one Render hop)");

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  app.post("/login", loginRateLimit, (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  const base = await listen(server);
  const ipFor = async (xff: string) =>
    ((await (await fetch(`${base}/ip`, { headers: { "X-Forwarded-For": xff } })).json()) as { ip: string }).ip;
  assert((await ipFor("203.0.113.7")) === "203.0.113.7", "ip", "single proxy hop: client IP is the forwarded address");
  assert(
    (await ipFor("6.6.6.6, 203.0.113.7")) === "203.0.113.7",
    "ip",
    "client-supplied X-Forwarded-For entries are ignored (only the proxy-appended one is trusted)",
  );
  const login = (xff: string) =>
    fetch(`${base}/login`, {
      method: "POST",
      headers: { "X-Forwarded-For": xff, "Content-Type": "application/json" },
      body: "{}",
    }).then((r) => r.status);
  const a: number[] = [];
  for (let i = 0; i < 4; i++) a.push(await login(`10.${i}.0.1, 198.51.100.10`));
  assert(a.slice(0, 3).every((s) => s === 200) && a[3] === 429, "ip", "per-IP login limit enforced (3 → 429), spoofed prefixes do not evade it");
  assert((await login("198.51.100.11")) === 200, "ip", "a different client behind the same proxy has its own bucket");
  server.close();
}

// --- 11: Socket.IO handshake origin policy (same CORS options as production) ---
{
  const server = createServer();
  const io = new SocketIoServer(server, { cors: socketCorsOptions });
  const base = await listen(server);
  const handshake = (origin: string) =>
    fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } });
  const ok = await handshake("https://caretip.de");
  const okBody = await ok.text();
  assert(
    ok.status === 200 && ok.headers.get("access-control-allow-origin") === "https://caretip.de" && okBody.startsWith("0{"),
    "socket",
    "Socket.IO polling handshake succeeds for https://caretip.de",
  );
  const bad = await handshake("https://evil.example");
  await bad.text();
  assert(!bad.headers.get("access-control-allow-origin"), "socket", "Socket.IO handshake not CORS-allowed for a foreign origin");
  io.close();
  server.close();
}
{
  const socketSrc = readFileSync(path.join(backendRoot, "src/socket/socketServer.ts"), "utf8");
  assert(socketSrc.includes("cors: socketCorsOptions"), "socket", "production Socket.IO server uses socketCorsOptions");
}

// --- 13: upload/media URL base and webhook mounts unchanged ---
{
  process.env.RENDER_EXTERNAL_URL = "https://caretip.onrender.com";
  assert(
    resolvePublicApiBaseUrl() === "https://caretip.onrender.com",
    "routes",
    "media URLs keep the Render origin unless PUBLIC_API_BASE_URL is set (no change by default)",
  );
  process.env.PUBLIC_API_BASE_URL = "https://api.caretip.de/";
  assert(resolvePublicApiBaseUrl() === "https://api.caretip.de", "routes", "PUBLIC_API_BASE_URL can move media URLs to api.caretip.de");
  delete process.env.PUBLIC_API_BASE_URL;
  delete process.env.RENDER_EXTERNAL_URL;
  const indexSrc = readFileSync(path.join(backendRoot, "src/index.ts"), "utf8");
  assert(
    indexSrc.indexOf('app.use("/api/webhooks", express.raw') !== -1 &&
      indexSrc.indexOf('app.use("/api/webhooks", express.raw') < indexSrc.indexOf("app.use(cors(corsMiddlewareOptions))"),
    "routes",
    "Stripe webhooks still mounted with raw body before CORS/JSON (host-independent)",
  );
}

// --- Session host migration endpoint ---
type Row = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
};
function memoryStore() {
  const rows = new Map<string, Row>();
  let seq = 0;
  const tick = () => new Promise<void>((r) => setImmediate(r));
  const pick = (r: Row) => ({
    id: r.id,
    userId: r.userId,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    replacedByTokenId: r.replacedByTokenId,
  });
  const db = {
    refreshToken: {
      async findUnique(args: { where: { tokenHash: string } | { id: string } }) {
        await tick();
        const w = args.where as { tokenHash?: string; id?: string };
        const row = w.id ? rows.get(w.id) : [...rows.values()].find((r) => r.tokenHash === w.tokenHash);
        return row ? pick(row) : null;
      },
      async create(args: { data: Omit<Row, "id"> }) {
        await tick();
        const id = `rt-${++seq}`;
        rows.set(id, { id, ...args.data });
        return { id };
      },
      async updateMany(args: {
        where: { id?: string; userId?: string; revokedAt: null };
        data: { revokedAt: Date; replacedByTokenId?: string };
      }) {
        await tick();
        let count = 0;
        for (const r of rows.values()) {
          if (args.where.id && r.id !== args.where.id) continue;
          if (args.where.userId && r.userId !== args.where.userId) continue;
          if (r.revokedAt !== null) continue;
          r.revokedAt = args.data.revokedAt;
          if (args.data.replacedByTokenId) r.replacedByTokenId = args.data.replacedByTokenId;
          count++;
        }
        return { count };
      },
      async deleteMany(args: { where: { id: string } }) {
        await tick();
        return { count: rows.delete(args.where.id) ? 1 : 0 };
      },
    },
  };
  const add = (userId: string, opts?: Partial<Row>) => {
    const id = `rt-${++seq}`;
    rows.set(id, {
      id,
      tokenHash: `hash-${id}`,
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      replacedByTokenId: null,
      ...opts,
    });
    return id;
  };
  const active = (userId: string) => [...rows.values()].filter((r) => r.userId === userId && r.revokedAt === null);
  return { rows, db, add, active };
}

const authResult = async (userId: string, ctx?: { refreshSessionId?: string }) =>
  ({ token: `access-for-${userId}-${ctx?.refreshSessionId ?? "none"}`, user: { id: userId } }) as never;
ctrl.authRefreshTestHooks.setAuthResultForUserId(authResult);

function accessToken(user: Record<string, unknown>, opts?: { ageMs?: number; expiresIn?: string }): string {
  const iat = Math.floor((Date.now() - (opts?.ageMs ?? 0)) / 1000);
  return signJwt({ type: "access", tv: 0, ...user, iat }, (opts?.expiresIn ?? "15m") as never);
}

async function callMigrate(
  store: ReturnType<typeof memoryStore>,
  user: Record<string, unknown>,
  opts?: { ageMs?: number },
) {
  svc.refreshTokenServiceTestHooks.setDb(store.db as never);
  const { res, cookies } = fakeRes("api.caretip.de");
  const headers = { authorization: `Bearer ${accessToken(user, opts)}` };
  await inProduction(() => ctrl.migrateSessionHost({ user, headers } as never, res as never));
  return { status: res.statusCode, body: res.body as Record<string, unknown> | undefined, cookies };
}

async function callLogout(
  store: ReturnType<typeof memoryStore> | { db: unknown },
  host: string,
  opts: { cookie?: string; bearer?: string },
) {
  svc.refreshTokenServiceTestHooks.setDb(store.db as never);
  const { res, cookies } = fakeRes(host);
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `caretip_refresh=${opts.cookie}`;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  await inProduction(() => ctrl.logout({ headers } as never, res as never));
  return { status: res.statusCode, body: res.body as Record<string, unknown> | undefined, cookies };
}

/** Old host refresh with a raw cookie value, as the legacy refresh endpoint does (60s grace). */
const legacyRefresh = (raw: string) => svc.rotateRefreshTokenWithOutcome(raw, { graceMs: svc.REFRESH_ROTATION_GRACE_MS });

{
  const store = memoryStore();
  const legacySid = store.add("u1");
  const otherDevice = store.add("u1");
  const out = await callMigrate(store, { sub: "u1", sid: legacySid, role: "employee" });
  const legacyRow = store.rows.get(legacySid)!;
  const newSessions = store.active("u1").filter((r) => r.id !== otherDevice);
  assert(out.status === 200, "migrate", "valid session migrates (200)");
  assert(
    out.cookies.length === 1 &&
      out.cookies[0].opts.sameSite === "lax" &&
      out.cookies[0].opts.httpOnly === true &&
      out.cookies[0].opts.secure === true &&
      out.cookies[0].opts.path === "/" &&
      !("domain" in out.cookies[0].opts),
    "migrate",
    "new refresh cookie set by api.caretip.de: HttpOnly, Secure, SameSite=Lax, Path=/, host-only",
  );
  assert(
    legacyRow.revokedAt !== null && legacyRow.replacedByTokenId === newSessions[0]?.id,
    "migrate",
    "old-host session revoked and linked to its replacement (same commit protocol as a rotation)",
  );
  assert(newSessions.length === 1, "migrate", "exactly one new active session for this browser");
  assert(newSessions[0]?.userId === "u1", "migrate", "replacement session belongs to the same user");
  assert(store.rows.get(otherDevice)!.revokedAt === null, "migrate", "the user's other devices are untouched");
  assert(
    typeof out.body?.token === "string" && (out.body.token as string).endsWith(newSessions[0].id),
    "migrate",
    "returned access token is bound to the new session",
  );
  assert(
    JSON.stringify(out.body ?? {}).indexOf(out.cookies[0]?.value ?? "<none>") === -1,
    "migrate",
    "refresh token only in the HttpOnly cookie, never in the JSON body",
  );
  const replay = await legacyRefresh("unused");
  assert(replay.kind === "rejected", "migrate", "unknown token rejected");
}

// --- Lost migrate response: recoverable, no duplicate sessions ---
{
  const store = memoryStore();
  const sid = store.add("u7", { tokenHash: sha256("legacy-raw-7") });
  const otherDevice = store.add("u7");
  const first = await callMigrate(store, { sub: "u7", sid, role: "employee" });
  // The response (and its Set-Cookie) never reached the browser: it still holds only the old cookie.
  assert(first.status === 200, "recovery", "migration committed server-side");
  const recovered = await legacyRefresh("legacy-raw-7");
  assert(
    recovered.kind === "rotated" && recovered.recoveredFromSessionId === sid,
    "recovery",
    "old cookie replayed within 60s recovers into the migrated chain (no logout)",
  );
  const browserActive = () => store.active("u7").filter((r) => r.id !== otherDevice);
  assert(browserActive().length === 1, "recovery", "recovery replaces the unreceived session: still one active session");
  const retry = await callMigrate(store, { sub: "u7", sid: recovered.kind === "rotated" ? recovered.newId : "", role: "employee" });
  assert(retry.status === 200 && retry.cookies.length === 1, "recovery", "migration retry succeeds and sets the api.caretip.de cookie");
  assert(browserActive().length === 1, "recovery", "after retry: exactly one active session (no duplicates)");
  assert(store.rows.get(otherDevice)!.revokedAt === null, "recovery", "other devices untouched by recovery");
  const again = await callMigrate(store, { sub: "u7", sid, role: "employee" });
  assert(again.status === 401 && browserActive().length === 1, "recovery", "re-migrating the already-moved session is refused");
}
{
  const store = memoryStore();
  const sid = store.add("u8", { tokenHash: sha256("legacy-raw-8") });
  await callMigrate(store, { sub: "u8", sid, role: "employee" });
  const t0 = Date.now();
  svc.refreshTokenServiceTestHooks.setClock(() => t0 + svc.REFRESH_ROTATION_GRACE_MS + 5_000);
  const late = await legacyRefresh("legacy-raw-8");
  svc.refreshTokenServiceTestHooks.setClock(null);
  assert(
    late.kind === "rejected" && late.reason === "reuse_detected" && store.active("u8").length === 0,
    "recovery",
    "replay of the migrated cookie after the grace window is handled like any rotated-token reuse",
  );
}

// --- Freshness: only a just-issued access token can be exchanged for a refresh cookie ---
{
  const store = memoryStore();
  const sid = store.add("u9");
  const stale = await callMigrate(store, { sub: "u9", sid, role: "employee" }, { ageMs: 3 * 60_000 });
  assert(
    stale.status === 401 && stale.body?.code === "SESSION_MIGRATE_STALE_TOKEN" && stale.cookies.length === 0,
    "migrate",
    "access token older than 2 minutes cannot migrate",
  );
  assert(store.rows.get(sid)!.revokedAt === null, "migrate", "a refused stale-token migration changes nothing");
}

// --- authMiddleware gate in front of /session/migrate ---
{
  type U = { id: string; authTokenVersion: number; isActive: boolean; accountStatus: string };
  const users = new Map<string, U>([
    ["ok", { id: "ok", authTokenVersion: 0, isActive: true, accountStatus: "active" }],
    ["inactive", { id: "inactive", authTokenVersion: 0, isActive: false, accountStatus: "active" }],
    ["suspended", { id: "suspended", authTokenVersion: 0, isActive: true, accountStatus: "suspended" }],
    ["bumped", { id: "bumped", authTokenVersion: 3, isActive: true, accountStatus: "active" }],
  ]);
  const sessions = new Map<string, { userId: string; revokedAt: Date | null; expiresAt: Date }>();
  const future = new Date(Date.now() + 86_400_000);
  for (const u of users.keys()) sessions.set(`s-${u}`, { userId: u, revokedAt: null, expiresAt: future });
  sessions.set("s-revoked", { userId: "ok", revokedAt: new Date(), expiresAt: future });
  sessions.set("s-expired", { userId: "ok", revokedAt: null, expiresAt: new Date(Date.now() - 1000) });
  authMiddlewareTestHooks.setDb({
    user: { findUnique: async ({ where }: { where: { id: string } }) => (users.get(where.id) ?? null) as never },
    refreshToken: { findUnique: async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null },
  } as never);
  const gate = (authorization?: string) =>
    new Promise<number>((resolve) => {
      const res = {
        status: (code: number) => ({ json: () => resolve(code) }),
      };
      authMiddleware({ headers: authorization ? { authorization } : {} } as never, res as never, () => resolve(200));
    });
  const tok = (sub: string, sid: string, extra?: Record<string, unknown>) =>
    `Bearer ${accessToken({ sub, sid, role: "EMPLOYEE", ...extra })}`;
  await inProduction(async () => {
    assert((await gate(tok("ok", "s-ok"))) === 200, "gate", "valid session passes authMiddleware");
    assert((await gate(tok("inactive", "s-inactive"))) === 401, "gate", "inactive user rejected");
    assert((await gate(tok("suspended", "s-suspended"))) === 401, "gate", "suspended account rejected");
    assert((await gate(tok("bumped", "s-bumped"))) === 401, "gate", "token version mismatch (password change / logout-all) rejected");
    assert((await gate(tok("ok", "s-revoked"))) === 401, "gate", "logged-out session rejected");
    assert((await gate(tok("ok", "s-expired"))) === 401, "gate", "expired session rejected");
    assert((await gate(tok("ok", "s-inactive"))) === 401, "gate", "session of another user rejected");
    assert((await gate(tok("ok", ""))) === 401, "gate", "production token without sid rejected");
    assert((await gate()) === 401, "gate", "no Bearer token rejected");
    assert(
      (await gate(`Bearer ${signJwt({ sub: "ok", sid: "s-ok", tv: 0, type: "access" }, "-10s" as never)}`)) === 401,
      "gate",
      "expired access token rejected",
    );
    assert((await gate("Bearer not-a-jwt")) === 401, "gate", "forged token rejected");
  });
  authMiddlewareTestHooks.setDb(null);
}
{
  const src = readFileSync(path.join(backendRoot, "src/controllers/auth.controller.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function migrateSessionHost"), src.indexOf("export async function logout"));
  assert(
    !/req\.body|req\.query/.test(body),
    "migrate",
    "migrate reads no token or user id from the JSON body or query string (session comes from the verified Bearer)",
  );
}
{
  const store = memoryStore();
  const sid = store.add("u2");
  const [a, b] = await Promise.all([
    callMigrate(store, { sub: "u2", sid, role: "employee" }),
    callMigrate(store, { sub: "u2", sid, role: "employee" }),
  ]);
  const statuses = [a.status, b.status].sort();
  const loser = a.status === 409 ? a : b;
  assert(statuses[0] === 200 && statuses[1] === 409, "migrate", "concurrent migrations: one 200, one 409");
  assert(loser.cookies.length === 0, "migrate", "conflict loser sets/clears no cookie");
  assert(store.active("u2").length === 1, "migrate", "concurrent migrations leave exactly one active session");
}
{
  const store = memoryStore();
  const revoked = store.add("u3", { revokedAt: new Date() });
  const expired = store.add("u3", { expiresAt: new Date(Date.now() - 1000) });
  const foreign = store.add("someone-else");
  const valid = store.add("u3");
  const r1 = await callMigrate(store, { sub: "u3", sid: revoked, role: "employee" });
  const r2 = await callMigrate(store, { sub: "u3", sid: expired, role: "employee" });
  const r3 = await callMigrate(store, { sub: "u3", sid: foreign, role: "employee" });
  const r4 = await callMigrate(store, { sub: "u3", role: "employee" });
  const r5 = await callMigrate(store, { sub: "u3", sid: valid, role: "business", impersonatedBy: "admin-1" });
  assert(r1.status === 401 && r1.cookies.length === 0, "migrate", "revoked (logged-out) session cannot migrate");
  assert(r2.status === 401, "migrate", "expired session cannot migrate");
  assert(r3.status === 401, "migrate", "another user's session id cannot be migrated");
  assert(r4.status === 401, "migrate", "token without a session id cannot migrate");
  assert(r5.status === 401 && store.rows.get(valid)!.revokedAt === null, "migrate", "impersonation tokens cannot migrate");
}
{
  const routesSrc = readFileSync(path.join(backendRoot, "src/routes/auth.routes.ts"), "utf8");
  assert(
    /"\/session\/migrate",\s*oauthRateLimit,\s*requireCaretipClientHeader,\s*requireTrustedOrigin,\s*authMiddleware,\s*authController\.migrateSessionHost/.test(
      routesSrc,
    ),
    "migrate",
    "route guarded by rate limit, client header, trusted origin and full authMiddleware (tv/sid/active)",
  );
}

// --- Logout lifecycle on both hosts ---
{
  // Before migration: legacy cookie only, logout on the old host.
  const store = memoryStore();
  const legacy = store.add("l1", { tokenHash: sha256("l1-legacy") });
  const other = store.add("l1");
  const out = await callLogout(store, "caretip.onrender.com", { cookie: "l1-legacy" });
  assert(out.status === 200 && store.rows.get(legacy)!.revokedAt !== null, "logout", "old-host logout revokes the legacy session");
  assert(
    out.cookies.length === 1 && out.cookies[0].opts.sameSite === "none" && out.cookies[0].opts.maxAge === 0 && !("domain" in out.cookies[0].opts),
    "logout",
    "old-host logout clears its cookie with the old host's attributes (SameSite=None, host-only)",
  );
  assert(store.rows.get(other)!.revokedAt === null, "logout", "logout leaves the user's other devices signed in");
  const again = await callLogout(store, "caretip.onrender.com", { cookie: "l1-legacy" });
  assert(again.status === 200 && again.body?.revoked === 0, "logout", "repeated logout is a no-op, not an error");
}
{
  // After migration: new cookie only, logout on api.caretip.de.
  const store = memoryStore();
  const sid = store.add("l2");
  const moved = await callMigrate(store, { sub: "l2", sid, role: "employee" });
  const newRaw = moved.cookies[0]?.value ?? "";
  const out = await callLogout(store, "api.caretip.de", { cookie: newRaw });
  assert(out.status === 200 && store.active("l2").length === 0, "logout", "new-host logout revokes the migrated session");
  const setOpts = moved.cookies[0]?.opts ?? {};
  const clearOpts = out.cookies[0]?.opts ?? {};
  assert(
    ["httpOnly", "secure", "sameSite", "path"].every((k) => clearOpts[k] === setOpts[k]) &&
      clearOpts.sameSite === "lax" &&
      !("domain" in clearOpts) &&
      clearOpts.maxAge === 0,
    "logout",
    "api.caretip.de logout clears the cookie with exactly the attributes it was set with",
  );
}
{
  // Both cookies present (migration response lost, marker not set): dual-host logout.
  const store = memoryStore();
  const sid = store.add("l3", { tokenHash: sha256("l3-legacy") });
  const moved = await callMigrate(store, { sub: "l3", sid, role: "employee" });
  const legacyOut = await callLogout(store, "caretip.onrender.com", { cookie: "l3-legacy" });
  const newOut = await callLogout(store, "api.caretip.de", { cookie: moved.cookies[0]?.value });
  assert(
    legacyOut.status === 200 && newOut.status === 200 && store.active("l3").length === 0,
    "logout",
    "dual-host logout: no active session remains for this browser",
  );
  assert(
    legacyOut.cookies[0]?.opts.sameSite === "none" && newOut.cookies[0]?.opts.sameSite === "lax",
    "logout",
    "each host clears only its own cookie with its own attributes",
  );
  const replay = await legacyRefresh("l3-legacy");
  assert(replay.kind === "rejected" && store.active("l3").length === 0, "logout", "stale legacy cookie cannot create a session after logout");
}
{
  // Old host unreachable: the new host revokes via the access token's session (no cookie needed).
  const store = memoryStore();
  const sid = store.add("l4", { tokenHash: sha256("l4-legacy") });
  const bearer = accessToken({ sub: "l4", sid, role: "employee" });
  const out = await callLogout(store, "api.caretip.de", { bearer });
  assert(out.status === 200 && store.rows.get(sid)!.revokedAt !== null, "logout", "Bearer-only logout revokes the access token's session");
  const replay = await legacyRefresh("l4-legacy");
  assert(replay.kind === "rejected" && replay.reason === "revoked_logout", "logout", "legacy cookie of that session is dead afterwards");
}
{
  // Bearer naming another user's session, an expired token, or an impersonation token revokes nothing.
  const store = memoryStore();
  const victim = store.add("victim");
  const own = store.add("l5");
  await callLogout(store, "api.caretip.de", { bearer: accessToken({ sub: "l5", sid: victim, role: "employee" }) });
  await callLogout(store, "api.caretip.de", {
    bearer: signJwt({ sub: "l5", sid: own, tv: 0, type: "access" }, "-10s" as never),
  });
  await callLogout(store, "api.caretip.de", {
    bearer: accessToken({ sub: "l5", sid: own, role: "MANAGER", type: "impersonation", impersonatedBy: "admin" }),
  });
  assert(
    store.rows.get(victim)!.revokedAt === null && store.rows.get(own)!.revokedAt === null,
    "logout",
    "foreign-session, expired and impersonation Bearer tokens revoke nothing",
  );
}
{
  // Logout racing a migration, both interleavings: no session may survive.
  for (const order of ["logout-first", "migrate-first", "parallel"] as const) {
    const store = memoryStore();
    const sid = store.add("l6", { tokenHash: sha256("l6-legacy") });
    const bearer = accessToken({ sub: "l6", sid, role: "employee" });
    let migrated: Awaited<ReturnType<typeof callMigrate>>;
    if (order === "logout-first") {
      await callLogout(store, "caretip.onrender.com", { cookie: "l6-legacy", bearer });
      migrated = await callMigrate(store, { sub: "l6", sid, role: "employee" });
    } else if (order === "migrate-first") {
      migrated = await callMigrate(store, { sub: "l6", sid, role: "employee" });
      // Logout sent before the migrate response arrived: only the legacy cookie and token.
      await callLogout(store, "api.caretip.de", { bearer });
    } else {
      const [m] = await Promise.all([
        callMigrate(store, { sub: "l6", sid, role: "employee" }),
        callLogout(store, "api.caretip.de", { bearer }),
      ]);
      migrated = m;
    }
    assert(store.active("l6").length === 0, "logout", `logout racing migration (${order}): no active session remains`);
    if (order === "logout-first") {
      assert(migrated.status === 401 && migrated.cookies.length === 0, "logout", "migration after logout is refused and sets no cookie");
    }
  }
}
{
  // Store failure during logout: not reported as success.
  const failing = {
    db: {
      refreshToken: {
        findUnique: async () => {
          throw new Error("pooler down");
        },
      },
    },
  };
  const out = await callLogout(failing, "api.caretip.de", { cookie: "whatever" });
  assert(out.status === 503 && out.body?.ok === false, "logout", "store failure → 503 ok:false (revocation not claimed)");
}

// --- Forwarded client IP: one helper, bounded by trust proxy ---
{
  const app = express();
  app.set("trust proxy", 1);
  app.get("/ctx", (req, res) =>
    res.json({ ip: trustedClientIp(req), login: extractLoginRequestContext(req).ip, scan: resolveScanSessionId(req) }),
  );
  const devApp = express();
  devApp.get("/ctx", (req, res) => res.json({ ip: trustedClientIp(req) }));
  const server = createServer(app);
  const devServer = createServer(devApp);
  const base = await listen(server);
  const devBase = await listen(devServer);
  const ctx = async (b: string, xff?: string) =>
    (await (
      await fetch(`${b}/ctx`, { headers: { "User-Agent": "ua-test", ...(xff ? { "X-Forwarded-For": xff } : {}) } })
    ).json()) as { ip: string; login: string; scan: string };
  const legit = await ctx(base, "203.0.113.7");
  const spoofed = await ctx(base, "6.6.6.6, 203.0.113.7");
  const spoofOnly = await ctx(base, "6.6.6.6");
  assert(legit.ip === "203.0.113.7" && legit.login === "203.0.113.7", "ip", "Render-forwarded request: client IP from the proxy-appended entry");
  assert(
    spoofed.ip === "203.0.113.7" && spoofed.login === "203.0.113.7" && spoofed.scan === legit.scan,
    "ip",
    "spoofed left-most X-Forwarded-For does not change the login-notification IP or the QR session fallback",
  );
  assert(spoofOnly.ip === "6.6.6.6", "ip", "(boundary) with one trusted hop, the last entry is whatever the proxy appended");
  const dev = await ctx(devBase, "6.6.6.6");
  assert(dev.ip === "127.0.0.1", "ip", "without trust proxy (non-production) X-Forwarded-For is ignored entirely");
  server.close();
  devServer.close();
  assert(trustedClientIp({ ip: "::ffff:198.51.100.4" } as never) === "198.51.100.4", "ip", "IPv4-mapped addresses normalised");
  assert(trustedClientIp({ ip: "" } as never) === null, "ip", "missing address → null (callers use 'unknown')");

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(path.join("lib", "clientIp.ts"))) continue;
      else if (/\.ts$/.test(name) && /headers\[\s*["']x-forwarded-for["']\s*\]|get\(\s*["']x-forwarded-for["']\s*\)/i.test(readFileSync(p, "utf8"))) {
        offenders.push(path.relative(backendRoot, p));
      }
    }
  };
  walk(path.join(backendRoot, "src"));
  assert(offenders.length === 0, "ip", `no raw X-Forwarded-For reads in backend/src (${offenders.join(", ") || "none"})`);
}

// --- Missing cookie is distinguishable (drives the one-time migration) ---
{
  const { res, cookies } = fakeRes("api.caretip.de");
  await ctrl.refresh({ headers: {} } as never, res as never);
  assert(
    res.statusCode === 401 && (res.body as { code?: string })?.code === "REFRESH_COOKIE_MISSING" && cookies.length === 0,
    "refresh",
    "refresh without cookie: 401 REFRESH_COOKIE_MISSING, no Set-Cookie",
  );
}

svc.refreshTokenServiceTestHooks.setDb(null);
ctrl.authRefreshTestHooks.setAuthResultForUserId(null);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} [${r.id}] ${r.detail}`);
if (failed.length > 0) {
  console.error(`first-party-api-domain-runtime: ${failed.length} failed`);
  process.exit(1);
}
console.log(`first-party-api-domain-runtime: ok (${results.length} checks)`);
process.exit(0);
