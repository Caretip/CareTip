/**
 * Customer journey loader / flicker regressions (no browser).
 * Run: node ./backend/node_modules/tsx/dist/cli.mjs ./scripts/customer-journey-flicker-runtime.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const tipAmount = read("src/app/pages/customer/TipAmountPage.tsx");
assert(
  tipAmount.includes("useState(() =>") && tipAmount.includes("isCustomerEmployeeContextReady"),
  "TipAmountPage must not start loading=true when employee context is already in memory",
);

const staff = read("src/app/pages/customer/StaffLandingPage.tsx");
assert(staff.includes("isCustomerEntryPending"), "staff QR still uses a pending entry phase");
assert(
  tipAmount.includes('loadingContext="tipPage"'),
  "tip amount still uses the same tipPage copy — but only while context is actually missing",
);

const success = read("src/app/pages/customer/SuccessPage.tsx");
assert(
  success.includes('registrationKey="success-page-verification"') &&
    success.includes('context="stripeReturn"'),
  "Stripe return must keep HTML/boot overlay instead of a second confirming shell while polling",
);
assert(
  !/verification\.phase === "loading"[\s\S]{0,200}TipPaymentProcessingView/.test(success),
  "SuccessPage must not mount TipPaymentProcessingView during loading/pending (duplicate confirming UI)",
);

const bridge = read("src/app/lib/htmlMarketingBootBridge.ts");
assert(
  bridge.includes("isCustomerJourneyPath") && bridge.includes("shouldRetainHtmlBootUntilLandingCommit"),
  "HTML boot retain must cover guest tip URLs, not only /",
);

const bootLocale = read("public/boot-locale.js");
assert(
  bootLocale.includes("isCustomerBootPath") && bootLocale.includes("[data-caretip-route-ready]"),
  "boot-locale must retain the HTML boot on guest paths until route-ready",
);

const shell = read("src/app/pages/customer/CustomerFlowShell.tsx");
assert(
  shell.includes("data-caretip-route-ready") && shell.includes("usePublicHtmlBootHandoff"),
  "customer shell marks destination-ready and hands off HTML boot only when not loading",
);

const heroStack = read("src/styles/caretip-landing-hero-mobile-stack.css");
assert(
  heroStack.includes("--caretip-hero-gap-body-cta: 0.75rem"),
  "mobile hero CTA gap must be compact (not 2.25rem under the supporting copy)",
);

const checkout = read("src/app/lib/startGuestTipCheckout.ts");
assert(checkout.includes("createTipCheckoutSession"), "guest checkout still uses one server session create");
assert(tipAmount.includes("if (result !== \"redirected\") setProcessing(false)"), "tip submit stays locked until redirect");

console.log("customer-journey-flicker-runtime: ok");
