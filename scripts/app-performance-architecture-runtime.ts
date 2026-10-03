/**
 * Locks the app-wide performance architecture (loader isolation, no fake overlay floors).
 * Run: npm run test:app-performance-architecture
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MIN_OVERLAY_VISIBLE_MS,
  PREMIUM_MIN_OVERLAY_VISIBLE_MS,
  resolveMinOverlayVisibleMs,
} from "../src/app/lib/appLoadingTiming";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const loadingManager = read("src/app/context/AppLoadingManager.tsx");
assert(
  loadingManager.includes("IsolateProviderChildren"),
  "AppLoadingManager must isolate routed children from overlay state",
);
assert(
  loadingManager.includes("AppLoadingOverlayVisibleContext"),
  "overlay visibility must not live on the registration/actions context",
);
assert(
  loadingManager.includes("AppLoadingActionsContext"),
  "loader registration must use a stable actions context",
);

const socket = read("src/app/context/SocketProvider.tsx");
assert(socket.includes("IsolateProviderChildren"), "SocketProvider must isolate the router from connection churn");

const tipFlow = read("src/app/context/TipFlowContext.tsx");
assert(tipFlow.includes("IsolateProviderChildren"), "TipFlowProvider must not rerender the app on amount changes");

const outlet = read("src/app/components/RouteOutletTransition.tsx");
assert(!outlet.includes("opacity: 0"), "in-shell navigation must not fade the dashboard to blank");
assert(outlet.includes("<Outlet"), "RouteOutletTransition must still render the outlet");

const fcm = read("src/app/lib/fcmPush.ts");
assert(
  !/import \{[^}]*initializeApp/.test(fcm),
  "firebase/app must not be a static runtime import on the dashboard graph",
);
assert(fcm.includes('import("firebase/app")'), "firebase app SDK must load only when push runs");

assert(DEFAULT_MIN_OVERLAY_VISIBLE_MS === 0, "no fake minimum branded overlay time");
assert(PREMIUM_MIN_OVERLAY_VISIBLE_MS === 0, "no premium fake overlay floor");
assert(resolveMinOverlayVisibleMs("payment-page-checkout") === 0, "checkout overlay must not pad duration");
assert(resolveMinOverlayVisibleMs("app-boot") === 0, "boot overlay must not pad duration");

const routes = read("src/app/routes.tsx");
assert(routes.includes("MarketingShellLayout"), "marketing shell layout stays eager");
assert(
  read("src/app/routing/marketingChildRoutes.tsx").includes("Component: LandingPage"),
  "landing index route stays eager under marketing shell",
);
assert(
  read("src/app/layouts/MarketingShellLayout.tsx").includes('data-caretip-marketing-shell'),
  "persistent marketing shell marker",
);
assert(routes.includes("Component: AuthPage"), "login stays eager");

const businessDrawer = read("src/app/components/business/BusinessMobileSidebar.tsx");
assert(
  !businessDrawer.includes("logout();\n            onClose()"),
  "business mobile sign-out must not close the drawer (overflow race)",
);
const employeeDrawer = read("src/app/components/employee/EmployeeMobileSidebar.tsx");
assert(
  !employeeDrawer.includes("logout();\n            onClose()"),
  "employee mobile sign-out must not close the drawer after logout",
);
const adminDrawer = read("src/app/components/AdminMobileSidebar.tsx");
assert(
  !adminDrawer.includes("logout();\n            onClose()"),
  "admin mobile sign-out must not close the drawer after logout",
);

const logoutTrans = read("src/app/lib/authLogoutTransition.ts");
assert(logoutTrans.includes("caretip-logout-viewport-lock"), "logout must lock viewport overflow");

const globals = read("src/styles/globals.css");
assert(
  /caretip-dashboard-page-enter \{\s*animation:\s*none;/.test(globals),
  "dashboard shell must not fade in with caretip-page-enter",
);

const nativeSignOut = read("mobile/hooks/useSignOutAction.ts");
assert(!nativeSignOut.includes("hapticWarning"), "native sign-out must not fire warning haptics on tap");

const softHold = read("src/app/routing/SoftSpaRouteHold.tsx");
const rootHold = read("src/app/routing/RootSpaRouteHold.tsx");
const publicHold = read("src/app/routing/PublicRouteChunkHold.tsx");
const minimalFallback = read("src/app/routing/DashboardOutletFallback.tsx");
assert(softHold.includes("SoftSpaRouteHold"), "soft SPA hold component exists");
assert(
  rootHold.includes("SoftSpaRouteHold") && !rootHold.includes("AuthBootstrapShell"),
  "root SPA hold must not reopen AuthBootstrapShell after shell is interactive",
);
assert(
  rootHold.includes("isInShellMarketingNavigation"),
  "root SPA hold must skip in-shell marketing navigations",
);
assert(
  publicHold.includes("isAppShellInteractive()") && publicHold.includes("SoftSpaRouteHold"),
  "public chunk hold must downgrade after shell is interactive",
);
assert(
  minimalFallback.includes("isAppShellInteractive()") && minimalFallback.includes("SoftSpaRouteHold"),
  "minimal route fallback must downgrade after shell is interactive",
);

const journey = read("src/app/lib/appLoadingJourney.ts");
assert(
  journey.includes("isAppShellInteractive()") && journey.includes("shouldRegisterBrandedRouteNavigation"),
  "branded route navigation gated on shell lifecycle",
);

console.log("app-performance-architecture-runtime: ok");
