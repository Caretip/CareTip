/**
 * Session-expiry classification (no backend, no credentials): drives the real API client with a
 * scripted fetch and asserts which failures may say "your session has expired".
 * Run: npm run test:auth-session-classification
 */
const stores = { local: new Map<string, string>(), session: new Map<string, string>() };
const shim = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => void m.set(k, String(v)),
  removeItem: (k: string) => void m.delete(k),
});
const define = (name: string, value: unknown) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define("localStorage", shim(stores.local));
define("sessionStorage", shim(stores.session));
define("window", {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
  setTimeout,
  clearTimeout,
  location: {
    hostname: "localhost",
    host: "localhost:5173",
    origin: "http://localhost:5173",
    protocol: "http:",
    href: "http://localhost:5173/login",
    pathname: "/login",
  },
});
const broadcasts: unknown[] = [];
define(
  "BroadcastChannel",
  class {
    onmessage: unknown = null;
    constructor(public name: string) {}
    postMessage(m: unknown) {
      if (this.name === "caretip-auth-session-v1") broadcasts.push(m);
    }
    close() {}
  },
);
const out = console.log.bind(console);
for (const level of ["log", "info", "debug", "warn", "error"] as const) console[level] = () => undefined;

type Reply = { status: number; body?: unknown; type?: string } | "network";
const calls: string[] = [];
let reply: (path: string, n: number) => Reply = () => ({ status: 401, body: { message: "Unauthorized" } });
define("fetch", async (input: string | URL | Request, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const p = new URL(href, "http://localhost:5173").pathname;
  calls.push(p);
  const r = reply(p, calls.filter((c) => c === p).length);
  await new Promise((done) => setTimeout(done, 5));
  if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (r === "network") throw new TypeError("Failed to fetch");
  return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), {
    status: r.status,
    headers: { "Content-Type": r.type ?? "application/json" },
  });
});

const { markSessionBootstrapSettled } = await import("../src/app/lib/authSessionBootstrap");
const api = await import("../src/app/lib/api");
const notice = await import("../src/app/lib/sessionExpiredNotice");
const tokens = await import("../src/app/lib/accessTokenStore");
const { isDefinitiveRefreshFailure } = await import("../src/app/lib/authRefreshFailureClassification");
const { bumpSessionEpoch } = await import("../src/app/lib/authSessionEpoch");
const { performClientLogoutCleanup } = await import("../src/app/lib/clientLogout");
markSessionBootstrapSettled();

const NOTICE = "caretip_session_expired_notice";
const USER = JSON.stringify({ id: "u1", email: "u@example.test", role: "business", name: "U" });
const okSession = { token: "fresh", user: { id: "u1", email: "u@example.test", role: "MANAGER", name: "U" } };
const unauthorized: Reply = { status: 401, body: { message: "Authentication required" } };
const badCredentials: Reply = { status: 401, body: { message: "Invalid email or password" } };

function reset(opts: { signedIn?: boolean } = {}) {
  api.clearClientAuthStorage();
  stores.local.clear();
  stores.session.clear();
  calls.length = 0;
  broadcasts.length = 0;
  if (opts.signedIn) {
    stores.local.set("caretip_user", USER);
    stores.session.set("caretip_session_hint", "1");
    tokens.setMemoryAccessToken("old-token");
  }
}
const noticed = () => stores.session.has(NOTICE);
const refreshCalls = () => calls.filter((c) => c === "/api/auth/refresh").length;
const attempt = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
};
const results: { ok: boolean; text: string }[] = [];
const check = (ok: unknown, text: string) => results.push({ ok: Boolean(ok), text });

// Invalid credentials are not an expired session.
const rejectedSignIns: [string, () => Promise<unknown>][] = [
  ["wrong password", () => api.loginAPI("a@example.test", "bad")],
  ["OAuth rejected", () => api.oauthAPI({ provider: "google", idToken: "x", isLogin: true })],
  ["wrong MFA code", () => api.loginMfaVerifyAPI("pending", "000000")],
  ["resend verification, wrong password", () => api.resendVerificationEmailAPI("a@example.test", "bad", "en")],
];
for (const [label, run] of rejectedSignIns) {
  reset();
  reply = () => badCredentials;
  check(await attempt(run), `${label}: rejects`);
  check(!noticed(), `${label}: no expired notice`);
  check(broadcasts.length === 0, `${label}: other tabs are not told a session ended`);
}

// A failed sign-in must not wipe a session this browser already has (another tab).
reset({ signedIn: true });
reply = (p) => (p === "/api/auth/refresh" ? { status: 200, body: okSession } : badCredentials);
await attempt(() => api.loginAPI("a@example.test", "bad"));
check(stores.local.has("caretip_user"), "wrong password keeps an existing session of this browser");
check(!noticed(), "wrong password beside an existing session: no expired notice");

// Signing in never starts a session refresh of its own, even with stale data in storage.
reset();
stores.local.set("caretip_user", USER);
reply = () => badCredentials;
await attempt(() => api.loginAPI("a@example.test", "bad"));
check(refreshCalls() === 0, "sign-in does not start a refresh first");
check(!noticed(), "sign-in with stale stored data: no expired notice");

// Never authenticated: a protected 401 is not an expiry.
reset();
reply = () => unauthorized;
await attempt(() => api.getMyAccountSettings());
check(!noticed() && broadcasts.length === 0, "anonymous protected 401: no notice, no broadcast");

// Access token expired, refresh valid: recovered silently.
reset({ signedIn: true });
reply = (p, n) => {
  if (p === "/api/auth/refresh") return { status: 200, body: okSession };
  return n === 1
    ? { status: 401, body: { message: "Access token expired", code: "TOKEN_EXPIRED" } }
    : { status: 200, body: {} };
};
check((await attempt(() => api.getMyAccountSettings())) === null, "expired access token is refreshed and retried");
check(!noticed() && tokens.getMemoryAccessToken() === "fresh", "no notice; new token in memory");

// Refresh session expired under concurrent 401s: one refresh, one notice, one broadcast.
reset({ signedIn: true });
reply = () => unauthorized;
await Promise.all([
  attempt(() => api.getMyAccountSettings()),
  attempt(() => api.listLinkedOAuthAccountsAPI()),
  ...["a", "b", "c", "d"].map((x) => attempt(() => api.fetchAuthedObjectUrl(`/uploads/${x}.pdf`))),
]);
check(refreshCalls() === 1, `six simultaneous 401s: one refresh (got ${refreshCalls()})`);
check(broadcasts.length === 1, `six simultaneous 401s: one session-ended broadcast (got ${broadcasts.length})`);
check(notice.consumeSessionExpiredNotice(), "genuine expiry is reported");
check(!stores.local.has("caretip_user") && !tokens.getMemoryAccessToken(), "expired session is cleaned up");
await attempt(() => api.getMyAccountSettings());
check(!noticed(), "a late 401 after the notice was shown does not mark it again");

// Explicit logout and later sign-in never surface an older notice.
reset({ signedIn: true });
notice.markSessionExpiredNotice();
performClientLogoutCleanup();
reply = () => unauthorized;
await attempt(() => api.getMyAccountSettings());
check(!notice.consumeSessionExpiredNotice(), "explicit logout shows no expired notice");
notice.markSessionExpiredNotice();
api.clearClientSessionRevoked();
check(!notice.consumeSessionExpiredNotice(), "a new sign-in drops an unshown notice");
stores.session.set(NOTICE, String(Date.now() - 60 * 60_000));
check(!notice.consumeSessionExpiredNotice(), "an old notice is not shown");

// Temporary failures keep the session.
const html = "<!doctype html><title>x</title>";
const transient: [string, Reply][] = [
  ["network failure", "network"],
  ["500", { status: 500, body: {} }],
  ["503", { status: 503, body: {} }],
  ["429", { status: 429, body: {} }],
  ["404 (proxy / deploy swap)", { status: 404, body: html, type: "text/html" }],
  ["200 with an HTML page (captive portal)", { status: 200, body: html, type: "text/html" }],
  ["403 HTML page (firewall)", { status: 403, body: html, type: "text/html" }],
];
for (const [label, r] of transient) {
  reset({ signedIn: true });
  reply = (p) => (p === "/api/auth/refresh" ? r : unauthorized);
  await attempt(() => api.getMyAccountSettings());
  check(stores.local.has("caretip_user") && !noticed(), `refresh ${label}: session kept, no expired notice`);
  reset({ signedIn: true });
  check((await api.bootstrapRefreshSession()).kind === "transient_error", `startup refresh ${label}: transient`);
  reset({ signedIn: true });
  const err = await attempt(() => api.refreshSessionAPI());
  check(err && !isDefinitiveRefreshFailure(err), `refresh ${label}: not classified as definitive`);
}

// Genuine refusals stay definitive (also covers a deactivated account: refresh answers 401).
const refused: [string, Reply][] = [
  ["401", unauthorized],
  ["403 email not verified", { status: 403, body: { message: "Verify", code: "EMAIL_NOT_VERIFIED" } }],
];
for (const [label, r] of refused) {
  reset({ signedIn: true });
  reply = () => r;
  const err = await attempt(() => api.refreshSessionAPI());
  check(err && isDefinitiveRefreshFailure(err), `refresh ${label}: definitive`);
  check(!stores.local.has("caretip_user"), `refresh ${label}: session cleared`);
}

// Deactivated account: definitive, and told apart from an expiry (here and in other tabs).
const deactivated: Reply = { status: 401, body: { message: "Authentication required", code: "ACCOUNT_DEACTIVATED" } };
reset({ signedIn: true });
reply = (p) => (p === "/api/auth/refresh" ? deactivated : unauthorized);
await Promise.all([attempt(() => api.getMyAccountSettings()), attempt(() => api.listLinkedOAuthAccountsAPI())]);
check(notice.consumeSessionEndNotice() === "deactivated", "deactivated account: its own notice");
check(broadcasts.length === 1 && (broadcasts[0] as { reason: string }).reason === "deactivated", "deactivated account: other tabs told once");
check(!stores.local.has("caretip_user"), "deactivated account: session cleared");
notice.markSessionExpiredNotice("expired");
check(notice.consumeSessionEndNotice() === "deactivated", "a second tab refused right after shows the same cause");
reset({ signedIn: true });
const deactivatedErr = await attempt(() => api.refreshSessionAPI());
check(deactivatedErr && isDefinitiveRefreshFailure(deactivatedErr), "deactivated account: definitive");
reset();
const startup = await api.bootstrapRefreshSession();
check(startup.kind === "unauthenticated" && startup.accountDeactivated === true, "deactivated account: startup knows the cause");
reset();
reply = () => badCredentials;
await attempt(() => api.loginAPI("a@example.test", "bad"));
check(notice.consumeSessionEndNotice() === null, "signing in to a deactivated account reveals nothing");

// Account isolation: a refresh landing after a newer sign-in must not restore the old token.
reset({ signedIn: true });
reply = () => ({ status: 200, body: okSession });
const late = attempt(() => api.refreshSessionAPI());
bumpSessionEpoch();
tokens.setMemoryAccessToken("token-of-new-account");
await late;
check(
  tokens.getMemoryAccessToken() === "token-of-new-account",
  "a late refresh cannot replace a newer sign-in's token",
);

for (const r of results) out(`${r.ok ? "PASS" : "FAIL"} ${r.text}`);
const failed = results.filter((r) => !r.ok).length;
out(`\nauth-session-classification: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
export {};
