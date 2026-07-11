/**
 * Copies self-hosted Manrope woff2 assets into public/fonts for
 * early <link rel="preload"> on marketing pages.
 * Inter is bundled via Vite (@fontsource) — see src/styles/caretip-inter-vite.css.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const manropeAssets = [
  ["@fontsource/manrope/files/manrope-latin-600-normal.woff2", "public/fonts/manrope/manrope-latin-600.woff2"],
  ["@fontsource/manrope/files/manrope-latin-700-normal.woff2", "public/fonts/manrope/manrope-latin-700.woff2"],
  ["@fontsource/manrope/files/manrope-latin-800-normal.woff2", "public/fonts/manrope/manrope-latin-800.woff2"],
];

await Promise.all(
  manropeAssets.map(async ([fromRel, toRel]) => {
    const dest = join(root, toRel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(root, "node_modules", fromRel), dest);
  }),
);

await copyFile(
  join(root, "src/styles/caretip-font-faces.css"),
  join(root, "public/caretip-font-faces.css"),
);

console.log(`Synced ${manropeAssets.length} Manrope font files + public/caretip-font-faces.css`);
