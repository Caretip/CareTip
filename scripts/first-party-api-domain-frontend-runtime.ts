/**
 * First-party API domain — frontend checks against the real `api.ts`, with a scripted `fetch`
 * that models per-host cookie jars (a cookie is sent only to its own host and only with
 * `credentials: "include"`). No backend, no credentials.
 * Run: npm run test:first-party-api-domain-frontend
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- Browser shims (before app modules load) ---
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
  configurable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    location: {
      hostname: "caretip.de",
      host: "caretip.de",
      origin: "https://caretip.de",
      protocol: "https:",
      href: "https://caretip.de/dashboard",
      pathname: "/dashboard",
    },
  },
  configurable: true,
});
class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {}
  postMessage(): void {}
  close(): void {}
}
Object.defineProperty(globalThis, "BroadcastChannel", { value: MockBroadcastChannel, configurable: true });

const logBuffer: string[] = [];
const realConsole = { ...console };
for (const level of ["log", "info", "debug", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    logBuffer.push(`[${level}] ${args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
  };
}

const { resolveApiBaseUrl, resolveLegacyApiBaseUrl } = await import("../src/app/lib/apiOrigin");
const { authRefreshCoordinationTestHooks } = await import("../src/app/lib/authRefreshCoordination");
const { clearMemoryAccessToken, getMemoryAccessToken } = await import("../src/app/lib/accessTokenStore");
const { markSessionBootstrapSettled, resetSessionBootstrap } = await import("../src/app/lib/authSessionBootstrap");
const { LEGACY_SESSION_MIGRATION_STORAGE_KEY } = await import("../src/app/lib/legacySessionMigration");
const api = await import("../src/app/lib/api");

const results: { id: string; ok: boolean; detail: string }[] = [];
const assert = (cond: unknown, id: string, detail: string) => results.push({ id, ok: Boolean(cond), detail });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const API = "api.caretip.de";
const LEGACY = "caretip.onrender.com";

// --- Scripted server with per-host cookie jars ---
type Call = { host: string; path: string; method: string; credentials?: RequestCredentials; auth: string | null };
const calls: Call[] = [];
const jar = new Map<string, string>();
let legacyRevoked = false;
/** Server-side grace window after a committed migration (old cookie may be replayed once). */
let legacyRecoverable = false;
let migrateMode: "ok" | "503" | "401" | "409-winner-elsewhere" | "lost-with-cookie" | "lost-no-cookie" = "ok";
let logoutMode: "ok" | "500" | "network" = "ok";
let legacyLogoutMode: "ok" | "network" = "ok";
let migrateCalls = 0;
let seq = 0;
let inFlightRefresh = 0;
let maxInFlightRefresh = 0;

const userBody = { id: "u1", email: "user@example.test", role: "employee" };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const headers = new Headers(init?.headers);
  const call: Call = {
    host: url.host,
    path: url.pathname,
    method: (init?.method ?? "GET").toUpperCase(),
    credentials: init?.credentials,
    auth: headers.get("authorization"),
  };
  calls.push(call);
  const cookie = init?.credentials === "include" ? jar.get(url.host) : undefined;
  await sleep(5);

  if (call.path === "/api/auth/signin" || call.path === "/api/auth/oauth") {
    jar.set(url.host, `rt-${url.host}-${++seq}`);
    return json(200, { token: `access-login-${seq}`, user: userBody });
  }
  if (call.path === "/api/auth/refresh") {
    inFlightRefresh++;
    maxInFlightRefresh = Math.max(maxInFlightRefresh, inFlightRefresh);
    try {
      await sleep(20);
      if (url.host === LEGACY && legacyRevoked) {
        if (!legacyRecoverable) return json(401, { message: "Authentication required" });
        legacyRecoverable = false;
        legacyRevoked = false;
      }
      if (!cookie) return json(401, { message: "Authentication required", code: "REFRESH_COOKIE_MISSING" });
      jar.set(url.host, `rt-${url.host}-${++seq}`);
      return json(200, { token: `access-${url.host === LEGACY ? "legacy" : "api"}-${seq}`, user: userBody });
    } finally {
      inFlightRefresh--;
    }
  }
  if (call.path === "/api/auth/session/migrate") {
    migrateCalls++;
    if (!call.auth?.startsWith("Bearer access-legacy-")) return json(401, { message: "Authentication required" });
    if (migrateMode === "503") return json(503, { code: "REFRESH_UNAVAILABLE", retryable: false });
    if (migrateMode === "401") return json(401, { message: "Authentication required" });
    if (migrateMode === "409-winner-elsewhere") {
      // Another request moved this session first; its cookie is already in this browser's jar.
      migrateMode = "ok";
      legacyRevoked = true;
      jar.set(url.host, `rt-${url.host}-${++seq}`);
      return json(409, { code: "REFRESH_CONFLICT" });
    }
    legacyRevoked = true;
    if (migrateMode === "lost-with-cookie" || migrateMode === "lost-no-cookie") {
      // Committed server-side; the response is lost in transit (one-shot).
      if (migrateMode === "lost-with-cookie") jar.set(url.host, `rt-${url.host}-${++seq}`);
      else legacyRecoverable = true;
      migrateMode = "ok";
      throw new TypeError("Failed to fetch");
    }
    jar.set(url.host, `rt-${url.host}-${++seq}`);
    return json(200, { token: `access-migrated-${seq}`, user: userBody });
  }
  if (call.path === "/api/auth/logout") {
    if (url.host === LEGACY && legacyLogoutMode === "network") throw new TypeError("Failed to fetch");
    if (url.host === API && logoutMode === "network") throw new TypeError("Failed to fetch");
    if (url.host === API && logoutMode === "500") return json(503, { ok: false });
    if (cookie) jar.delete(url.host);
    if (url.host === LEGACY) legacyRevoked = true;
    return json(200, { ok: true });
  }
  return json(200, {});
}) as typeof fetch;

const CACHED_USER = JSON.stringify(userBody);

function reload(opts: { cachedUser: boolean }): void {
  api.cancelPendingSessionRefresh();
  clearMemoryAccessToken();
  resetSessionBootstrap();
  authRefreshCoordinationTestHooks.reset();
  authRefreshCoordinationTestHooks.resetWebLocksOverride();
  authRefreshCoordinationTestHooks.setTabIdForTests(`tab-${Math.random().toString(36).slice(2, 8)}`);
  api.clearClientSessionRevoked();
  if (opts.cachedUser) storage.set("caretip_user", CACHED_USER);
  else storage.delete("caretip_user");
  calls.length = 0;
}

function freshBrowser(): void {
  storage.clear();
  jar.clear();
  legacyRevoked = false;
  legacyRecoverable = false;
  migrateMode = "ok";
  logoutMode = "ok";
  legacyLogoutMode = "ok";
  migrateCalls = 0;
  api.clearClientAuthStorage({ notifySync: false });
  storage.clear();
}

const authCalls = () => calls.filter((c) => c.path.startsWith("/api/auth/"));

// --- 1: configured hosts ---
assert(resolveApiBaseUrl() === "https://api.caretip.de", "host", "API base resolves to https://api.caretip.de");
assert(resolveLegacyApiBaseUrl() === "https://caretip.onrender.com", "host", "legacy base resolves only from VITE_LEGACY_API_URL");

// --- 9: password login → cookie on api host → reload restores session ---
freshBrowser();
reload({ cachedUser: false });
markSessionBootstrapSettled();
{
  await api.loginAPI("user@example.test", "not-a-real-password");
  const login = calls.find((c) => c.path === "/api/auth/signin");
  assert(login?.host === API && login.credentials === "include", "password", "login POST goes to api.caretip.de with credentials");
  assert(jar.has(API) && !jar.has(LEGACY), "password", "refresh cookie stored for api.caretip.de only");
  reload({ cachedUser: true });
  const out = await api.bootstrapRefreshSession();
  const refresh = authCalls();
  assert(out.kind === "authenticated", "password", "page reload restores the session");
  assert(
    refresh.length === 1 && refresh[0].host === API && refresh[0].credentials === "include" && refresh[0].auth === null,
    "password",
    "reload refresh: one POST to api.caretip.de, credentials included, no Authorization header",
  );
  assert(!calls.some((c) => c.host === LEGACY), "password", "no request to the Render host");
}

// --- 10: logout clears the api cookie and the session stays gone after reload ---
{
  await api.logoutAPIWithTimeout({ timeoutMs: 2_000 });
  const logout = calls.filter((c) => c.path === "/api/auth/logout");
  assert(
    logout.length === 1 && logout[0].host === API && logout[0].credentials === "include",
    "logout",
    "logout POST goes to api.caretip.de with credentials (no legacy call once migrated)",
  );
  assert(!jar.has(API), "logout", "api.caretip.de refresh cookie cleared");
  reload({ cachedUser: false });
  const out = await api.bootstrapRefreshSession();
  assert(out.kind === "unauthenticated", "logout", "after logout, reload is unauthenticated");
  assert(!calls.some((c) => c.host === LEGACY), "logout", "no legacy fallback after logout");
}

// --- 7/8: Google and Apple credential exchange on the new host ---
for (const provider of ["google", "apple"] as const) {
  freshBrowser();
  reload({ cachedUser: false });
  markSessionBootstrapSettled();
  await api.oauthAPI({ provider, idToken: `id-token-${provider}`, isLogin: true });
  const exchange = calls.find((c) => c.path === "/api/auth/oauth");
  assert(
    exchange?.host === API && exchange.credentials === "include",
    provider,
    `${provider} token exchange goes to api.caretip.de with credentials`,
  );
  assert(jar.has(API) && !jar.has(LEGACY), provider, `${provider} session cookie issued by api.caretip.de`);
  reload({ cachedUser: true });
  const out = await api.bootstrapRefreshSession();
  assert(out.kind === "authenticated" && !calls.some((c) => c.host === LEGACY), provider, `${provider} session survives reload without the Render host`);
}

// --- Existing-session migration: old cookie only on the Render host ---
freshBrowser();
jar.set(LEGACY, "rt-legacy-existing");
reload({ cachedUser: true });
{
  const out = await api.bootstrapRefreshSession();
  const seqCalls = authCalls().map((c) => `${c.host}${c.path}`);
  assert(
    JSON.stringify(seqCalls) ===
      JSON.stringify([`${API}/api/auth/refresh`, `${LEGACY}/api/auth/refresh`, `${API}/api/auth/session/migrate`]),
    "migration",
    `migration sequence: new-host refresh → legacy refresh → migrate (${seqCalls.join(", ")})`,
  );
  const legacyCall = authCalls()[1];
  const migrateCall = authCalls()[2];
  assert(legacyCall?.credentials === "include" && legacyCall.auth === null, "migration", "legacy refresh uses the old cookie, no Authorization");
  assert(
    migrateCall?.credentials === "include" && migrateCall.auth?.startsWith("Bearer access-legacy-"),
    "migration",
    "migrate sends the legacy-issued access token as Bearer",
  );
  assert(out.kind === "authenticated" && getMemoryAccessToken()?.startsWith("access-migrated-"), "migration", "session continues with the new-host token");
  assert(jar.has(API) && legacyRevoked, "migration", "cookie now on api.caretip.de; old session revoked server-side");
  assert(storage.get(LEGACY_SESSION_MIGRATION_STORAGE_KEY) === "done", "migration", "completion marker stored");

  reload({ cachedUser: true });
  const again = await api.bootstrapRefreshSession();
  assert(
    again.kind === "authenticated" && authCalls().length === 1 && authCalls()[0].host === API,
    "migration",
    "next reload: single new-host refresh, Render host no longer contacted",
  );
}

// Anonymous visitor: no legacy probe
freshBrowser();
reload({ cachedUser: false });
{
  const out = await api.bootstrapRefreshSession();
  assert(out.kind === "unauthenticated" && !calls.some((c) => c.host === LEGACY), "migration", "anonymous visitor never contacts the Render host");
}

// Legacy session already gone: unauthenticated, marker set, no migrate call
freshBrowser();
reload({ cachedUser: true });
{
  const out = await api.bootstrapRefreshSession();
  assert(out.kind === "unauthenticated", "migration", "no legacy cookie: unauthenticated (single re-login)");
  assert(!calls.some((c) => c.path === "/api/auth/session/migrate"), "migration", "no migrate call without a legacy session");
  assert(storage.get(LEGACY_SESSION_MIGRATION_STORAGE_KEY) === "done", "migration", "marker set so the Render host is not probed again");
}

// Migrate temporarily unavailable: stay signed in on the legacy token, retry later
freshBrowser();
jar.set(LEGACY, "rt-legacy-existing");
migrateMode = "503";
reload({ cachedUser: true });
{
  const out = await api.bootstrapRefreshSession();
  assert(out.kind === "authenticated" && getMemoryAccessToken()?.startsWith("access-legacy-"), "migration", "migrate 503: user stays signed in (legacy token)");
  assert(!storage.has(LEGACY_SESSION_MIGRATION_STORAGE_KEY), "migration", "migrate 503: marker not set, migration retried later");
  migrateMode = "ok";
  reload({ cachedUser: true });
  const later = await api.bootstrapRefreshSession();
  assert(later.kind === "authenticated" && jar.has(API), "migration", "later reload completes the migration");
}

// Migrate rejects the session: definitive
freshBrowser();
jar.set(LEGACY, "rt-legacy-existing");
migrateMode = "401";
reload({ cachedUser: true });
{
  const out = await api.bootstrapRefreshSession();
  assert(out.kind === "unauthenticated", "migration", "migrate 401: unauthenticated");
}

// Two tabs migrating at once: serialised, one migration, second tab uses the new cookie
freshBrowser();
jar.set(LEGACY, "rt-legacy-existing");
reload({ cachedUser: true });
{
  let chain: Promise<unknown> = Promise.resolve();
  authRefreshCoordinationTestHooks.setWebLocksOverride({
    request: (_n: string, cb: (l: unknown) => Promise<unknown>) => {
      const result = chain.then(() => cb({}), () => cb({}));
      chain = result.catch(() => undefined);
      return result;
    },
    query: async () => ({ held: [], pending: [] }),
  } as unknown as LockManager);
  maxInFlightRefresh = 0;
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-a");
  const pA = api.bootstrapRefreshSession();
  api.cancelPendingSessionRefresh();
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-b");
  const pB = api.bootstrapRefreshSession();
  const [a, b] = await Promise.all([pA, pB]);
  const migrates = calls.filter((c) => c.path === "/api/auth/session/migrate").length;
  const legacyRefreshes = calls.filter((c) => c.host === LEGACY).length;
  assert(a.kind === "authenticated" && b.kind === "authenticated", "multitab", "both tabs end authenticated");
  assert(migrates === 1 && legacyRefreshes === 1, "multitab", `exactly one legacy refresh and one migration (${legacyRefreshes}/${migrates})`);
  assert(maxInFlightRefresh === 1, "multitab", "refresh POSTs never overlapped across tabs");
}

// Logout during transition (not yet migrated) also revokes on the Render host
freshBrowser();
jar.set(LEGACY, "rt-legacy-existing");
reload({ cachedUser: true });
{
  await api.logoutAPIWithTimeout({ timeoutMs: 2_000 });
  await sleep(30);
  const hosts = calls.filter((c) => c.path === "/api/auth/logout").map((c) => c.host).sort();
  assert(JSON.stringify(hosts) === JSON.stringify([API, LEGACY].sort()), "logout", "unmigrated browser: logout sent to both hosts");
  assert(!jar.has(LEGACY), "logout", "legacy cookie cleared by the legacy logout");
}

// Lost migrate response, cookie did arrive: the current host already holds the session.
freshBrowser();
jar.set(LEGACY, "rt-legacy-existing");
migrateMode = "lost-with-cookie";
reload({ cachedUser: true });
{
  const out = await api.bootstrapRefreshSession();
  const seqCalls = authCalls().map((c) => `${c.host}${c.path}`);
  assert(out.kind === "authenticated", "lost-response", "lost migrate response (cookie stored): still signed in");
  assert(
    seqCalls.at(-1) === `${API}/api/auth/refresh` && migrateCalls === 1,
    "lost-response",
    `recovers with a current-host refresh, no second migration (${seqCalls.join(", ")})`,
  );
  assert(storage.get(LEGACY_SESSION_MIGRATION_STORAGE_KEY) === "done" && jar.has(API), "lost-response", "marker set; cookie on api.caretip.de");
}

// Lost migrate response, Set-Cookie never arrived: old host grace window lets the move be redone once.
freshBrowser();
jar.set(LEGACY, "rt-legacy-existing");
migrateMode = "lost-no-cookie";
reload({ cachedUser: true });
{
  const out = await api.bootstrapRefreshSession();
  assert(out.kind === "authenticated" && getMemoryAccessToken()?.startsWith("access-migrated-"), "lost-response", "lost migrate response (no cookie): recovered, signed in on the new host");
  assert(migrateCalls === 2 && calls.filter((c) => c.host === LEGACY && c.path === "/api/auth/refresh").length === 2, "lost-response", "exactly one retry (second legacy refresh + second migrate)");
  assert(jar.has(API) && storage.get(LEGACY_SESSION_MIGRATION_STORAGE_KEY) === "done", "lost-response", "migration completed after the retry");
}

// Concurrent loser (409): the winner's cookie is used, no second move.
freshBrowser();
jar.set(LEGACY, "rt-legacy-existing");
migrateMode = "409-winner-elsewhere";
reload({ cachedUser: true });
{
  const out = await api.bootstrapRefreshSession();
  assert(out.kind === "authenticated" && migrateCalls === 1, "lost-response", "409 loser continues with the winner's api.caretip.de session");
  assert(getMemoryAccessToken()?.startsWith("access-api-"), "lost-response", "409 loser's token comes from the current host, not the revoked legacy session");
}

// Logout result reflects what the server confirmed.
for (const [mode, legacy, expectOk, label] of [
  ["ok", "ok", true, "both hosts confirm → ok"],
  ["500", "ok", false, "new host 5xx → not ok"],
  ["network", "ok", false, "new host unreachable → not ok"],
  ["ok", "network", false, "previous host unreachable during migration → not ok (legacyConfirmed=false)"],
] as const) {
  freshBrowser();
  jar.set(LEGACY, "rt-legacy-existing");
  reload({ cachedUser: true });
  await api.bootstrapRefreshSession().catch(() => undefined);
  storage.delete(LEGACY_SESSION_MIGRATION_STORAGE_KEY);
  logoutMode = mode;
  legacyLogoutMode = legacy;
  const r = await api.logoutAPIWithTimeout({ timeoutMs: 2_000 });
  assert(r.ok === expectOk, "logout-result", label);
  if (legacy === "network") assert(r.legacyConfirmed === false, "logout-result", "legacy failure surfaced in legacyConfirmed");
  assert(getMemoryAccessToken() == null && !storage.has("caretip_user"), "logout-result", `${label}: local session cleared regardless`);
}

// --- 15: no token ever persisted to localStorage ---
{
  const leaked = [...storage.entries()].filter(([, v]) => /access-|rt-|Bearer/.test(v));
  assert(leaked.length === 0, "storage", `no access/refresh token in localStorage (keys: ${[...storage.keys()].join(",")})`);
}

// --- 14: no hardcoded Render hostname in shipped browser code ---
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.runtime\.ts$/.test(name)) out.push(p);
  }
  return out;
}
{
  const offenders = walk(path.join(root, "src")).filter((f) => readFileSync(f, "utf8").includes("onrender.com"));
  assert(offenders.length === 0, "render-host", `no onrender.com literal in src/ (${offenders.map((f) => path.relative(root, f)).join(", ") || "none"})`);
}

// --- 11: Socket.IO uses the same API base; CSP allows the new host ---
{
  const provider = readFileSync(path.join(root, "src/app/context/SocketProvider.tsx"), "utf8");
  const pub = readFileSync(path.join(root, "src/app/hooks/usePublicSocket.ts"), "utf8");
  assert(
    provider.includes("const base = resolveApiBaseUrl();") && pub.includes("const base = resolveApiBaseUrl();"),
    "socket",
    "authenticated and public Socket.IO clients connect to resolveApiBaseUrl() (api.caretip.de)",
  );
  assert(provider.includes("auth: { token }"), "socket", "socket auth still sends the in-memory access token (no cookie dependency)");
  const headers = readFileSync(path.join(root, "public/_headers"), "utf8");
  assert(
    /connect-src[^;]*https:\/\/\*\.caretip\.de/.test(headers) && /connect-src[^;]*wss:\/\/\*\.caretip\.de/.test(headers),
    "socket",
    "Netlify CSP connect-src already allows https://*.caretip.de and wss://*.caretip.de",
  );
}

// --- 16: canonical-domain redirect does not affect auth callbacks ---
{
  const apple = readFileSync(path.join(root, "src/app/lib/appleOAuthWeb.ts"), "utf8");
  assert(
    apple.includes("redirectURI: window.location.origin") && apple.includes("usePopup: true"),
    "www",
    "Apple web sign-in is a popup returning to the page origin (no API-host callback)",
  );
  const redirects = readFileSync(path.join(root, "public/_redirects"), "utf8");
  assert(!/www\.caretip\.de/.test(redirects), "www", "repo _redirects does not touch www → apex (owned by Netlify domain settings)");
}

Object.assign(console, realConsole);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) console.log(logBuffer.slice(-60).join("\n"));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} [${r.id}] ${r.detail}`);
if (failed.length > 0) {
  console.error(`first-party-api-domain-frontend-runtime: ${failed.length} failed`);
  process.exit(1);
}
console.log(`first-party-api-domain-frontend-runtime: ok (${results.length} checks)`);
process.exit(0);
