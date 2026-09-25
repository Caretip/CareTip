/**
 * Category visibility P1 regression checks (no browser).
 *
 *   npm run test:seo-category-p1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCareTipOrganizationSameAs } from "../src/app/lib/caretipSocialLinks.ts";
import { matchSeoRoute } from "../src/app/lib/seo/seoRoutes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function run() {
  const footer = read("src/app/components/Footer.tsx");
  assert.match(footer, /to: "\/faq"/);
  assert.match(footer, /footer\.linkFaq/);

  const featuresCta = read("src/components/public/features/FeaturesPageFinalCta.tsx");
  assert.match(featuresCta, /to="\/signup"/);
  assert.doesNotMatch(featuresCta, /to="\/how-it-works"/);

  const en = JSON.parse(read("src/i18n/locales/en.json")) as {
    landing: { features: { i4Text: string } };
  };
  assert.match(en.landing.features.i4Text, /schedule you configure/i);

  const sameAs = collectCareTipOrganizationSameAs();
  assert.ok(sameAs.length >= 3, "expected at least facebook, instagram, tiktok");
  for (const url of sameAs) {
    assert.match(url, /^https:\/\//);
  }
  assert.ok(!sameAs.includes(""), "sameAs must not include empty strings");

  const structuredData = read("src/app/lib/seo/structuredData.ts");
  assert.match(structuredData, /collectCareTipOrganizationSameAs/);
  assert.match(structuredData, /if \(sameAs\.length > 0\)/);
  assert.match(structuredData, /org\.sameAs = sameAs/);

  const login = matchSeoRoute("/login");
  assert.equal(login.indexable, false);

  const dashboard = matchSeoRoute("/dashboard");
  assert.equal(dashboard.indexable, false);

  const home = matchSeoRoute("/");
  assert.equal(home.indexable, true);

  const faq = matchSeoRoute("/faq");
  assert.equal(faq.indexable, true);

  console.log("seo-category-p1-runtime: ok");
}

run();
