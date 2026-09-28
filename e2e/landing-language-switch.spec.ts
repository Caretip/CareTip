import { test, expect } from "@playwright/test";

test.describe("Landing language switch", () => {
  test("switches locale without losing hero image and without HTML boot", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#about-section.caretip-hero-section")).toBeVisible({ timeout: 20_000 });

    const heroImg = page.locator('[data-hero-frame="wyc"] img');
    await expect(heroImg).toBeVisible();
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-hero-frame="wyc"] img');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    });

    const langButton = page.getByRole("button", { name: /language|sprache/i }).first();
    await langButton.click();

    const target =
      (await page.evaluate(() => document.documentElement.lang)) === "de"
        ? page.getByRole("option", { name: /english/i })
        : page.getByRole("option", { name: /deutsch|german/i });
    await target.click();

    await expect(page.locator("#caretip-html-boot")).toHaveCount(0);
    await expect(page.locator("#about-section")).toBeVisible();
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-hero-frame="wyc"] img');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    });
    await expect(page.locator('[data-hero-frame="wyc"]')).toHaveCount(1);
  });
});
