/**
 * Frontend: QR held-order states and the platform-admin release workflow.
 *
 *   node ./backend/node_modules/tsx/dist/cli.mjs ./scripts/physical-qr-hold-ui-runtime.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPhysicalQrFulfillable, physicalQrFulfillmentHoldKey, physicalQrPaymentLabel } from "../src/app/lib/physicalQrOrderUi";

let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`PASS: ${name}`);
}

check("only PAID, or a released PARTIALLY_REFUNDED order, is fulfillable", () => {
  assert.equal(isPhysicalQrFulfillable("PAID"), true);
  for (const s of ["PENDING", "FAILED", "CANCELLED", "IN_REVIEW", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"]) {
    assert.equal(isPhysicalQrFulfillable(s), false, s);
  }
  assert.equal(isPhysicalQrFulfillable("PARTIALLY_REFUNDED", "2026-11-12T10:00:00.000Z"), true);
  assert.equal(isPhysicalQrFulfillable("REFUNDED", "2026-11-12T10:00:00.000Z"), false, "a release never applies to REFUNDED");
  assert.equal(isPhysicalQrFulfillable("DISPUTED", "2026-11-12T10:00:00.000Z"), false);
});

check("held states show a hold reason; a released partial refund does not", () => {
  assert.equal(physicalQrFulfillmentHoldKey("IN_REVIEW"), "admin.physicalQr.holdInReview");
  assert.equal(physicalQrFulfillmentHoldKey("PARTIALLY_REFUNDED"), "admin.physicalQr.holdPartiallyRefunded");
  assert.equal(physicalQrFulfillmentHoldKey("PARTIALLY_REFUNDED", "2026-11-12T10:00:00.000Z"), null);
  assert.equal(physicalQrFulfillmentHoldKey("PAID"), null);
});

check("every held status has a payment label in English and German", () => {
  for (const lng of ["en", "de"]) {
    const j = JSON.parse(readFileSync(`src/i18n/locales/${lng}.json`, "utf8"));
    const orders = j.business.qrStudio.physical.orders;
    const admin = j.admin.physicalQr;
    for (const k of ["paymentInReview", "paymentPartiallyRefunded", "paymentRefunded", "paymentDisputed"]) assert.ok(orders[k], `${lng} ${k}`);
    for (const k of ["releaseTitle", "releaseReasonLabel", "releaseConfirm", "releaseDone", "holdNotReleasableRefunded", "holdNotReleasableDisputed", "holdReleasedNotice", "resolutionHistory"]) {
      assert.ok(admin[k], `${lng} admin.${k}`);
    }
    assert.equal(admin.holdResolutionMissing, undefined, `${lng}: stale "not available yet" text removed`);
  }
  const t = ((key: string) => key) as never;
  assert.equal(physicalQrPaymentLabel("IN_REVIEW", t), "business.qrStudio.physical.orders.paymentInReview");
});

check("admin page: release needs a reason, a confirmation step, and sends the status the admin saw", () => {
  const page = readFileSync("src/app/pages/platform/PlatformPhysicalQrOrderDetailPage.tsx", "utf8");
  assert.ok(page.includes("releasePlatformPhysicalQrHold(order.id"));
  assert.ok(page.includes("expectedPaymentStatus: order.paymentStatus"));
  assert.ok(page.includes("reasonLength >= 10"));
  assert.ok(page.includes("releaseConfirming ?"), "two-step confirmation");
  assert.ok(page.includes(`order.paymentStatus === "IN_REVIEW" || (order.paymentStatus === "PARTIALLY_REFUNDED" && !order.holdReleasedAt)`));
  assert.ok(page.includes("isPhysicalQrFulfillable(order.paymentStatus, order.holdReleasedAt)"));
  assert.ok(!/order\.paymentStatus === "PAID" \?/.test(page), "print buttons use the shared rule, not PAID alone");
  assert.ok(page.includes("{fulfillable && order.fulfillmentStatus === \"PROCESSING\""), "printing action hidden while held");
});

check("no tenant (business/employee) page or API helper can release a hold", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|ts)$/.test(f)) files.push(p);
    }
  };
  walk("src/app");
  const users = files.filter((f) => readFileSync(f, "utf8").includes("releasePlatformPhysicalQrHold"));
  for (const f of users) {
    const norm = f.split("\\").join("/");
    assert.ok(norm.endsWith("src/app/lib/api.ts") || norm.includes("src/app/pages/platform/"), `release used outside platform admin: ${norm}`);
  }
  const api = readFileSync("src/app/lib/api.ts", "utf8");
  assert.ok(api.includes("/api/platform/physical-qr/orders/${encodeURIComponent(orderId)}/release-hold"), "platform route only");
});

console.log(`\nphysical-qr-hold-ui: ok (${checks} checks)`);
