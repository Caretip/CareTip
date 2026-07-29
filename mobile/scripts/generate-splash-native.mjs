/**
 * Generates mobile/assets/splash-native.png — 1024×1024, transparent, centered lockup.
 * Orange fill comes from app.json backgroundColor (#EB992C), not the PNG.
 *
 * Usage: node scripts/generate-splash-native.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");
const svgPath = path.join(mobileRoot, "assets/brand/CareTip_White-TagLine.svg");
const outPath = path.join(mobileRoot, "assets/splash-native.png");

const CANVAS = 1024;
/** Logo occupies ~66% width — leaves ~17% transparent padding per side. */
const LOGO_MAX_WIDTH = 680;

async function main() {
  const logoBuffer = await sharp(svgPath)
    .resize({ width: LOGO_MAX_WIDTH, fit: "inside" })
    .png()
    .toBuffer();

  const meta = await sharp(logoBuffer).metadata();
  const width = meta.width ?? LOGO_MAX_WIDTH;
  const height = meta.height ?? Math.round(LOGO_MAX_WIDTH * 0.31);
  const left = Math.round((CANVAS - width) / 2);
  const top = Math.round((CANVAS - height) / 2);

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logoBuffer, left, top }])
    .png()
    .toFile(outPath);

  const verify = await sharp(outPath).metadata();
  console.log(`Wrote ${outPath}`);
  console.log(`  size: ${verify.width}x${verify.height}, alpha: ${verify.hasAlpha}`);
  console.log(`  logo: ${width}x${height} @ (${left}, ${top})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
