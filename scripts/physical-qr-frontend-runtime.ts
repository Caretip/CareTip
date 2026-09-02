/**
 * Frontend physical template + digital Branding regression (no browser).
 * Run: npm run test:physical-qr-frontend
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPhysicalQrTemplate, isPhysicalQrTemplateId, listPhysicalQrTemplates } from "../src/app/lib/physicalQrTemplate/registry.ts";
import {
  PHYSICAL_QR_FONT_STATUS,
  PHYSICAL_QR_LIGHT_OVERLAY_TEXT,
  PHYSICAL_QR_TEMPLATE_CLASSIC_ID,
  PHYSICAL_QR_TEMPLATE_ID,
  PHYSICAL_QR_TEMPLATE_IDS,
  PHYSICAL_QR_TEMPLATE_LIGHT_ID,
  PHYSICAL_QR_TEMPLATE_MIDNIGHT_ID,
  PHYSICAL_QR_TEMPLATE_NATURE_ID,
  physicalQrOverlayTextColor,
} from "../src/app/lib/physicalQrTemplate/types.ts";
import {
  PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  tryParsePhysicalQrHex,
  validatePhysicalQrColorTokens,
} from "../src/app/lib/physicalQrTemplate/colors.ts";
import {
  PHYSICAL_QR_SHIP_COUNTRY,
  physicalQrDeliveryIsComplete,
  groupPhysicalQrItemsByLocation,
} from "../src/app/lib/physicalQrOrderUi.ts";
import { quotePhysicalQrPrints } from "../src/app/lib/physicalQrPricing.ts";
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
const newArtwork = [
  "src/assets/physical-qr/caretip-light.png",
  "src/assets/physical-qr/caretip-midnight.png",
  "src/assets/physical-qr/caretip-nature.png",
  "src/assets/physical-qr/caretip_classic.png",
];
for (const rel of newArtwork) {
  if (existsSync(path.join(root, rel))) pass(`new print template image present: ${rel}`);
  else fail(`missing new print template image ${rel}`);
}
const displayArt = [
  "src/assets/physical-qr/display/caretip-a5-artwork.thumb.webp",
  "src/assets/physical-qr/display/caretip-a5-artwork.preview.webp",
  "src/assets/physical-qr/display/caretip_classic.thumb.webp",
  "src/assets/physical-qr/display/caretip_classic.preview.webp",
  "src/assets/physical-qr/display/caretip-light.thumb.webp",
  "src/assets/physical-qr/display/caretip-light.preview.webp",
  "src/assets/physical-qr/display/caretip-midnight.thumb.webp",
  "src/assets/physical-qr/display/caretip-midnight.preview.webp",
  "src/assets/physical-qr/display/caretip-nature.thumb.webp",
  "src/assets/physical-qr/display/caretip-nature.preview.webp",
];
for (const rel of displayArt) {
  if (existsSync(path.join(root, rel))) pass(`display derivative present: ${rel}`);
  else fail(`missing display derivative ${rel}`);
}
const artworkModule = readFileSync(path.join(root, "src/app/lib/physicalQrTemplate/artwork.ts"), "utf8");
if (
  artworkModule.includes(".thumb.webp") &&
  artworkModule.includes(".preview.webp") &&
  !artworkModule.includes('from "@/assets/physical-qr/caretip-a5-artwork.png"') &&
  artworkModule.includes('display: PhysicalQrArtworkDisplay = "preview"')
) {
  pass("dashboard artwork uses WebP display derivatives, not print-master PNGs");
} else fail("artwork.ts still bundles print-master PNGs");
const listed = listPhysicalQrTemplates();
const listedIds = listed.map((t) => t.id);
if (listed.length === PHYSICAL_QR_TEMPLATE_IDS.length && new Set(listedIds).size === listed.length) {
  pass("print template registry IDs are unique");
} else fail("print template registry IDs");
if (
  isPhysicalQrTemplateId(PHYSICAL_QR_TEMPLATE_ID) &&
  isPhysicalQrTemplateId(PHYSICAL_QR_TEMPLATE_CLASSIC_ID) &&
  !isPhysicalQrTemplateId("../secret.png") &&
  !isPhysicalQrTemplateId("/tmp/evil.png")
) {
  pass("template IDs are allowlisted; client paths are rejected");
} else fail("template ID allowlist");
if (
  physicalQrOverlayTextColor(PHYSICAL_QR_TEMPLATE_CLASSIC_ID, "#1A1A1A") === PHYSICAL_QR_LIGHT_OVERLAY_TEXT &&
  physicalQrOverlayTextColor(PHYSICAL_QR_TEMPLATE_MIDNIGHT_ID, "#1A1A1A") === PHYSICAL_QR_LIGHT_OVERLAY_TEXT &&
  physicalQrOverlayTextColor(PHYSICAL_QR_TEMPLATE_LIGHT_ID, "#1A1A1A") === "#1A1A1A" &&
  physicalQrOverlayTextColor(PHYSICAL_QR_TEMPLATE_NATURE_ID, "#1A1A1A") === "#1A1A1A" &&
  physicalQrOverlayTextColor(PHYSICAL_QR_TEMPLATE_ID, "#1A1A1A") === "#1A1A1A"
) {
  pass("Classic and Midnight overlay name/address in white; Light/Nature/original stay dark");
} else fail("overlay text color for dark print templates");
const previewSrc = readFileSync(path.join(root, "src/app/components/business/physical-branding/PhysicalQrPreview.tsx"), "utf8");
if (previewSrc.includes("physicalQrOverlayTextColor") && previewSrc.includes("overlayTextColor")) {
  pass("Print QR preview uses template overlay color for name and address");
} else fail("PhysicalQrPreview overlay color");
if (
  previewSrc.includes("object-contain") &&
  previewSrc.includes('containerType: "inline-size"') &&
  previewSrc.includes("NAME_FONT_CQW") &&
  previewSrc.includes("ADDRESS_FONT_CQW") &&
  previewSrc.includes("useSharedPhysicalQrDataUrl") &&
  previewSrc.includes("providedQrDataUrl") &&
  previewSrc.includes("width: 640") &&
  !previewSrc.includes("PREVIEW_LAYOUT_WIDTH") &&
  !previewSrc.includes("100cqw /") &&
  !previewSrc.includes("object-cover") &&
  !previewSrc.includes("0.65rem") &&
  !previewSrc.includes("0.55rem")
) {
  pass("thumb and Preview share one flyer; type scales with cqw; artwork uses object-contain");
} else fail("PhysicalQrPreview thumbnail crop/scale");
if (!previewSrc.includes("transform: `scale")) {
  pass("compact cards no longer layout at 22rem inside overflow-hidden");
} else fail("compact 22rem scale wrapper still present");
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
  routes.includes("path: 'templates'") &&
  routes.includes('Navigate to="/dashboard/qr-studio/print"')
) {
  pass("/templates redirects to QR Studio print");
} else fail("templates route should redirect to print");
if (routes.includes("branding/orders/:orderId") && routes.includes("branding-orders/:orderId")) {
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
  physicalQrDeliveryIsComplete({
    recipientName: "Marie Testerin",
    streetLine: "",
    postalCode: "",
    city: "Berlin",
    country: PHYSICAL_QR_SHIP_COUNTRY,
    email: "marie@example.com",
    phone: "+493012345678",
  })
) {
  pass("delivery without Landmark still enables continue");
} else fail("optional Landmark should not block delivery");

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
  adminDetail.includes("order.items") &&
  adminDetail.includes("line items") &&
  adminDetail.includes("total copies") &&
  !adminDetail.includes("PhysicalQrOrderThread") &&
  !adminDetail.includes("registeredAddress")
) {
  pass("admin order detail has fulfillment controls, line items, and separate internal notes");
} else fail("admin fulfillment controls");

if (
  adminDetail.includes("downloadPlatformPhysicalQrOrderPrint") &&
  adminDetail.includes("onClick={() => void downloadPdf()}") &&
  adminDetail.includes("onClick={() => void run(() => markPlatformPhysicalQrPrinting(order.id))}")
) {
  pass("Download PDF is separate from Mark as printing");
} else fail("Download PDF should stay separate from Mark as printing");

if (
  adminDetail.includes("downloadAllPdfs") &&
  adminDetail.includes("preparingPdfs") &&
  adminDetail.includes("if (downloadingPdf) return") &&
  adminDetail.includes("downloadAllPdfsDone") &&
  adminDetail.includes("loadError") &&
  adminDetail.includes("totalPages = order.quantity") &&
  adminDetail.indexOf("admin.physicalQr.currentStatus") < adminDetail.indexOf("admin.physicalQr.orderItems")
) {
  pass("admin bulk PDF download shows Preparing N PDFs, blocks double-click, and reports combined-file success");
} else fail("admin bulk PDF preparing state");

const overviewPage = readFileSync(path.join(root, "src/app/pages/business/qr-studio/QrStudioOverviewPage.tsx"), "utf8");
const ordersPage = readFileSync(path.join(root, "src/app/pages/business/qr-studio/QrStudioOrdersPage.tsx"), "utf8");
const printStudio = readFileSync(path.join(root, "src/app/components/business/physical-branding/PrintQrStudio.tsx"), "utf8");
const skeletons = readFileSync(
  path.join(root, "src/app/components/business/qr-studio/QrStudioLoadingSkeletons.tsx"),
  "utf8",
);
if (
  skeletons.includes("QrStudioOverviewSkeleton") &&
  skeletons.includes("QrStudioOrderListSkeleton") &&
  skeletons.includes("PrintQrStudioSkeleton") &&
  overviewPage.includes("QrStudioOverviewSkeleton") &&
  ordersPage.includes("QrStudioOrderListSkeleton") &&
  orderDetail.includes("QrStudioOrderDetailSkeleton") &&
  printStudio.includes("PrintQrStudioSkeleton") &&
  printStudio.includes("bootLoading")
) {
  pass("QR Studio pages use layout-preserving skeleton loading");
} else fail("QR Studio skeleton loading");

const printLoadErrorAt = printStudio.indexOf("if (loadError)");
const printEmptyAt = printStudio.indexOf("emptyLocation");
const printBootAt = printStudio.indexOf("if (bootLoading)");
if (
  printBootAt >= 0 &&
  printLoadErrorAt > printBootAt &&
  printEmptyAt > printLoadErrorAt &&
  printStudio.includes("PrintQrStudioSkeleton") &&
  !printStudio.slice(printLoadErrorAt, printEmptyAt).includes("emptyLocation")
) {
  pass("Print QR Studio loading/error/empty are mutually exclusive");
} else fail("Print QR Studio loading/error/empty overlap");

const qrManagement = readFileSync(path.join(root, "src/app/pages/business/QRCodeManagementPage.tsx"), "utf8");
if (
  qrManagement.includes("venueLoading") &&
  qrManagement.includes("venueError") &&
  qrManagement.includes("DashboardListSkeleton") &&
  qrManagement.includes("business.qrPage.noLocations")
) {
  pass("Locations QR page distinguishes loading, error, and empty");
} else fail("Locations QR loading/error/empty");
if (
  overviewPage.includes("Promise.all") &&
  overviewPage.includes('qrStudioViewPath("business")') &&
  overviewPage.includes('qrStudioPrintPath("business")') &&
  overviewPage.includes("ordersEmptyTitle") &&
  overviewPage.includes("countTeam") &&
  !overviewPage.includes("countActive") &&
  !overviewPage.includes("PhysicalQrPreview") &&
  !overviewPage.includes("qrcode") &&
  !overviewPage.includes("quotePhysicalQrCart") &&
  ordersPage.includes("QrStudioOrderListSkeleton") &&
  orderDetail.includes("if (loadError)") &&
  qrManagement.includes("venueLoading")
) {
  pass("QR Studio overview, orders, detail, and category pages keep loading distinct from empty");
} else fail("QR Studio navigation/loading surfaces");

const platformOrders = readFileSync(
  path.join(root, "src/app/pages/platform/PlatformPhysicalQrOrdersPage.tsx"),
  "utf8",
);
if (
  platformOrders.includes("error ?") &&
  platformOrders.includes("admin.physicalQr.empty") &&
  platformOrders.includes("aria-busy") &&
  !platformOrders.includes("downloadPlatformPhysicalQrOrdersZip") &&
  !platformOrders.includes("downloadPaidPdfs")
) {
  pass("Admin QR order list distinguishes loading/error/empty and has no list-level Download all PDFs");
} else fail("Admin QR order list loading/error/empty");

if (
  platformOrders.includes("platform-physical-qr") &&
  platformOrders.includes("whitespace-normal") &&
  platformOrders.includes("break-words") &&
  platformOrders.includes("min-w-0")
) {
  pass("Admin physical branding order list wraps filter chips and order copy on mobile");
} else fail("Admin physical branding order list mobile wrap");

if (
  adminDetail.includes("platform-physical-qr") &&
  adminDetail.includes("lg:hidden") &&
  adminDetail.includes("hidden") &&
  adminDetail.includes("lg:block") &&
  adminDetail.includes("whitespace-normal") &&
  adminDetail.includes("break-words")
) {
  pass("Admin physical branding order detail stacks items and wraps actions on mobile");
} else fail("Admin physical branding order detail mobile layout");

if (
  printStudio.includes("print-qr-studio__actions") &&
  printStudio.includes("break-words") &&
  printStudio.includes("ring-inset") &&
  !printStudio.includes("-mx-3") &&
  !printStudio.includes("truncate font-medium")
) {
  pass("Print QR studio keeps labels and actions inside the mobile viewport");
} else fail("Print QR studio mobile overflow");

if (
  orderUi.includes("isPhysicalQrIncludedOrder") &&
  orderUi.includes("orderReceived") &&
  orderUi.includes("stepOrderReceived") &&
  orderDetail.includes("orderReceivedProcessing")
) {
  pass("Pro zero-cost orders use Order received copy instead of Payment received");
} else fail("Pro order received messaging");
if (
  orderUi.includes("PHYSICAL_QR_QUANTITY_MIN = 1") &&
  orderUi.includes("PHYSICAL_QR_QUANTITY_MAX = 50") &&
  orderUi.includes("clampPhysicalQrQuantity")
) {
  pass("quantity clamp constants 1–50 in physicalQrOrderUi");
} else fail("quantity clamp constants");
if (
  printStudio.includes("function QuantityStepper") &&
  printStudio.includes("setLineQuantity") &&
  printStudio.includes("clampPhysicalQrQuantity") &&
  printStudio.includes("onQuantityChange") &&
  printStudio.includes("quantity: line.quantity")
) {
  pass("PrintQrStudio cart has quantity stepper and sends line quantities");
} else fail("PrintQrStudio quantity controls");
if (
  printStudio.includes("previewProductId") &&
  printStudio.includes("Eye") &&
  printStudio.includes("Dialog") &&
  printStudio.includes("max-w-[8.5rem]") &&
  printStudio.includes("max-w-[22rem]") &&
  !printStudio.includes("lg:sticky") &&
  printStudio.includes("noTemplates") &&
  printStudio.indexOf("if (bootLoading)") < printStudio.indexOf("noTemplates")
) {
  pass("Print QR cards are compact, preview is eye/dialog-only, loading stays distinct from empty");
} else fail("Print QR template card/preview UX");
if (
  !printStudio.includes("print-location-filter") &&
  printStudio.includes("locationLocked") &&
  printStudio.includes("qrContextType === \"location\"") &&
  printStudio.includes("quotePhysicalQrPrints") &&
  printStudio.includes("quotePhysicalQrCart") &&
  printStudio.includes("downgradeCartReset") &&
  printStudio.includes("QUOTA_CHANGED") &&
  printStudio.includes("payPhysicalQrBatch") &&
  printStudio.includes("useSharedPhysicalQrDataUrl") &&
  printStudio.includes("qrDataUrl={sharedQrDataUrl}") &&
  printStudio.includes("250") &&
  !printStudio.includes("checkoutPhysicalQrBatch") &&
  !printStudio.includes("createPhysicalQrBatch(")
) {
  pass("PrintQrStudio has location lock notice without a duplicate location dropdown");
} else fail("PrintQrStudio Albertina location/quote delta missing");

const pricing = readFileSync(path.join(root, "src/app/lib/physicalQrPricing.ts"), "utf8");
if (
  pricing.includes("PHYSICAL_QR_PACKAGE_CENTS = 1490") &&
  pricing.includes("PHYSICAL_QR_EXTRA_PRINT_CENTS = 130") &&
  pricing.includes("PHYSICAL_QR_PRO_FREE_INCLUDED_PRINTS = 8")
) {
  pass("Frontend quote constants match Albertina package");
} else fail("Frontend quote constants");

const basic4 = quotePhysicalQrPrints({ printCount: 4, printingIncludedEligible: false, freeOrderAvailable: false });
const pro9 = quotePhysicalQrPrints({ printCount: 9, printingIncludedEligible: true, freeOrderAvailable: true });
if (basic4.totalCents === 1490 && pro9.totalCents === 130) {
  pass("Frontend quote matches Albertina 4-print package and Pro extra prints");
} else fail(`Frontend quote got basic4=${basic4.totalCents} pro9=${pro9.totalCents}`);

const grouped = groupPhysicalQrItemsByLocation([
  { locationName: "Location A", id: "1" },
  { locationName: "Location B", id: "2" },
  { locationName: "Location A", id: "3" },
]);
if (grouped.length === 2 && grouped[0]?.items.length === 2 && grouped[1]?.items.length === 1) {
  pass("Order items group by location without duplicating lines");
} else fail("location grouping helper");

const apiSrc = readFileSync(path.join(root, "src/app/lib/api.ts"), "utf8");
if (apiSrc.includes("quotePhysicalQrCart") && apiSrc.includes("/api/business/physical-qr/quote")) {
  pass("Frontend can request server-side physical QR quote");
} else fail("missing quotePhysicalQrCart API");
const createOrderFn = apiSrc.slice(
  apiSrc.indexOf("export async function createPhysicalQrOrder"),
  apiSrc.indexOf("export async function checkoutPhysicalQrOrder"),
);
const createBatchFn = apiSrc.slice(
  apiSrc.indexOf("export async function createPhysicalQrBatch"),
  apiSrc.indexOf("export async function checkoutPhysicalQrBatch"),
);
const payBatchFn = apiSrc.slice(
  apiSrc.indexOf("export async function payPhysicalQrBatch"),
  apiSrc.indexOf("export type PhysicalQrAdminOrder"),
);
if (
  !createOrderFn.includes("monthlyFreeQuotaApplied") &&
  !createOrderFn.includes("freeOrderAvailable") &&
  !createOrderFn.includes("totalAmount") &&
  !createBatchFn.includes("monthlyFreeQuotaApplied") &&
  !createBatchFn.includes("totalAmount") &&
  !payBatchFn.includes("monthlyFreeQuotaApplied") &&
  !payBatchFn.includes("totalAmount") &&
  apiSrc.includes("/api/business/physical-qr/orders/batch/pay")
) {
  pass("Frontend create payloads cannot send quota consumption or totals");
} else fail("frontend create still sends quota or totals");
if (
  apiSrc.includes("downloadPlatformPhysicalQrOrdersZip") &&
  apiSrc.includes("/api/platform/physical-qr/orders/print-bulk") &&
  apiSrc.includes("downloadPlatformPhysicalQrOrderPrint")
) {
  pass("Admin bulk ZIP and individual PDF download helpers both exist");
} else fail("missing bulk ZIP or individual PDF download helper");

const nav = readFileSync(path.join(root, "src/app/components/business/businessDashboardNav.ts"), "utf8");
if (!nav.includes("qr-studio/templates")) pass("Templates nav entry removed");
else fail("Templates nav still present");

const failed = results.filter((r) => r.startsWith("FAIL"));
for (const line of results) console.log(line);
console.log(`\nPhysical QR frontend: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
