/**
 * Syncs official CareTip brand files into public/ for boot splash, favicons pipeline, and email hotlinks.
 * Run from prebuild (and on demand).
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const brandDir = join(root, "src/assets/brand");
const publicBrand = join(root, "public/brand");

await mkdir(publicBrand, { recursive: true });

await copyFile(join(brandDir, "App-Icon_S.svg"), join(publicBrand, "caretip-app-icon.svg"));
await copyFile(join(brandDir, "CareTip_Primary.svg"), join(publicBrand, "caretip-logo-primary.svg"));
await copyFile(
  join(brandDir, "CareTip_Primary-TagLine.svg"),
  join(publicBrand, "caretip-logo-tagline.svg"),
);

async function svgToPng(svgName, outName, width) {
  const buf = await readFile(join(brandDir, svgName));
  await sharp(buf, { density: 300 })
    .resize({ width, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(publicBrand, outName));
  console.log(`Wrote public/brand/${outName}`);
}

await svgToPng("CareTip_Primary.svg", "caretip-logo-primary.png", 640);
await svgToPng("CareTip_Primary-TagLine.svg", "caretip-logo-tagline.png", 800);

const iconPng = await readFile(join(brandDir, "App-Icon_L.png"));
await sharp(iconPng)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(join(publicBrand, "caretip-app-icon.png"));
console.log("Wrote public/brand/caretip-app-icon.png");

console.log("Brand public assets synced.");
