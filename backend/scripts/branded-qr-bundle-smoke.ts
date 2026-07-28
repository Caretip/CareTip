import { resolveQrRenderBundlePath } from "../src/qr/resolveQrRenderBundlePath.js";
import { installNodeQrCanvas } from "../src/qr/installNodeQrCanvas.js";
import { pathToFileURL } from "node:url";

async function main() {
  const bundlePath = resolveQrRenderBundlePath();
  console.log("[bundle-smoke] path:", bundlePath);
  const bundle = await import(pathToFileURL(bundlePath).href);
  installNodeQrCanvas(bundle);
  const branding = bundle.buildUnifiedQrBrandingOptions({
    premium: false,
    settings: {},
    registeredBusinessName: "Demo Venue",
    profile: { name: "Demo Venue" },
    businessId: "test",
    sessionFallbackName: "Demo Venue",
  });
  const png = await bundle.renderBrandedQrUrlToDataUrl("https://caretip.de/demo/staff", branding);
  console.log("[bundle-smoke] ok", png.startsWith("data:image/png"), "len", png.length);
}

main().catch((err) => {
  console.error("[bundle-smoke] FAILED", err);
  process.exit(1);
});
