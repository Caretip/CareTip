/**
 * Digital plain QR vs Physical A5 separation (no browser).
 * Run: npm run test:digital-plain-qr-frontend
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(path.join(root, rel));
}

for (const rel of [
  "src/app/lib/qrTemplateEngine/registry.ts",
  "src/app/lib/qrTemplateEngine/renderer.ts",
  "src/app/components/business/settings/QrTemplatePicker.tsx",
  "src/app/components/business/QrStudioDesigner.tsx",
]) {
  if (exists(rel)) pass(`digital template infra still present ${rel}`);
  else fail(`missing ${rel}`);
}

if (exists("src/app/lib/plainQr.ts")) pass("digital plain QR helper exists");
else fail("missing src/app/lib/plainQr.ts");

const plainQr = read("src/app/lib/plainQr.ts");
if (
  plainQr.includes("PLAIN_QR_MODULE_DARK") &&
  plainQr.includes("#000000") &&
  plainQr.includes("QR_QUIET_ZONE_MODULES") &&
  !plainQr.includes("physicalQr") &&
  !plainQr.includes("caretip-a5") &&
  !plainQr.includes("qrTemplateEngine")
) {
  pass("plain QR is matrix-only and does not import Physical/template engine");
} else fail("plain QR helper coupling");

const management = read("src/app/pages/business/QRCodeManagementPage.tsx");
if (management.includes("renderPlainQrUrlToDataUrl") && management.includes("validatePlainQrReliability")) {
  pass("QR management uses digital plain QR");
} else fail("QR management still on branded renderer");
if (!management.includes("renderBrandedQrUrlToDataUrl")) pass("QR management does not call branded renderer");
else fail("QR management still calls branded renderer");
if (management.includes("onVenuePrint") && management.includes("storefrontQrItem")) {
  pass("storefront print/PDF wired");
} else fail("storefront print/PDF not wired");

const card = read("src/app/components/business/QrManagementCard.tsx");
if (card.includes("const showPreviewActions = Boolean(previewDataUrl);")) {
  pass("employee Preview/PNG restored");
} else fail("employee Preview/PNG still hidden");

const tables = read("src/app/pages/business/TablesPage.tsx");
if (
  tables.includes("renderPlainQrUrlToDataUrl") &&
  tables.includes("downloadQrDataUrlPng") &&
  tables.includes("printQrDataUrl") &&
  tables.includes("qrTableUrl")
) {
  pass("Tables page has plain QR preview/download/print");
} else fail("Tables page missing plain QR actions");
if (!tables.includes("qrSlug") || tables.includes("qrTableUrl(tableId)") || tables.includes("qrTableUrl(row.id)")) {
  pass("Tables page keeps /qr/table/{id}");
} else fail("Tables URL changed");

const designer = read("src/app/components/business/QrStudioDesigner.tsx");
if (designer.includes("renderBrandedQrUrlToDataUrl")) pass("digital designer still uses branded template engine");
else fail("designer lost branded renderer");

const brandingPage = read("src/app/pages/business/qr-studio/QrStudioBrandingPage.tsx");
if (brandingPage.includes("PhysicalBrandingStudio") && !brandingPage.includes("QrStudioDesigner")) {
  pass("Branding route remains Physical-only");
} else fail("Branding route mixed with digital designer");

const physicalPreview = read("src/app/components/business/physical-branding/PhysicalQrPreview.tsx");
if (!physicalPreview.includes("plainQr") && physicalPreview.includes("caretip-a5-artwork")) {
  pass("Physical preview still uses A5 artwork, not digital plainQr");
} else fail("Physical preview coupling");

const physicalStudio = read("src/app/components/business/physical-branding/PhysicalBrandingStudio.tsx");
if (!physicalStudio.includes("from \"../../lib/plainQr\"") && !physicalStudio.includes("from \"@/app/lib/plainQr\"")) {
  pass("PhysicalBrandingStudio does not import digital plainQr");
} else fail("PhysicalBrandingStudio imported plainQr");

const png = await QRCode.toBuffer("https://caretip.de/demo-venue/demo-staff", {
  type: "png",
  errorCorrectionLevel: "H",
  margin: 4,
  width: 256,
  color: { dark: "#000000", light: "#FFFFFF" },
});
if (png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47) {
  pass("qrcode library emits PNG for a digital guest URL");
} else fail("qrcode PNG header");

const failed = results.filter((r) => r.startsWith("FAIL"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} digital plain QR frontend check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} digital plain QR frontend checks passed`);
