/**
 * Phase 31 — login diagnostic: cookie accept (force), submit, capture post-login URL.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const ORIGIN = "https://caretip.de";
const EMAIL = "jordan.p26_1786691378148@caretip-test.local";
const PASSWORD = process.env.PHASE26_PASSWORD?.trim() || "Phase26E2E!23";
const EVIDENCE_DIR = join(process.cwd(), "..", "security-audit", "phase-31-evidence");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const steps: string[] = [];
  try {
    await page.goto(`${ORIGIN}/employee/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    steps.push(`login_url=${page.url()}`);
    await page.getByRole("button", { name: /accept all|alle akzeptieren/i }).click({ force: true, timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
    await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click({ force: true });
    await page.waitForTimeout(8000);
    steps.push(`after_submit=${page.url()}`);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE_DIR, "jordan-after-login.png"), fullPage: true });
    const nav = await page.locator("a, button").evaluateAll((els) =>
      els
        .map((e) => ((e as HTMLElement).innerText || "").trim())
        .filter((t) => t && t.length < 80)
        .slice(0, 40),
    );
    await page.goto(`${ORIGIN}/employee/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
    steps.push(`dashboard=${page.url()}`);
    await page.screenshot({ path: join(EVIDENCE_DIR, "jordan-dashboard.png"), fullPage: true });
    const dashText = ((await page.locator("body").innerText()) || "").slice(0, 1500);
    await page.goto(`${ORIGIN}/employee/payouts`, { waitUntil: "networkidle", timeout: 60000 });
    steps.push(`payouts=${page.url()}`);
    await page.screenshot({ path: join(EVIDENCE_DIR, "jordan-payouts-authed.png"), fullPage: true });
    const payoutText = ((await page.locator("body").innerText()) || "").slice(0, 1500);
    const out = { steps, nav, dashText, payoutText };
    writeFileSync(join(EVIDENCE_DIR, "ui-login-diagnostic.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
