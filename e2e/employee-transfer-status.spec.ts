import { test, expect } from "@playwright/test";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";
import { PREMIUM_EMPLOYEE_PROFILE } from "./helpers/entitlementMocks";

const BASE_ANALYTICS = {
  period: "month",
  periodStart: new Date(Date.now() - 30 * 86400000).toISOString(),
  periodEnd: new Date().toISOString(),
  periodBasis: "tip_created_at",
  businessTimezone: "Europe/Berlin",
  metrics: {
    scope: "period",
    grossTipsEur: 100,
    employeeEarningsEur: 90,
    totalSupporters: 5,
    caretipFeesFromPayablesEur: 10,
    feesExact: true,
    tipCount: 5,
    averageTipEur: 20,
    largestTipEur: 30,
  },
  lifetimeMetrics: {
    grossTipsEur: 500,
    employeeEarningsEur: 450,
    paidToStripeEur: 400,
    pendingReleaseEur: 50,
    totalSupporters: 20,
    prePayableGrossTipsEur: 0,
  },
  tipRecords: [],
  chartSeries: [],
  stripe: {
    readable: true,
    availableCents: 1000,
    pendingCents: 0,
    instantAvailableCents: 0,
    currency: "eur",
    transfers: [],
    bankPayouts: { items: [], stripeReadable: true },
  },
};

const ROW = {
  payableId: "p1",
  transactionId: "t1",
  status: "MATCHED" as const,
  caretipPayableCents: 1000,
  caretipTransferredCents: 1000,
  caretipRemainingCents: 0,
  caretipStatus: "transferred",
  stripeTransferId: "tr_1",
  stripeTransferAmountCents: 1000,
  stripeTransferCreatedAt: new Date().toISOString(),
  stripeDestination: "acct_1",
  employeeStripeAccountId: "acct_1",
};

function reconciliation(overrides: Record<string, unknown>) {
  return {
    rows: [],
    needsAttention: false,
    stripeReadable: true,
    complete: true,
    examinedPayableCount: 0,
    totalPayableCount: 0,
    payablesTruncated: false,
    transfersHasMore: false,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  };
}

async function installAnalytics(page: import("@playwright/test").Page, reconciliationSlice: unknown) {
  await installMockAuthRefresh(page, {
    token: "e2e-test-token",
    user: {
      id: "e2e-employee-1",
      email: "staff@e2e.local",
      role: "EMPLOYEE",
      name: "E2E Staff",
      emailVerified: true,
      hasCompletedOnboarding: false,
      employeeId: "e2e-emp-row",
      businessId: "e2e-biz-row",
    },
  });
  await primeE2ESessionToken(page);

  await page.route("**/api/employees/me**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill(jsonResponse(PREMIUM_EMPLOYEE_PROFILE));
  });

  await page.route("**/api/me/employee-connect/analytics?**", async (route) => {
    await route.fulfill(jsonResponse({ ...BASE_ANALYTICS, reconciliation: reconciliationSlice }));
  });
}

async function openEmployeeAnalytics(page: import("@playwright/test").Page, locale: "en" | "de" = "en") {
  await page.addInitScript((lang) => {
    localStorage.setItem("caretip_i18n_language", lang);
  }, locale);
  await page.goto("/employee/analytics", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".employee-analytics-summary")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".employee-analytics-status")).toBeVisible({ timeout: 20_000 });
}

test.describe("Employee transfer status UX", () => {
  test("stripe unreadable shows neutral message, not alarming reconciliation copy", async ({ page }) => {
    await installAnalytics(
      page,
      reconciliation({
        rows: [{ ...ROW, status: "STRIPE_TRANSFER_MISSING", stripeTransferId: null }],
        stripeReadable: false,
      }),
    );
    await openEmployeeAnalytics(page);
    await expect(page.getByRole("heading", { name: "Transfer status" })).toBeVisible();
    await expect(
      page.getByText("We couldn't verify your Stripe transfers right now"),
    ).toBeVisible();
    await expect(page.getByText("Payout reconciliation needs attention")).toHaveCount(0);
    await expect(page.locator("[data-transfer-status='stripe_unreadable']")).toBeVisible();
  });

  test("transfer confirmed state when MATCHED", async ({ page }) => {
    await installAnalytics(page, reconciliation({ rows: [ROW] }));
    await openEmployeeAnalytics(page);
    await expect(page.getByText("Transfer confirmed")).toBeVisible();
    await expect(
      page.getByText("Your earnings were successfully transferred to your Stripe account."),
    ).toBeVisible();
    await expect(page.locator("[data-transfer-status='transfer_confirmed']")).toBeVisible();
    await expect(page.getByText("Last checked:")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh status" })).toBeVisible();
  });

  test("transfer verifying state when Stripe readable and transfer missing", async ({ page }) => {
    await installAnalytics(
      page,
      reconciliation({
        rows: [{ ...ROW, status: "STRIPE_TRANSFER_MISSING", stripeTransferId: null }],
        stripeReadable: true,
        needsAttention: true,
      }),
    );
    await openEmployeeAnalytics(page);
    await expect(page.getByText("Transfer being verified")).toBeVisible();
    await expect(page.locator("[data-transfer-status='transfer_verifying']")).toBeVisible();
  });

  test("transfer failed state", async ({ page }) => {
    await installAnalytics(
      page,
      reconciliation({
        rows: [
          {
            ...ROW,
            status: "CARETIP_PENDING",
            caretipStatus: "transfer_failed",
            caretipTransferredCents: 0,
            caretipRemainingCents: 500,
          },
        ],
      }),
    );
    await openEmployeeAnalytics(page);
    await expect(page.getByText("Transfer needs attention")).toBeVisible();
    await expect(page.locator("[data-transfer-status='transfer_failed']")).toBeVisible();
  });

  test("state transitions when server reconciliation changes on refetch", async ({ page }) => {
    let call = 0;
    await installMockAuthRefresh(page, {
      token: "e2e-test-token",
      user: {
        id: "e2e-employee-1",
        email: "staff@e2e.local",
        role: "EMPLOYEE",
        name: "E2E Staff",
        emailVerified: true,
        hasCompletedOnboarding: false,
        employeeId: "e2e-emp-row",
        businessId: "e2e-biz-row",
      },
    });
    await primeE2ESessionToken(page);
    await page.route("**/api/employees/me**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill(jsonResponse(PREMIUM_EMPLOYEE_PROFILE));
    });
    await page.route("**/api/me/employee-connect/analytics?**", async (route) => {
      call += 1;
      const reconciliationSlice =
        call === 1
          ? reconciliation({
              rows: [{ ...ROW, status: "STRIPE_TRANSFER_MISSING", stripeTransferId: null, stripeTransferCreatedAt: null }],
              stripeReadable: true,
              needsAttention: true,
            })
          : reconciliation({ rows: [ROW] });
      await route.fulfill(jsonResponse({ ...BASE_ANALYTICS, reconciliation: reconciliationSlice }));
    });
    await openEmployeeAnalytics(page);
    await expect(page.locator("[data-transfer-status='transfer_verifying']")).toBeVisible();
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(page.locator("[data-transfer-status='transfer_confirmed']")).toBeVisible();
  });

  test("amount mismatch shows review message not confirming", async ({ page }) => {
    await installAnalytics(
      page,
      reconciliation({
        rows: [{ ...ROW, status: "AMOUNT_MISMATCH" }],
        stripeReadable: true,
        needsAttention: true,
      }),
    );
    await openEmployeeAnalytics(page);
    await expect(page.getByText("We're reviewing a transfer")).toBeVisible();
    await expect(page.locator("[data-transfer-status='transfer_review_amount']")).toBeVisible();
    await expect(page.getByText("Transfer being verified")).toHaveCount(0);
  });

  test("German localization renders without overflow at 320px", async ({ page }) => {
    await installAnalytics(
      page,
      reconciliation({
        rows: [{ ...ROW, status: "STRIPE_TRANSFER_MISSING", stripeTransferId: null }],
        stripeReadable: false,
      }),
    );
    await page.setViewportSize({ width: 320, height: 800 });
    await openEmployeeAnalytics(page, "de");
    await expect(page.getByRole("heading", { name: "Überweisungsstatus" })).toBeVisible();
    await expect(
      page.getByText("Wir konnten Ihre Stripe-Überweisungen gerade nicht prüfen"),
    ).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
