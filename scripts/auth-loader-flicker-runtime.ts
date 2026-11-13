/**
 * Auth loader flicker regressions (no backend, no credentials). Drives real app modules.
 * Run: npm run test:auth-loader-flicker
 *
 * Root causes covered:
 *  1/5 Login button + sign-out swapped to a code-split auth page before its code had loaded, showing
 *      the full-screen Suspense fallback → auth entry routes are recognised so links and logout wait
 *      for the code; loaded code renders synchronously (no React.lazy first-render suspend).
 *  2   The Sign In handoff cover was shown on click, hiding the form for the whole request (and
 *      flashing on a wrong password / MFA) → hidden until navigation to the destination.
 *  3   A rejected password was re-POSTed by the 401 refresh-and-retry path → credential exchanges
 *      are sent once.
 *  4   Logout navigated inside flushSync with the non-DOM RouterProvider, so the route committed later
 *      and an empty frame appeared → DOM RouterProvider + navigate({ flushSync: true }).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// --- Browser shims (must exist before api.ts loads) ---
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
      hostname: "localhost",
      host: "localhost:5173",
      origin: "http://localhost:5173",
      protocol: "http:",
      href: "http://localhost:5173/login",
      pathname: "/login",
    },
  },
  configurable: true,
});
const logBuffer: string[] = [];
const realConsole = { ...console };
for (const level of ["log", "info", "debug", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    logBuffer.push(`[${level}] ${args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
  };
}
class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {}
  postMessage(): void {}
  close(): void {}
}
Object.defineProperty(globalThis, "BroadcastChannel", { value: MockBroadcastChannel, configurable: true });

// --- Scripted fetch: records every request ---
const calls: Array<{ path: string; method: string }> = [];
let signinStatus = 401;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const p = new URL(url, "http://localhost:5173").pathname;
  calls.push({ path: p, method: (init?.method ?? "GET").toUpperCase() });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (p === "/api/auth/signin") {
    return signinStatus === 401
      ? json(401, { message: "Invalid email or password" })
      : json(200, { token: "t", user: { id: "u1", email: "u@example.test", role: "business" } });
  }
  if (p === "/api/auth/refresh") return json(401, { message: "Unauthorized" });
  return json(401, { message: "Unauthorized" });
}) as typeof fetch;

const { markSessionBootstrapSettled } = await import("../src/app/lib/authSessionBootstrap");
// API calls wait for startup session bootstrap; a signed-out visitor on /login has finished it.
markSessionBootstrapSettled();
const { loginAPI, isCredentialExchangeAuthPath, getMyAccountSettings } = await import("../src/app/lib/api");
const handoff = await import("../src/app/lib/authSignInHandoff");
const { isAuthEntryRoutePath, ensureAuthEntryRouteCode } = await import("../src/app/routing/routeLazy");

type Check = { id: string; ok: boolean; detail: string };
const results: Check[] = [];
const check = (cond: unknown, id: string, detail: string) => results.push({ id, ok: Boolean(cond), detail });

// ── 3: credential exchanges are sent once ────────────────────────────────────────────────────────
for (const p of ["/api/auth/signin", "/api/auth/register", "/api/auth/oauth", "/api/auth/login/mfa/verify",
  "/api/auth/login/mfa/setup", "/api/auth/facebook/complete", "/api/auth/mobile-web-handoff/consume"]) {
  check(isCredentialExchangeAuthPath(p), "C1", `${p} is a credential exchange`);
}
for (const p of ["/api/auth/refresh", "/api/auth/me", "/api/auth/logout", "/api/auth/oauth/link",
  "/api/auth/oauth/accounts", "/api/me/settings", "/api/auth/change-password"]) {
  check(!isCredentialExchangeAuthPath(p), "C2", `${p} keeps session refresh-and-retry`);
}
calls.length = 0;
let loginError = "";
try {
  await loginAPI("user@example.test", "wrong-password");
} catch (e) {
  loginError = e instanceof Error ? e.message : String(e);
}
const signins = calls.filter((c) => c.path === "/api/auth/signin").length;
const refreshes = calls.filter((c) => c.path === "/api/auth/refresh").length;
check(loginError.length > 0, "C3", `wrong password rejects (${loginError || "no error"})`);
check(signins === 1, "C4", `wrong password POSTs /api/auth/signin exactly once (got ${signins})`);
check(refreshes === 0, "C5", `wrong password triggers no refresh round-trip (got ${refreshes})`);

// Protected resources still recover through refresh (unchanged behaviour).
calls.length = 0;
try {
  await getMyAccountSettings();
} catch {
  /* expected 401 */
}
check(calls.some((c) => c.path === "/api/auth/refresh"), "C6", "a protected 401 still attempts session refresh");

// ── 2: Sign In cover only from navigation ────────────────────────────────────────────────────────
handoff.beginAuthSignInHandoff();
check(handoff.isAuthSignInHandoffActive(), "H1", "sign-in handoff active after click");
check(!handoff.isAuthSignInHandoffCoverVisible(), "H2", "cover NOT visible while credentials are checked");
handoff.endAuthSignInHandoff("test_wrong_password");
check(!handoff.isAuthSignInHandoffActive() && !handoff.isAuthSignInHandoffCoverVisible(), "H3", "failed sign-in ends with no cover ever shown");
handoff.beginAuthSignInHandoff();
handoff.markSignInHandoffAuthCompleted();
check(!handoff.isAuthSignInHandoffCoverVisible(), "H4", "cover still hidden after auth success, before navigation");
handoff.markSignInHandoffNavigating("/dashboard");
check(handoff.isAuthSignInHandoffCoverVisible(), "H5", "cover visible once navigation to the destination starts");
handoff.endAuthSignInHandoff("test_done");
check(!handoff.isAuthSignInHandoffCoverVisible(), "H6", "cover hidden after handoff ends");

// ── 1/5: auth entry routes recognised; other routes never delayed ────────────────────────────────
for (const p of ["/login", "/login/", "/login?next=x", "/signup", "/auth", "/employee/login", "/join/signup", "/platform-admin/login"]) {
  check(isAuthEntryRoutePath(p), "R1", `${p} is an auth entry route`);
}
for (const p of ["/", "/dashboard", "/employee/dashboard", "/pricing", "/join", "/forgot-password", "/platform-admin"]) {
  check(!isAuthEntryRoutePath(p), "R2", `${p} is not delayed`);
  check(ensureAuthEntryRouteCode(p) === null, "R3", `${p}: ensureAuthEntryRouteCode returns null (navigate immediately)`);
}

// ── wiring (the pieces that make the fixes effective in the browser) ─────────────────────────────
const app = read("src/app/App.tsx");
check(/import \{ RouterProvider \} from ['"]react-router\/dom['"]/.test(app), "W1", "RouterProvider comes from react-router/dom (flushSync wired)");
const useAuthSrc = read("src/app/hooks/useAuth.ts");
const runLogout = useAuthSrc.slice(useAuthSrc.indexOf("const runLogout"), useAuthSrc.indexOf("const logout = useCallback"));
check(/navigate\(snapshot\.loginPath, \{ replace: true, flushSync: true \}\)/.test(runLogout), "W2", "logout navigates with { flushSync: true }");
check(!/flushSync\(\(\) => \{\s*navigate\(/.test(runLogout), "W3", "logout no longer relies on navigate() inside a flushSync callback");
const runLogoutEnd = runLogout.indexOf("endAuthLogoutTransition()");
check(runLogoutEnd > runLogout.indexOf("flushSync: true"), "W4", "logout cover ends only after the synchronous route commit");
check(/ensureAuthEntryRouteCode\(captureLogoutSnapshot\(\)\.loginPath\)/.test(useAuthSrc), "W5", "logout waits for the login page code when it is not loaded");
const routes = read("src/app/routes.tsx");
check(/const \[Loaded\] = useState\(getLoadedAuthPage\)/.test(routes), "W6", "AuthPage route renders loaded code synchronously");
check(/const \[Loaded\] = useState\(getLoadedPlatformAdminLogin\)/.test(routes), "W7", "Platform admin login route renders loaded code synchronously");
const prefetchLink = read("src/app/components/PrefetchLink.tsx");
check(/ensureAuthEntryRouteCode\(path\)/.test(prefetchLink) && /e\.preventDefault\(\)/.test(prefetchLink), "W8", "PrefetchLink holds auth-route navigation until the code is loaded");
check(/currentHistoryKey\(\) !== keyAtClick/.test(prefetchLink), "W9", "a late navigation is dropped if the user went elsewhere");
const hero = read("src/app/components/landing/HeroNestedCardSection.tsx");
check(/<PrefetchLink\s+to="\/login"/.test(hero), "W10", "hero Login link uses PrefetchLink");
const handoffSrc = read("src/app/lib/authSignInHandoff.ts");
const beginBody = handoffSrc.slice(handoffSrc.indexOf("export function beginAuthSignInHandoff"), handoffSrc.indexOf("export function markSignInHandoffAuthCompleted"));
check(/coverVisible = false;/.test(beginBody) && !/coverVisible = true;/.test(beginBody), "W11", "beginAuthSignInHandoff does not show the cover");

const failed = results.filter((r) => !r.ok);
for (const r of results) realConsole.log(`${r.ok ? "PASS" : "FAIL"} [${r.id}] ${r.detail}`);
if (failed.length) {
  realConsole.log("\n--- app log (last 30) ---\n" + logBuffer.slice(-30).join("\n"));
  realConsole.log(`\nauth-loader-flicker-runtime: ${failed.length} failure(s)`);
  process.exit(1);
}
realConsole.log(`\nauth-loader-flicker-runtime: ok (${results.length} checks)`);
process.exit(0);
