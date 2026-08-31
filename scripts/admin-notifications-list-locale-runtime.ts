/**
 * Regression: incomplete localeTemplate must not abort inbox list localization.
 * Run: npx tsx scripts/admin-notifications-list-locale-runtime.ts
 *
 * Avoids importing notificationInbox.service (pulls Prisma / DATABASE_URL).
 */
import assert from "node:assert/strict";
import {
  localizeNotificationPayload,
  renderNotificationTemplate,
} from "../backend/src/notifications/notificationI18n.ts";
import { inferNotificationTemplate } from "../backend/src/notifications/notificationTemplateInfer.ts";

function main() {
  // 1) Broken physical_qr_paid_admin params must not throw via public localize helper
  const broken = localizeNotificationPayload("en", {
    title: "Physical QR order paid",
    body: "A business paid for a physical QR order.",
    localeTemplate: { id: "physical_qr_paid_admin" } as never,
  });
  assert.equal(broken.title, "Physical QR order paid");
  assert.match(broken.body, /paid/i);

  // 2) render with missing params should not throw after hardening
  assert.doesNotThrow(() =>
    renderNotificationTemplate("en", { id: "physical_qr_paid_admin" } as never),
  );

  // 3) Infer must not return id-only templates (those used to crash list mapping)
  const inferred = inferNotificationTemplate({
    type: "system_alert",
    title: "Physical QR order paid",
    message: "A business paid for a physical QR order.",
    metadata: { templateId: "physical_qr_paid_admin" },
  });
  assert.equal(inferred, undefined);

  // 4) Complete template still localizes
  const ok = localizeNotificationPayload("en", {
    title: "Physical QR order paid",
    body: "fallback",
    localeTemplate: {
      id: "physical_qr_paid_admin",
      params: {
        businessName: "Cafe Test",
        orderId: "ord_1",
        productLabel: "A5",
        quantity: 2,
        itemLineCount: 1,
        lineItemsSummary: "A5 × 2",
        totalAmountCents: 1999,
        currency: "EUR",
        paidAtIso: "2026-08-31T12:00:00.000Z",
      },
    },
  });
  assert.match(ok.title, /Physical QR/i);
  assert.match(ok.body, /Cafe Test/);
  assert.match(ok.body, /ord_1/);

  // 5) Simulate pre-fix crash shape: accessing params on id-only cast
  let preFixWouldThrow = false;
  try {
    const bad = { id: "physical_qr_paid_admin" } as {
      id: string;
      params?: { lineItemsSummary: string };
    };
    void bad.params!.lineItemsSummary.trim();
  } catch {
    preFixWouldThrow = true;
  }
  assert.equal(preFixWouldThrow, true);

  console.log("admin-notifications-list-locale-runtime: OK");
}

main();
