import { test, expect } from "@playwright/test";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";
import { PREMIUM_EMPLOYEE_PROFILE } from "./helpers/entitlementMocks";
import { findOverflowOffenders, readPageOverflow } from "./helpers/overflowAudit";

const MOBILE_WIDTHS = [320, 360, 375, 390, 412, 430] as const;

function jsonResponse(data: unknown, delayMs = 0) {
  return async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return { status: 200, contentType: "application/json", body: JSON.stringify(data) };
  };
}

const ANALYTICS_MOCK = {
  period: "month",
  periodStart: new Date(Date.now() - 30 * 86400000).toISOString(),
  periodEnd: new Date().toISOString(),
  periodBasis: "tip_created_at",
  businessTimezone: "Europe/Berlin",
  metrics: {
    scope: "period",
    grossTipsEur: 248.5,
    employeeEarningsEur: 231.2,
    totalSupporters: 18,
    caretipFeesFromPayablesEur: 17.3,
    feesExact: true,
    tipCount: 24,
    averageTipEur: 10.35,
    largestTipEur: 45,
  },
  lifetimeMetrics: {
    grossTipsEur: 1200,
    employeeEarningsEur: 1116,
    paidToStripeEur: 890.5,
    pendingReleaseEur: 225.5,
    totalSupporters: 64,
    prePayableGrossTipsEur: 0,
  },
  tipRecords: [
    {
      id: "tip-1",
      createdAt: new Date().toISOString(),
      receiptNumber: "1042",
      grossEur: 12.5,
      platformFeeEur: 0.88,
      employeeEarningsEur: 11.62,
      routingMode: "direct_to_employee",
      chargeModel: "destination",
      payoutStatus: "paid",
      payoutStatusLabel: "paid",
      hasPayable: true,
    },
    {
      id: "tip-2",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      receiptNumber: null,
      grossEur: 8,
      platformFeeEur: 0.56,
      employeeEarningsEur: null,
      routingMode: "business_distribution",
      chargeModel: "destination",
      payoutStatus: "pending",
      payoutStatusLabel: "pending",
      hasPayable: true,
    },
  ],
  chartSeries: [
    { label: "Mo", grossEur: 40, earningsEur: 37 },
    { label: "Di", grossEur: 55, earningsEur: 51 },
    { label: "Mi", grossEur: 32, earningsEur: 30 },
  ],
  reconciliation: {
    rows: [],
    needsAttention: false,
    stripeReadable: true,
    complete: true,
    examinedPayableCount: 0,
    totalPayableCount: 0,
    payablesTruncated: false,
    transfersHasMore: false,
    checkedAt: new Date().toISOString(),
  },
  stripe: {
    readable: true,
    availableCents: 4525,
    pendingCents: 1200,
    instantAvailableCents: 0,
    currency: "eur",
    transfers: [
      {
        id: "tr_1",
        createdAt: new Date().toISOString(),
        amountCents: 1162,
        currency: "eur",
        destination: "acct_1",
        caretipPayableId: "payable-abc123",
        reversed: false,
      },
    ],
    bankPayouts: {
      items: [
        {
          stripePayoutId: "po_1",
          createdAt: new Date().toISOString(),
          amountCents: 5000,
          currency: "eur",
          status: "paid",
          arrivalDate: new Date(Date.now() + 2 * 86400000).toISOString(),
        },
      ],
      stripeReadable: true,
    },
  },
};

async function installEmployeeAnalyticsMocks(page: import("@playwright/test").Page) {
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
    await route.fulfill(await jsonResponse(PREMIUM_EMPLOYEE_PROFILE)());
  });

  await page.route("**/api/me/employee-connect/analytics?**", async (route) => {
    await route.fulfill(await jsonResponse(ANALYTICS_MOCK, 60)());
  });
}

async function waitForEmployeeAnalyticsShell(page: import("@playwright/test").Page) {
  await page.goto("/employee/analytics", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".employee-analytics-summary")).toBeVisible({ timeout: 20_000 });
}

test.describe("Employee analytics mobile overflow", () => {
  for (const width of MOBILE_WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await installEmployeeAnalyticsMocks(page);
      await waitForEmployeeAnalyticsShell(page);

      await expect(page.locator(".employee-analytics-mobile-list").first()).toBeVisible({
        timeout: 10_000,
      });
      await page.waitForTimeout(300);

      const metrics = await readPageOverflow(page);
      const offenders = await findOverflowOffenders(page, 8);

      expect(
        metrics.docScrollWidth,
        `doc scrollWidth ${metrics.docScrollWidth} > innerWidth ${metrics.innerWidth}; offenders: ${JSON.stringify(offenders)}`,
      ).toBeLessThanOrEqual(metrics.innerWidth + 1);
    });
  }
});
