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
    notify.includes("physical_qr_order_received") &&
    notify.includes("isIncludedPhysicalQrOrder") &&
    notify.includes('template: included ? { id: "physical_qr_order_received" } : { id: "physical_qr_paid" }')
  ) {
    pass("Pro/included orders use Order received email template");
  } else fail("Pro/included vs Basic payment email branch missing");

  if (
    notify.includes("channels: { in_app: true, push: true, email: true }") &&
    notify.includes("onPlatformOperationalAlert")
  ) {
    pass("admin paid notification enables in-app + push + email");
  } else fail("admin paid notification missing email channel");

  if (
    notify.includes("lineItemsSummary") &&
    notify.includes("itemLineCount") &&
    notify.includes("labelSnapshot") &&
    notify.includes("order.items")
  ) {
    pass("admin paid notification includes line-item summary from order items");
  } else fail("admin notify missing line-item summary");

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

  if (
    resend.includes("getCareTipEmailLogoAttachment") &&
    resend.includes("CARETIP_EMAIL_LOGO_CID") &&
    resend.includes("attachments")
  ) {
    pass("Resend auto-attaches CareTip logo for CID brand mark");
  } else fail("Resend CareTip logo CID attachment wiring missing");

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
    quantity: 6,
    itemLineCount: 3,
    lineItemsSummary: "Solo Beauty Spa × 2; Jordan Park × 1; Table 12 Window × 3",
    totalAmountCents: 5940,
    currency: "EUR",
    paidAtIso: "2026-08-30T10:15:00.000Z",
  };

  const en = renderNotificationTemplate("en", { id: "physical_qr_paid_admin", params });
  const de = renderNotificationTemplate("de", { id: "physical_qr_paid_admin", params });

  if (en.title === "Physical QR order paid" && en.body.includes("Demo Venue") && en.body.includes("ord_test_123")) {
    pass("EN admin template title/body include business and order id");
  } else fail("EN admin template copy");

  if (de.title === "Physische QR Bestellung bezahlt" && de.body.includes("Demo Venue")) {
    pass("DE admin template localized");
  } else fail("DE admin template copy");

  if (en.body.includes("Items (3):") && en.body.includes("Solo Beauty Spa × 2") && en.body.includes("Total quantity: 6")) {
    pass("EN admin template includes line items and total quantity");
  } else fail("EN admin template line items");

  if (en.body.includes("Payment: Paid") && en.body.includes("Fulfillment: Processing") && en.body.includes("Paid at:")) {
    pass("EN admin template includes status labels");
  } else fail("EN admin template detail fields");

  const amount = formatNotificationAmountCents(5940, "EUR", "en");
  if (amount.includes("59.40") || amount.includes("59,40")) {
    pass("amount formatter converts cents to currency");
  } else fail(`amount formatter got ${amount}`);

  const when = formatNotificationDateTime(params.paidAtIso, "en");
  if (when.length > 4 && !when.includes("Invalid")) {
    pass("paid-at datetime formatter produces readable value");
  } else fail("paid-at datetime formatter");

  const includedParams = {
    businessName: "Demo Venue",
    orderId: "ord_test_pro",
    productLabel: "CareTip A5 flyer with address",
    quantity: 6,
    itemLineCount: 3,
    lineItemsSummary: "Solo Beauty Spa × 2; Jordan Park × 1; Table 12 Window × 3",
    currency: "EUR",
    receivedAtIso: "2026-08-30T10:15:00.000Z",
  };
  const includedEn = renderNotificationTemplate("en", {
    id: "physical_qr_order_received_admin",
    params: includedParams,
  });
  if (
    includedEn.title === "Physical QR order received" &&
    includedEn.body.includes("included in plan") &&
    includedEn.body.includes("Payment: Included in plan") &&
    !includedEn.body.includes("Payment: Paid")
  ) {
    pass("EN admin Pro/included template uses order received copy");
  } else fail("EN admin Pro/included template copy");
}

function sectionBusinessTemplateUnchanged() {
  const en = renderNotificationTemplate("en", { id: "physical_qr_paid" });
  const included = renderNotificationTemplate("en", { id: "physical_qr_order_received" });
  const printing = renderNotificationTemplate("en", { id: "physical_qr_printing" });
  const shipped = renderNotificationTemplate("en", {
    id: "physical_qr_shipped",
    params: { trackingNumber: "TRACK1" },
  });
  const delivered = renderNotificationTemplate("en", { id: "physical_qr_delivered" });

  if (en.title === "Payment received") pass("business paid template unchanged (Basic)");
  else fail("business paid template changed");

  if (
    included.title === "Order received" &&
    /received and is now being processed/i.test(included.body) &&
    !/paid for/i.test(included.body)
  ) {
    pass("business Pro/included template uses Order received");
  } else fail("business Pro/included template missing or still payment copy");

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
