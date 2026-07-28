/**
 * Bundles the web branded QR renderer for Node (same canvas pipeline as the SPA).
 * Output: backend/dist/qr-render.bundle.mjs
 */
import esbuild from "esbuild";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const repoRoot = path.resolve(backendRoot, "..");
const appRoot = path.join(repoRoot, "src", "app");
const assetsRoot = path.join(repoRoot, "src", "assets");

const entry = path.join(backendRoot, "src/qr/renderBundleEntry.ts");
const outfile = path.join(backendRoot, "dist/qr-render.bundle.mjs");
const i18nStub = path.join(backendRoot, "src/qr/stubs/i18n.ts");

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  packages: "bundle",
  external: ["@napi-rs/canvas", "@napi-rs/canvas-win32-x64-msvc", "qrcode"],
  alias: {
    "@": appRoot,
  },
  define: {
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
  },
  loader: {
    ".avif": "file",
    ".jpg": "file",
    ".jpeg": "file",
    ".png": "file",
    ".webp": "file",
  },
  plugins: [
    {
      name: "qr-assets-and-i18n",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n\/i18n$/ }, () => ({ path: i18nStub }));
        build.onResolve({ filter: /^@\/assets\// }, (args) => {
          const rel = args.path.replace(/^@\/assets\//, "");
          const avifPath = path.join(assetsRoot, rel.replace(/\.jpg$/i, ".avif"));
          const jpgPath = path.join(assetsRoot, rel);
          const resolved = fs.existsSync(avifPath) ? avifPath : jpgPath;
          return { path: resolved, namespace: "file" };
        });
      },
    },
  ],
  logLevel: "info",
});

console.log(`[build-qr-render] Wrote ${outfile}`);
