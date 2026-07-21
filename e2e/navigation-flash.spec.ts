import { test, expect } from "@playwright/test";

const NOT_FOUND_PATTERN = /not found|go home|go back home|nicht gefunden/i;

async function assertNoNotFoundFlash(page: import("@playwright/test").Page, maxMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(NOT_FOUND_PATTERN);
    if (page.url().includes("/tip-amount")) break;
    await page.waitForTimeout(50);
  }
}

test.describe("Navigation flash regression", () => {
  test("staff slug auto-redirect never flashes not-found before tip amount", async ({ page }) => {
    await page.route("**/api/staff/test-slug", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-1",
          name: "Test Staff",
          jobTitle: "Server",
          businessId: "biz-1",
          businessName: "Test Venue",
          avatar: null,
          bio: null,
          slug: "test-slug",
        }),
      });
    });

    await page.goto("/staff/test-slug", { waitUntil: "domcontentloaded" });
    await assertNoNotFoundFlash(page);
    await expect(page).toHaveURL(/\/tip-amount\?.*employeeId=emp-1/, { timeout: 10_000 });

    const finalText = await page.locator("body").innerText();
    expect(finalText).not.toMatch(NOT_FOUND_PATTERN);
  });

  test("staff slug preview=1 shows profile without not-found flash", async ({ page }) => {
    await page.route("**/api/staff/preview-slug", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-2",
          name: "Preview Staff",
          jobTitle: "Barista",
          businessId: "biz-1",
          businessName: "Test Venue",
          avatar: null,
          bio: "Hello",
          slug: "preview-slug",
        }),
      });
    });

    await page.goto("/staff/preview-slug?preview=1", { waitUntil: "domcontentloaded" });
    await assertNoNotFoundFlash(page, 3000);
    await expect(page.getByRole("heading", { name: "Preview Staff" }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("canonical public path auto-redirect never flashes not-found", async ({ page }) => {
    await page.route("**/api/staff/directory/business/venue/employee/server**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-3",
          name: "Server One",
          jobTitle: "Server",
          businessId: "biz-1",
          businessName: "Venue",
          businessLogo: null,
          avatar: null,
          bio: null,
          slug: "server",
        }),
      });
    });

    await page.goto("/venue/server", { waitUntil: "domcontentloaded" });
    await assertNoNotFoundFlash(page);
    await expect(page).toHaveURL(/\/tip-amount\?.*employeeId=emp-3/, { timeout: 10_000 });
  });
});
