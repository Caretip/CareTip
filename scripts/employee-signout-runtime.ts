/**
 * Employee vs Business sign-out lifecycle locks (no live credentials).
 * Run: npm run test:employee-signout
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchRoutes } from "react-router";
import { getLoginPathForSessionRole, getLoginPathFromAppPath } from "../src/app/lib/authSession";
import { isLogoutHandoffDestinationReady } from "../src/app/lib/authLogoutTransition";
import {
  isAuthenticatedAppShellPath,
  isInShellAuthenticatedNavigation,
  isPublicShellPath,
} from "../src/app/lib/publicRoutes";
import { shouldShowAuthBootstrapShell } from "../src/app/lib/authBootstrapUi";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const useAuth = read("src/app/hooks/useAuth.ts");
const clientLogout = read("src/app/lib/clientLogout.ts");
const protectedRoute = read("src/app/components/ProtectedRoute.tsx");
const employeeLayout = read("src/app/layouts/EmployeeLayout.tsx");
const cover = read("src/app/components/auth/AuthLogoutHandoffCover.tsx");
const routes = read("src/app/routes.tsx");

assert(useAuth.includes("performClientLogoutCleanup"), "logout clears client session before navigate");
assert(useAuth.includes("logoutAPIWithTimeout"), "logout still POSTs /api/auth/logout after local cleanup");
assert(useAuth.includes("void logoutAPIWithTimeout"), "server logout must stay fire-and-forget (not UI-blocking)");
assert(useAuth.includes("if (isAuthLogoutTransitionActive()) return"), "repeat Sign out clicks are ignored");
assert(clientLogout.includes("markClientSessionRevoked"), "client logout marks session revoked");
assert(clientLogout.includes("resetAllClientSessionCaches"), "client logout wipes session caches");
assert(clientLogout.includes("clearEmployeeNotifications"), "employee notification store is cleared");
assert(clientLogout.includes("getLoginPathForSessionRole"), "login destination follows prior session role");
assert(
  !/if \(logoutTransitionActive\) \{\s*return null;/.test(protectedRoute),
  "ProtectedRoute must not unmount the shell on logout overlay",
);
assert(
  employeeLayout.includes('useWarmPrefetchAuthLoginRoute("/employee/login"'),
  "employee layout prefetches /employee/login",
);
assert(cover.includes("useSignalLogoutDestinationReady"), "cover ends when login URL commits");
assert(routes.includes("path: '/employee/login'"), "staff login is a dedicated route");
assert(routes.includes("Component: AuthPage"), "staff/business login stay eager AuthPage");

assert(getLoginPathForSessionRole("employee") === "/employee/login", "employee → /employee/login");
assert(getLoginPathForSessionRole("business") === "/login", "business → /login");
assert(getLoginPathFromAppPath("/employee/dashboard") === "/employee/login", "employee app path → staff login");
assert(getLoginPathFromAppPath("/employee/payouts") === "/employee/login", "payouts path → staff login");
assert(getLoginPathFromAppPath("/employee/payments/connect") === "/employee/login", "connect path → staff login");
assert(isPublicShellPath("/employee/login") === true, "employee login is a public shell path");
assert(isAuthenticatedAppShellPath("/employee/login") === false, "employee login is not the staff app shell");
assert(isAuthenticatedAppShellPath("/employee/dashboard") === true, "employee dashboard is app shell");
assert(
  isInShellAuthenticatedNavigation("/employee/dashboard", "/employee/login") === false,
  "staff logout is a root replacement, not an in-shell child swap",
);
assert(
  isLogoutHandoffDestinationReady("/employee/login", "/employee/login") === true,
  "handoff ready when staff login committed",
);
assert(
  isLogoutHandoffDestinationReady("/employee/dashboard", "/employee/login") === false,
  "handoff not ready while still on staff dashboard",
);
assert(
  isLogoutHandoffDestinationReady("/login", "/employee/login") === false,
  "business login is not the staff logout destination",
);

assert(
  shouldShowAuthBootstrapShell({
    authStatus: "unauthenticated",
    authTransitionPending: false,
  }) === false,
  "signed-out login form is not a bootstrap shell",
);

const rankingRoutes = [
  {
    id: "root",
    children: [
      { path: "/login", id: "login" },
      { path: "/employee/login", id: "employee-login" },
      {
        path: "/employee",
        id: "employee-shell",
        children: [
          {
            id: "employee-layout-lazy",
            children: [
              { index: true, id: "employee-index" },
              { path: "dashboard", id: "employee-dashboard" },
              { path: "payouts", id: "employee-payouts" },
              { path: "payments/connect", id: "employee-connect" },
            ],
          },
        ],
      },
    ],
  },
];

function matchedIds(url: string): string[] {
  const matches = matchRoutes(rankingRoutes, url);
  if (!matches) throw new Error(`no match for ${url}`);
  return matches.map((m) => String(m.route.id ?? m.route.path));
}

assert(matchedIds("/employee/login").includes("employee-login"), "/employee/login ranks as AuthPage, not staff shell");
assert(!matchedIds("/employee/login").includes("employee-shell"), "/employee/login must not enter ProtectedRoute shell");
assert(matchedIds("/employee/dashboard").includes("employee-shell"), "/employee/dashboard is the staff shell");
assert(matchedIds("/login").includes("login"), "/login is the business AuthPage");

console.log("employee-signout-runtime: ok");
