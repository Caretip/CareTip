/**
 * Phase 10 Stripe checkout-session ownership (STRIPE-S01 / AUTHZ-S01).
 * Run: npm run test:phase-10-stripe-session
 */
import { checkoutSessionBoundToBusiness } from "../src/lib/subscription/checkoutSessionOwnership.js";

type CaseResult = { id: string; pass: boolean; detail: string };
const results: CaseResult[] = [];
const pass = (id: string, detail: string) => results.push({ id, pass: true, detail });
const fail = (id: string, detail: string) => results.push({ id, pass: false, detail });

const bizA = "biz_aaaaaaaaaaaaaaaaaaaaaaaa";
const bizB = "biz_bbbbbbbbbbbbbbbbbbbbbbbb";

function run() {
  if (
    checkoutSessionBoundToBusiness(
      { metadata: { caretipBusinessId: bizA, caretipPlanKey: "premium" } },
      bizA,
    )
  ) {
    pass("own-session-accepted", "Matching caretipBusinessId binds session to caller");
  } else {
    fail("own-session-accepted", "Own session rejected");
  }

  if (
    !checkoutSessionBoundToBusiness(
      { metadata: { caretipBusinessId: bizB } },
      bizA,
    )
  ) {
    pass("foreign-session-rejected", "Business A cannot bind Business B session metadata");
  } else {
    fail("foreign-session-rejected", "Foreign session accepted");
  }

  if (!checkoutSessionBoundToBusiness({ metadata: {} }, bizA)) {
    pass("missing-metadata-rejected", "Empty metadata fail-closed (historical STRIPE-S01)");
  } else {
    fail("missing-metadata-rejected", "Missing metadata still bindable");
  }

  if (!checkoutSessionBoundToBusiness({ metadata: null }, bizA)) {
    pass("null-metadata-rejected", "Null metadata fail-closed");
  } else {
    fail("null-metadata-rejected", "Null metadata accepted");
  }

  if (
    !checkoutSessionBoundToBusiness(
      { metadata: { source: "physical_qr_order", businessId: bizA, orderId: "ord_1" } },
      bizA,
    )
  ) {
    pass(
      "physical-qr-metadata-not-billing",
      "Physical QR metadata keys are not billing ownership (cannot attach subscription via QR session)",
    );
  } else {
    fail("physical-qr-metadata-not-billing", "QR session treated as billing bind");
  }

  if (!checkoutSessionBoundToBusiness({ metadata: { caretipBusinessId: bizA } }, "  ")) {
    pass("empty-caller-rejected", "Empty caller businessId cannot bind");
  } else {
    fail("empty-caller-rejected", "Empty caller accepted");
  }
}

run();
console.log("=== Phase 10 Stripe session ownership ===\n");
for (const r of results) {
  console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
}
const failures = results.filter((r) => !r.pass);
console.log(`\nSummary: ${results.length} tests, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
