/**
 * Copies self-hosted Inter + Manrope assets into public/fonts for
 * absolute /fonts/... URLs in caretip-font-faces.css.
 *
 * Inter: use the same @fontsource latin .woff files the app used before
 * (this package build does not ship matching .woff2 for those weights).
 * Manrope: .woff2 as before.
 */
import { copyFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fontAssets = [
  [
    "@fontsource/inter/files/inter-latin-400-normal.woff",
    "public/fonts/inter/inter-latin-400-normal.woff",
  ],
  [
    "@fontsource/inter/files/inter-latin-500-normal.woff",
    "public/fonts/inter/inter-latin-500-normal.woff",
  ],
  [
    "@fontsource/inter/files/inter-latin-600-normal.woff",
    "public/fonts/inter/inter-latin-600-normal.woff",
  ],
  [
    "@fontsource/inter/files/inter-latin-700-normal.woff",
    "public/fonts/inter/inter-latin-700-normal.woff",
  ],
  [
    "@fontsource/inter/files/inter-latin-800-normal.woff",
    "public/fonts/inter/inter-latin-800-normal.woff",
  ],
  [
    "@fontsource/manrope/files/manrope-latin-600-normal.woff2",
    "public/fonts/manrope/manrope-latin-600.woff2",
  ],
  [
    "@fontsource/manrope/files/manrope-latin-700-normal.woff2",
    "public/fonts/manrope/manrope-latin-700.woff2",
  ],
  [
    "@fontsource/manrope/files/manrope-latin-800-normal.woff2",
    "public/fonts/manrope/manrope-latin-800.woff2",
  ],
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

for (const [fromRel, toRel] of fontAssets) {
  const src = join(root, "node_modules", fromRel);
  const dest = join(root, toRel);
  if (!(await exists(src))) {
    throw new Error(`Missing font asset: ${fromRel}`);
  }
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

await copyFile(
  join(root, "src/styles/caretip-font-faces.css"),
  join(root, "public/caretip-font-faces.css"),
);

console.log(`Synced ${fontAssets.length} font files + public/caretip-font-faces.css`);
