/**
 * Digital plain QR API render vs Physical A5 print pipeline (no HTTP).
 * Run from backend: npm run test:digital-plain-qr
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDigitalPlainQrPngBuffer } from "../src/services/qr/digitalPlainQrPng.ts";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const backendRoot = path.dirname(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = path.resolve(backendRoot, "..");

function readBackend(rel: string): string {
  return readFileSync(path.join(backendRoot, rel), "utf8");
}

function existsRepo(rel: string): boolean {
  return existsSync(path.join(repoRoot, rel));
}

const png = await renderDigitalPlainQrPngBuffer("https://caretip.de/qr/table/demo-table-id");
if (png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47 && png.length > 200) {
  pass(`digital plain QR PNG generated (${png.length} bytes)`);
} else fail("digital plain QR PNG");

const renderService = readBackend("src/services/qr/brandedQrRender.service.ts");
if (renderService.includes("renderDigitalPlainQrPngBuffer") && renderService.includes("DIGITAL_PLAIN_QR_FINGERPRINT")) {
  pass("mobile branded-QR service uses digital plain PNG");
} else fail("mobile branded-QR service still on template engine");
if (!renderService.includes("physicalQr") && !renderService.includes("renderBrandedQrUrlToDataUrl")) {
  pass("mobile QR service does not import Physical pipeline or branded card renderer");
} else fail("mobile QR service coupling");

const pipeline = readBackend("src/lib/physicalQr/printPipeline.ts");
if (pipeline.includes("renderPhysicalQrSvg") && pipeline.includes("qrPngDataUrl")) {
  pass("Physical print pipeline still present");
} else fail("Physical print pipeline missing");
if (!pipeline.includes("digitalPlainQrPng") && !pipeline.includes("plainQr.ts")) {
  pass("Physical print pipeline does not import digital plain QR");
} else fail("Physical print pipeline imported digital plain QR");

for (const rel of [
  "src/app/lib/qrTemplateEngine/registry.ts",
  "src/app/components/business/settings/QrTemplatePicker.tsx",
  "src/app/components/business/QrStudioDesigner.tsx",
  "src/assets/physical-qr/caretip-a5-artwork.png",
]) {
  if (existsRepo(rel)) pass(`required file still present ${rel}`);
  else fail(`missing ${rel}`);
}

const failed = results.filter((r) => r.startsWith("FAIL"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} digital plain QR backend check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} digital plain QR backend checks passed`);
