/**
 * Builds dashboard-only WebP derivatives of Physical QR artwork.
 * Does NOT overwrite print masters in src/assets/physical-qr/*.png or template/.
 */
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src", "assets", "physical-qr");
const outDir = join(srcDir, "display");

const MASTERS = [
  "caretip-a5-artwork.png",
  "caretip_classic.png",
  "caretip-light.png",
  "caretip-midnight.png",
  "caretip-nature.png",
];

const VARIANTS = [
  { suffix: "thumb", width: 420, quality: 78 },
  { suffix: "preview", width: 704, quality: 80 },
];

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const file of MASTERS) {
    const input = join(srcDir, file);
    const base = file.replace(/\.png$/i, "");
    const masterBytes = (await stat(input)).size;
    for (const variant of VARIANTS) {
      const output = join(outDir, `${base}.${variant.suffix}.webp`);
      await sharp(input)
        .resize({ width: variant.width, withoutEnlargement: true })
        .webp({ quality: variant.quality })
        .toFile(output);
      const outBytes = (await stat(output)).size;
      console.log(
        `${file} ${variant.suffix}: ${(masterBytes / 1024).toFixed(1)} KiB PNG → ${(outBytes / 1024).toFixed(1)} KiB webp @${variant.width}w`,
      );
    }
  }
}

await main();
