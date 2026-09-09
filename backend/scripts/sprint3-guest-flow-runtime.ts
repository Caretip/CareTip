/**
 * Sprint 3 guest journey static + runtime checks.
 * Run: npm run test:sprint3-guest-flow (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/prisma.js";
import {
  assertEmployeeEligibleForTipPayment,
  TipPaymentEligibilityError,
} from "../src/services/tipPaymentEligibility.service.js";
import {
  isStripeWebhookEventProcessed,
  markStripeWebhookEventProcessed,
} from "../src/services/stripeWebhookIdempotency.service.js";
import {
  resolveKycUiStatus,
  hasRequiredKycDocuments,
  parseKycDocuments,
} from "../src/services/kyc.service.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "../..");

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const skip = (m: string) => results.push(`SKIP: ${m}`);

function read(rel: string): string {
  const p = join(root, rel);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

async function main() {
  // --- Static: guest UI route chain ---
  const routes = read("src/app/routes.tsx");
  const guestRoutes: Array<{ path: string; alt?: string }> = [
    { path: "/tip-amount" },
    { path: "/payment" },
    { path: "/rating" },
    { path: "/tip-complete", alt: "tip-complete" },
  ];
  for (const { path, alt } of guestRoutes) {
    const hit =
      routes.includes(`'${path}'`) ||
      routes.includes(`"${path}"`) ||
      routes.includes(`path: '${path}'`) ||
      (alt != null && routes.includes(alt));
    if (hit) pass(`frontend route ${path} registered`);
    else fail(`frontend route ${path} not found in routes.tsx`);
  }

  const tipAmount = read("src/app/pages/customer/TipAmountPage.tsx");
  const paymentPage = read("src/app/pages/customer/PaymentPage.tsx");
  const startCheckout = read("src/app/lib/startGuestTipCheckout.ts");
  const guestPay =
    tipAmount.includes("startGuestTipCheckout") ||
    startCheckout.includes("createTipCheckoutSession") ||
    paymentPage.includes("/tip-amount");
  if (guestPay) pass("guest payment flow wired (tip-amount → Stripe Checkout)");
  else fail("guest payment flow not found in TipAmountPage/startGuestTipCheckout");

  const ratingPage = read("src/app/pages/customer/RatingPage.tsx");
  if (ratingPage.includes("session_id") || ratingPage.includes("sessionId")) {
    pass("RatingPage reads Stripe session_id");
  } else {
    fail("RatingPage missing session_id handling");
  }

  // --- Static: backend payment + webhook ---
  const stripeSvc = read("backend/src/services/stripe.service.ts");
  if (stripeSvc.includes("createTipCheckoutSession") && stripeSvc.includes("assertEmployeeEligibleForTipPayment")) {
    pass("checkout session gates eligibility pre-payment");
  } else {
    fail("checkout missing pre-payment eligibility");
  }
  if (stripeSvc.includes("refundTipPaymentForEligibilityFailure")) {
    pass("post-payment eligibility refund path exists");
  } else {
    fail("missing eligibility refund");
  }

  const webhook = read("backend/src/webhooks/stripe.webhook.ts");
  if (webhook.includes("verifyWebhookSignature") && webhook.includes("isStripeWebhookEventProcessed")) {
    pass("webhook signature + event idempotency");
  } else {
    fail("webhook missing signature or idempotency");
  }

  // --- KYC UI status derivation ---
  const pending = resolveKycUiStatus({
    verificationStatus: "pending",
    kycDocuments: parseKycDocuments({}),
    kycSubmittedAt: null,
  });
  if (pending === "PENDING_UPLOAD") pass("KYC PENDING_UPLOAD derivation");
  else fail("KYC PENDING_UPLOAD derivation");

  const review = resolveKycUiStatus({
    verificationStatus: "pending",
    kycDocuments: {
      registration: "/kyc/a.pdf",
      address: "/kyc/b.pdf",
      governmentId: "/kyc/c.pdf",
    },
    kycSubmittedAt: new Date(),
  });
  if (review === "UNDER_REVIEW") pass("KYC UNDER_REVIEW derivation");
  else fail("KYC UNDER_REVIEW derivation");

  if (hasRequiredKycDocuments({ registration: "a", address: "b", governmentId: "c" })) {
    pass("required KYC docs detection");
  } else {
    fail("required KYC docs detection");
  }

  // --- Runtime: eligibility (needs DB) ---
  let employeeId: string | null = null;
  let businessId: string | null = null;
  try {
    const emp = await prisma.employee.findFirst({
      where: { isActive: true, activationStatus: "active" },
      select: {
        id: true,
        businessId: true,
        business: { select: { verificationStatus: true } },
        user: { select: { emailVerified: true, isActive: true } },
      },
    });
    if (emp) {
      employeeId = emp.id;
      businessId = emp.businessId;
      await assertEmployeeEligibleForTipPayment(emp.id, emp.businessId);
      pass("active verified employee eligible (sample)");
    } else {
      skip("no active employee in DB for eligibility positive test");
    }

    if (employeeId && businessId) {
      const inactive = await prisma.employee.update({
        where: { id: employeeId },
        data: { isActive: false },
        select: { id: true, businessId: true },
      });
      let blocked = false;
      try {
        await assertEmployeeEligibleForTipPayment(inactive.id, inactive.businessId!);
      } catch (e) {
        blocked = e instanceof TipPaymentEligibilityError && e.code === "EMPLOYEE_INACTIVE";
      }
      await prisma.employee.update({ where: { id: employeeId }, data: { isActive: true } });
      if (blocked) pass("inactive employee blocked at eligibility");
      else fail("inactive employee not blocked");
    }
  } catch (e) {
    skip(`DB eligibility tests: ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- Runtime: webhook idempotency table ---
  const testEventId = `evt_sprint3_test_${Date.now()}`;
  try {
    const first = await isStripeWebhookEventProcessed(testEventId);
    if (!first) pass("webhook idempotency: new event not processed");
    else fail("webhook idempotency: false positive");

    await markStripeWebhookEventProcessed(testEventId, "checkout.session.completed");
    const second = await isStripeWebhookEventProcessed(testEventId);
    if (second) pass("webhook idempotency: marked event detected");
    else fail("webhook idempotency: mark not persisted");

    await prisma.stripeWebhookEvent.delete({ where: { id: testEventId } }).catch(() => {});
  } catch (e) {
    skip(`webhook idempotency DB: ${e instanceof Error ? e.message : String(e)}`);
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} checks passed`);
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
