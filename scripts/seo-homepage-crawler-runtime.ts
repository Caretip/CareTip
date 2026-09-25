/**
 * Homepage crawler-readability regression checks (no browser).
 *
 *   npm run test:seo-homepage-crawler
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function run() {
  const indexHtml = read("index.html");

  assert.match(indexHtml, /id="caretip-static-summary"/);
  assert.doesNotMatch(
    indexHtml,
    /<main[^>]*id="caretip-static-summary"[^>]*\bhidden\b/,
    "static summary must not use hidden — crawlers need body copy in raw HTML",
  );

  const summaryMatch = indexHtml.match(
    /<main id="caretip-static-summary"[\s\S]*?<\/main>/,
  );
  assert.ok(summaryMatch, "expected caretip-static-summary block");
  const summary = summaryMatch![0];

  assert.match(summary, /<h1>[\s\S]*CareTip[\s\S]*<\/h1>/);
  assert.match(summary, /digitale Trinkgeld-Plattform|digital tipping platform/i);
  assert.match(summary, /QR/i);
  assert.match(summary, /Gastgewerbe|hospitality/i);
  assert.match(summary, /Mitarbeitende|employees/i);
  assert.match(summary, /Auszahlungen|payouts/i);
  assert.match(summary, /Verteilung|distribution/i);
  assert.match(summary, /href="\/features"/);
  assert.match(summary, /href="\/faq"/);
  assert.match(summary, /href="\/industries\/gastronomy"/);
  assert.match(summary, /href="\/industries\/hotels"/);
  assert.doesNotMatch(summary, /href="\/how-it-works"/);

  assert.match(indexHtml, /#caretip-html-boot/);
  assert.match(indexHtml, /caretip-html-boot-active/);
  assert.match(read("src/main.tsx"), /removeStaticCrawlerSummary/);

  console.log("seo-homepage-crawler-runtime: ok");
}

run();
