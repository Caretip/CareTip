import { test, expect } from "@playwright/test";

test.describe("Customer journey language switch", () => {
  test("EN ↔ DE keeps tip page painted without fullscreen hold", async ({ page }) => {
    await page.route("**/api/staff/lang-demo", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-lang",
          name: "Anna Müller",
          jobTitle: "Server",
          businessId: "biz-1",
          businessName: "Café Sonnenschein",
          businessLogo: null,
          avatar: null,
          bio: null,
          slug: "lang-demo",
        }),
      });
    });

    await page.route("**/api/employees/emp-lang**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-lang",
          name: "Anna Müller",
          businessId: "biz-1",
          businessName: "Café Sonnenschein",
          businessLogo: null,
          avatar: null,
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem("caretip_i18n_language", "en");
    });

    await page.goto("/staff/lang-demo", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/tip-amount/, { timeout: 15_000 });
    await expect(page.locator("[data-caretip-route-ready]")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/anna müller/i)).toBeVisible();

    const switcher = page.locator(".customer-journey-lang-switch");
    await expect(switcher).toBeVisible();

    await switcher.getByRole("button", { name: "DE" }).click();
    await expect(page.locator('[data-testid="soft-spa-route-hold"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="public-route-chunk-hold"]')).toHaveCount(0);
    await expect(page.getByText(/anna müller/i)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");

    await switcher.getByRole("button", { name: "EN" }).click();
    await expect(page.locator('[data-testid="soft-spa-route-hold"]')).toHaveCount(0);
    await expect(page.getByText(/anna müller/i)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
