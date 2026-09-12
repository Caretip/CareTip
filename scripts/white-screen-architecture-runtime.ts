/**
 * Architecture lock for full-page white/blank screens.
 * Run: npm run test:white-screen-architecture
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAuthenticatedAppShellPath,
  isInShellAuthenticatedNavigation,
} from "../src/app/lib/publicRoutes";
import {
  isChunkLoadFailure,
  loadRouteModuleWithRetry,
} from "../src/app/lib/chunkLoadRecovery";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const routes = read("src/app/routes.tsx");
const logoutCover = read("src/app/components/auth/AuthLogoutHandoffCover.tsx");
const spaHold = read("src/app/routing/RootSpaRouteHold.tsx");
const routeLazy = read("src/app/routing/routeLazy.ts");
const main = read("src/main.tsx");
const success = read("src/app/pages/customer/SuccessPage.tsx");
const approvedGate = read("src/app/components/ApprovedBusinessGate.tsx");
const protectedRoute = read("src/app/components/ProtectedRoute.tsx");
const chunkLib = read("src/app/lib/chunkLoadRecovery.ts");

assert(routes.includes("Component: LandingPage"), "landing must stay eager");
assert(routes.includes("Component: AuthPage"), "login/auth must be eager (RR lazy does not suspend Outlet)");
assert(routes.includes("Component: PlatformAdminLoginPage"), "admin login must be eager (admin logout destination)");
assert(routes.includes("Component: JoinPage"), "join must be eager (landing CTA)");
assert(!/path: '\/login',\s*lazy:/.test(routes), "/login must not use RR lazy");
assert(!/path: '\/platform-admin\/login',\s*lazy:/.test(routes), "admin login must not use RR lazy");
assert(routes.includes("<AuthLogoutHandoffCover />"), "RootLayout must mount logout cover");
assert(routes.includes("<RootSpaRouteHold />"), "RootLayout must mount SPA root hold");
assert(routes.includes("<SignInHandoffCover />"), "Sign In cover must remain");

assert(logoutCover.includes("data-testid=\"auth-logout-handoff-cover\""), "logout cover must be queryable");
assert(logoutCover.includes("common.signingOut"), "logout cover uses signing-out copy, not an empty viewport");
assert(spaHold.includes("isInShellAuthenticatedNavigation"), "SPA hold must skip nested dashboard child swaps");
assert(spaHold.includes("isAppShellInteractive"), "SPA hold must not restack CareTip splash on cold boot");

assert(routeLazy.includes("loadRouteModuleWithRetry"), "lazy routes must retry stale chunks once");
assert(chunkLib.includes("RECOVERY_COOLDOWN_MS") || chunkLib.includes("30_000"), "chunk document reload must be cooldown-bounded");
assert(main.includes("vite:preloadError"), "entry must handle Vite preload/chunk failures");
assert(main.includes("paintBootstrapFailure"), "i18n/bootstrap failure must paint recovery UI, not dismiss boot onto empty #root");

assert(!approvedGate.includes("if (!user) return null"), "ApprovedBusinessGate must not blank the outlet when user is cleared");
assert(protectedRoute.includes("AuthLogoutHandoffCover"), "ProtectedRoute logout null must be documented against the cover");

assert(
  !/verification\.phase === "error"[\s\S]{0,180}return null/.test(success),
  "SuccessPage must not return null on failed verification (redirect gap)",
);

assert(isAuthenticatedAppShellPath("/dashboard/settings") === true, "dashboard is shell");
assert(isAuthenticatedAppShellPath("/login") === false, "login is not shell");
assert(isAuthenticatedAppShellPath("/employee/login") === false, "employee login is not shell");
assert(isAuthenticatedAppShellPath("/platform-admin/login") === false, "admin login is not shell");
assert(isAuthenticatedAppShellPath("/employee/payments") === true, "employee app is shell");
assert(isInShellAuthenticatedNavigation("/dashboard", "/dashboard/stripe/payouts") === true, "nested business nav is in-shell");
assert(isInShellAuthenticatedNavigation("/dashboard", "/login") === false, "logout destination is not in-shell");
assert(isInShellAuthenticatedNavigation("/", "/pricing") === false, "public to public is root replacement");

assert(isChunkLoadFailure(new Error("Failed to fetch dynamically imported module: http://x/a.js")), "detects vite dynamic import 404");
assert(isChunkLoadFailure({ name: "ChunkLoadError", message: "Loading chunk 3 failed" }), "detects webpack-style name");
assert(!isChunkLoadFailure(new Error("Network Error")), "does not treat generic errors as chunks");

let attempts = 0;
const recovered = await loadRouteModuleWithRetry(async () => {
  attempts += 1;
  if (attempts === 1) {
    throw new Error("Failed to fetch dynamically imported module: ./gone.js");
  }
  return { ok: true };
});
assert(recovered.ok === true && attempts === 2, "chunk retry must run the factory exactly twice on first failure");

attempts = 0;
try {
  await loadRouteModuleWithRetry(async () => {
    attempts += 1;
    throw new Error("not a chunk");
  });
  throw new Error("expected throw");
} catch (err) {
  assert(err instanceof Error && err.message === "not a chunk", "non-chunk errors must not retry");
  assert(attempts === 1, "non-chunk errors must not retry");
}

console.log("white-screen-architecture-runtime: ok");
