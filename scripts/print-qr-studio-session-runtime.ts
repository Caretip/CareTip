/**
 * Order Print session cache: business-scoped snapshot, QR reuse, logout wipe.
 * Run: npm run test:print-qr-studio-session
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearPrintQrStudioSessionCache,
  getCachedPrintQrDataUrl,
  printQrStudioCacheKey,
  readPrintQrStudioSnapshot,
  setCachedPrintQrDataUrl,
  writePrintQrStudioSnapshot,
  type PrintQrStudioSnapshot,
} from "../src/app/lib/printQrStudioSessionCache";
import { resetAllClientSessionCaches } from "../src/app/lib/resetAllClientSessionCaches";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function sampleSnapshot(businessId: string, label: string): PrintQrStudioSnapshot {
  return {
    businessId,
    products: [
      {
        id: `${businessId}-product`,
        name: label,
        description: "",
        templateId: "caretip-a5",
        supportsAddress: true,
        active: true,
        orderable: true,
        currency: "EUR",
        priceCents: 0,
        priceConfigured: true,
        checkoutReady: true,
        checkoutBlock: null,
      },
    ],
    productId: `${businessId}-product`,
    contexts: {
      storefront: { id: businessId, label },
      employees: [],
      locations: [],
      tables: [],
      primaryLocationId: null,
      freeOrderAvailable: true,
    },
    cart: [
      {
        id: "storefront:storefront",
        qrContextType: "storefront",
        label,
        quantity: 1,
      },
    ],
    printAddress: `${label} street`,
    recipientName: label,
    streetLine: "1 Main",
    city: "Berlin",
    contactEmail: `${businessId}@example.test`,
    contactPhone: "",
    previewTargetUrl: `https://caretip.app/b/${businessId}`,
  };
}

clearPrintQrStudioSessionCache();

if (printQrStudioCacheKey("biz-a") === "print-qr-studio:biz-a") {
  pass("Cache key is prefixed and business-scoped");
} else {
  fail("printQrStudioCacheKey drifted");
}

writePrintQrStudioSnapshot(sampleSnapshot("biz-a", "Alpha"));
writePrintQrStudioSnapshot(sampleSnapshot("biz-b", "Beta"));

const readA = readPrintQrStudioSnapshot("biz-a");
const readB = readPrintQrStudioSnapshot("biz-b");
const readMissing = readPrintQrStudioSnapshot("biz-c");

if (readA?.recipientName === "Alpha" && readA.cart[0]?.label === "Alpha" && readA.businessId === "biz-a") {
  pass("First visit snapshot is readable for business A");
} else {
  fail("Business A snapshot missing");
}

if (readB?.recipientName === "Beta" && readA?.recipientName === "Alpha") {
  pass("Business B snapshot does not overwrite business A");
} else {
  fail("Cross-business snapshot isolation failed");
}

if (readMissing == null) {
  pass("Unknown business has no snapshot");
} else {
  fail("Missing business returned a snapshot");
}

setCachedPrintQrDataUrl("biz-a", "https://caretip.app/b/biz-a", "data:image/png;base64,AAA");
setCachedPrintQrDataUrl("biz-b", "https://caretip.app/b/biz-a", "data:image/png;base64,BBB");

if (getCachedPrintQrDataUrl("biz-a", "https://caretip.app/b/biz-a") === "data:image/png;base64,AAA") {
  pass("QR data URL is reused for the same business + destination");
} else {
  fail("QR data URL cache miss for business A");
}

if (getCachedPrintQrDataUrl("biz-b", "https://caretip.app/b/biz-a") === "data:image/png;base64,BBB") {
  pass("Same destination URL is isolated per business for QR data URLs");
} else {
  fail("QR data URL leaked across businesses");
}

if (getCachedPrintQrDataUrl("biz-a", "https://caretip.app/b/other") == null) {
  pass("QR destination change does not reuse the previous data URL");
} else {
  fail("QR cache returned a data URL for a different destination");
}

resetAllClientSessionCaches();

if (readPrintQrStudioSnapshot("biz-a") == null && getCachedPrintQrDataUrl("biz-a", "https://caretip.app/b/biz-a") == null) {
  pass("Logout/session reset clears Order Print snapshot and QR data URLs");
} else {
  fail("Session reset left Order Print cache in place");
}

const printStudio = read("src/app/components/business/physical-branding/PrintQrStudio.tsx");
if (
  printStudio.includes("readPrintQrStudioSnapshot") &&
  printStudio.includes("useState(() => !initialSnapshot)") &&
  printStudio.includes("fetchPhysicalQrContexts({ revalidate: true })") &&
  printStudio.includes("writePrintQrStudioSnapshot")
) {
  pass("PrintQrStudio hydrates from session snapshot then quietly revalidates contexts");
} else {
  fail("PrintQrStudio missing cache-first boot / quiet revalidate");
}

if (printStudio.includes("if (!snap)") && printStudio.includes("setLoadError")) {
  pass("Failed revalidate does not replace a successful cached snapshot with an error screen");
} else {
  fail("Error handling may wipe cached Order Print content");
}

if (
  printStudio.includes("invalidatePhysicalQrContextsClientCache()") &&
  printStudio.includes("setCart([])")
) {
  pass("Successful order invalidates quota context cache and clears the cart");
} else {
  fail("Post-order cache/cart invalidation missing");
}

if (printStudio.includes('hasFeature("physicalQrPrinting")')) {
  pass("physicalQrPrinting entitlement gate is unchanged");
} else {
  fail("Order Print entitlement check drifted");
}

const cacheMod = read("src/app/lib/printQrStudioSessionCache.ts");
if (
  !printStudio.includes("localStorage") &&
  !cacheMod.includes("localStorage.setItem") &&
  !cacheMod.includes("window.localStorage")
) {
  pass("Order Print session cache does not use localStorage");
} else {
  fail("Order Print cache wrote localStorage");
}

const preview = read("src/app/components/business/physical-branding/PhysicalQrPreview.tsx");
if (preview.includes("getCachedPrintQrDataUrl") && preview.includes("setCachedPrintQrDataUrl")) {
  pass("Shared QR preview reuses a session data URL instead of re-encoding on remount");
} else {
  fail("PhysicalQrPreview still always regenerates the QR data URL");
}

const reset = read("src/app/lib/resetAllClientSessionCaches.ts");
if (reset.includes("clearPrintQrStudioSessionCache") && reset.includes("clearPhysicalQrPrintClientCache")) {
  pass("resetAllClientSessionCaches wipes Order Print snapshot and API client caches");
} else {
  fail("Logout cache reset missing Order Print clears");
}

const api = read("src/app/lib/api.ts");
if (
  api.includes("physicalQrCatalogInflight") &&
  api.includes("fetchPhysicalQrContexts(opts?:") &&
  api.includes("clearPhysicalQrPrintClientCache")
) {
  pass("Catalog/context fetches are session-deduped with explicit revalidate");
} else {
  fail("Physical QR API client cache missing");
}

const routes = read("src/app/routes.tsx");
if (routes.includes("qr-studio/QrStudioPrintPage") && routes.includes("path: 'print'")) {
  pass("Order Print remains a lazy child route (component still remounts; data is cached)");
} else {
  fail("Order Print route drifted");
}

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} print-qr-studio-session check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} print-qr-studio-session checks passed`);
