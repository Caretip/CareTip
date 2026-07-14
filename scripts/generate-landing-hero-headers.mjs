/**
 * Convert approved Header landing page JPGs into sharp hero WebP/AVIF + mobile crops.
 * Run: node scripts/generate-landing-hero-headers.mjs
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(__dirname, "..", "images");

/** Desktop full-bleed — covers 1920 CSS px at 2× DPR without upscaling sources. */
const DESKTOP_MAX_WIDTH = 3840;
/** Mobile portrait crop — covers ~430 CSS px at 3×. */
const MOBILE_WIDTH = 1080;
const MOBILE_HEIGHT = 1920;

const FRAMES = [
  {
    // Café / POS transaction — LCP frame (wyc)
    source: "Header landing page.jpg",
    desktopBase: "wyc",
    mobileBase: "formemobile01",
    // POS handoff / attendant — slightly lower to de-emphasize menu boards
    focalX: 0.64,
    focalY: 0.48,
  },
  {
    // Hospitality housekeeping team — deferred frame (wyo)
    source: "Header landing page (2).jpg",
    desktopBase: "wyo",
    mobileBase: "formemobile02",
    // Both staff centered in portrait crop
    focalX: 0.5,
    focalY: 0.38,
  },
];

async function portraitCrop(input, { focalX, focalY, width, height }) {
  const meta = await sharp(input).rotate().metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) throw new Error(`Missing dimensions for ${input}`);

  const targetAspect = width / height;
  let cropW = srcW;
  let cropH = Math.round(srcW / targetAspect);
  if (cropH > srcH) {
    cropH = srcH;
    cropW = Math.round(srcH * targetAspect);
  }

  const centerX = srcW * focalX;
  const centerY = srcH * focalY;
  const left = Math.max(0, Math.min(srcW - cropW, Math.round(centerX - cropW / 2)));
  const top = Math.max(0, Math.min(srcH - cropH, Math.round(centerY - cropH / 2)));

  return sharp(input)
    .rotate()
    .extract({ left, top, width: cropW, height: cropH })
    .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 });
}

async function writeDesktop(inputPath, base) {
  const pipeline = sharp(inputPath)
    .rotate()
    .resize({
      width: DESKTOP_MAX_WIDTH,
      withoutEnlargement: true,
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
    });

  const webpBuf = await pipeline
    .clone()
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toBuffer();
  const avifBuf = await pipeline
    .clone()
    .avif({ quality: 55, effort: 6, chromaSubsampling: "4:2:0" })
    .toBuffer();

  const webpPath = join(imagesDir, `${base}.webp`);
  const avifPath = join(imagesDir, `${base}.avif`);
  await writeFile(webpPath, webpBuf);
  await writeFile(avifPath, avifBuf);

  const meta = await sharp(webpBuf).metadata();
  return {
    webpKb: Math.round(webpBuf.length / 1024),
    avifKb: Math.round(avifBuf.length / 1024),
    width: meta.width,
    height: meta.height,
  };
}

async function writeMobile(inputPath, base, focal) {
  const cropped = await portraitCrop(inputPath, {
    ...focal,
    width: MOBILE_WIDTH,
    height: MOBILE_HEIGHT,
  });

  const jpegBuf = await cropped
    .clone()
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  const webpBuf = await cropped
    .clone()
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toBuffer();
  const avifBuf = await cropped
    .clone()
    .avif({ quality: 52, effort: 6, chromaSubsampling: "4:2:0" })
    .toBuffer();

  await writeFile(join(imagesDir, `${base}.jpeg`), jpegBuf);
  await writeFile(join(imagesDir, `${base}.webp`), webpBuf);
  await writeFile(join(imagesDir, `${base}.avif`), avifBuf);

  return {
    jpegKb: Math.round(jpegBuf.length / 1024),
    webpKb: Math.round(webpBuf.length / 1024),
    avifKb: Math.round(avifBuf.length / 1024),
  };
}

async function main() {
  for (const frame of FRAMES) {
    const inputPath = join(imagesDir, frame.source);
    console.log(`\n→ ${frame.source}`);
    const desktop = await writeDesktop(inputPath, frame.desktopBase);
    console.log(
      `  desktop ${frame.desktopBase}: ${desktop.width}×${desktop.height} · webp ${desktop.webpKb}KB · avif ${desktop.avifKb}KB`,
    );
    const mobile = await writeMobile(inputPath, frame.mobileBase, frame);
    console.log(
      `  mobile ${frame.mobileBase}: ${MOBILE_WIDTH}×${MOBILE_HEIGHT} · jpeg ${mobile.jpegKb}KB · webp ${mobile.webpKb}KB · avif ${mobile.avifKb}KB`,
    );
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
