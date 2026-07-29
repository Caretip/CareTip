/**
 * Generates splash assets — icon-only on transparent canvas.
 * Orange fill comes from app.json backgroundColor (#EB992C), not the PNG.
 *
 * Outputs:
 *   assets/splash-icon-white.png  — 512×512 icon for in-app splash
 *   assets/splash-native.png      — 1024×1024 for native expo-splash-screen
 *
 * Usage: node scripts/generate-splash-native.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");
const svgPath = path.join(mobileRoot, "assets/brand/CareTip_Icon_White.svg");
const iconOutPath = path.join(mobileRoot, "assets/splash-icon-white.png");
const splashOutPath = path.join(mobileRoot, "assets/splash-native.png");

const ICON_CANVAS = 512;
const SPLASH_CANVAS = 1024;
/** Icon occupies ~42% of splash width — safe inside Android 12 circular mask. */
const SPLASH_ICON_MAX_WIDTH = 430;

async function renderIcon(maxWidth) {
  return sharp(svgPath)
    .resize({ width: maxWidth, fit: "inside" })
    .png()
    .toBuffer();
}

async function writeCenteredIcon(canvasSize, iconMaxWidth, outPath) {
  const logoBuffer = await renderIcon(iconMaxWidth);
  const meta = await sharp(logoBuffer).metadata();
  const width = meta.width ?? iconMaxWidth;
  const height = meta.height ?? Math.round(iconMaxWidth * 0.58);
  const left = Math.round((canvasSize - width) / 2);
  const top = Math.round((canvasSize - height) / 2);

  await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logoBuffer, left, top }])
    .png()
    .toFile(outPath);

  return { width, height, left, top, canvasSize };
}

async function main() {
  const iconMeta = await writeCenteredIcon(ICON_CANVAS, 320, iconOutPath);
  const splashMeta = await writeCenteredIcon(
    SPLASH_CANVAS,
    SPLASH_ICON_MAX_WIDTH,
    splashOutPath,
  );

  console.log(`Wrote ${iconOutPath}`);
  console.log(`  icon ${iconMeta.width}x${iconMeta.height} @ (${iconMeta.left}, ${iconMeta.top})`);

  const verify = await sharp(splashOutPath).metadata();
  console.log(`Wrote ${splashOutPath}`);
  console.log(`  size: ${verify.width}x${verify.height}, alpha: ${verify.hasAlpha}`);
  console.log(
    `  icon ${splashMeta.width}x${splashMeta.height} @ (${splashMeta.left}, ${splashMeta.top})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
