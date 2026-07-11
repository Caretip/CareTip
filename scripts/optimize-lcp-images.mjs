/**
 * Generates WebP + AVIF variants for marketing assets and compresses logo PNG fallback.
 * Run: node scripts/optimize-lcp-images.mjs
 */
import { readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/** @type {{ inPath: string; maxWidth: number; logoPng?: boolean }[]} */
const EXPLICIT_TARGETS = [
  { inPath: "images/story-hero01.png", maxWidth: 1344 },
  { inPath: "images/story-hero02.png", maxWidth: 1344 },
  { inPath: "images/wyc.png", maxWidth: 1344 },
  { inPath: "images/wyo.png", maxWidth: 1344 },
  { inPath: "images/formobile01.jpeg", maxWidth: 960 },
  { inPath: "images/formobile02.jpeg", maxWidth: 960 },
  { inPath: "src/assets/brand/company_logo.png", maxWidth: 640, logoPng: true },
  { inPath: "images/caring002.png", maxWidth: 1200 },
  { inPath: "images/payment-infrastructure.png", maxWidth: 1200 },
  { inPath: "images/payment002.png", maxWidth: 960 },
  { inPath: "images/logy.png", maxWidth: 960 },
  { inPath: "images/fromfanny002-cropped.jpg", maxWidth: 960 },
  { inPath: "images/rep.png", maxWidth: 960 },
  { inPath: "images/new-mid.png", maxWidth: 960 },
  { inPath: "images/newly01.png", maxWidth: 960 },
  { inPath: "images/bizzy001.png", maxWidth: 960 },
  { inPath: "images/foremployee.png", maxWidth: 960 },
  { inPath: "images/feature001.png", maxWidth: 960 },
  { inPath: "images/feature01.png", maxWidth: 960 },
  { inPath: "images/caretip-mission001.png", maxWidth: 1200 },
  { inPath: "images/FYP.jpeg", maxWidth: 960 },
  { inPath: "images/home.jpeg", maxWidth: 960 },
  { inPath: "images/English-version.png", maxWidth: 960 },
  { inPath: "images/live-in-minutes.jpeg", maxWidth: 960 },
  { inPath: "images/trophy.jpeg", maxWidth: 720 },
  { inPath: "images/about-team.jpeg", maxWidth: 1200 },
  { inPath: "images/feature002.jpeg", maxWidth: 960 },
  { inPath: "images/brandedqr.jpeg", maxWidth: 960 },
  { inPath: "images/employee02.jpeg", maxWidth: 960 },
  { inPath: "images/forpayment.jpg", maxWidth: 960 },
  { inPath: "images/analytics01.jpeg", maxWidth: 960 },
  { inPath: "images/en-step-01-create-account.jpeg", maxWidth: 720 },
  { inPath: "images/en-step-02-add-team.jpeg", maxWidth: 720 },
  { inPath: "images/en-step-03-activate-qr.jpeg", maxWidth: 720 },
  { inPath: "images/en-step-04-receive-tips.jpeg", maxWidth: 720 },
  { inPath: "images/de-step-01-konto-erstellen.jpeg", maxWidth: 720 },
  { inPath: "images/de-step-02-team-einladen.jpeg", maxWidth: 720 },
  { inPath: "images/de-step-03-qr-aktivieren.jpeg", maxWidth: 720 },
  { inPath: "images/de-step-04-tipps-empfangen.jpeg", maxWidth: 720 },
  { inPath: "images/Hotels.png", maxWidth: 960 },
  { inPath: "images/cafe-employee.png", maxWidth: 960 },
  { inPath: "images/logistics.png", maxWidth: 960 },
  { inPath: "images/salon and spa.png", maxWidth: 960 },
  { inPath: "images/healthcare and nursing.png", maxWidth: 960 },
  { inPath: "images/petcare and services.png", maxWidth: 960 },
  { inPath: "images/trade and home services.png", maxWidth: 960 },
  { inPath: "images/Log01.png", maxWidth: 960 },
  { inPath: "images/hw01.png", maxWidth: 800 },
  { inPath: "images/hw02.png", maxWidth: 800 },
  { inPath: "images/hw03.png", maxWidth: 800 },
  { inPath: "images/hw04.png", maxWidth: 800 },
  { inPath: "images/hw05.png", maxWidth: 800 },
  { inPath: "images/hw06.png", maxWidth: 800 },
  { inPath: "images/hw07.png", maxWidth: 800 },
  { inPath: "images/hw08.png", maxWidth: 800 },
  { inPath: "images/hw09.png", maxWidth: 800 },
];

const SCAN_DIRS = ["images", join("src", "assets", "qr-templates", "backgrounds")];
const RASTER_RE = /\.(png|jpe?g)$/i;
const SKIP_NAMES = new Set(["pwa_icon_source.png"]);

async function walkRasterFiles(dir) {
  const absDir = join(root, dir);
  let entries = [];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkRasterFiles(rel)));
      continue;
    }
    if (!RASTER_RE.test(entry.name)) continue;
    if (SKIP_NAMES.has(entry.name)) continue;
    files.push(rel.replace(/\\/g, "/"));
  }
  return files;
}

async function compressLogoPng(resized, outPath) {
  for (const quality of [82, 72, 62, 52]) {
    const buf = await resized
      .clone()
      .png({ compressionLevel: 9, quality, effort: 8 })
      .toBuffer();
    if (buf.length <= 50 * 1024 || quality === 52) {
      await writeFile(outPath, buf);
      return buf.length;
    }
  }
  return 0;
}

async function writeVariants({ inPath, maxWidth, logoPng = false }) {
  const absIn = join(root, inPath);
  let buf;
  try {
    buf = await readFile(absIn);
  } catch {
    return null;
  }

  const outBase = inPath.replace(/\.(png|jpe?g)$/i, "");
  const resized = sharp(buf).resize({ width: maxWidth, withoutEnlargement: true });

  const webpPath = join(root, `${outBase}.webp`);
  const avifPath = join(root, `${outBase}.avif`);

  await mkdir(dirname(webpPath), { recursive: true });
  await resized.clone().webp({ quality: 82, effort: 4 }).toFile(webpPath);
  await resized.clone().avif({ quality: 55, effort: 4 }).toFile(avifPath);

  let pngBytes = null;
  if (logoPng) {
    pngBytes = await compressLogoPng(resized, absIn);
  }

  return {
    inPath,
    webp: `${outBase}.webp`,
    avif: `${outBase}.avif`,
    maxWidth,
    webpBytes: (await readFile(webpPath)).length,
    avifBytes: (await readFile(avifPath)).length,
    pngBytes,
  };
}

const targetMap = new Map();
for (const target of EXPLICIT_TARGETS) {
  targetMap.set(target.inPath.replace(/\\/g, "/"), target);
}

for (const dir of SCAN_DIRS) {
  for (const rel of await walkRasterFiles(dir)) {
    if (!targetMap.has(rel)) {
      const isQrBg = rel.includes("qr-templates/backgrounds");
      targetMap.set(rel, {
        inPath: rel,
        maxWidth: isQrBg ? 1400 : 1200,
      });
    }
  }
}

const results = [];
for (const target of targetMap.values()) {
  const result = await writeVariants(target);
  if (result) results.push(result);
}

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      processed: results.length,
      results: results.sort((a, b) => a.inPath.localeCompare(b.inPath)),
    },
    null,
    2,
  ),
);
