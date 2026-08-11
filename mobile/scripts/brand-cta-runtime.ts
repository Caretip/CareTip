/**
 * Brand CTA + splash plate regression.
 * Asserts the mobile Sign In gradient matches the web source, and that
 * Android splash logos are transparent (no baked lighter-orange card).
 *
 *   npm run test:brand-cta
 *   npx tsx scripts/brand-cta-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { brand, caretipPrimaryCtaGradient } from "../theme/colors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

/** Traced from src/styles/caretip-brand.css / src/lib/caretipBrand.ts */
const WEB_ORANGE_LIGHT = "#ff9e2d";
const WEB_ORANGE_BASE = "#e9781c";
/** Legacy splash plate that must not return in native splash logos. */
const LEGACY_SPLASH_PLATE = { r: 235, g: 153, b: 44 };

function runTokenAssertions(): void {
  assert.equal(brand.orangeLight, WEB_ORANGE_LIGHT);
  assert.equal(brand.orange, WEB_ORANGE_BASE);
  assert.deepEqual([...caretipPrimaryCtaGradient.colors], [WEB_ORANGE_LIGHT, WEB_ORANGE_BASE]);
  assert.deepEqual([...caretipPrimaryCtaGradient.locations], [0, 1]);
  assert.deepEqual(caretipPrimaryCtaGradient.start, { x: 0.5, y: 0 });
  assert.deepEqual(caretipPrimaryCtaGradient.end, { x: 0.5, y: 1 });
}

function runAuthContinueButtonSource(): void {
  const source = fs.readFileSync(
    path.join(mobileRoot, "components/auth/AuthContinueButton.tsx"),
    "utf8",
  );
  assert.match(source, /caretipPrimaryCtaGradient/);
  assert.doesNotMatch(source, /authBrand\.orangeSoft,\s*authBrand\.orange,\s*authBrand\.orangeDeep/);
  assert.doesNotMatch(source, /end=\{\{\s*x:\s*1,\s*y:\s*1\s*\}\}/);
}

async function assertTransparentSplashPng(filePath: string): Promise<void> {
  assert.equal(fs.existsSync(filePath), true, `missing ${filePath}`);
  const img = sharp(filePath);
  const meta = await img.metadata();
  assert.equal(meta.hasAlpha, true, `${filePath} must have an alpha channel`);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  assert.ok(channels >= 4, `${filePath} must be RGBA`);

  const sample = (x: number, y: number) => {
    const i = (y * info.width + x) * channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };

  for (const [x, y] of [
    [0, 0],
    [info.width - 1, 0],
    [0, info.height - 1],
    [info.width - 1, info.height - 1],
  ] as const) {
    const px = sample(x, y);
    assert.equal(px.a, 0, `${filePath} corner (${x},${y}) must be transparent`);
  }

  let bakedPlate = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (
      data[i] === LEGACY_SPLASH_PLATE.r &&
      data[i + 1] === LEGACY_SPLASH_PLATE.g &&
      data[i + 2] === LEGACY_SPLASH_PLATE.b &&
      data[i + 3] === 255
    ) {
      bakedPlate += 1;
    }
  }
  assert.equal(bakedPlate, 0, `${filePath} must not bake the legacy #EB992C plate`);
}

async function runSplashAssetAssertions(): Promise<void> {
  await assertTransparentSplashPng(path.join(mobileRoot, "assets/splash-native.png"));
  const densities = [
    "drawable-mdpi",
    "drawable-hdpi",
    "drawable-xhdpi",
    "drawable-xxhdpi",
    "drawable-xxxhdpi",
  ];
  for (const density of densities) {
    await assertTransparentSplashPng(
      path.join(mobileRoot, "android/app/src/main/res", density, "splashscreen_logo.png"),
    );
  }
}

async function main(): Promise<void> {
  runTokenAssertions();
  runAuthContinueButtonSource();
  await runSplashAssetAssertions();
  console.log("brand-cta-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
