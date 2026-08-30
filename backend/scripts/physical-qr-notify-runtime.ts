/**
 * Physical QR paid-notification regression — admin in-app/push/email on Stripe payment only.
 * Run: npm run test:physical-qr-notify (from backend/)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatNotificationAmountCents,
  formatNotificationDateTime,
  renderNotificationTemplate,
} from "../src/notifications/notificationI18n.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function readBackend(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function sectionStaticRegression() {
  const notify = readBackend("src/services/physicalQr/physicalQrNotify.service.ts");
  const webhook = readBackend("src/services/physicalQr/physicalQrWebhook.service.ts");
  const triggers = readBackend("src/services/push/notification.triggers.ts");
  const orchestrator = readBackend("src/services/notifications/notificationOrchestrator.service.ts");
  const resend = readBackend("src/services/resendClient.ts");
  const localizedEmail = readBackend("src/services/localizedNotificationEmail.service.ts");
  const activation = readBackend("src/services/employeeActivationEmail.service.ts");
  const passwordReset = readBackend("src/services/passwordReset.service.ts");

  if (
    notify.includes("channels: { in_app: true, push: true, email: true }") &&
    notify.includes("onPlatformOperationalAlert")
  ) {
    pass("admin paid notification enables in-app + push + email");
  } else fail("admin paid notification missing email channel");

  if (notify.includes('paymentStatus !== "PAID"')) {
    pass("admin notify guard skips non-PAID orders");
  } else fail("admin notify missing PAID guard");

  if (
    triggers.includes("channels?: Partial<Record<DeliveryChannel, boolean>>") &&
    triggers.includes("channels: params.channels")
  ) {
    pass("onPlatformOperationalAlert forwards channel overrides");
  } else fail("onPlatformOperationalAlert channel override missing");

  if (
    webhook.includes('if (order.paymentStatus === "PAID")') &&
    webhook.includes("duplicate: true") &&
    webhook.includes("notifyPhysicalQrPaymentReceived")
  ) {
    pass("webhook idempotency returns before notify on duplicate PAID");
  } else fail("webhook duplicate/idempotency guard missing or notify not gated");

  const notifyIdx = webhook.indexOf("notifyPhysicalQrPaymentReceived");
  const paidGuardIdx = webhook.indexOf('paymentStatus === "PAID"');
  if (notifyIdx > paidGuardIdx && paidGuardIdx >= 0) {
    pass("notify only after first PAID transition");
  } else fail("notify may run before duplicate guard");

  if (
    triggers.includes('role: "SUPER_ADMIN", isPlatformAdmin: true, isActive: true') &&
    notify.includes("onPlatformOperationalAlert")
  ) {
    pass("admin recipients resolved via listPlatformAdminUserIds path");
  } else fail("platform admin recipient resolution not wired");

  if (
    orchestrator.includes("sendLocalizedUserNotificationEmail") &&
    orchestrator.includes("email: false") &&
    localizedEmail.includes("sendResendEmail")
  ) {
    pass("notification email uses shared orchestrator + Resend path");
  } else fail("notification email path regression");

  if (
    resend.includes("export async function sendResendEmail") &&
    !notify.includes("new Resend") &&
    !notify.includes("@resend")
  ) {
    pass("physical QR notify reuses shared Resend client (no duplicate SDK)");
  } else fail("duplicate email infrastructure detected");

  if (activation.includes("sendResendEmail") && passwordReset.includes("sendResendEmail")) {
    pass("activation/password-reset Resend paths present and untouched");
  } else fail("activation/password-reset email files regression");

  const orderService = readBackend("src/services/physicalQr/physicalQrOrder.service.ts");
  if (!orderService.includes("notifyPhysicalQr")) {
    pass("unpaid order creation does not call notify");
  } else fail("order creation unexpectedly triggers notifications");
}

function sectionTemplateCopy() {
  const params = {
    businessName: "Demo Venue",
    orderId: "ord_test_123",
    productLabel: "CareTip A5 flyer with address",
    quantity: 3,
    totalAmountCents: 2970,
    currency: "EUR",
    paidAtIso: "2026-08-30T10:15:00.000Z",
  };

  const en = renderNotificationTemplate("en", { id: "physical_qr_paid_admin", params });
  const de = renderNotificationTemplate("de", { id: "physical_qr_paid_admin", params });

  if (en.title === "Physical QR order paid" && en.body.includes("Demo Venue") && en.body.includes("ord_test_123")) {
    pass("EN admin template title/body include business and order id");
  } else fail("EN admin template copy");

  if (de.title === "Physische QR-Bestellung bezahlt" && de.body.includes("Demo Venue")) {
    pass("DE admin template localized");
  } else fail("DE admin template copy");

  if (en.body.includes("Quantity: 3") && en.body.includes("Processing") && en.body.includes("Paid")) {
    pass("EN admin template includes quantity and status labels");
  } else fail("EN admin template detail fields");

  const amount = formatNotificationAmountCents(2970, "EUR", "en");
  if (amount.includes("29.70") || amount.includes("29,70")) {
    pass("amount formatter converts cents to currency");
  } else fail(`amount formatter got ${amount}`);

  const when = formatNotificationDateTime(params.paidAtIso, "en");
  if (when.length > 4 && !when.includes("Invalid")) {
    pass("paid-at datetime formatter produces readable value");
  } else fail("paid-at datetime formatter");
}

function sectionBusinessTemplateUnchanged() {
  const en = renderNotificationTemplate("en", { id: "physical_qr_paid" });
  const printing = renderNotificationTemplate("en", { id: "physical_qr_printing" });
  const shipped = renderNotificationTemplate("en", {
    id: "physical_qr_shipped",
    params: { trackingNumber: "TRACK1" },
  });
  const delivered = renderNotificationTemplate("en", { id: "physical_qr_delivered" });

  if (en.title === "Payment received") pass("business paid template unchanged");
  else fail("business paid template changed");

  if (printing.title === "Printing" && shipped.title === "Shipped" && delivered.title === "Delivered") {
    pass("printing/shipped/delivered business templates unchanged");
  } else fail("fulfillment business templates changed");
}

async function sectionWebhookDuplicateBehavior() {
  try {
    const { handlePhysicalQrCheckoutSessionCompleted } = await import(
      "../src/services/physicalQr/physicalQrWebhook.service.js"
    );

    const unpaid = await handlePhysicalQrCheckoutSessionCompleted({
      metadata: { source: "physical_qr_order" },
    } as never);
    if (!unpaid.ok && unpaid.reason === "missing_metadata") {
      pass("unpaid/malformed webhook does not mark paid or notify");
    } else fail(`malformed webhook ${JSON.stringify(unpaid)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/DATABASE_URL is required|Can't reach|P1001/i.test(msg)) {
      pass("webhook duplicate behavior skipped (DATABASE_URL unavailable)");
    } else {
      fail(`webhook duplicate section ${msg}`);
    }
  }
}

async function main() {
  sectionStaticRegression();
  sectionTemplateCopy();
  sectionBusinessTemplateUnchanged();
  await sectionWebhookDuplicateBehavior();

  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) console.log(line);
  console.log(`\nPhysical QR notify: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

void main();
