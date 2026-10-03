import { test, expect } from "@playwright/test";

test.describe("Marketing shell continuity", () => {
  test("navigation stays mounted across / → /features → /pricing", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-caretip-marketing-shell]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 30_000 });

    const nav = page.locator("header.caretip-marketing-nav, nav[aria-label]").first();
    await expect(nav).toBeVisible();

    const navBefore = await nav.evaluate((el) => el.outerHTML.length);

    await page.locator('a[href="/features"]').first().click();
    await expect(page).toHaveURL(/\/features/, { timeout: 30_000 });
    await expect(page.locator("[data-caretip-route-ready]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-caretip-marketing-shell]")).toBeVisible();
    await expect(nav).toBeVisible();

    const holdRoot = await page.locator('[data-testid="root-spa-route-hold"]').count();
    expect(holdRoot).toBe(0);

    await page.locator('a[href="/pricing"]').first().click();
    await expect(page).toHaveURL(/\/pricing/, { timeout: 30_000 });
    await expect(page.locator("[data-caretip-marketing-shell]")).toBeVisible();
    await expect(nav).toBeVisible();

    const navAfter = await nav.evaluate((el) => el.outerHTML.length);
    expect(navAfter).toBeGreaterThan(0);
    expect(Math.abs(navAfter - navBefore)).toBeLessThan(5000);
  });

  test("no branded loader on marketing SPA hops", async ({ page }) => {
    await page.goto("/features", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-caretip-route-ready]")).toBeVisible({ timeout: 30_000 });
    await page.locator('a[href="/faq"]').first().click();
    await expect(page).toHaveURL(/\/faq/, { timeout: 30_000 });
    await expect(page.locator(".app-branded-loader.app-setup-loading--instant")).toHaveCount(0);
    await expect(page.locator('[data-testid="public-route-chunk-hold"]')).toHaveCount(0);
  });
});
