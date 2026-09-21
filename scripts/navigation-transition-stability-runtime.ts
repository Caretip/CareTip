/**
 * Post-deployment navigation / loader transition regressions.
 * Run: npm run test:navigation-transition-stability
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginExternalStripeNavigationHold,
  endExternalStripeNavigationHold,
  getExternalStripeNavigationHoldMessage,
  isExternalStripeNavigationHoldActive,
  resetExternalStripeNavigationHoldForTests,
} from "../src/app/lib/externalStripeNavigationHold";
import { shouldBypassOverlayShowThreshold } from "../src/app/lib/appLoadingTiming";
import {
  isIntentionalPostShellOverlayKey,
  markAppShellInteractive,
  resetAppShellInteractiveForTests,
  shouldSuppressSoftNavGlobalOverlay,
} from "../src/app/lib/appShellLifecycle";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const connectCard = read("src/app/components/business/settings/billing/BusinessStripeConnectCard.tsx");
const employeeConnect = read("src/app/components/employee/EmployeePayoutAccountCard.tsx");
const redirect = read("src/app/lib/externalStripeRedirect.ts");
const hold = read("src/app/lib/externalStripeNavigationHold.ts");
const loadingManager = read("src/app/context/AppLoadingManager.tsx");
const logoutCover = read("src/app/components/auth/AuthLogoutHandoffCover.tsx");
const useAuth = read("src/app/hooks/useAuth.ts");
const staleBusyHook = read("src/app/hooks/useClearStaleStripeRedirectBusy.ts");
const staleStateLib = read("src/app/lib/staleExternalStripeState.ts");

assert(
  connectCard.includes("useClearStaleStripeRedirectBusy") &&
    connectCard.includes('"connect"') &&
    !/startOnboarding[\s\S]{0,400}finally[\s\S]{0,40}setBusy\(null\)/.test(connectCard) &&
    connectCard.includes("setBusy(null)"),
  "business Connect card clears stale busy on return/bfcache, not in finally on success",
);

assert(
  employeeConnect.includes("useClearStaleStripeRedirectBusy") &&
    employeeConnect.includes('"payoutConnect"') &&
    !/finally[\s\S]{0,80}setBusy\(null\)/.test(employeeConnect),
  "employee Connect card clears busy only on failure, not in finally after redirect",
);

assert(
  redirect.includes("beginExternalStripeNavigationHold") &&
    hold.includes("pagehide") &&
    loadingManager.includes("externalStripeHoldActive"),
  "external Stripe redirect keeps overlay until pagehide",
);

resetExternalStripeNavigationHoldForTests();
assert(!isExternalStripeNavigationHoldActive(), "hold starts inactive");
beginExternalStripeNavigationHold("Taking you to secure checkout…");
assert(isExternalStripeNavigationHoldActive(), "hold activates before navigation");
assert(
  getExternalStripeNavigationHoldMessage() === "Taking you to secure checkout…",
  "hold stores explicit checkout message",
);
endExternalStripeNavigationHold();
assert(!isExternalStripeNavigationHoldActive(), "hold ends cleanly");
assert(getExternalStripeNavigationHoldMessage() === undefined, "hold message clears on end");

assert(
  shouldBypassOverlayShowThreshold("stripe-connect-onboarding", false) &&
    shouldBypassOverlayShowThreshold("customer-tip-journey", false),
  "Connect + tip journey overlays bypass show threshold",
);

assert(
  isIntentionalPostShellOverlayKey("stripe-connect-onboarding"),
  "Connect overlay allowed after shell is interactive",
);

resetAppShellInteractiveForTests();
markAppShellInteractive();
assert(
  isIntentionalPostShellOverlayKey("customer-tip-journey"),
  "tip journey checkout overlay allowed after shell is interactive",
);
assert(
  !shouldSuppressSoftNavGlobalOverlay("customer-tip-journey"),
  "customer-tip-journey registers during warm SPA checkout",
);
resetAppShellInteractiveForTests();

assert(
  logoutCover.includes("showTagline={false}") &&
    !logoutCover.includes("common.signingOut") &&
    useAuth.includes("endAuthLogoutTransition()") &&
    useAuth.includes("signalLogoutAuthPageReady()"),
  "logout ends synchronously without Signing you out copy",
);

assert(
  staleStateLib.includes("event.persisted") &&
    staleBusyHook.includes("useStaleExternalStripeStateReset"),
  "stale Connect busy uses shared bfcache restore",
);

const staffLanding = read("src/app/pages/customer/StaffLandingPage.tsx");
const tipAmount = read("src/app/pages/customer/TipAmountPage.tsx");
const customerShell = read("src/app/pages/customer/CustomerFlowShell.tsx");
const routes = read("src/app/routes.tsx");
assert(
  staffLanding.includes('registrationKey="customer-tip-journey"') &&
    tipAmount.includes('loadingRegistrationKey="customer-tip-journey"'),
  "tip journey uses one stable loader registration key",
);
assert(
  !tipAmount.includes("tip-amount-stripe-redirect"),
  "tip checkout must not use a second loader registration key",
);
assert(
  tipAmount.includes('loadingContext={journeyLoadingContext}') &&
    tipAmount.includes('loading={journeyLoading}') &&
    tipAmount.includes('journeyLoadingContext = processing ? "stripeRedirect" : "tipPage"'),
  "tip checkout updates one journey message instead of swapping registrars",
);
assert(
  customerShell.includes('loadingContext === "stripeRedirect"') &&
    customerShell.includes("checkoutTransition"),
  "CustomerFlowShell registers checkout overlay on warm SPA",
);
assert(
  !tipAmount.includes("animate-spin") || !/processing \?[\s\S]{0,120}animate-spin/.test(tipAmount),
  "tip CTA must not duplicate checkout spinner while global journey owns the transition",
);
assert(
  loadingManager.includes("getExternalStripeNavigationHoldMessage") &&
    redirect.includes("beginExternalStripeNavigationHold(holdMessage)"),
  "Stripe hold prefers explicit checkout message over stale journey ref",
);
assert(
  routes.includes("Component: RatingPage") && routes.includes("Component: SuccessPage"),
  "Stripe return routes must be eager",
);

console.log("navigation-transition-stability-runtime: ok");
