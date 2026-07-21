import { test, expect } from "@playwright/test";

const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/join",
  "/forgot-password",
  "/verify-email",
  "/activate",
  "/platform-admin/login",
] as const;

test.describe("Auth back to home navigation", () => {
  for (const path of AUTH_ROUTES) {
    test(`${path} shows back to home nav`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const homeLinks = page.locator('.caretip-auth-back-home a[href="/"]');
      await expect(homeLinks.first()).toBeVisible({ timeout: 15_000 });
      expect(await homeLinks.count()).toBeGreaterThanOrEqual(1);
    });
  }

  test("mobile layout keeps nav escape hatch above auth card", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    const card = page.locator(".caretip-auth-card").first();
    await expect(card).toBeVisible();

    // Marketing-column back-nav is intentionally hidden on small screens; form/logo escape hatch remains.
    const escape = page
      .locator(
        '.caretip-auth-back-home:not(.caretip-auth-back-home--marketing) a[href="/"], .caretip-auth-card a[href="/"], [role="region"] a[href="/"]',
      )
      .first();
    await expect(escape).toBeVisible({ timeout: 15_000 });

    const escapeBox = await escape.boundingBox();
    const cardBox = await card.boundingBox();
    expect(escapeBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(escapeBox!.y).toBeLessThanOrEqual(cardBox!.y + 48);
  });

  test("back to home links navigate to landing", async ({ page }) => {
    await page.goto("/login");
    await page.locator(".caretip-auth-back-home__link, .caretip-auth-back-home a[href='/']").first().click();
    await expect(page).toHaveURL(/\/$/);
  });
});
