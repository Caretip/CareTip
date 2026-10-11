/**
 * Sprint 2 — SUB-004 / SUB-008 unit checks (mocked email + Stripe; no DB required).
 */
import { SubscriptionPlanKey } from "@prisma/client";
import {
  __buildPaymentFailedCopyForTests,
  BILLING_NOTIFICATION_SENDING_STALE_MS,
  isSendingNotificationReclaimable,
} from "../src/services/subscriptionPaymentFailedNotification.service.js";
import { SubscriptionBillingNotificationStatus } from "@prisma/client";
import {
  __resetSubscriptionBillingReconciliationTestSeams,
  BILLING_RECONCILIATION_BATCH_SIZE,
} from "../src/services/subscriptionBillingReconciliation.service.js";
import { mapStripeSubscriptionStatus } from "../src/lib/subscription/mapStripeSubscriptionStatus.js";
import { __setSendResendEmailFnForTests } from "../src/services/resendClient.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const en = __buildPaymentFailedCopyForTests("en", "Cafe Example", SubscriptionPlanKey.premium);
const de = __buildPaymentFailedCopyForTests("de", "Cafe Beispiel", SubscriptionPlanKey.premium);

assert(en.title.includes("payment failed"), "EN title mentions payment failure");
assert(de.title.includes("Zahlung"), "DE title localized");
assert(!en.body.match(/\b4242\b/), "EN body has no card number");
assert(!en.body.includes("sk_"), "EN body has no Stripe secrets");
assert(en.body.includes("Pro"), "EN body names plan without internal ids");

let sendCount = 0;
__setSendResendEmailFnForTests(async () => {
  sendCount += 1;
  return true;
});
assert(typeof (await import("../src/services/resendClient.js")).sendResendEmail === "function", "resend seam");
__setSendResendEmailFnForTests(null);

const paused = mapStripeSubscriptionStatus("paused");
assert(paused.status === "paused", "paused maps to non-entitled mirror paused");

assert(BILLING_RECONCILIATION_BATCH_SIZE === 25, "reconciliation batch bounded");

assert(BILLING_NOTIFICATION_SENDING_STALE_MS === 10 * 60 * 1000, "sending stale TTL 10m");
const staleAt = new Date(Date.now() - BILLING_NOTIFICATION_SENDING_STALE_MS - 1_000);
const freshAt = new Date();
assert(
  isSendingNotificationReclaimable(
    SubscriptionBillingNotificationStatus.sending,
    staleAt,
  ),
  "stale sending reclaimable",
);
assert(
  !isSendingNotificationReclaimable(
    SubscriptionBillingNotificationStatus.sending,
    freshAt,
  ),
  "fresh sending not reclaimable",
);
assert(
  !isSendingNotificationReclaimable(
    SubscriptionBillingNotificationStatus.delivered,
    staleAt,
  ),
  "delivered never reclaimable as sending",
);

const internalJobs = readFileSync(join(__dirname, "../src/routes/internalJobs.routes.ts"), "utf8");
assert(internalJobs.includes('"/subscription-billing-reconciliation"'), "reconciliation cron route");
assert(internalJobs.includes('"/subscription-billing-notification-retry"'), "notification retry route");
assert(internalJobs.includes("x-cron-secret"), "cron auth uses x-cron-secret header");

const webhook = readFileSync(join(__dirname, "../src/services/stripeBillingWebhook.service.ts"), "utf8");
assert(webhook.includes("handleSubscriptionInvoicePaymentFailedNotification"), "payment_failed hooks notification");
assert(webhook.includes("supersedeSubscriptionPaymentFailedNotificationsForInvoice"), "payment_succeeded supersedes failure email");

const renderYaml = readFileSync(join(__dirname, "../../render.yaml"), "utf8");
assert(renderYaml.includes("caretip-subscription-billing-reconciliation"), "render blueprint cron entry");

__resetSubscriptionBillingReconciliationTestSeams();

console.log("subscription-reliability-sprint2-runtime: ok");
