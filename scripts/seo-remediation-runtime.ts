/**
 * SEO remediation regression checks (no browser).
 *
 *   npm run test:seo-remediation
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchSeoRoute, resolveCanonicalPathname, SITEMAP_PATHS } from "../src/app/lib/seo/seoRoutes.ts";
import { CARETIP_SITEMAP_PATHS } from "./seo-sitemap-paths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function run() {
  assert.deepEqual(
    [...SITEMAP_PATHS].sort(),
    [...CARETIP_SITEMAP_PATHS].sort(),
    "sitemap paths must match between TS and build script",
  );

  const robots = read("public/robots.txt");
  assert.match(robots, /^User-agent:/m);
  assert.match(robots, /Sitemap: https:\/\//);
  assert.doesNotMatch(robots, /<!DOCTYPE html>/i);

  const sitemap = read("public/sitemap.xml");
  assert.match(sitemap, /^<\?xml version="1.0"/);
  assert.match(sitemap, /<urlset/);
  for (const p of CARETIP_SITEMAP_PATHS) {
    const loc = p === "/" ? "<loc>https://caretip.de/</loc>" : `<loc>https://caretip.de${p}</loc>`;
    assert.match(sitemap, new RegExp(loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(sitemap, /<!DOCTYPE html>/i);

  const redirects = read("public/_redirects");
  assert.match(redirects, /\/robots\.txt\s+\/robots\.txt/);
  assert.match(redirects, /\/sitemap\.xml\s+\/sitemap\.xml/);

  const vercel = read("vercel.json");
  assert.match(vercel, /xml\)\$/);

  const indexHtml = read("index.html");
  assert.match(indexHtml, /id="caretip-static-summary"/);
  assert.match(indexHtml, /digitale Trinkgeld-Plattform|digital tipping platform/i);
  assert.match(indexHtml, /https:\/\/caretip\.de\/brand\/caretip-logo-tagline\.png/);

  const en = JSON.parse(read("src/i18n/locales/en.json")) as {
    seo: { pages: { home: { title: string } } };
    landing: { showcase: { platformLead: string } };
  };
  assert.match(en.seo.pages.home.title, /digital tipping platform/i);
  assert.match(en.landing.showcase.platformLead, /digital tipping platform/i);

  const dashboard = matchSeoRoute("/dashboard/settings");
  assert.equal(dashboard.indexable, false);
  assert.equal(dashboard.pageKey, "private");

  const employee = matchSeoRoute("/employee/dashboard");
  assert.equal(employee.indexable, false);

  const home = matchSeoRoute("/");
  assert.equal(home.indexable, true);
  assert.equal(home.pageKey, "home");

  const blog = matchSeoRoute("/blog");
  assert.equal(blog.indexable, false);

  const unknownSlug = matchSeoRoute("/totally-unknown-static");
  assert.equal(unknownSlug.indexable, false);
  assert.equal(unknownSlug.pageKey, "private");

  const unknownNested = matchSeoRoute("/not/a/real/nested/path");
  assert.equal(unknownNested.indexable, false);
  assert.equal(unknownNested.pageKey, "notFound");

  assert.equal(resolveCanonicalPathname("/faq", "?q=tips&lang=en"), "/faq");
  assert.equal(resolveCanonicalPathname("/contact", "?intent=demo&lang=de"), "/contact");

  console.log("seo-remediation-runtime: ok");
}

run();
