/**
 * Initial HTML SEO regression (build-time prerender + injection helpers).
 *
 *   npm run test:seo-initial-html
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARETIP_SITEMAP_PATHS } from "./seo-sitemap-paths.mjs";
import { getBuildTimeSeoT } from "./lib/buildSeoI18n.ts";
import { resolveRouteSeo } from "../src/app/lib/seo/resolveRouteSeo.ts";
import { matchSeoRoute, SITEMAP_PATHS } from "../src/app/lib/seo/seoRoutes.ts";
import { injectRouteSeoIntoHtml } from "../src/app/lib/seo/injectRouteSeoIntoHtml.ts";
import { parseStaticFaqItems } from "../src/app/lib/seo/faqStaticContent.ts";
import { staticSummaryHasSubstantiveContent } from "../src/app/lib/seo/publicSeoStaticContent.ts";

process.env.BASE_URL = process.env.BASE_URL || "https://caretip.de";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://caretip.de";

const REQUIRED_SPOT_CHECKS = [
  "/",
  "/features",
  "/pricing",
  "/about",
  "/contact",
  "/faq",
  "/industries/hotels",
  "/industries/field-service",
  "/privacy",
  "/terms",
  "/imprint",
] as const;

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function canonicalFromHtml(html: string): string | undefined {
  const m = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  return m?.[1];
}

function titleFromHtml(html: string): string | undefined {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m?.[1];
}

function metaDescription(html: string): string | undefined {
  const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  return m?.[1];
}

function ogUrl(html: string): string | undefined {
  const m = html.match(/<meta\s+property="og:url"\s+content="([^"]*)"/i);
  return m?.[1];
}

function robotsMeta(html: string): string | undefined {
  const m = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i);
  return m?.[1];
}

function countCanonicals(html: string): number {
  return [...html.matchAll(/<link\s+rel="canonical"/gi)].length;
}

function h1Text(html: string): string | undefined {
  const summary = html.match(/<main id="caretip-static-summary"[\s\S]*?<\/main>/i)?.[0];
  if (!summary) return undefined;
  const h1 = summary.match(/<h1>([^<]*)<\/h1>/i);
  return h1?.[1];
}

function testPublicBodyContentNotMetadataOnly(): void {
  const template = read("index.html");
  const t = getBuildTimeSeoT();
  const faqItems = parseStaticFaqItems(t);
  assert.ok(faqItems.length >= 3, "FAQ i18n must expose multiple public Q&A items");

  const contentHeavyPaths = [
    "/faq",
    "/features",
    "/pricing",
    "/about",
    "/contact",
    "/industries/hotels",
  ] as const;

  for (const pathname of contentHeavyPaths) {
    const match = matchSeoRoute(pathname);
    const seo = resolveRouteSeo(pathname, "", t);
    const html = injectRouteSeoIntoHtml(template, seo, match, t);
    assert.ok(
      staticSummaryHasSubstantiveContent(html),
      `${pathname} initial HTML must include substantive public body content, not metadata only`,
    );
  }

  const faqHtml = injectRouteSeoIntoHtml(
    template,
    resolveRouteSeo("/faq", "", t),
    matchSeoRoute("/faq"),
    t,
  );
  assert.match(
    faqHtml,
    new RegExp(escapeRegExp(faqItems[0]!.question.slice(0, 24))),
    "/faq must include first FAQ question in static summary",
  );
  assert.match(faqHtml, /<script[^>]*type="application\/ld\+json"/i, "/faq JSON-LD");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function testInjectionForAllSitemapPaths(): void {
  const template = read("index.html");
  const t = getBuildTimeSeoT();

  for (const pathname of CARETIP_SITEMAP_PATHS) {
    const match = matchSeoRoute(pathname);
    assert.equal(match.indexable, true, `${pathname} must be indexable`);
    const seo = resolveRouteSeo(pathname, "", t);
    const html = injectRouteSeoIntoHtml(template, seo, match, t);
    const expectedCanonical =
      pathname === "/" ? `${origin}/` : `${origin}${pathname}`;

    assert.equal(countCanonicals(html), 1, `${pathname} canonical count`);
    assert.equal(canonicalFromHtml(html), expectedCanonical, `${pathname} canonical href`);
    assert.equal(ogUrl(html), expectedCanonical, `${pathname} og:url`);
    assert.equal(titleFromHtml(html), seo.title, `${pathname} title`);
    assert.equal(metaDescription(html), seo.description, `${pathname} description`);
    assert.equal(robotsMeta(html), "index,follow", `${pathname} robots`);

    if (pathname !== "/") {
      assert.notEqual(
        canonicalFromHtml(html),
        `${origin}/`,
        `${pathname} must not use homepage canonical`,
      );
      const h1 = h1Text(html);
      assert.ok(h1 && h1.length > 0, `${pathname} static summary h1`);
      assert.doesNotMatch(
        html,
        /<h1>CareTip — Digitale Trinkgeld-Plattform<\/h1>/,
        `${pathname} must not use homepage static H1`,
      );
    }
  }
}

function testHowItWorksDelisted(): void {
  assert.ok(!CARETIP_SITEMAP_PATHS.includes("/how-it-works"));
  assert.ok(!SITEMAP_PATHS.includes("/how-it-works" as never));
  const match = matchSeoRoute("/how-it-works");
  assert.equal(match.indexable, false);
}

function testPrivateRoutesNoindexInInjection(): void {
  const template = read("index.html");
  const t = getBuildTimeSeoT();
  for (const pathname of ["/login", "/dashboard", "/employee/dashboard"]) {
    const match = matchSeoRoute(pathname);
    assert.equal(match.indexable, false);
    const seo = resolveRouteSeo(pathname, "", t);
    const html = injectRouteSeoIntoHtml(template, seo, match, t);
    assert.equal(robotsMeta(html), "noindex,nofollow", pathname);
  }
}

function testDistOutputWhenPresent(): void {
  const distIndex = path.join(root, "dist", "index.html");
  const prerenderMarker = path.join(root, "dist", "pricing", "index.html");
  if (!existsSync(distIndex) || !existsSync(prerenderMarker)) {
    console.log(
      "seo-initial-html-runtime: skip dist checks (run npm run build to generate prerendered HTML)",
    );
    return;
  }

  for (const pathname of REQUIRED_SPOT_CHECKS) {
    const file =
      pathname === "/"
        ? distIndex
        : path.join(root, "dist", pathname.slice(1), "index.html");
    assert.ok(existsSync(file), `expected built HTML: ${pathname}`);
    const html = readFileSync(file, "utf8");
    const expectedCanonical =
      pathname === "/" ? `${origin}/` : `${origin}${pathname}`;
    assert.equal(canonicalFromHtml(html), expectedCanonical, `dist ${pathname}`);
    assert.equal(countCanonicals(html), 1, `dist ${pathname} canonical count`);
  }
}

function testDistFaqContentWhenPresent(): void {
  const faqFile = path.join(root, "dist", "faq", "index.html");
  if (!existsSync(faqFile)) return;
  const t = getBuildTimeSeoT();
  const firstQ = parseStaticFaqItems(t)[0]?.question;
  assert.ok(firstQ, "FAQ items");
  const html = readFileSync(faqFile, "utf8");
  assert.match(html, new RegExp(escapeRegExp(firstQ.slice(0, 20))));
  assert.ok(staticSummaryHasSubstantiveContent(html), "dist /faq substantive body");
}

function run(): void {
  testHowItWorksDelisted();
  testInjectionForAllSitemapPaths();
  testPublicBodyContentNotMetadataOnly();
  testPrivateRoutesNoindexInInjection();
  testDistOutputWhenPresent();
  testDistFaqContentWhenPresent();
  console.log("seo-initial-html-runtime: ok");
}

run();
