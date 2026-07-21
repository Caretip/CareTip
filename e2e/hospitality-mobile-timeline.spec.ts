import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-results", "hospitality-mobile-timeline", "screenshots");

const MOBILE_WIDTHS = [320, 375, 430] as const;

/** Current landing sections that replace the retired #built-for-hospitality block. */
const SECTION_IDS = ["industries", "business-section", "how-it-works", "recognition"] as const;

async function loadLandingSections(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".caretip-hero-section", { timeout: 20_000 });
  await page.waitForTimeout(800);

  for (let pass = 0; pass < 14; pass += 1) {
    const found = await page.evaluate((ids) => ids.filter((id) => document.getElementById(id)).length, [
      ...SECTION_IDS,
    ]);
    if (found >= 2) break;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await page.waitForTimeout(400);
  }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
}

test.describe("Landing mobile section layout", () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const width of MOBILE_WIDTHS) {
    test(`layout at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await loadLandingSections(page);

      for (const id of SECTION_IDS) {
        const section = page.locator(`#${id}`);
        await expect(section).toBeAttached({ timeout: 20_000 });
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
      }

      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 1;
      });
      expect(overflow).toBe(false);

      await page.locator("#business-section").screenshot({
        path: path.join(OUT_DIR, `business-section--${width}px.png`),
      });
    });
  }
});
