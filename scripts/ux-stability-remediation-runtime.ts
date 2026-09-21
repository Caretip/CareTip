/**
 * UX Stability Remediation Sprint — architecture + unit regressions.
 * Run: npm run test:ux-stability-remediation
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authRefreshCoordinationTestHooks,
  hasRecentPeerRefreshSuccess,
  isRefreshBlockedByPeerLock,
} from "../src/app/lib/authRefreshCoordination";
import { markSessionExpiredNotice, consumeSessionExpiredNotice } from "../src/app/lib/sessionExpiredNotice";
import { isDefinitiveRefreshFailure } from "../src/app/lib/authRefreshFailureClassification";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// --- Phase 1: white screen protection ---
const minimalFallback = read("src/app/routing/DashboardOutletFallback.tsx");
const publicHold = read("src/app/routing/PublicRouteChunkHold.tsx");
assert(
  minimalFallback.includes("return <PublicRouteChunkHold />"),
  "MinimalRouteFallback must render PublicRouteChunkHold (never blank #root) except sign-in handoff",
);
assert(
  publicHold.includes('data-testid="public-route-chunk-hold"') && publicHold.includes("AuthBootstrapShell"),
  "public route chunk hold must be branded",
);

// --- Phase 2: multi-tab refresh + transient vs auth failure ---
const api = read("src/app/lib/api.ts");
const authInit = read("src/app/hooks/useAuthInitializer.ts");
const coordination = read("src/app/lib/authRefreshCoordination.ts");
assert(api.includes("coordinateCrossTabRefresh"), "refresh must coordinate across tabs");
assert(api.includes("hasRecentPeerRefreshSuccess"), "rotation loser must retry after peer success");
assert(coordination.includes("caretip-auth-refresh-v1"), "Web Locks use CareTip-specific lock name");
assert(!coordination.includes("if (peerDone?.ok)"), "peer success must not bypass coordination mutex");
assert(coordination.includes("RefreshCoordinationTimeoutError"), "refresh coordination timeout is classified");
assert(api.includes("clearAuthStorageForDefinitiveFailure"), "only definitive failures clear session");
assert(!authInit.includes("forceUnsettledBootstrapToAnonymous"), "bootstrap must not force-logout on transient settle");
assert(authInit.includes("settleTransientBootstrapDegraded"), "transient failures settle degraded, not logged out");
assert(authInit.includes("isDefinitiveRefreshFailure"), "bootstrap distinguishes auth vs transient errors");

// localStorage shim for coordination unit checks
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
  },
  configurable: true,
});

authRefreshCoordinationTestHooks.reset();
authRefreshCoordinationTestHooks.setPeerLock("peer-tab-a");
assert(isRefreshBlockedByPeerLock(), "peer refresh lock blocks concurrent rotation");
authRefreshCoordinationTestHooks.reset();
authRefreshCoordinationTestHooks.setPeerDone("peer-tab-b", true, 200);
assert(hasRecentPeerRefreshSuccess(), "recent peer refresh success is detectable");

// --- Phase 3: auth bootstrap degraded release ---
const bootstrapRegistrar = read("src/app/components/AuthBootstrapLoadingRegistrar.tsx");
assert(
  bootstrapRegistrar.includes("markSessionBootstrapDegraded"),
  "stuck auth bootstrap must release shell in degraded mode",
);

// --- Phase 4: session expired UX ---
const authPage = read("src/app/components/AuthPage.tsx");
const adminLogin = read("src/app/pages/platform/PlatformAdminLoginPage.tsx");
assert(authPage.includes("consumeSessionExpiredNotice"), "AuthPage shows session-expired notice");
assert(adminLogin.includes("consumeSessionExpiredNotice"), "admin login shows session-expired notice");

const sessionStorageShim = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (k: string) => (sessionStorageShim.has(k) ? sessionStorageShim.get(k)! : null),
    setItem: (k: string, v: string) => {
      sessionStorageShim.set(k, v);
    },
    removeItem: (k: string) => {
      sessionStorageShim.delete(k);
    },
  },
  configurable: true,
});
markSessionExpiredNotice();
assert(consumeSessionExpiredNotice(), "session-expired notice is one-shot consumable");
assert(!consumeSessionExpiredNotice(), "session-expired notice must not replay");

// --- Phase 5: loading overlay threshold ---
const loadingTiming = read("src/app/lib/appLoadingTiming.ts");
assert(
  loadingTiming.includes("app-auth-bootstrap") && loadingTiming.includes("route-chunk"),
  "auth bootstrap and route chunks bypass 200ms overlay gap",
);

// --- Phase 6: dashboard cold boot ---
const businessDash = read("src/app/pages/business/BusinessDashboard.tsx");
const employeeDash = read("src/app/pages/employee/EmployeeDashboard.tsx");
assert(
  businessDash.includes('useBusinessPageBoot("overview", false)'),
  "business dashboard must not block global loader on KPI fetch",
);
assert(
  /useExtendGlobalLoaderUntilReady\([\s\S]*?false,/.test(employeeDash),
  "employee dashboard must not block global loader on metrics fetch",
);

// --- Phase 7: hero persistence ---
const heroLayer = read("src/app/components/landing/LandingHeroPersistenceLayer.tsx");
const routes = read("src/app/routes.tsx");
const landingPage = read("src/app/pages/LandingPage.tsx");
assert(routes.includes("LandingHeroPersistenceLayer"), "RootLayout mounts hero persistence layer");
assert(heroLayer.includes("landing-hero-persistence-layer"), "hero stays mounted off-screen on warm nav");
assert(landingPage.includes("LANDING_HERO_SLOT_ID"), "landing page exposes hero portal slot");

// --- Phase 8: stripe return retry ---
const sessionHook = read("src/app/hooks/useVerifiedTipSession.ts");
const tipProcessing = read("src/app/pages/customer/TipPaymentProcessingView.tsx");
const success = read("src/app/pages/customer/SuccessPage.tsx");
const rating = read("src/app/pages/customer/RatingPage.tsx");
const billingSuccess = read("src/app/pages/SubscriptionSuccessPage.tsx");
assert(sessionHook.includes("retryVerification") && sessionHook.includes("as const"), "tip session hook exposes retry tuple");
assert(tipProcessing.includes("onRetry") && tipProcessing.includes("common.tryAgain"), "tip timeout view offers retry");
assert(success.includes("retryVerification") && success.includes("onRetry"), "success page wires retry");
assert(rating.includes("retryVerification") && rating.includes("onRetry"), "rating page wires retry");
assert(billingSuccess.includes("retrySync") && billingSuccess.includes("common.tryAgain"), "billing return offers retry");

// --- Definitive vs transient refresh classification (exported helper) ---
assert(
  isDefinitiveRefreshFailure(new Error("Your session has expired. Please sign in again.")),
  "expired session message is definitive",
);
assert(
  !isDefinitiveRefreshFailure(new Error("Our servers hit a problem. Please try again in a few minutes.")),
  "503-style message is transient",
);

console.log("ux-stability-remediation-runtime: ok");
