/**
 * Phase 4.5 — Stripe Connect UI/UX static + display-unit checks.
 * Run: npm run test:stripe-connect-phase4-5-ui
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatConnectPayoutAmount,
  sanitizePayoutFailureDisplay,
} from "../src/app/lib/connectPayoutDisplay";
import { classifyFetchError } from "../src/app/lib/listFilterUx";
import { ApiRequestError } from "../src/app/lib/apiError";
import { isAllowedStripeRedirectUrl } from "../src/app/lib/externalStripeRedirect";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function testAmountFormatting(): boolean {
  let ok = true;
  const eur = formatConnectPayoutAmount(12345, "eur", "en");
  if (!eur.includes("123.45") || !/€|EUR/i.test(eur)) {
    fail(`EUR cents must stay EUR, got ${eur}`);
    ok = false;
  }
  const usd = formatConnectPayoutAmount(500, "usd", "en");
  if (usd.includes("€") || !usd.includes("5.00")) {
    fail(`USD cents must not convert to EUR, got ${usd}`);
    ok = false;
  }
  if (ok) pass("payout amount uses payout currency (no EUR conversion)");
  return ok;
}

function testFailureSanitization(): boolean {
  let ok = true;
  if (sanitizePayoutFailureDisplay("sk_live_abc") !== null) {
    fail("secret-like failure text must be dropped");
    ok = false;
  }
  if (sanitizePayoutFailureDisplay("acct_123") !== null) {
    fail("acct_ failure text must be dropped");
    ok = false;
  }
  if (sanitizePayoutFailureDisplay("po_abc") !== null) {
    fail("po_ failure text must be dropped");
    ok = false;
  }
  const safe = sanitizePayoutFailureDisplay("Insufficient funds");
  if (safe !== "Insufficient funds") {
    fail(`safe failure text must pass through, got ${safe}`);
    ok = false;
  }
  if (ok) pass("payout failure display redacts Stripe ids/secrets");
  return ok;
}

function testClassifyFetchError(): boolean {
  let ok = true;
  if (classifyFetchError(new ApiRequestError("no", 401)) !== "permission") {
    fail("401 must classify as permission");
    ok = false;
  }
  if (classifyFetchError(new ApiRequestError("no", 403)) !== "permission") {
    fail("403 must classify as permission");
    ok = false;
  }
  if (classifyFetchError(new ApiRequestError("no", 404)) !== "api") {
    fail("404 must classify as api");
    ok = false;
  }
  if (classifyFetchError(new ApiRequestError("no", 504)) !== "network") {
    fail("504 must classify as network");
    ok = false;
  }
  if (ok) pass("list error classification maps 401/403/404/timeout");
  return ok;
}

function testNavigationBoundaries(): boolean {
  let ok = true;
  const billingNav = read("src/app/components/business/businessDashboardNav.ts");
  if (billingNav.includes("${BILLING_BASE}/payouts") || billingNav.includes("/dashboard/billing/payouts")) {
    fail("manager billing subnav must not include payouts");
    ok = false;
  }
  if (!billingNav.includes("stripeSubNavItems") || !billingNav.includes("STRIPE_CONNECT_HREF") || !billingNav.includes("STRIPE_PAYOUTS_HREF")) {
    fail("manager Stripe parent must include Connect and Payouts children");
    ok = false;
  }
  if (!billingNav.includes('id: "stripe"') || !billingNav.includes("/dashboard/stripe")) {
    fail("manager Stripe parent group missing");
    ok = false;
  }
  const lock = read("src/app/components/business/sidebar/sidebarNavLock.ts");
  if (!lock.includes('"/dashboard/stripe"')) {
    fail("Stripe nav must stay always-open (not subscription-locked)");
    ok = false;
  }
  const employeeNav = read("src/app/components/employee/employeeDashboardNav.ts");
  if (/payout/i.test(employeeNav) || /stripe/i.test(employeeNav)) {
    fail("employee nav must not include Connect payouts or Stripe");
    ok = false;
  }
  const routes = read("src/app/routes.tsx");
  if (!routes.includes("BusinessStripePayoutsPage") || !routes.includes("BusinessStripeConnectPage")) {
    fail("manager Stripe Connect/Payouts routes missing");
    ok = false;
  }
  if (!routes.includes('Navigate to="/dashboard/stripe/payouts"')) {
    fail("legacy /dashboard/billing/payouts must redirect to Stripe payouts");
    ok = false;
  }
  if (!routes.includes("revenue/connect-payouts") || !routes.includes("PlatformConnectPayoutsPage")) {
    fail("admin connect-payouts route missing");
    ok = false;
  }
  const billingPanel = read("src/app/components/business/settings/BusinessSettingsBillingPanel.tsx");
  if (billingPanel.includes("BusinessStripeConnectCard")) {
    fail("Connect card must not remain on Billing → Subscription");
    ok = false;
  }
  const dashboard = read("src/app/pages/business/BusinessDashboard.tsx");
  if (!dashboard.includes("BusinessStripeConnectPrompt")) {
    fail("dashboard must surface Stripe Connect setup prompt");
    ok = false;
  }
  const onboarding = read("src/app/components/business/BusinessOnboardingFinishCta.tsx");
  if (!onboarding.includes("stripeNextHint")) {
    fail("onboarding finish must mention Stripe as the next setup step");
    ok = false;
  }
  if (ok) pass("Stripe parent nav; billing excludes payouts; employee Stripe nav absent");
  return ok;
}

function testNoMutationUi(): boolean {
  let ok = true;
  const files = [
    "src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx",
    "src/app/pages/platform/revenue/PlatformConnectPayoutsPage.tsx",
    "src/app/components/connect/ConnectPayoutDetailDialog.tsx",
    "src/app/lib/api.ts",
  ];
  const banned = [
    "payouts.create",
    "createPayout(",
    "Pay Now",
    "Instant Payout",
    "Instant payout",
    "Withdraw",
    "externalAccounts",
    "cancelPayout",
  ];
  for (const file of files) {
    const src = read(file);
    for (const token of banned) {
      if (src.includes(token)) {
        fail(`${file} must not contain ${token}`);
        ok = false;
      }
    }
  }
  const managerPanel = read("src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx");
  if (managerPanel.includes("businessId")) {
    fail("manager payout panel must not send client businessId");
    ok = false;
  }
  if (ok) pass("Connect payout UI has no mutation / Pay Now / Withdraw");
  return ok;
}

function testGuestConnectMapping(): boolean {
  let ok = true;
  const errors = read("src/app/lib/errorMessages.ts");
  if (!errors.includes("CONNECT_NOT_READY")) {
    fail("ERROR_MAP must map CONNECT_NOT_READY");
    ok = false;
  }
  if (!errors.includes("This venue cannot accept tips right now.")) {
    fail("guest Connect failure copy missing");
    ok = false;
  }
  const payment = read("src/app/pages/customer/PaymentPage.tsx");
  if (!payment.includes("toUserFriendlyMessage")) {
    fail("PaymentPage must use toUserFriendlyMessage");
    ok = false;
  }
  if (ok) pass("guest Connect failure uses safe copy, not machine codes");
  return ok;
}

function testEmployeePayoutAction(): boolean {
  let ok = true;
  const nav = read("src/app/lib/notificationNavigation.ts");
  if (!nav.includes('if (type === "payout_paid" || type === "payout_completed") return "viewTip"')) {
    fail("legacy payout notifications must use viewTip, not viewPayout");
    ok = false;
  }
  if (ok) pass("legacy payout notifications deep-link as tip records");
  return ok;
}

function testDetailAndOnboardingPresent(): boolean {
  let ok = true;
  const dialog = read("src/app/components/connect/ConnectPayoutDetailDialog.tsx");
  if (!dialog.includes("ConnectPayoutDetailDialog") || !dialog.includes("balanceLinesHint")) {
    fail("payout detail dialog missing");
    ok = false;
  }
  const connect = read("src/app/components/business/settings/billing/BusinessStripeConnectCard.tsx");
  if (connect.includes("disabledReason")) {
    fail("Connect card must not render disabledReason");
    ok = false;
  }
  if (!connect.includes("chargesOff") || !connect.includes("payoutsOff")) {
    fail("Connect card must surface charges/payouts disabled copy");
    ok = false;
  }
  const admin = read("src/app/pages/platform/revenue/PlatformConnectPayoutsPage.tsx");
  if (!admin.includes("filterCurrency") || !admin.includes("createdFrom") || !admin.includes("fetchPlatformConnectPayout")) {
    fail("admin payouts page missing currency/date filters or detail fetch");
    ok = false;
  }
  if (ok) pass("detail dialog, Connect onboarding copy, admin filters present");
  return ok;
}

function testConnectReturnUrlsAndFee(): boolean {
  let ok = true;
  const connectSvc = read("backend/src/services/stripeConnect.service.ts");
  if (!connectSvc.includes("/dashboard/stripe/connect?connect=return") || !connectSvc.includes("/dashboard/stripe/connect?connect=refresh")) {
    fail("Account Link return/refresh must land on Stripe Connect page");
    ok = false;
  }
  if (connectSvc.includes("/dashboard/billing/subscription?connect=")) {
    fail("Account Link must not return to Billing subscription");
    ok = false;
  }
  const fees = read("backend/src/config/fees.ts");
  if (
    !fees.includes("export const CARETIP_FEE_PERCENT = 10") ||
    !fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49")
  ) {
    fail("CareTip fee must remain 10 percent + €0.49");
    ok = false;
  }
  const dest = read("backend/src/services/connectTipDestination.service.ts");
  if (!dest.includes("CONNECT_NOT_READY") || !dest.includes("destination")) {
    fail("destination-charge Connect gate must remain");
    ok = false;
  }
  if (ok) pass("Connect return URLs, 10% + €0.49 fee, destination charges unchanged");
  return ok;
}

function testConnectRedirectAllowlist(): boolean {
  let ok = true;
  const src = read("src/app/lib/externalStripeRedirect.ts");
  if (/\*\.stripe\.com/.test(src) || src.includes('endsWith(".stripe.com")') || src.includes("endsWith('.stripe.com')")) {
    fail("Connect redirect must not use a Stripe subdomain wildcard");
    ok = false;
  }
  if (!src.includes("accounts.stripe.com") || !src.includes("connect.stripe.com")) {
    fail("Connect allowlist must include exact V2 accounts.stripe.com and V1 connect.stripe.com");
    ok = false;
  }
  if (src.includes("checkout.stripe.com") && src.includes('kind === "connect"') === false) {
    // checkout host must remain for checkout kind only; presence in file is expected
  }

  const allowed = [
    "https://accounts.stripe.com/r/acct_1Nv0FGQ9RKHgCVdK#alu_test",
    "https://connect.stripe.com/setup/s/test_v1_link",
  ];
  for (const url of allowed) {
    if (!isAllowedStripeRedirectUrl(url, "connect")) {
      fail(`Connect must allow official host ${new URL(url).hostname}`);
      ok = false;
    }
  }

  const rejected: Array<[string, string]> = [
    ["https://evil.stripe.com/r/acct_x", "attacker-controlled stripe subdomain"],
    ["https://accounts.stripe.com.evil.example/r/acct_x", "suffix lookalike host"],
    ["https://stripe.com/connect", "apex stripe.com"],
    ["http://accounts.stripe.com/r/acct_x", "non-HTTPS"],
    ["https://checkout.stripe.com/c/pay/cs_test", "checkout host on connect kind"],
    ["https://billing.stripe.com/p/session/test", "portal host on connect kind"],
    ["https://example.com/phish", "arbitrary external host"],
  ];
  for (const [url, why] of rejected) {
    if (isAllowedStripeRedirectUrl(url, "connect")) {
      fail(`Connect must reject ${why}: ${url}`);
      ok = false;
    }
  }

  if (
    !isAllowedStripeRedirectUrl("https://checkout.stripe.com/c/pay/cs_test", "checkout") ||
    isAllowedStripeRedirectUrl("https://accounts.stripe.com/r/acct_x", "checkout")
  ) {
    fail("Checkout redirect allowlist must stay checkout.stripe.com only");
    ok = false;
  }
  if (
    !isAllowedStripeRedirectUrl("https://billing.stripe.com/p/session/test", "portal") ||
    isAllowedStripeRedirectUrl("https://accounts.stripe.com/r/acct_x", "portal")
  ) {
    fail("Portal redirect allowlist must stay billing.stripe.com only");
    ok = false;
  }

  if (ok) pass("Connect redirect allows exact V1/V2 Stripe hosts; rejects wildcards and other kinds");
  return ok;
}

let failed = 0;
failed += testAmountFormatting() ? 0 : 1;
failed += testFailureSanitization() ? 0 : 1;
failed += testClassifyFetchError() ? 0 : 1;
failed += testNavigationBoundaries() ? 0 : 1;
failed += testNoMutationUi() ? 0 : 1;
failed += testGuestConnectMapping() ? 0 : 1;
failed += testEmployeePayoutAction() ? 0 : 1;
failed += testDetailAndOnboardingPresent() ? 0 : 1;
failed += testConnectReturnUrlsAndFee() ? 0 : 1;
failed += testConnectRedirectAllowlist() ? 0 : 1;

for (const line of results) console.log(line);
console.log(failed === 0 ? `\nOK: ${results.length} checks` : `\nFAILED: ${failed} check group(s)`);
process.exit(failed === 0 ? 0 : 1);
