import { test, expect } from "@playwright/test";

/**
 * Sprint 4 — guest revenue path UI smoke (API mocked; full ledger path in backend sprint4-payment-e2e).
 */
test.describe("Guest payment flow (UI)", () => {
  test("tip amount → Stripe checkout redirect", async ({ page }) => {
    const employeeId = "e2e-employee-pay";
    const businessId = "e2e-business-pay";

    await page.route("**/api/employees/**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: employeeId,
          name: "Alex Server",
          jobTitle: "Server",
          businessId,
          businessName: "Harbor Kitchen",
          businessSlug: "harbor-kitchen",
          avatar: null,
          businessLogo: null,
        }),
      });
    });

    await page.route("**/api/payments/create-tip-session", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessionId: "cs_e2e_test_session",
          url: "https://checkout.stripe.com/c/pay/e2e_test",
        }),
      });
    });

    await page.goto(`/tip-amount?employeeId=${employeeId}`, { waitUntil: "domcontentloaded" });
    const amountBtn = page.locator("button").filter({ hasText: /^€?\s*10/ }).first();
    await expect(amountBtn).toBeVisible({ timeout: 20_000 });
    await amountBtn.click();
    const continueBtn = page.getByRole("button", { name: /Continue|Weiter|Payment|Zahlen/i }).first();
    await expect(continueBtn).toBeVisible({ timeout: 10_000 });
  });

  test("legacy /payment redirects to tip-amount", async ({ page }) => {
    const employeeId = "e2e-employee-pay";
    await page.route("**/api/employees/**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: employeeId,
          name: "Alex Server",
          jobTitle: "Server",
          businessId: "e2e-business-pay",
          businessName: "Harbor Kitchen",
          avatar: null,
          businessLogo: null,
        }),
      });
    });
    await page.goto(`/payment?employeeId=${employeeId}&amount=5`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/tip-amount/, { timeout: 20_000 });
  });

  test("rating page accepts session_id query", async ({ page }) => {
    await page.route("**/api/payment/session/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ready",
          employeeName: "Alex",
          amountEur: 5,
          businessName: "Harbor Kitchen",
        }),
      });
    });

    await page.goto("/rating?session_id=cs_e2e_rating_test");
    await expect(page).toHaveURL(/session_id=cs_e2e_rating_test/);
  });
});
