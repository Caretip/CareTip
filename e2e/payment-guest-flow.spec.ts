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

  const SAMPLE_PLACE = "ChIJJ4vHZOVkskcRYFbcF3dtLbo";
  const googleWriteReviewUrl = `https://search.google.com/local/writereview?placeid=${SAMPLE_PLACE}`;
  const tripadvisorReviewUrl = "https://www.tripadvisor.com/Restaurant_Review-g187309.html";

  function readyContext(externalReviews: unknown) {
    return {
      status: "ready" as const,
      sessionId: "cs_e2e_rating_test",
      paymentIntentId: "pi_e2e",
      transactionId: "tx_e2e",
      receiptNumber: "CT-26-E2E00001",
      employee: { id: "emp", name: "Alex", avatar: null },
      businessId: "e2e-business-pay",
      locationId: "loc-e2e",
      tableId: null,
      customerName: "Guest",
      externalReviews,
    };
  }

  test("successful payment without external links keeps CareTip feedback only", async ({ page }) => {
    await page.route("**/api/payments/tip-session/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(readyContext(null)),
      });
    });
    await page.goto("/rating?session_id=cs_e2e_rating_test");
    await expect(page.getByRole("button", { name: /Skip|Überspringen/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /Google|TripAdvisor/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /How was your experience\?|Wie war Ihre Erfahrung\?/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send Feedback|Feedback senden/i })).toBeVisible();
  });

  test("successful payment with Google and TripAdvisor shows both external links", async ({ page }) => {
    await page.route("**/api/payments/tip-session/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          readyContext({
            googleWriteReviewUrl,
            tripadvisorReviewUrl,
          }),
        ),
      });
    });
    await page.goto("/rating?session_id=cs_e2e_rating_test");
    const google = page.getByRole("link", { name: /Google/i });
    const trip = page.getByRole("link", { name: /TripAdvisor/i });
    await expect(google).toBeVisible({ timeout: 20_000 });
    await expect(trip).toBeVisible();
    await expect(google).toHaveAttribute("href", googleWriteReviewUrl);
    await expect(trip).toHaveAttribute("href", tripadvisorReviewUrl);
    await expect(google).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("heading", { name: /Leave a public review|Öffentliche Bewertung hinterlassen/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /How was your experience\?|Wie war Ihre Erfahrung\?/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Send Feedback|Feedback senden/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Skip|Überspringen/i })).toBeVisible();
  });

  test("successful payment with Google only hides CareTip feedback", async ({ page }) => {
    await page.route("**/api/payments/tip-session/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          readyContext({
            googleWriteReviewUrl,
            tripadvisorReviewUrl: null,
          }),
        ),
      });
    });
    await page.goto("/rating?session_id=cs_e2e_rating_test");
    await expect(page.getByRole("link", { name: /Google/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /TripAdvisor/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Send Feedback|Feedback senden/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /How was your experience\?|Wie war Ihre Erfahrung\?/i })).toHaveCount(0);
  });

  test("successful payment with TripAdvisor only hides CareTip feedback", async ({ page }) => {
    await page.route("**/api/payments/tip-session/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          readyContext({
            googleWriteReviewUrl: null,
            tripadvisorReviewUrl,
          }),
        ),
      });
    });
    await page.goto("/rating?session_id=cs_e2e_rating_test");
    await expect(page.getByRole("link", { name: /TripAdvisor/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /Google/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Send Feedback|Feedback senden/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /How was your experience\?|Wie war Ihre Erfahrung\?/i })).toHaveCount(0);
  });

  test("external review buttons wrap on a 360×640 viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.route("**/api/payments/tip-session/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          readyContext({
            googleWriteReviewUrl,
            tripadvisorReviewUrl,
          }),
        ),
      });
    });
    await page.goto("/rating?session_id=cs_e2e_rating_test");
    const google = page.getByRole("link", { name: /Google/i });
    await expect(google).toBeVisible({ timeout: 20_000 });
    const box = await google.boundingBox();
    expect(box).toBeTruthy();
    expect((box?.width ?? 0) <= 360).toBeTruthy();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBeFalsy();
  });

  test("pending payment does not show review links", async ({ page }) => {
    await page.route("**/api/payments/tip-session/**", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          status: "pending",
          sessionId: "cs_e2e_rating_test",
          paymentIntentId: "pi_e2e",
          paymentStatus: "unpaid",
          checkoutStatus: "open",
        }),
      });
    });
    await page.goto("/rating?session_id=cs_e2e_rating_test");
    await expect(page.getByRole("link", { name: /Google|TripAdvisor/i })).toHaveCount(0);
  });

  test("failed payment does not show review links", async ({ page }) => {
    await page.route("**/api/payments/tip-session/**", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          status: "failed",
          sessionId: "cs_e2e_rating_test",
          tipId: "tx_fail",
        }),
      });
    });
    await page.goto("/rating?session_id=cs_e2e_rating_test");
    await expect(page.getByRole("link", { name: /Google|TripAdvisor/i })).toHaveCount(0);
  });
});
