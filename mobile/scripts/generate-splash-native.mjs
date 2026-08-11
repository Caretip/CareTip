/**
 * Generates splash assets — white CareTip icon on a fully transparent canvas.
 * Orange fill comes from app.json / splashscreen_background (#e9781c), not the PNG.
 *
 * Android 12 shows `splashscreen_logo` inside a circular/rounded icon mask.
 * A baked orange fill (historically #EB992C) reads as a lighter-orange card
 * on the #e9781c window. Keep these PNGs transparent so the hierarchy is:
 *   solid CareTip orange → white logo
 *
 * Outputs:
 *   assets/splash-icon-white.png  — 512×512 icon for in-app splash
 *   assets/splash-native.png      — 1024×1024 for native expo-splash-screen
 *   android/.../splashscreen_logo.png per density (transparent, existing sizes)
 *
 * Usage: node scripts/generate-splash-native.mjs
 * Re-run after `expo prebuild` so Expo cannot restore an opaque orange plate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");
const svgPath = path.join(mobileRoot, "assets/brand/CareTip_Icon_White.svg");
const iconOutPath = path.join(mobileRoot, "assets/splash-icon-white.png");
const splashOutPath = path.join(mobileRoot, "assets/splash-native.png");
const androidRes = path.join(mobileRoot, "android/app/src/main/res");

const ICON_CANVAS = 512;
const SPLASH_CANVAS = 1024;
/** Icon occupies ~42% of splash width — safe inside Android 12 circular mask. */
const SPLASH_ICON_MAX_WIDTH = 430;

const ANDROID_DENSITIES = [
  "drawable-mdpi",
  "drawable-hdpi",
  "drawable-xhdpi",
  "drawable-xxhdpi",
  "drawable-xxxhdpi",
];

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

async function writeAndroidDensityLogos(sourcePath) {
  const written = [];
  for (const density of ANDROID_DENSITIES) {
    const outPath = path.join(androidRes, density, "splashscreen_logo.png");
    if (!fs.existsSync(outPath)) continue;
    const existing = await sharp(outPath).metadata();
    const size = existing.width ?? existing.height;
    if (!size) continue;
    await sharp(sourcePath)
      .resize(size, size, { fit: "fill" })
      .png()
      .toFile(outPath);
    written.push({ density, size });
  }
  return written;
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

  const androidWritten = await writeAndroidDensityLogos(splashOutPath);
  for (const row of androidWritten) {
    console.log(`Wrote android ${row.density}/splashscreen_logo.png (${row.size}x${row.size}, transparent)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
