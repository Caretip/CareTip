/**
 * Stripe stale client transition state — bfcache / return cleanup regressions.
 * Run: npm run test:stripe-stale-state
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isBillingStripeReturnParam,
  isConnectStripeReturnParam,
  isPhysicalQrCheckoutReturnParam,
  isTipCheckoutCanceledParam,
  subscribeBfcacheRestore,
} from "../src/app/lib/staleExternalStripeState";
import { clearGuestTipCheckoutInFlightForStaleRestore } from "../src/app/lib/startGuestTipCheckout";
import { clearActivationCheckoutInFlightForStaleRestore } from "../src/app/lib/activateCareTipCheckout";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const staleLib = read("src/app/lib/staleExternalStripeState.ts");
const staleHook = read("src/app/hooks/useStaleExternalStripeStateReset.ts");
const connectHook = read("src/app/hooks/useClearStaleStripeRedirectBusy.ts");

assert(staleLib.includes("event.persisted"), "bfcache restore requires pageshow persisted");
assert(staleLib.includes("subscribeBfcacheRestore"), "shared bfcache subscriber exists");
assert(staleHook.includes("subscribeBfcacheRestore(onReset)"), "hook uses bfcache subscriber");
assert(!staleHook.includes("onReset()") || staleHook.includes("billingReturn"), "return params are explicit");

assert(isBillingStripeReturnParam("success") && isBillingStripeReturnParam("canceled"));
assert(!isBillingStripeReturnParam("pending"));
assert(isConnectStripeReturnParam("return") && isConnectStripeReturnParam("refresh"));
assert(isPhysicalQrCheckoutReturnParam("success") && isPhysicalQrCheckoutReturnParam("cancel"));
assert(isTipCheckoutCanceledParam(new URLSearchParams("canceled=1")));

const g = globalThis as typeof globalThis & { window?: typeof globalThis };
if (g.window == null) g.window = g;

const listeners: Array<(event: PageTransitionEvent) => void> = [];
const win = g.window as typeof globalThis & {
  addEventListener?: (type: string, handler: (event: PageTransitionEvent) => void) => void;
  removeEventListener?: (type: string, handler: (event: PageTransitionEvent) => void) => void;
};
const prevAdd = win.addEventListener?.bind(win);
const prevRemove = win.removeEventListener?.bind(win);
win.addEventListener = (type, handler) => {
  if (type === "pageshow") listeners.push(handler);
};
win.removeEventListener = (type, handler) => {
  if (type === "pageshow") {
    const idx = listeners.indexOf(handler);
    if (idx >= 0) listeners.splice(idx, 1);
  }
};
let bfcacheFired = false;
const unsub = subscribeBfcacheRestore(() => {
  bfcacheFired = true;
});
for (const handler of listeners) {
  handler({ persisted: false } as PageTransitionEvent);
}
assert(!bfcacheFired, "non-persisted pageshow must not reset");
for (const handler of listeners) {
  handler({ persisted: true } as PageTransitionEvent);
}
assert(bfcacheFired, "persisted pageshow must reset");
unsub();
if (prevAdd) win.addEventListener = prevAdd;
if (prevRemove) win.removeEventListener = prevRemove;

assert(typeof clearGuestTipCheckoutInFlightForStaleRestore === "function");
assert(typeof clearActivationCheckoutInFlightForStaleRestore === "function");

const confirmedPaths: Record<string, string> = {
  ConnectPayoutsPanel: "src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx",
  BillingPlanManagement: "src/app/components/business/settings/billing/BillingPlanManagement.tsx",
  BillingTrialSection: "src/app/components/business/settings/billing/BillingTrialSection.tsx",
  BillingPaymentMethodsPanel: "src/app/components/business/settings/billing/BillingPaymentMethodsPanel.tsx",
  BillingInvoicesPanel: "src/app/components/business/settings/billing/BillingInvoicesPanel.tsx",
  BusinessSettingsBillingPanel: "src/app/components/business/settings/BusinessSettingsBillingPanel.tsx",
  UpgradeCta: "src/app/components/subscription/UpgradeCta.tsx",
  ProUpgradeCard: "src/app/components/subscription/ProUpgradeCard.tsx",
  ActivateCareTipCta: "src/app/components/subscription/ActivateCareTipCta.tsx",
  BusinessOnboardingPage: "src/app/pages/BusinessOnboardingPage.tsx",
  TipAmountPage: "src/app/pages/customer/TipAmountPage.tsx",
  QrStudioOrdersPage: "src/app/pages/business/qr-studio/QrStudioOrdersPage.tsx",
  PhysicalQrOrderDetailPage: "src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx",
  PrintQrStudio: "src/app/components/business/physical-branding/PrintQrStudio.tsx",
  PhysicalBrandingStudio: "src/app/components/business/physical-branding/PhysicalBrandingStudio.tsx",
};

for (const [name, rel] of Object.entries(confirmedPaths)) {
  const src = read(rel);
  assert(src.includes("useStaleExternalStripeStateReset"), `${name} registers stale-state reset`);
}

assert(connectHook.includes("useStaleExternalStripeStateReset"), "Connect busy hook delegates to shared reset");

const guestTip = read("src/app/lib/startGuestTipCheckout.ts");
const activation = read("src/app/lib/activateCareTipCheckout.ts");
assert(guestTip.includes("clearGuestTipCheckoutInFlightForStaleRestore"), "guest tip lock has stale restore export");
assert(activation.includes("clearActivationCheckoutInFlightForStaleRestore"), "activation lock has stale restore export");

const employeeStripeBtn = read("src/app/components/employee/EmployeeViewInStripeButton.tsx");
assert(employeeStripeBtn.includes("finally"), "EmployeeViewInStripeButton unchanged — finally retained");

const detail = read("src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx");
assert(detail.includes("setPaying(false)") && detail.includes("checkoutFlag"), "QR detail clears pay launch on return");

const redirect = read("src/app/lib/externalStripeRedirect.ts");
assert(redirect.includes("beginExternalStripeNavigationHold"), "forward navigation hold unchanged");

console.log("stripe-stale-state-runtime: ok");
