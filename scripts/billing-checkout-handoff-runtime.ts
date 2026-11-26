/**
 * Billing / QR print checkout hand-off regression checks.
 *
 * Behaviour (with a fake `window`): the browser is only sent to Stripe once a valid Stripe Checkout
 * URL exists; invalid or missing URLs never navigate; checkout buttons use the inline hand-off (the
 * CareTip page stays visible, no full-screen overlay); a hand-off that never leaves the page is
 * recovered; navigation that throws is reported.
 * Source (static): no checkout entry point registers the global overlay while the session is
 * being created, and every checkout/portal button uses the inline hand-off.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const assigned: string[] = [];
let assignThrows = false;
const fakeWindow = {
  location: {
    assign(url: string) {
      if (assignThrows) throw new Error("navigation blocked");
      assigned.push(url);
    },
  },
  addEventListener(type: string, fn: Listener) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener(type: string, fn: Listener) {
    listeners.get(type)?.delete(fn);
  },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout),
};
(globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;
const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn());

const { performExternalStripeRedirect, isAllowedStripeRedirectUrl } = await import("../src/app/lib/externalStripeRedirect");
const hold = await import("../src/app/lib/externalStripeNavigationHold");

let failures = 0;
let count = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  count++;
  try {
    hold.resetExternalStripeNavigationHoldForTests();
    assigned.length = 0;
    assignThrows = false;
    listeners.clear();
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const VALID = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fidkdWxOYHwnPyd1blpxYHZxWjA0";

await check("valid Stripe Checkout URL: hand-off starts, browser goes to exactly that URL", () => {
  const r = performExternalStripeRedirect(VALID, "checkout", undefined, { presentation: "inline" });
  assert(r.ok, "should succeed");
  assert(assigned.length === 1 && assigned[0] === VALID, `assigned ${JSON.stringify(assigned)}`);
  assert(hold.isExternalStripeNavigationHoldActive(), "hold active (blocks deploy-update reloads)");
});

await check("inline hand-off keeps the page: the global overlay is not requested", () => {
  performExternalStripeRedirect(VALID, "checkout", undefined, { presentation: "inline" });
  assert(!hold.isExternalStripeNavigationHoldOverlayActive(), "overlay must stay off for inline");
});

await check("default (other Stripe flows) still uses the overlay", () => {
  performExternalStripeRedirect(VALID, "checkout");
  assert(hold.isExternalStripeNavigationHoldOverlayActive(), "overlay on by default");
});

await check("missing URL (session without url): no navigation, caller told", () => {
  for (const u of [undefined, null, "", "   "]) {
    const r = performExternalStripeRedirect(u as string | null | undefined, "checkout", undefined, { presentation: "inline" });
    assert(!r.ok && r.reason === "missing_url", `reason for ${JSON.stringify(u)}`);
  }
  assert(assigned.length === 0, "never navigated");
  assert(!hold.isExternalStripeNavigationHoldActive(), "no hold");
});

await check("invalid or non-Stripe URL: no navigation", () => {
  const bad = [
    "http://checkout.stripe.com/c/pay/cs_test_x",
    "https://checkout.stripe.com.evil.example/c/pay/cs_test_x",
    "https://evil.example/?u=https://checkout.stripe.com",
    "https://billing.stripe.com/p/session/test_x",
    "javascript:alert(1)",
    "/dashboard/billing",
    "not a url",
  ];
  for (const u of bad) {
    const r = performExternalStripeRedirect(u, "checkout", undefined, { presentation: "inline" });
    assert(!r.ok && r.reason === "invalid_url", `accepted ${u}`);
    assert(!isAllowedStripeRedirectUrl(u, "checkout"), `allowlist accepted ${u}`);
  }
  assert(assigned.length === 0, "never navigated");
  assert(!hold.isExternalStripeNavigationHoldActive(), "no hold left behind");
});

await check("browser refuses the navigation (assign throws): reported, hold released", () => {
  assignThrows = true;
  const r = performExternalStripeRedirect(VALID, "checkout", undefined, { presentation: "inline", onStalled: () => {} });
  assert(!r.ok, "must report failure");
  assert(!hold.isExternalStripeNavigationHoldActive(), "hold released");
});

await check("hand-off that never leaves the page: onStalled restores the caller, hold released", async () => {
  let stalled = 0;
  const r = performExternalStripeRedirect(VALID, "checkout", undefined, { presentation: "inline", stallMs: 30, onStalled: () => stalled++ });
  assert(r.ok, "started");
  await new Promise((res) => setTimeout(res, 80));
  assert(stalled === 1, `stalled ${stalled}`);
  assert(!hold.isExternalStripeNavigationHoldActive(), "hold released after stall");
});

await check("page actually leaves (pagehide): no stall callback afterwards", async () => {
  let stalled = 0;
  performExternalStripeRedirect(VALID, "checkout", undefined, { presentation: "inline", stallMs: 30, onStalled: () => stalled++ });
  fire("pagehide");
  await new Promise((res) => setTimeout(res, 80));
  assert(stalled === 0, "stall must be cancelled when the page is left");
});

await check("portal hand-off: only billing.stripe.com", () => {
  assert(performExternalStripeRedirect("https://billing.stripe.com/p/session/test_x", "portal", undefined, { presentation: "inline" }).ok, "portal ok");
  assert(!performExternalStripeRedirect(VALID, "portal", undefined, { presentation: "inline" }).ok, "checkout host refused for portal");
});

// ── source checks ──
/** Full text of each performExternalStripeRedirect(...) call (balanced parentheses). */
function handoffCalls(src: string): string[] {
  const out: string[] = [];
  const needle = "performExternalStripeRedirect(";
  let i = src.indexOf(needle);
  while (i !== -1) {
    let depth = 0;
    let j = i + needle.length - 1;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf(needle, i + needle.length);
  }
  return out;
}
const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const CHECKOUT_ENTRY_POINTS = [
  "src/app/components/business/settings/billing/BillingPlanManagement.tsx",
  "src/app/components/business/settings/billing/BillingTrialSection.tsx",
  "src/app/components/business/settings/billing/BillingInvoicesPanel.tsx",
  "src/app/components/business/settings/billing/BillingPaymentMethodsPanel.tsx",
  "src/app/components/business/settings/BusinessSettingsBillingPanel.tsx",
  "src/app/components/subscription/ProUpgradeCard.tsx",
  "src/app/components/subscription/UpgradeCta.tsx",
  "src/app/lib/activateCareTipCheckout.ts",
  "src/app/components/business/physical-branding/PhysicalBrandingStudio.tsx",
  "src/app/components/business/physical-branding/PrintQrStudio.tsx",
  "src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx",
  "src/app/pages/business/qr-studio/QrStudioOrdersPage.tsx",
];

await check("no checkout entry point covers the page with the global overlay while preparing", () => {
  const offenders = CHECKOUT_ENTRY_POINTS.filter((p) => read(p).includes("useAppLoadingRegistration("));
  const plan = read("src/app/components/subscription/ActivateCareTipCta.tsx");
  if (/"activation-plan-checkout"/.test(plan)) offenders.push("ActivateCareTipCta (activation-plan-checkout)");
  assert(offenders.length === 0, `still registering the overlay: ${offenders.join(", ")}`);
});

await check("every checkout / portal hand-off uses the inline presentation with a stall recovery", () => {
  const missing: string[] = [];
  for (const p of CHECKOUT_ENTRY_POINTS) {
    const src = read(p);
    const calls = handoffCalls(src);
    if (calls.length === 0) missing.push(`${p}: no hand-off call`);
    for (const c of calls) {
      if (!c.includes('presentation: "inline"') || !c.includes("onStalled")) missing.push(`${p}: ${c.slice(0, 70)}…`);
    }
  }
  assert(missing.length === 0, missing.join(" | "));
});

await check("the session is created before navigation; a dialog closes only after a valid URL", () => {
  const cta = read("src/app/components/subscription/UpgradeCta.tsx");
  const create = cta.indexOf("createBillingCheckoutSession(");
  const validate = cta.indexOf("isAllowedStripeRedirectUrl(session.url");
  const close = cta.indexOf("await closeBeforeNavigate()", create);
  assert(create > 0 && validate > create && close > validate, "UpgradeCta order: create → validate → close dialog → hand off");
});

await check("success return does not assume payment: billing return is re-verified from the server", () => {
  const sync = read("src/app/lib/billingCheckoutSuccessSync.ts");
  assert(/fetchBillingSyncStatus|fetchBillingStatus/.test(sync), "billing success sync reads the server state");
  const detail = read("src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx");
  assert(detail.includes('paymentStatus === "PAID"') && !detail.includes("attempts >= 15") && detail.includes("CONFIRM_FAST_ATTEMPTS"), "QR order return keeps polling the server until paid or failed (never gives up and re-shows Pay)");
});

console.log(failures ? `\n${failures} of ${count} failed` : `\nbilling-checkout-handoff: ok (${count} checks)`);
process.exit(failures ? 1 : 0);
