/**
 * Regression locks for file/QR security remediation (2026-09).
 * Run: npm run test:security-remediation (backend)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const qrScanRoutes = read("src/routes/qrScan.routes.ts");
assert(
  qrScanRoutes.includes("qrScanRateLimit") && qrScanRoutes.includes('post("/scan", qrScanRateLimit'),
  "POST /api/qr/scan must use qrScanRateLimit",
);

const qrScanMw = read("src/middleware/qrScanRateLimit.middleware.ts");
assert(qrScanMw.includes("SEC_QR_SCAN_IP_MAX_PER_15M"), "QR scan limit must be env-configurable");

const imageVal = read("src/lib/imageUploadValidation.ts");
assert(imageVal.includes("assertImageDimensionsWithinLimits"), "Image upload must enforce dimensions");

const dim = read("src/lib/imageDimensionValidation.ts");
assert(dim.includes("MAX_IMAGE_EDGE_PX") && dim.includes("readPngDimensions"), "Dimension helpers present");

const branded = read("src/lib/brandedQrTargetUrl.ts");
assert(branded.includes("assertCareTipBrandedQrTargetUrl"), "Branded QR target URL validator required");

const render = read("src/services/qr/brandedQrRender.service.ts");
assert(
  render.includes('mode === "manager"') && render.includes("assertCareTipBrandedQrTargetUrl"),
  "Manager branded QR must validate targetUrl",
);

const businessRoutes = read("src/routes/business.routes.ts");
assert(
  businessRoutes.includes("uploadKycRateLimit") && businessRoutes.includes("uploadImageRateLimit"),
  "Business upload routes must use upload rate limits",
);

const employeeRoutes = read("src/routes/employee.routes.ts");
assert(employeeRoutes.includes("uploadImageRateLimit"), "Employee avatar upload must be rate limited");

const secCfg = read("src/config/securityRateLimit.config.ts");
assert(secCfg.includes("uploadImage") && secCfg.includes("uploadKyc"), "Security config must define upload limits");

import { assertCareTipBrandedQrTargetUrl } from "../src/lib/brandedQrTargetUrl.js";
import { BrandedQrInvalidTargetUrlError } from "../src/services/qr/brandedQr.errors.js";
import {
  readPngDimensions,
  MAX_IMAGE_EDGE_PX,
} from "../src/lib/imageDimensionValidation.js";
import { validateImageBufferForUpload } from "../src/lib/imageUploadValidation.js";

const origin = process.env.PUBLIC_APP_ORIGIN ?? "https://caretip.de";
const good = `${origin.replace(/\/$/, "")}/qr/employee/emp_test_123`;
assert(assertCareTipBrandedQrTargetUrl(good) === good || assertCareTipBrandedQrTargetUrl(good).startsWith("http"), "CareTip employee URL accepted");

let threw = false;
try {
  assertCareTipBrandedQrTargetUrl("https://evil.example/phish");
} catch (e) {
  threw = e instanceof BrandedQrInvalidTargetUrlError;
}
assert(threw, "External branded QR target must be rejected");

try {
  assertCareTipBrandedQrTargetUrl("javascript:alert(1)");
  assert(false, "javascript URL must throw");
} catch (e) {
  assert(e instanceof BrandedQrInvalidTargetUrlError, "javascript scheme rejected");
}

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
validateImageBufferForUpload(tinyPng, "image/png");

function hugePng(w: number, h: number): Buffer {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  const chunk = Buffer.concat([Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), ihdrData]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk,
    Buffer.alloc(8, 0),
  ]);
}

const dimHuge = readPngDimensions(hugePng(MAX_IMAGE_EDGE_PX + 1, 8));
assert(dimHuge && dimHuge.width > MAX_IMAGE_EDGE_PX, "PNG dimension reader detects oversized width");

let dimRejected = false;
try {
  validateImageBufferForUpload(hugePng(MAX_IMAGE_EDGE_PX + 1, 8), "image/png");
} catch {
  dimRejected = true;
}
assert(dimRejected, "Oversized PNG dimensions must be rejected");

console.log("security-remediation-runtime: ok");
