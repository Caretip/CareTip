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
  tipAmount.includes("useState(() =>") &&
    tipAmount.includes("isCustomerEmployeeContextReady") &&
    tipAmount.includes("loading={!contextReady}"),
  "TipAmountPage must keep the opening wait until employee context is ready, then hand off",
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
assert(
  bridge.includes("isLazyPublicMarketingShellPath") ||
    (bridge.includes("/pricing") && bridge.includes("isCustomerJourneyPath")),
  "HTML boot retain must also cover lazy public marketing shells until route-ready",
);

const publicShell = read("src/components/public/PublicPageShell.tsx");
assert(
  publicShell.includes("data-caretip-route-ready") &&
    publicShell.includes("usePublicHtmlBootHandoff(true)"),
  "PublicPageShell must commit route-ready and hand off HTML boot",
);

const bootLocale = read("public/boot-locale.js");
assert(
  bootLocale.includes("isCustomerBootPath") &&
    bootLocale.includes("isLazyPublicMarketingPath") &&
    bootLocale.includes('return Boolean(doc.querySelector("[data-caretip-route-ready]"));'),
  "boot-locale must keep HTML boot on guest + lazy marketing paths until destination route-ready",
);

const shell = read("src/app/pages/customer/CustomerFlowShell.tsx");
assert(
  shell.includes("data-caretip-route-ready") && shell.includes("usePublicHtmlBootHandoff(!loading)"),
  "customer shell marks destination-ready and hands off HTML boot only when not loading",
);

const empQr = read("src/app/pages/customer/EmployeeQrEntryPage.tsx");
assert(
  empQr.includes('usePublicHtmlBootHandoff(phase === "ready" && Boolean(emp))'),
  "Employee QR must not dismiss HTML boot while identity is still fetching",
);
assert(
  tipAmount.includes("peekGuestTipEmployee") &&
    tipAmount.includes("loading={!contextReady}") &&
    empQr.includes("rememberGuestTipEmployee"),
  "Employee QR must cache identity so /tip-amount does not wait on a second employee GET",
);

const rating = read("src/app/pages/customer/RatingPage.tsx");
assert(
  rating.includes('registrationKey="rating-page-verification"') &&
    rating.includes('context="stripeReturn"') &&
    !rating.includes("showVerifyingPayment"),
  "Rating verification uses one stripeReturn wait loader, not a second inline confirming line",
);

const sessionHook = read("src/app/hooks/useVerifiedTipSession.ts");
assert(
  sessionHook.includes("peekVerifiedTipSession") && sessionHook.includes("rememberVerifiedTipSession"),
  "Verified tip session must be remembered so /rating does not replay Confirming after /success",
);

const heroStack = read("src/styles/caretip-landing-hero-mobile-stack.css");
assert(
  heroStack.includes("--caretip-hero-gap-body-cta: 0.75rem"),
  "mobile hero CTA gap must be compact (not 2.25rem under the supporting copy)",
);

const manager = read("src/app/context/AppLoadingManager.tsx");
assert(
  manager.includes('attributeFilter: ["data-caretip-route-ready"]') &&
    !manager.includes("{ subtree: true, childList: true, attributes: true }"),
  "HTML boot MutationObserver must not watch every document attribute (renderer crash)",
);

const tipFlow = read("src/app/context/TipFlowContext.tsx");
assert(
  tipFlow.includes("prev.businessId === id ? prev") &&
    tipFlow.includes("prev.locationId === venue.locationId"),
  "TipFlow venue/employee setters must no-op when values are unchanged",
);
const checkout = read("src/app/lib/startGuestTipCheckout.ts");
assert(checkout.includes("createTipCheckoutSession"), "guest checkout still uses one server session create");
assert(checkout.includes("guestTipCheckoutInFlight"), "guest checkout must reject overlapping Pay taps");
assert(tipAmount.includes('if (result === "failed") setProcessing(false)'), "tip submit stays locked until redirect or failure");
assert(tipAmount.includes("if (processing) return"), "tip amount ignores clicks while checkout is already starting");

console.log("customer-journey-flicker-runtime: ok");
