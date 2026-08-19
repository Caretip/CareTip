/**
 * Frontend physical template + digital Branding regression (no browser).
 * Run: npm run test:physical-qr-frontend
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHYSICAL_QR_FONT_STATUS,
  PHYSICAL_QR_TEMPLATE_ID,
} from "../src/app/lib/physicalQrTemplate/types.ts";
import { getPhysicalQrTemplate } from "../src/app/lib/physicalQrTemplate/registry.ts";
import {
  PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  tryParsePhysicalQrHex,
  validatePhysicalQrColorTokens,
} from "../src/app/lib/physicalQrTemplate/colors.ts";
import {
  PHYSICAL_QR_SHIP_COUNTRY,
  physicalQrDeliveryIsComplete,
} from "../src/app/lib/physicalQrOrderUi.ts";
import {
  injectPhysicalQrSvg,
  svgHidesAddress,
  svgShowsAddress,
} from "../src/app/lib/physicalQrTemplate/inject.ts";

const QR_STUDIO_SAMPLE_URL = "https://caretip.app/qr-studio-scan-check";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));
const authoredSvgPath = path.join(root, "src/assets/physical-qr/caretip-a5.svg");
if (existsSync(authoredSvgPath)) pass("authored A5 SVG exists at src/assets/physical-qr/caretip-a5.svg");
else fail("missing authored A5 SVG");

const template = existsSync(authoredSvgPath) ? readFileSync(authoredSvgPath, "utf8") : "";
if (template.includes("viewBox=\"0 0 1410 2000\"") && template.includes("id=\"physical-artwork\"")) {
  pass("authored SVG wraps uploaded 1410×2000 artwork");
} else fail("authored SVG layout");
const artworkPng = path.join(root, "src/assets/physical-qr/caretip-a5-artwork.png");
if (existsSync(artworkPng)) pass("uploaded A5 PNG copied to src/assets/physical-qr/caretip-a5-artwork.png");
else fail("missing artwork PNG");
if (!template.includes("Kolonnenstraße")) {
  pass("authored SVG does not bake the sample PNG address");
} else fail("sample address baked into SVG");

const tpl = getPhysicalQrTemplate(PHYSICAL_QR_TEMPLATE_ID);
if (tpl?.printWidthMm === 148 && tpl.printHeightMm === 210) pass("registry A5 148×210");
else fail("registry size");

const artworkHref = existsSync(artworkPng)
  ? `data:image/png;base64,${readFileSync(artworkPng).toString("base64")}`
  : "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const withAddr = injectPhysicalQrSvg(template, {
  businessName: "CareTip UG",
  address: "Kolonnenstraße 8",
  supportsAddress: true,
  colorTokens: PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  qrDataUrl: null,
  artworkDataUrl: artworkHref,
});
const noAddr = injectPhysicalQrSvg(template, {
  businessName: "CareTip UG",
  address: "Kolonnenstraße 8",
  supportsAddress: false,
  colorTokens: PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  qrDataUrl: null,
  artworkDataUrl: artworkHref,
});
if (withAddr.includes("Kolonnenstraße") && svgShowsAddress(withAddr)) pass("preview address visible");
else fail("preview address");
if (svgHidesAddress(noAddr) && noAddr.includes("CareTip UG")) pass("preview hides address and keeps name");
else fail("preview no-address");
if (withAddr.includes(PHYSICAL_QR_FONT_STATUS)) pass("preview marks temporary font");
else fail("preview font status");
if (!withAddr.includes(QR_STUDIO_SAMPLE_URL)) pass("preview SVG does not embed sample URL");
else fail("sample URL in preview");
if (withAddr.includes("#1A1A1A") && withAddr.includes("id=\"physical-artwork\"") && withAddr.includes("data:image/png;base64,")) {
  pass("overlay colour applied and uploaded PNG is embedded");
} else fail("artwork embed / overlay colour");

const colors = validatePhysicalQrColorTokens({
  backgroundGradientStart: "#FFF8F0",
  backgroundGradientEnd: "#F4B184",
  primaryTextColor: "#FFF8F0",
  secondaryTextColor: "#FFFFFF",
});
if (!colors.ok) pass("frontend contrast guard rejects weak colours");
else fail("frontend contrast guard");
if (tryParsePhysicalQrHex("#eb992c") === "#EB992C" && tryParsePhysicalQrHex("#FF") === null) {
  pass("typed hex is parsed only when complete");
} else fail("typed hex parse");

const brandingPage = readFileSync(path.join(root, "src/app/pages/business/qr-studio/QrStudioBrandingPage.tsx"), "utf8");
if (
  brandingPage.includes("PhysicalBrandingStudio") &&
  !brandingPage.includes("QrStudioDesigner")
) {
  pass("Branding page is physical print only");
} else fail("Branding page should not render the old digital designer");

if (existsSync(path.join(root, "src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx"))) {
  pass("business order detail page exists");
} else fail("missing business order detail page");
if (existsSync(path.join(root, "src/app/pages/platform/PlatformPhysicalQrOrderDetailPage.tsx"))) {
  pass("admin order detail page exists");
} else fail("missing admin order detail page");

const digital = [
  "src/app/lib/qrTemplateEngine/renderer.ts",
  "src/app/components/business/settings/QrTemplatePicker.tsx",
  "src/app/components/business/QrStudioDesigner.tsx",
];
for (const rel of digital) {
  if (existsSync(path.join(root, rel))) pass(`digital still present ${rel}`);
  else fail(`missing ${rel}`);
}

const routes = readFileSync(path.join(root, "src/app/routes.tsx"), "utf8");
if (
  routes.includes('path: \'templates\'') &&
  routes.includes('Navigate to="/dashboard/qr-studio/branding"')
) {
  pass("/templates redirects to Branding");
} else fail("templates route should redirect to branding");
if (routes.includes("branding/orders/:orderId") && routes.includes("businesses/branding-orders/:orderId")) {
  pass("business and admin physical order detail routes exist");
} else fail("missing physical order detail routes");

const orderUi = readFileSync(path.join(root, "src/app/lib/physicalQrOrderUi.ts"), "utf8");
if (
  orderUi.includes("Europe/Berlin") &&
  orderUi.includes("paymentPending") &&
  orderUi.includes("paymentReceived") &&
  orderUi.includes("physicalQrCustomerStatus") &&
  !orderUi.includes("PENDING PENDING_PAYMENT")
) {
  pass("business status labels use Berlin time and human copy");
} else fail("order UI labels");

const orderCard = readFileSync(path.join(root, "src/app/components/business/physical-branding/PhysicalQrOrderCard.tsx"), "utf8");
if (orderCard.includes("showPay = Boolean(canPay) && !confirming") && orderCard.includes("physicalQrCustomerStatus")) {
  pass("Pay now is hidden while confirming payment");
} else fail("Pay now confirming gate");

const studio = readFileSync(path.join(root, "src/app/components/business/physical-branding/PhysicalBrandingStudio.tsx"), "utf8");
const en = readFileSync(path.join(root, "src/i18n/locales/en.json"), "utf8");
if (
  !studio.includes("CardTitle") &&
  studio.includes("divide-y") &&
  studio.includes("physicalQrDeliveryIsComplete") &&
  studio.includes("needDelivery") &&
  studio.includes("missingDelivery") &&
  !studio.includes("backgroundGradientStart") &&
  !en.includes("Stripe webhook") &&
  en.includes("Track your physical QR orders")
) {
  pass("Branding order UI is compact and customer-facing");
} else fail("Branding page still uses nested cards or webhook copy");

if (
  !physicalQrDeliveryIsComplete({
    recipientName: "",
    streetLine: "",
    postalCode: "",
    city: "",
    country: PHYSICAL_QR_SHIP_COUNTRY,
    email: "",
    phone: "",
  })
) {
  pass("Place order/Pay stays disabled until delivery is valid");
} else fail("empty delivery should not enable pay");

if (
  physicalQrDeliveryIsComplete({
    recipientName: "Marie Testerin",
    streetLine: "Kolonnenstraße 8",
    postalCode: "10827",
    city: "Berlin",
    country: PHYSICAL_QR_SHIP_COUNTRY,
    email: "marie@example.com",
    phone: "+493012345678",
  })
) {
  pass("complete Germany delivery enables pay");
} else fail("valid DE delivery should enable pay");

if (
  !physicalQrDeliveryIsComplete({
    recipientName: "Marie Testerin",
    streetLine: "Kolonnenstraße 8",
    postalCode: "10827",
    city: "Berlin",
    country: "AT",
    email: "marie@example.com",
    phone: "+493012345678",
  }) &&
  !physicalQrDeliveryIsComplete({
    recipientName: "Marie Testerin",
    streetLine: "Kolonnenstraße 8",
    postalCode: "10827",
    city: "Berlin",
    country: PHYSICAL_QR_SHIP_COUNTRY,
    email: "marie@example.com",
    phone: "",
  })
) {
  pass("non-Germany shipping and missing phone keep Pay disabled");
} else fail("country/phone delivery gates");

const orderDetail = readFileSync(path.join(root, "src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx"), "utf8");
if (
  orderDetail.includes('checkoutFlag === "success"') &&
  orderDetail.includes("fetchPhysicalQrOrder") &&
  orderDetail.includes("setConfirming(false)") &&
  !orderDetail.includes("PhysicalQrOrderThread")
) {
  pass("Stripe return polls webhook state without treating redirect as paid");
} else fail("Stripe return polling");

const adminDetail = readFileSync(path.join(root, "src/app/pages/platform/PlatformPhysicalQrOrderDetailPage.tsx"), "utf8");
if (
  adminDetail.includes("markPlatformPhysicalQrPrinting") &&
  adminDetail.includes("downloadPlatformPhysicalQrOrderPrint") &&
  adminDetail.includes('paymentStatus === "PAID"') &&
  adminDetail.includes("shipPlatformPhysicalQrOrder") &&
  adminDetail.includes("internalNotes") &&
  adminDetail.includes("deliveryAddress") &&
  adminDetail.includes("deliveryMissingWarning") &&
  !adminDetail.includes("PhysicalQrOrderThread") &&
  !adminDetail.includes("registeredAddress")
) {
  pass("admin order detail has fulfillment controls and separate internal notes");
} else fail("admin fulfillment controls");

if (
  adminDetail.includes("downloadPlatformPhysicalQrOrderPrint") &&
  adminDetail.includes("onClick={() => void downloadPdf()}") &&
  adminDetail.includes("onClick={() => void run(() => markPlatformPhysicalQrPrinting(order.id))}")
) {
  pass("Download PDF is separate from Mark as printing");
} else fail("Download PDF should stay separate from Mark as printing");

const nav = readFileSync(path.join(root, "src/app/components/business/businessDashboardNav.ts"), "utf8");
if (!nav.includes("qr-studio/templates")) pass("Templates nav entry removed");
else fail("Templates nav still present");

const failed = results.filter((r) => r.startsWith("FAIL"));
for (const line of results) console.log(line);
console.log(`\nPhysical QR frontend: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
