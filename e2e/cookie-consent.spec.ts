import { test, expect } from "@playwright/test";

test.describe("GDPR cookie consent (Phase 13.10)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("caretip_cookie_consent");
    });
  });

  test("banner appears on first visit and consent is remembered", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const banner = page.getByRole("dialog", { name: /privacy|privatsphäre/i });
    await expect(banner).toBeVisible();

    await page.getByRole("button", { name: /reject non-essential|nicht notwendige ablehnen/i }).click();
    await expect(banner).toHaveCount(0);

    const stored = await page.evaluate(() => localStorage.getItem("caretip_cookie_consent"));
    expect(stored).toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: /privacy|privatsphäre/i })).toHaveCount(0);
  });

  test("footer reopens cookie settings", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /reject non-essential|nicht notwendige ablehnen/i }).click();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole("button", { name: /cookie settings|cookie-einstellungen/i }).click();

    await expect(page.getByRole("dialog", { name: /cookie settings|cookie-einstellungen/i })).toBeVisible();
  });
});
