/**
 * Phase 31 UI retry — cookie consent then employee login against caretip.de.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const ORIGIN = "https://caretip.de";
const JORDAN_EMAIL = "jordan.p26_1786691378148@caretip-test.local";
const SAM_EMAIL = "sam.p26_1786691378148@caretip-test.local";
const PASSWORD = process.env.PHASE26_PASSWORD?.trim() || "Phase26E2E!23";
const EVIDENCE_DIR = join(process.cwd(), "..", "security-audit", "phase-31-evidence");

async function acceptCookies(page: import("@playwright/test").Page) {
  const accept = page.getByRole("button", { name: /accept all|alle akzeptieren/i });
  if (await accept.count()) {
    await accept.first().click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
}

async function loginEmployee(page: import("@playwright/test").Page, email: string) {
  await page.goto(`${ORIGIN}/employee/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await acceptCookies(page);
  await page.locator('input[name="email"], input[type="email"]').first().waitFor({ timeout: 20000 });
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  const submit = page.locator('button[type="submit"]').first();
  await submit.click();
  await page.waitForTimeout(4000);
  await acceptCookies(page);
}

async function run(opts: {
  email: string;
  lang: "en" | "de";
  viewport: { width: number; height: number };
  file: string;
}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: opts.viewport,
    locale: opts.lang === "de" ? "de-DE" : "en-US",
  });
  await context.addInitScript((lang) => {
    localStorage.setItem("caretip_i18n_language", lang);
  }, opts.lang);
  const page = await context.newPage();
  try {
    await loginEmployee(page, opts.email);
    await page.goto(`${ORIGIN}/employee/payouts`, { waitUntil: "networkidle", timeout: 60000 });
    await acceptCookies(page);
    await page.waitForTimeout(2500);
    const bodyText = (await page.locator("body").innerText()) || "";
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE_DIR, opts.file), fullPage: true });
    return {
      url: page.url(),
      langAttr: await page.locator("html").getAttribute("lang"),
      hasAcctId: /acct_/.test(bodyText),
      hasSk: /sk_(live|test)_/.test(bodyText),
      openDashboard: /Open Stripe Dashboard|Stripe-Dashboard öffnen/i.test(bodyText),
      updateDetails: /Update Stripe details|Stripe-Daten aktualisieren/i.test(bodyText),
      continueSetup: /Continue setup/i.test(bodyText),
      connectStripe: /Connect Stripe|Stripe verbinden/i.test(bodyText),
      completeSetup: /Complete Stripe setup|Stripe-Einrichtung abschließen/i.test(bodyText),
      instantCard: /Instant Payout|Sofortauszahlung/i.test(bodyText),
      min30: /€\s*30|30,00\s*€|€30/i.test(bodyText),
      payableNote: /payable record|Zahlungsverpflichtung|not a live Stripe/i.test(bodyText),
      bankNote: /Bank payouts are managed by Stripe|Bankauszahlungen verwaltet Stripe/i.test(bodyText),
      businessMissing: /couldn't find this business|Unternehmen nicht finden/i.test(bodyText),
      overflowX: await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      ),
      snippet: bodyText.slice(0, 1800),
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const out: Record<string, unknown> = {};
  const runs = [
    { email: JORDAN_EMAIL, lang: "en" as const, viewport: { width: 1440, height: 900 }, file: "jordan-desktop-en.png" },
    { email: JORDAN_EMAIL, lang: "de" as const, viewport: { width: 1440, height: 900 }, file: "jordan-desktop-de.png" },
    { email: JORDAN_EMAIL, lang: "en" as const, viewport: { width: 390, height: 844 }, file: "jordan-mobile-en.png" },
    { email: JORDAN_EMAIL, lang: "de" as const, viewport: { width: 390, height: 844 }, file: "jordan-mobile-de.png" },
    { email: SAM_EMAIL, lang: "en" as const, viewport: { width: 1440, height: 900 }, file: "sam-desktop-en.png" },
    { email: SAM_EMAIL, lang: "de" as const, viewport: { width: 390, height: 844 }, file: "sam-mobile-de.png" },
  ];
  for (const r of runs) {
    try {
      out[r.file] = await run(r);
    } catch (err) {
      out[r.file] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  writeFileSync(join(EVIDENCE_DIR, "ui-retry.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
