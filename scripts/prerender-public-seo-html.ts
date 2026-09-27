/**
 * Post-build: emit route-specific index.html for every sitemap / indexable public URL.
 *
 *   node ./backend/node_modules/tsx/dist/cli.mjs ./scripts/prerender-public-seo-html.ts
 *
 * Invoked from npm run build after vite build.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARETIP_SITEMAP_PATHS } from "./seo-sitemap-paths.mjs";
import { getBuildTimeSeoT } from "./lib/buildSeoI18n.ts";
import { resolveRouteSeo } from "../src/app/lib/seo/resolveRouteSeo.ts";
import { matchSeoRoute } from "../src/app/lib/seo/seoRoutes.ts";
import { injectRouteSeoIntoHtml } from "../src/app/lib/seo/injectRouteSeoIntoHtml.ts";

process.env.BASE_URL = process.env.BASE_URL || "https://caretip.de";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const templatePath = path.join(distDir, "index.html");

function run(): void {
  if (!existsSync(templatePath)) {
    console.error("[seo-prerender] dist/index.html missing — run vite build first");
    process.exit(1);
  }

  const template = readFileSync(templatePath, "utf8");
  const t = getBuildTimeSeoT();
  let wrote = 0;

  for (const pathname of CARETIP_SITEMAP_PATHS) {
    const match = matchSeoRoute(pathname);
    if (!match.indexable) {
      console.warn(`[seo-prerender] skip non-indexable path: ${pathname}`);
      continue;
    }
    const seo = resolveRouteSeo(pathname, "", t);
    const html = injectRouteSeoIntoHtml(template, seo, match);

    if (pathname === "/") {
      writeFileSync(templatePath, html, "utf8");
      wrote += 1;
      continue;
    }

    const segments = pathname.slice(1).split("/");
    const outDir = path.join(distDir, ...segments);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "index.html"), html, "utf8");
    wrote += 1;
  }

  console.log(`[seo-prerender] wrote ${wrote} public SEO HTML documents under dist/`);
}

run();
