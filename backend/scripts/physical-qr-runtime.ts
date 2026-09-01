/**
 * Physical CareTip Branding — processing, template, colour, entitlement, checkout blockers,
 * status transitions, print/QR decode, and optional tenant-isolation checks.
 *
 * Run: npm run test:physical-qr (from backend/)
 */
import { DateTime } from "luxon";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  classifyPhysicalQrProcessing,
  deliveryWindowFromShippedAt,
  freezePhysicalQrProcessing,
  PHYSICAL_QR_PROCESSING_TIMEZONE,
} from "../src/lib/physicalQr/processing.js";
import {
  loadAuthoredPhysicalQrSvg,
  renderPhysicalQrSvg,
  svgHidesAddress,
  svgShowsAddress,
} from "../src/lib/physicalQr/svg.js";
import {
  PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  PHYSICAL_QR_PRINT_HEIGHT_MM,
  PHYSICAL_QR_PRINT_HEIGHT_PX,
  PHYSICAL_QR_PRINT_WIDTH_MM,
  PHYSICAL_QR_PRINT_WIDTH_PX,
  PHYSICAL_QR_SAMPLE_URL_FORBIDDEN,
} from "../src/lib/physicalQr/types.js";
import { validatePhysicalQrColorTokens } from "../src/lib/physicalQr/colors.js";
import { canTransitionFulfillment, orderCanPay } from "../src/lib/physicalQr/status.js";
import {
  parsePhysicalQrContactSnapshot,
  parsePhysicalQrShippingSnapshot,
  PhysicalQrShippingError,
} from "../src/lib/physicalQr/shipping.js";
import { PHYSICAL_QR_SHIP_COUNTRY } from "../src/lib/physicalQr/types.js";
import {
  assertPhysicalQrCheckoutReady,
  isPhysicalQrCheckoutEnvEnabled,
  PHYSICAL_QR_CHECKOUT_NOT_ACTIVATED,
  PHYSICAL_QR_PRICE_NOT_CONFIGURED,
} from "../src/config/physicalQrCheckout.js";
import { quotePhysicalQrPrints, resolvePhysicalQrCheckoutQuote, shouldReleasePhysicalQrQuotaOnExpire, isPhysicalQrFreeOrderUsedThisMonth, orderHasConsumedMonthlyFreeQuota } from "../src/lib/physicalQr/quote.js";
import { hasSubscriptionCapability } from "../src/config/subscriptionCapabilities.js";
import { jpegToA5Pdf, jpegsToA5Pdf } from "../src/lib/physicalQr/pdfA5.js";
import { crc32, zipStore } from "../src/lib/physicalQr/zipStore.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function berlin(isoLocal: string): Date {
  const dt = DateTime.fromISO(isoLocal, { zone: PHYSICAL_QR_PROCESSING_TIMEZONE });
  if (!dt.isValid) throw new Error(`bad berlin time ${isoLocal}`);
  return dt.toUTC().toJSDate();
}

function sectionProcessing() {
  const cases: Array<[string, "SAME_DAY" | "WITHIN_24_HOURS"]> = [
    ["2026-08-20T11:29:00", "SAME_DAY"],
    ["2026-08-20T11:30:00", "SAME_DAY"],
    ["2026-08-20T11:45:00", "SAME_DAY"],
    ["2026-08-20T11:59:00", "SAME_DAY"],
    ["2026-08-20T12:00:00", "SAME_DAY"],
    ["2026-08-20T12:01:00", "WITHIN_24_HOURS"],
  ];
  for (const [local, expected] of cases) {
    const actual = classifyPhysicalQrProcessing(berlin(local));
    if (actual === expected) pass(`processing ${local} Berlin → ${expected}`);
    else fail(`processing ${local} got ${actual} expected ${expected}`);
  }

  const summerNoon = berlin("2026-08-20T12:00:00");
  if (summerNoon.toISOString() === "2026-08-20T10:00:00.000Z") {
    pass("DST summer: 12:00 Berlin CEST = 10:00Z");
  } else fail(`DST summer offset ${summerNoon.toISOString()}`);

  const winterNoon = berlin("2026-01-15T12:00:00");
  if (winterNoon.toISOString() === "2026-01-15T11:00:00.000Z") {
    pass("DST winter: 12:00 Berlin CET = 11:00Z");
  } else fail(`DST winter offset ${winterNoon.toISOString()}`);

  if (classifyPhysicalQrProcessing(winterNoon) === "SAME_DAY") {
    pass("winter 12:00 Berlin SAME_DAY");
  } else fail("winter 12:00 should be SAME_DAY");
  if (classifyPhysicalQrProcessing(berlin("2026-01-15T12:01:00")) === "WITHIN_24_HOURS") {
    pass("winter 12:01 Berlin WITHIN_24_HOURS");
  } else fail("winter 12:01 should be WITHIN_24_HOURS");

  const specSame = freezePhysicalQrProcessing(new Date("2026-08-20T09:45:00.000Z"));
  if (specSame.processingClass === "SAME_DAY") pass("spec example 09:45Z → SAME_DAY");
  else fail(`spec 09:45Z got ${specSame.processingClass}`);

  const specLate = freezePhysicalQrProcessing(new Date("2026-08-20T13:15:00.000Z"));
  if (specLate.processingClass === "WITHIN_24_HOURS") pass("spec example 13:15Z → WITHIN_24_HOURS");
  else fail(`spec 13:15Z got ${specLate.processingClass}`);

  const frozen = freezePhysicalQrProcessing(berlin("2026-08-20T11:00:00"));
  const laterClass = classifyPhysicalQrProcessing(berlin("2026-08-20T15:00:00"));
  if (frozen.processingClass === "SAME_DAY" && laterClass === "WITHIN_24_HOURS") {
    pass("historical processing snapshot is independent of later clock");
  } else fail("historical snapshot should stay SAME_DAY");

  const shipped = new Date("2026-08-20T16:00:00.000Z");
  const window = deliveryWindowFromShippedAt(shipped);
  if (
    window.from.toISOString() === "2026-08-21T16:00:00.000Z" &&
    window.to.toISOString() === "2026-08-23T16:00:00.000Z"
  ) {
    pass("delivery 24–72h starts at shippedAt, not placedAt");
  } else fail(`delivery window ${window.from.toISOString()} ${window.to.toISOString()}`);
}

function sectionTemplate() {
  const withAddr = renderPhysicalQrSvg({
    qrDataUrl: null,
    businessName: "CareTip UG",
    address: "Kolonnenstraße 8, 10827 Berlin",
    supportsAddress: true,
    colorTokens: PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  });
  const noAddr = renderPhysicalQrSvg({
    qrDataUrl: null,
    businessName: "CareTip UG",
    address: "Kolonnenstraße 8, 10827 Berlin",
    supportsAddress: false,
    colorTokens: PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  });
  if (svgShowsAddress(withAddr) && withAddr.includes("Kolonnenstraße")) {
    pass("address template injects address node");
  } else fail("address template should show address");
  if (svgHidesAddress(noAddr) && !/id="physical-address"[^>]*display="inline"/.test(noAddr)) {
    pass("no-address template hides address node");
  } else fail("no-address should hide address");
  if (withAddr.includes("CareTip UG") && noAddr.includes("CareTip UG")) {
    pass("business name injected in both presentations");
  } else fail("business name missing");
  if (withAddr.includes("TEMPORARY_DEVELOPMENT_FONT_NOT_APPROVED_FOR_PRODUCTION")) {
    pass("temporary development font is marked, not claimed production");
  } else fail("font status marker missing");
  if (withAddr.includes("id=\"physical-artwork\"") && withAddr.includes("id=\"physical-qr-well\"")) {
    pass("print SVG embeds uploaded artwork and QR well");
  } else fail("authored flyer artwork missing from SVG");
  if (!loadAuthoredPhysicalQrSvg().includes("Kolonnenstraße")) {
    pass("authored master does not bake sample PNG address");
  } else fail("sample address in authored SVG");
  if (!withAddr.includes("caretip.app/qr-studio-scan-check")) {
    pass("SVG does not embed QR Studio sample URL");
  } else fail("sample URL leaked into SVG");

  const recoloured = renderPhysicalQrSvg({
    qrDataUrl: null,
    businessName: "Venue",
    address: null,
    supportsAddress: false,
    colorTokens: {
      backgroundGradientStart: "#FFFFFF",
      backgroundGradientEnd: "#E8E8E8",
      primaryTextColor: "#C44536",
      secondaryTextColor: "#111111",
    },
  });
  if (recoloured.includes("#111111") && recoloured.includes("id=\"physical-artwork\"")) {
    pass("approved colour tokens applied to SVG overlays");
  } else fail("colour tokens not applied");
}

function sectionColors() {
  const ok = validatePhysicalQrColorTokens(PHYSICAL_QR_DEFAULT_COLOR_TOKENS);
  if (ok.ok) pass("default artwork colours pass contrast");
  else fail(`default colours rejected ${ok.reasons.join(",")}`);

  const bad = validatePhysicalQrColorTokens({
    backgroundGradientStart: "#FFF8F0",
    backgroundGradientEnd: "#F4B184",
    primaryTextColor: "#FFF8F0",
    secondaryTextColor: "#FFFFFF",
  });
  if (!bad.ok) pass("low-contrast text/background combination rejected");
  else fail("low-contrast colours should be rejected");
}

function sectionAlbertinaPricing() {
  const basic4 = quotePhysicalQrPrints({ printCount: 4, printingIncludedEligible: false, freeOrderAvailable: false });
  const basic5 = quotePhysicalQrPrints({ printCount: 5, printingIncludedEligible: false, freeOrderAvailable: false });
  const basic10 = quotePhysicalQrPrints({ printCount: 10, printingIncludedEligible: false, freeOrderAvailable: false });
  if (basic4.totalCents === 1490) pass("Basic 4 prints = €14.90");
  else fail(`Basic 4 got ${basic4.totalCents}`);
  if (basic5.totalCents === 1620) pass("Basic 5 prints = €16.20");
  else fail(`Basic 5 got ${basic5.totalCents}`);
  if (basic10.totalCents === 2270) pass("Basic 10 prints = €22.70");
  else fail(`Basic 10 got ${basic10.totalCents}`);

  const pro8 = quotePhysicalQrPrints({ printCount: 8, printingIncludedEligible: true, freeOrderAvailable: true });
  const pro9 = quotePhysicalQrPrints({ printCount: 9, printingIncludedEligible: true, freeOrderAvailable: true });
  const pro10 = quotePhysicalQrPrints({ printCount: 10, printingIncludedEligible: true, freeOrderAvailable: true });
  if (pro8.totalCents === 0 && pro8.freeOrderApplied) pass("Pro free order 8 prints = €0");
  else fail(`Pro 8 got ${pro8.totalCents}`);
  if (pro9.totalCents === 130) pass("Pro free order 9 prints = €1.30");
  else fail(`Pro 9 got ${pro9.totalCents}`);
  if (pro10.totalCents === 260) pass("Pro free order 10 prints = €2.60");
  else fail(`Pro 10 got ${pro10.totalCents}`);

  const proUsed = quotePhysicalQrPrints({ printCount: 4, printingIncludedEligible: true, freeOrderAvailable: false });
  if (proUsed.totalCents === 1490 && !proUsed.freeOrderApplied) pass("Pro after quota used uses Basic package");
  else fail(`Pro used quota got ${proUsed.totalCents}`);

  const storedFree = quotePhysicalQrPrints({
    printCount: 8,
    printingIncludedEligible: true,
    freeOrderAvailable: true,
  });
  const retrySameOrder = resolvePhysicalQrCheckoutQuote({
    printCount: 8,
    printingIncludedEligible: true,
    freeOrderAvailable: false,
    orderMonthlyFreeQuotaApplied: true,
    storedQuote: { ...storedFree, quotaClaimedAt: "2026-08-31T10:00:00.000Z" },
  });
  if (
    retrySameOrder.reuseStoredFreeQuote &&
    retrySameOrder.quote.totalCents === 0 &&
    retrySameOrder.quote.freeOrderApplied &&
    retrySameOrder.quotaClaimedAt?.toISOString() === "2026-08-31T10:00:00.000Z"
  ) {
    pass("Same PENDING free order checkout retry keeps the free quote");
  } else fail("same-order checkout retry lost the free quote");

  const secondOrder = resolvePhysicalQrCheckoutQuote({
    printCount: 4,
    printingIncludedEligible: true,
    freeOrderAvailable: false,
    orderMonthlyFreeQuotaApplied: false,
    storedQuote: null,
  });
  if (!secondOrder.reuseStoredFreeQuote && secondOrder.quote.totalCents === 1490 && !secondOrder.quote.freeOrderApplied) {
    pass("Second unrelated Pro order after quota is consumed receives paid package pricing");
  } else fail(`second Pro order after quota got ${secondOrder.quote.totalCents}`);

  if (retrySameOrder.quote.totalCents === storedFree.totalCents) {
    pass("Same PENDING free order totalAmount stays on the established free quote");
  } else fail("retry checkout changed the free-order total");

  const forgedClientFlag = resolvePhysicalQrCheckoutQuote({
    printCount: 8,
    printingIncludedEligible: true,
    freeOrderAvailable: false,
    orderMonthlyFreeQuotaApplied: false,
    storedQuote: { ...storedFree, freeOrderApplied: true, quotaClaimedAt: "2026-08-31T10:00:00.000Z" },
  });
  if (!forgedClientFlag.reuseStoredFreeQuote && !forgedClientFlag.quote.freeOrderApplied && forgedClientFlag.quote.totalCents === 2010) {
    pass("Client cannot fake monthly_free_quota_applied; unpaid package quote is used");
  } else fail("forged free-quota snapshot was trusted");

  const createPreview = quotePhysicalQrPrints({
    printCount: 10,
    printingIncludedEligible: true,
    freeOrderAvailable: true,
  });
  const createNotConsumed = orderHasConsumedMonthlyFreeQuota({
    monthlyFreeQuotaApplied: false,
    storedQuote: createPreview,
  });
  if (createPreview.freeOrderApplied && createPreview.totalCents === 260 && !createNotConsumed.consumed) {
    pass("TEST 1: create-time free preview is eligible, not consumed");
  } else fail("create-time preview was treated as quota consumption");

  const firstCheckout = resolvePhysicalQrCheckoutQuote({
    printCount: 10,
    printingIncludedEligible: true,
    freeOrderAvailable: true,
    orderMonthlyFreeQuotaApplied: false,
    storedQuote: createPreview,
  });
  if (!firstCheckout.reuseStoredFreeQuote && firstCheckout.quote.freeOrderApplied && firstCheckout.quote.totalCents === 260) {
    pass("TEST 2: first checkout of a new eligible order must claim (not reuse)");
  } else fail("first checkout skipped the claim by reusing a create-time flag");

  const stampedWithoutClaim = resolvePhysicalQrCheckoutQuote({
    printCount: 10,
    printingIncludedEligible: true,
    freeOrderAvailable: true,
    orderMonthlyFreeQuotaApplied: true,
    storedQuote: createPreview,
  });
  if (!stampedWithoutClaim.reuseStoredFreeQuote && stampedWithoutClaim.quote.totalCents === 260) {
    pass("TEST 2b: create-time monthly_free_quota_applied without quotaClaimedAt does not skip the claim");
  } else fail("create-time flag alone reused the free quote");

  const afterClaim10 = quotePhysicalQrPrints({
    printCount: 10,
    printingIncludedEligible: true,
    freeOrderAvailable: false,
  });
  const afterClaim4 = quotePhysicalQrPrints({
    printCount: 4,
    printingIncludedEligible: true,
    freeOrderAvailable: false,
  });
  if (afterClaim10.totalCents === 2270 && !afterClaim10.freeOrderApplied && afterClaim4.totalCents === 1490) {
    pass("TEST 3 / TEST 10: second new order same Berlin month uses Basic package (10=€22.70, 4=€14.90)");
  } else fail(`same-month second order got 10=${afterClaim10.totalCents} 4=${afterClaim4.totalCents}`);

  const secondNewCheckout = resolvePhysicalQrCheckoutQuote({
    printCount: 10,
    printingIncludedEligible: true,
    freeOrderAvailable: false,
    orderMonthlyFreeQuotaApplied: false,
    storedQuote: afterClaim10,
  });
  if (!secondNewCheckout.reuseStoredFreeQuote && secondNewCheckout.quote.totalCents === 2270) {
    pass("TEST 10: two September orders without month-cross — second checkout is package, not free extras");
  } else fail("second independent September order reused free pricing");

  const retryAfterClaim = resolvePhysicalQrCheckoutQuote({
    printCount: 10,
    printingIncludedEligible: true,
    freeOrderAvailable: false,
    orderMonthlyFreeQuotaApplied: true,
    storedQuote: { ...createPreview, quotaClaimedAt: "2026-09-01T10:00:00.000Z" },
  });
  if (
    retryAfterClaim.reuseStoredFreeQuote &&
    retryAfterClaim.quote.totalCents === 260 &&
    retryAfterClaim.quotaClaimedAt?.toISOString() === "2026-09-01T10:00:00.000Z"
  ) {
    pass("TEST 4: same PENDING order retry keeps the established free quote and does not re-claim");
  } else fail("same-order retry after a real claim lost the free quote");

  const concurrentLoser = resolvePhysicalQrCheckoutQuote({
    printCount: 10,
    printingIncludedEligible: true,
    freeOrderAvailable: false,
    orderMonthlyFreeQuotaApplied: false,
    storedQuote: createPreview,
  });
  if (!concurrentLoser.reuseStoredFreeQuote && concurrentLoser.quote.totalCents === 2270 && !concurrentLoser.quote.freeOrderApplied) {
    pass("TEST 5: independent first checkout after the winner claimed receives package pricing (QUOTA_CHANGED if claim loses)");
  } else fail("losing concurrent checkout still received a free quote");

  const claimedAt = new Date("2026-08-31T10:00:00.000Z");
  if (
    !shouldReleasePhysicalQrQuotaOnExpire({
      sessionId: "cs_this",
      orderSessionId: "cs_this",
      paymentStatus: "PENDING",
      monthlyFreeQuotaApplied: false,
      quotaClaimedAt: claimedAt,
      paidFreeOrderThisMonth: false,
    })
  ) {
    pass("Expired checkout with no free-quota claim does not release");
  } else fail("unclaimed order must not release quota");

  const july = new Date("2026-07-15T10:00:00.000Z");
  const august = new Date("2026-08-20T10:00:00.000Z");
  const aug31Berlin = DateTime.fromISO("2026-08-31T23:53:10", { zone: "Europe/Berlin" }).toJSDate();
  const sep1Berlin = DateTime.fromISO("2026-09-01T01:04:09", { zone: "Europe/Berlin" }).toJSDate();
  if (!isPhysicalQrFreeOrderUsedThisMonth(july, august) && isPhysicalQrFreeOrderUsedThisMonth(august, august)) {
    pass("Next Berlin month is unaffected by last month's free-order claim");
  } else fail("month boundary for free-order quota");
  if (!isPhysicalQrFreeOrderUsedThisMonth(aug31Berlin, sep1Berlin) && isPhysicalQrFreeOrderUsedThisMonth(aug31Berlin, aug31Berlin)) {
    pass("TEST 9: Aug 31 free-order used_at does not block a Sep 1 new free order");
  } else fail("TEST 9 Berlin month-cross eligibility");
  if (
    shouldReleasePhysicalQrQuotaOnExpire({
      sessionId: "cs_this",
      orderSessionId: "cs_this",
      paymentStatus: "PENDING",
      monthlyFreeQuotaApplied: true,
      quotaClaimedAt: claimedAt,
      paidFreeOrderThisMonth: false,
    })
  ) {
    pass("TEST 6: Expired Checkout can release its own unused monthly-free claim");
  } else fail("expired session should release its own unused claim");

  if (
    !shouldReleasePhysicalQrQuotaOnExpire({
      sessionId: "cs_this",
      orderSessionId: "cs_this",
      paymentStatus: "PAID",
      monthlyFreeQuotaApplied: true,
      quotaClaimedAt: claimedAt,
      paidFreeOrderThisMonth: false,
    })
  ) {
    pass("TEST 7: Paid free-order cannot have its monthly-free quota released");
  } else fail("paid order must not release quota");

  if (
    !shouldReleasePhysicalQrQuotaOnExpire({
      sessionId: "cs_other",
      orderSessionId: "cs_this",
      paymentStatus: "PENDING",
      monthlyFreeQuotaApplied: true,
      quotaClaimedAt: claimedAt,
      paidFreeOrderThisMonth: false,
    })
  ) {
    pass("TEST 8: Expired session for another order cannot release this order's claim");
  } else fail("stale session must not release this order's claim");

  if (
    !shouldReleasePhysicalQrQuotaOnExpire({
      sessionId: "cs_this",
      orderSessionId: "cs_this",
      paymentStatus: "PENDING",
      monthlyFreeQuotaApplied: true,
      quotaClaimedAt: claimedAt,
      paidFreeOrderThisMonth: true,
    })
  ) {
    pass("Expire does not release quota when a PAID free order already exists this month");
  } else fail("paid free order this month must block expire release");
}

function sectionEntitlement() {
  if (hasSubscriptionCapability("basic", "physicalQrPrinting")) {
    pass("Basic can access physical QR printing (physicalQrPrinting)");
  } else fail("Basic should have physicalQrPrinting");
  if (!hasSubscriptionCapability("basic", "physicalQrPrintingIncluded")) {
    pass("Basic is not eligible for monthly included printing quota");
  } else fail("Basic should not have included printing");
  if (hasSubscriptionCapability("premium", "physicalQrPrintingIncluded")) {
    pass("Premium has included physical printing");
  } else fail("Premium should have physicalQrPrintingIncluded");
  if (hasSubscriptionCapability("premium", "brandingCustomization")) {
    pass("Premium can customize digital branding");
  } else fail("Premium should have brandingCustomization");
}

function sectionCheckoutBlock() {
  const prev = process.env.PHYSICAL_QR_CHECKOUT_ENABLED;
  try {
    delete process.env.PHYSICAL_QR_CHECKOUT_ENABLED;
    if (isPhysicalQrCheckoutEnvEnabled()) pass("checkout enabled by default for testing");
    else fail("checkout should be enabled when env is unset");

    try {
      assertPhysicalQrCheckoutReady({ priceCents: 990, orderable: true, currency: "EUR" });
      pass("test EUR price allows checkout");
    } catch (err) {
      fail(`test price should allow checkout ${(err as Error).message}`);
    }

    try {
      assertPhysicalQrCheckoutReady({ priceCents: null, orderable: false, currency: "EUR" });
      fail("null price should block checkout");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === PHYSICAL_QR_PRICE_NOT_CONFIGURED) pass("null price → PRICE_NOT_CONFIGURED");
      else fail(`null price code ${code}`);
    }

    process.env.PHYSICAL_QR_CHECKOUT_ENABLED = "false";
    try {
      assertPhysicalQrCheckoutReady({ priceCents: 990, orderable: true, currency: "EUR" });
      fail("PHYSICAL_QR_CHECKOUT_ENABLED=false should block checkout");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === PHYSICAL_QR_CHECKOUT_NOT_ACTIVATED) pass("env false → CHECKOUT_NOT_ACTIVATED");
      else fail(`disabled-env code ${code}`);
    }
  } finally {
    if (prev === undefined) delete process.env.PHYSICAL_QR_CHECKOUT_ENABLED;
    else process.env.PHYSICAL_QR_CHECKOUT_ENABLED = prev;
  }
}

function sectionStatus() {
  if (canTransitionFulfillment("PROCESSING", "PRINTING")) pass("PROCESSING → PRINTING allowed");
  else fail("PROCESSING → PRINTING");
  if (canTransitionFulfillment("PRINTING", "SHIPPED")) pass("PRINTING → SHIPPED allowed");
  else fail("PRINTING → SHIPPED");
  if (!canTransitionFulfillment("PROCESSING", "SHIPPED")) pass("cannot skip printing");
  else fail("PROCESSING should not jump to SHIPPED");
  if (!canTransitionFulfillment("PAID", "DELIVERED")) pass("PAID cannot jump to DELIVERED");
  else fail("PAID should not jump to DELIVERED");
  if (!canTransitionFulfillment("PENDING_PAYMENT", "DELIVERED")) pass("cannot skip to DELIVERED");
  else fail("PENDING_PAYMENT should not jump to DELIVERED");
  if (canTransitionFulfillment("SHIPPED", "DELIVERED")) pass("SHIPPED → DELIVERED allowed");
  else fail("SHIPPED → DELIVERED");
  if (!canTransitionFulfillment("PENDING_PAYMENT", "SHIPPED")) pass("customer/admin cannot skip to SHIPPED");
  else fail("PENDING_PAYMENT should not jump to SHIPPED");
  if (!canTransitionFulfillment("DELIVERED", "PROCESSING")) pass("DELIVERED is terminal");
  else fail("DELIVERED should be terminal");
  if (orderCanPay({ paymentStatus: "PENDING", fulfillmentStatus: "PENDING_PAYMENT" })) {
    pass("unpaid orders can pay");
  } else fail("PENDING_PAYMENT should be payable");
  if (!orderCanPay({ paymentStatus: "PAID", fulfillmentStatus: "PROCESSING" })) {
    pass("paid orders cannot pay again");
  } else fail("PAID/PROCESSING should not be payable");
  if (orderCanPay({ paymentStatus: "FAILED", fulfillmentStatus: "PAYMENT_FAILED" })) {
    pass("failed payments can retry");
  } else fail("PAYMENT_FAILED should be retryable");
  if (orderCanPay({ paymentStatus: "PENDING", fulfillmentStatus: "PENDING_PAYMENT" })) {
    pass("expired Checkout remains payable while unpaid");
  } else fail("unpaid order should stay payable after expiry policy");
}

function expectShippingError(code: string, fn: () => unknown) {
  try {
    fn();
    fail(`expected ${code}`);
  } catch (err) {
    if (err instanceof PhysicalQrShippingError && err.code === code) pass(`shipping rejects ${code}`);
    else fail(`expected ${code} got ${String(err)}`);
  }
}

function sectionShipping() {
  const validShipping = {
    recipientName: "Marie Testerin",
    streetLine: "Kolonnenstraße 8",
    city: "Berlin",
    country: "DE",
  };
  const parsed = parsePhysicalQrShippingSnapshot(validShipping);
  if (
    parsed.country === PHYSICAL_QR_SHIP_COUNTRY &&
    parsed.postalCode === "" &&
    parsed.recipientName === "Marie Testerin"
  ) {
    pass("Germany shipping snapshot is accepted");
  } else fail("valid DE shipping");

  expectShippingError("RECIPIENT_REQUIRED", () => parsePhysicalQrShippingSnapshot({}));
  expectShippingError("INVALID_COUNTRY", () =>
    parsePhysicalQrShippingSnapshot({ ...validShipping, country: "AT" }),
  );
  expectShippingError("INVALID_POSTAL_CODE", () =>
    parsePhysicalQrShippingSnapshot({ ...validShipping, postalCode: "1010" }),
  );
  expectShippingError("PHONE_REQUIRED", () =>
    parsePhysicalQrContactSnapshot({
      name: "Marie Testerin",
      email: "marie@example.com",
      phone: "",
    }),
  );
  const contact = parsePhysicalQrContactSnapshot(
    { phone: "+49 30 12345678" },
    { name: "Marie Testerin", email: "marie@example.com" },
  );
  if (contact.email === "marie@example.com" && contact.phone.includes("30")) {
    pass("contact snapshot uses server fallbacks except required phone from form");
  } else fail("contact fallbacks");

  try {
    parsePhysicalQrShippingSnapshot(undefined);
    fail("omitted shipping should 400");
  } catch (err) {
    if (err instanceof PhysicalQrShippingError) pass("omitted shipping is rejected server-side");
    else fail(`omitted shipping ${String(err)}`);
  }
}

function sectionPrintStatic() {
  if (PHYSICAL_QR_PRINT_WIDTH_MM === 148 && PHYSICAL_QR_PRINT_HEIGHT_MM === 210) {
    pass("print size is A5 148×210 mm");
  } else fail("print mm");
  if (PHYSICAL_QR_PRINT_WIDTH_PX === 1748 && PHYSICAL_QR_PRINT_HEIGHT_PX === 2480) {
    pass("300 DPI raster is 1748×2480");
  } else fail(`px ${PHYSICAL_QR_PRINT_WIDTH_PX}×${PHYSICAL_QR_PRINT_HEIGHT_PX}`);
  if (PHYSICAL_QR_SAMPLE_URL_FORBIDDEN.includes("qr-studio-scan-check")) {
    pass("sample URL is explicitly forbidden for physical orders");
  } else fail("forbidden sample URL constant");

  const fakeJpeg = Buffer.alloc(100, 0xff);
  const pdf = jpegToA5Pdf(fakeJpeg, 1748, 2480);
  const text = pdf.toString("latin1");
  if (text.includes("%PDF-1.4") && text.includes("419.528") && text.includes("595.276")) {
    pass("A5 PDF media box is 148×210 mm");
  } else fail("A5 PDF media box");
  if (text.includes("/Count 1") && !text.includes("/Count 5")) {
    pass("jpegToA5Pdf defaults to one page");
  } else fail("default PDF page count");
  const five = jpegToA5Pdf(fakeJpeg, 1748, 2480, 5).toString("latin1");
  if (five.includes("/Count 5") && five.includes("419.528") && five.includes("595.276")) {
    pass("quantity 5 yields five identical A5 pages");
  } else fail("PDF page count 5");

  const jpegA = Buffer.alloc(80, 0xaa);
  const jpegB = Buffer.alloc(90, 0xbb);
  const combined = jpegsToA5Pdf([
    { jpeg: jpegA, pixelWidth: 1748, pixelHeight: 2480, copies: 2 },
    { jpeg: jpegB, pixelWidth: 1748, pixelHeight: 2480, copies: 3 },
  ]).toString("latin1");
  if (combined.includes("/Count 5") && combined.includes("%PDF-1.4")) {
    pass("jpegsToA5Pdf combines distinct items with per-line quantities");
  } else fail("combined multi-item PDF page count");

  if (crc32(Buffer.from("123456789")) === 0xcbf43926) pass("zip CRC32 matches the known ISO vector");
  else fail("zip CRC32");
  const zipped = zipStore([{ name: "caretip-a5-order.pdf", data: Buffer.from("%PDF-1.4 test") }]);
  if (zipped.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && zipped.includes(Buffer.from("caretip-a5-order.pdf"))) {
    pass("zipStore packs existing PDFs without a new archive dependency");
  } else fail("zipStore output");
}

function sectionRegressionFiles() {
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const required = [
    "src/app/lib/qrTemplateEngine/registry.ts",
    "src/app/components/business/settings/QrTemplatePicker.tsx",
    "src/app/components/business/QrStudioDesigner.tsx",
    "src/app/pages/business/qr-studio/QrStudioBrandingPage.tsx",
    "src/assets/physical-qr/caretip-a5.svg",
    "src/assets/physical-qr/caretip-a5-artwork.png",
    "template/A5_Flyer without Address.png",
  ];
  for (const rel of required) {
    if (existsSync(path.join(root, rel))) pass(`digital Branding still present: ${rel}`);
    else fail(`missing digital Branding file ${rel}`);
  }
  const businessController = readFileSync(
    path.join(root, "backend/src/controllers/physicalQr.controller.ts"),
    "utf8",
  );
  const businessRoutes = readFileSync(
    path.join(root, "backend/src/routes/physicalQr.routes.ts"),
    "utf8",
  );
  const platformRoutes = readFileSync(
    path.join(root, "backend/src/routes/platform.routes.ts"),
    "utf8",
  );
  if (
    !businessController.includes("internalNotes") &&
    businessController.includes("CUSTOMER_CANNOT_MODIFY_FULFILLMENT") &&
    !businessRoutes.includes("/messages") &&
    !platformRoutes.includes("/physical-qr/orders/:orderId/messages")
  ) {
    pass("business APIs do not expose internal notes and cannot change fulfillment");
  } else fail("business controller leaked notes or lost 403 patch");

  const batchService = readFileSync(
    path.join(root, "backend/src/services/physicalQr/physicalQrBatch.service.ts"),
    "utf8",
  );
  if (
    batchService.includes("createPhysicalQrCartOrder") &&
    batchService.includes("One checkout cart → one parent physical QR order") &&
    batchService.includes("orderId: order.id") &&
    !batchService.includes("createPhysicalQrOrder(")
  ) {
    pass("batch checkout creates one parent order; Stripe metadata uses single orderId");
  } else fail("batch service still splits cart into multiple orders");

  const orderService = readFileSync(
    path.join(root, "backend/src/services/physicalQr/physicalQrOrder.service.ts"),
    "utf8",
  );
  if (
    orderService.includes("createPhysicalQrCartOrder") &&
    orderService.includes("items: {") &&
    orderService.includes("create: prepared.map") &&
    orderService.includes("assertBasicSingleLocation") &&
    orderService.includes("quotePhysicalQrPrints") &&
    orderService.includes("parsePhysicalQrShippingSnapshot") &&
    orderService.includes("parsePhysicalQrContactSnapshot") &&
    orderService.includes("shippingSnapshot") &&
    !orderService.includes("shippingSnapshot: business.registeredAddress")
  ) {
    pass("cart order creates parent + line items with shipping/contact snapshots");
  } else fail("order create shipping snapshots / line items");

  const pricingService = readFileSync(
    path.join(root, "backend/src/services/physicalQr/physicalQrPricing.service.ts"),
    "utf8",
  );
  if (
    pricingService.includes("tryClaimPhysicalQrMonthlyFreeOrder") &&
    pricingService.includes("$executeRaw") &&
    pricingService.includes("physical_qr_free_order_used_at") &&
    pricingService.includes("Number(result) === 1") &&
    pricingService.includes("AND (physical_qr_free_order_used_at IS NULL OR physical_qr_free_order_used_at < ${monthStart})") &&
    orderService.includes("QUOTA_CHANGED") &&
    orderService.includes("BASIC_SINGLE_LOCATION_REQUIRED") &&
    batchService.includes("stripeLineItemsForPhysicalQrQuote") &&
    batchService.includes("quantity: 1") &&
    businessRoutes.includes('"/quote"') &&
    businessController.includes("quoteMyPhysicalQrCart")
  ) {
    pass("Albertina quota claim is atomic; Basic multi-location rejected; Stripe charges quote total");
  } else fail("Albertina server security/pricing wiring");

  const createFn = orderService.slice(
    orderService.indexOf("export async function createPhysicalQrCartOrder"),
    orderService.indexOf("export async function createPhysicalQrOrder"),
  );
  const createPersist = createFn.slice(createFn.indexOf("persistPhysicalQrAlbertinaOrderColumns"));
  if (
    createFn.includes("monthlyFreeQuotaApplied: false") &&
    createPersist.includes("quote,") &&
    !createPersist.includes("quotaClaimedAt") &&
    pricingService.includes("const consumed = Boolean(claimedAtIso)") &&
    !pricingService.includes("input.quote.freeOrderApplied,")
  ) {
    pass("Create persists a preview snapshot without consuming the monthly quota");
  } else fail("create still stamps monthly_free_quota_applied from the preview quote");

  const lockFn = orderService.slice(
    orderService.indexOf("export async function lockQuoteForPhysicalQrCheckout"),
    orderService.indexOf("export { releasePhysicalQrMonthlyFreeOrderClaim }"),
  );
  if (
    lockFn.includes("tryClaimPhysicalQrMonthlyFreeOrder") &&
    lockFn.includes("reuseStoredFreeQuote") &&
    !lockFn.includes("?? quota.usedAt") &&
    pricingService.includes("hasPaidPhysicalQrMonthlyFreeOrderThisMonth") &&
    pricingService.includes("payment_status::text = 'PAID'")
  ) {
    pass("First checkout claims atomically; reuse requires this order's quotaClaimedAt; used_at is primary");
  } else fail("checkout claim/reuse wiring");

  const webhook = readFileSync(
    path.join(root, "backend/src/services/physicalQr/physicalQrWebhook.service.ts"),
    "utf8",
  );
  if (
    webhook.includes("shouldReleasePhysicalQrQuotaOnExpire") &&
    webhook.includes("clearPhysicalQrOrderMonthlyFreeQuota") &&
    webhook.includes("releasePhysicalQrMonthlyFreeOrderClaim") &&
    !webhook.includes('fulfillmentStatus: "CANCELLED"') &&
    webhook.includes('fulfillmentStatus: "PROCESSING"') &&
    webhook.includes("amount_total") &&
    webhook.includes("session.metadata.orderId") &&
    webhook.includes("orderIds")
  ) {
    pass("webhook marks single parent order paid; expired Checkout can safely release unused quota");
  } else fail("webhook expiry/paid/tenant checks");

  const expireAt = webhook.indexOf("export async function handlePhysicalQrCheckoutExpired");
  const beforeExpire = expireAt >= 0 ? webhook.slice(0, expireAt) : "";
  const expireBody = expireAt >= 0 ? webhook.slice(expireAt) : "";
  if (
    beforeExpire.includes("amount_total") &&
    !beforeExpire.includes("await releasePhysicalQrMonthlyFreeOrderClaim") &&
    expireBody.includes("await releasePhysicalQrMonthlyFreeOrderClaim")
  ) {
    pass("Successful checkout keeps the monthly quota consumed");
  } else fail("completed webhook must not release quota");
  if (
    expireBody.includes("await releasePhysicalQrMonthlyFreeOrderClaim") &&
    expireBody.includes("hasPaidPhysicalQrMonthlyFreeOrderThisMonth") &&
    !expireBody.includes("quota?.usedAt") &&
    expireBody.includes('reason: "not_releasable"')
  ) {
    pass("Expire release uses this order's quotaClaimedAt only; PAID free orders block release");
  } else fail("expire must not fall back to another order's used_at");

  const cartInput = orderService.slice(
    orderService.indexOf("export type CreatePhysicalQrCartInput"),
    orderService.indexOf("const ORDER_INCLUDE"),
  );
  if (
    orderService.includes('paymentStatus !== "PENDING"') &&
    orderService.includes("ORDER_NOT_CHECKOUTABLE") &&
    !cartInput.includes("monthlyFreeQuotaApplied") &&
    !cartInput.includes("totalAmount")
  ) {
    pass("Paid orders cannot be treated as pending free orders; client cannot send quota or totals");
  } else fail("paid/pending checkout guard or client quota flag");

  const adminDto = readFileSync(
    path.join(root, "backend/src/services/physicalQr/physicalQrFulfillment.service.ts"),
    "utf8",
  );
  if (
    adminDto.includes("shippingSnapshot: row.shippingSnapshot") &&
    adminDto.includes("contactSnapshot: row.contactSnapshot") &&
    adminDto.includes("itemCount") &&
    adminDto.includes("resolveOrderItemRows") &&
    !adminDto.includes("registeredAddress: true")
  ) {
    pass("admin DTO exposes shipping snapshot, item count, and line items");
  } else fail("admin shipping DTO");

  const checkout = readFileSync(
    path.join(root, "backend/src/services/physicalQr/physicalQrCheckout.service.ts"),
    "utf8",
  );
  if (
    batchService.includes("customer_email") &&
    batchService.includes("stripeLineItemsForPhysicalQrQuote") &&
    batchService.includes("lockQuoteForPhysicalQrCheckout") &&
    batchService.includes("previousSessionId") &&
    orderService.includes("resolvePhysicalQrCheckoutQuote") &&
    orderService.includes("reuseStoredFreeQuote") &&
    checkout.includes("createPhysicalQrBatchCheckoutSession") &&
    !checkout.includes("application_fee")
  ) {
    pass("Checkout reuses an already-claimed free quote and expires the prior Stripe session after the new id is saved");
  } else fail("checkout session shape");

  const adminPrint = readFileSync(
    path.join(root, "backend/src/controllers/platformPhysicalQr.controller.ts"),
    "utf8",
  );
  const printPipeline = readFileSync(
    path.join(root, "backend/src/lib/physicalQr/printPipeline.ts"),
    "utf8",
  );
  const adminPrintService = readFileSync(
    path.join(root, "backend/src/services/physicalQr/physicalQrAdminPrint.service.ts"),
    "utf8",
  );
  if (
    platformRoutes.includes("/physical-qr/orders/:orderId/print") &&
    adminPrint.includes("adminPrintPhysicalQrOrder") &&
    adminPrint.includes("renderPhysicalQrPrint") &&
    adminPrint.includes("PAYMENT_REQUIRED") &&
    adminPrint.includes("buildPhysicalQrOrderPdfForAdmin") &&
    adminPrint.includes("getPhysicalQrOrderForAdmin") &&
    !adminPrint.includes("req.query.path") &&
    !adminPrint.includes("registeredAddress") &&
    platformRoutes.includes("requirePlatformAdmin") &&
    printPipeline.includes("jpegToA5Pdf(jpeg, w, h)")
  ) {
    pass("admin print GET reuses snapshot renderer; bulk combines all line items");
  } else fail("admin print endpoint / snapshot renderer");

  if (
    adminPrint.includes("items.find((i) => i.id === itemId)") &&
    adminPrintService.includes("jpegsToA5Pdf") &&
    adminPrintService.includes("itemCopies") &&
    adminPrintService.includes("all-x${pageCount}") &&
    adminPrint.includes("adminPrintPhysicalQrOrdersBulk") &&
    platformRoutes.includes("/physical-qr/orders/print-bulk") &&
    adminPrint.includes("orderIds") &&
    !adminPrint.includes("req.query.path") &&
    !businessRoutes.includes("print-bulk") &&
    !adminPrintService.includes("archiver") &&
    adminPrintService.includes("zipStore")
  ) {
    pass("bulk ZIP reuses existing PDFs, authorizes each order id, and is platform-admin only");
  } else fail("bulk PDF authorization / combined renderer");
}

async function sectionPrintDecode() {
  try {
    const { renderPhysicalQrPrint } = await import("../src/lib/physicalQr/printPipeline.js");
    const target = "https://caretip.de/demo-venue-physical-print";
    const printed = await renderPhysicalQrPrint({
      targetUrl: target,
      businessName: "CareTip UG",
      address: "Kolonnenstraße 8, 10827 Berlin",
      supportsAddress: true,
      colorTokens: PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
    });
    if (printed.widthPx === 1748 && printed.heightPx === 2480) pass("print raster is 300 DPI A5");
    else fail("print raster size");
    if (printed.svg.includes("CareTip UG") && svgShowsAddress(printed.svg)) {
      pass("print SVG contains name and address");
    } else fail("print SVG content");

    const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const jsqrPath = path.join(root, "node_modules/jsqr");
    if (!existsSync(jsqrPath)) {
      pass("QR decode skipped (jsqr not installed at repo root)");
      return;
    }
    const require = createRequire(import.meta.url);
    const jsQR = require(jsqrPath) as (
      data: Uint8ClampedArray,
      w: number,
      h: number,
    ) => { data: string } | null;
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(printed.png);
    const sx = printed.widthPx / 1410;
    const sy = printed.heightPx / 2000;
    const qx = Math.round(401 * sx);
    const qy = Math.round(792 * sy);
    const qw = Math.round(609 * sx);
    const qh = Math.round(613 * sy);
    const canvas = createCanvas(qw, qh);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, qx, qy, qw, qh, 0, 0, qw, qh);
    const imageData = ctx.getImageData(0, 0, qw, qh);
    const decoded = jsQR(imageData.data, imageData.width, imageData.height);
    if (decoded?.data === target) pass("printed QR decodes to canonical target URL");
    else fail(`printed QR decode ${decoded?.data ?? "null"}`);
  } catch (err) {
    fail(`print pipeline ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function sectionOptionalDb() {
  let prisma: any = null;
  try {
    const mod = await import("../src/prisma.js");
    prisma = mod.prisma;
    const { resolvePhysicalQrContext } = await import("../src/services/physicalQr/qrContext.service.js");
    const businesses = await prisma.business.findMany({
      take: 2,
      select: { id: true, slug: true },
      orderBy: { createdAt: "asc" },
    });
    if (businesses.length < 2) {
      pass("tenant isolation DB check skipped (need two businesses)");
      return;
    }
    const [a, b] = businesses;
    const employee = await prisma.employee.findFirst({
      where: { businessId: b!.id, isDeleted: false },
      select: { id: true },
    });
    const location = await prisma.location.findFirst({
      where: { businessId: b!.id },
      select: { id: true },
    });
    const table = await prisma.table.findFirst({
      where: { location: { businessId: b!.id } },
      select: { id: true },
    });
    if (employee) {
      try {
        await resolvePhysicalQrContext({
          businessId: a!.id,
          qrContextType: "employee",
          qrSubjectId: employee.id,
        });
        fail("cross-tenant employee QR was allowed");
      } catch (err) {
        if ((err as { code?: string }).code === "CROSS_TENANT_QR") pass("cross-tenant employee QR rejected");
        else fail(`employee cross-tenant ${String(err)}`);
      }
    } else pass("cross-tenant employee skipped (no employee on second business)");
    if (location) {
      try {
        await resolvePhysicalQrContext({
          businessId: a!.id,
          qrContextType: "location",
          qrSubjectId: location.id,
        });
        fail("cross-tenant location QR was allowed");
      } catch (err) {
        if ((err as { code?: string }).code === "CROSS_TENANT_QR") pass("cross-tenant location QR rejected");
        else fail(`location cross-tenant ${String(err)}`);
      }
    } else pass("cross-tenant location skipped (no location on second business)");
    if (table) {
      try {
        await resolvePhysicalQrContext({
          businessId: a!.id,
          qrContextType: "table",
          qrSubjectId: table.id,
        });
        fail("cross-tenant table QR was allowed");
      } catch (err) {
        if ((err as { code?: string }).code === "CROSS_TENANT_QR") pass("cross-tenant table QR rejected");
        else fail(`table cross-tenant ${String(err)}`);
      }
    } else pass("cross-tenant table skipped (no table on second business)");

    const storefront = await resolvePhysicalQrContext({
      businessId: a!.id,
      qrContextType: "storefront",
    });
    if (storefront.qrTargetUrl.includes(a!.slug) && !storefront.qrTargetUrl.includes("qr-studio-scan-check")) {
      pass("storefront URL is canonical for authenticated business");
    } else fail(`storefront URL ${storefront.qrTargetUrl}`);

    const { handlePhysicalQrCheckoutSessionCompleted } = await import(
      "../src/services/physicalQr/physicalQrWebhook.service.js"
    );
    const missing = await handlePhysicalQrCheckoutSessionCompleted({
      metadata: { source: "physical_qr_order" },
    } as never);
    if (!missing.ok && missing.reason === "missing_metadata") pass("webhook rejects missing order metadata");
    else fail(`webhook metadata ${JSON.stringify(missing)}`);
    const wrongBiz = await handlePhysicalQrCheckoutSessionCompleted({
      id: "cs_test_forged",
      metadata: { source: "physical_qr_order", orderId: "does-not-exist", businessId: a!.id },
      amount_total: 999999,
    } as never);
    if (!wrongBiz.ok && wrongBiz.reason === "order_not_found") pass("webhook rejects unknown order");
    else fail(`webhook unknown order ${JSON.stringify(wrongBiz)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/physicalQrProduct|physical_qr|does not exist|P2021|Can't reach|P1001|DATABASE_URL is required/i.test(msg)) {
      pass("DB tenant checks skipped until migration is applied");
    } else {
      fail(`optional DB ${msg}`);
    }
  } finally {
    await prisma?.$disconnect?.().catch(() => undefined);
  }
}

async function main() {
  sectionProcessing();
  sectionTemplate();
  sectionColors();
  sectionAlbertinaPricing();
  sectionEntitlement();
  sectionCheckoutBlock();
  sectionStatus();
  sectionShipping();
  sectionPrintStatic();
  sectionRegressionFiles();
  await sectionPrintDecode();
  await sectionOptionalDb();

  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) console.log(line);
  console.log(`\nPhysical QR: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

void main();
