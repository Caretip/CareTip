import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate qr-render.bundle.mjs whether the server runs from src/ (tsx) or dist/ (node).
 */
export function resolveQrRenderBundlePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "../qr-render.bundle.mjs"),
    path.join(here, "../../dist/qr-render.bundle.mjs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `QR render bundle not found. Run "npm run build:qr-render". Checked: ${candidates.join(", ")}`,
  );
}
