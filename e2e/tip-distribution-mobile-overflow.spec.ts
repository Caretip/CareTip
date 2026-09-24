import { test, expect } from "@playwright/test";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";
import { PREMIUM_BUSINESS_PROFILE } from "./helpers/entitlementMocks";
import { findOverflowOffenders, readPageOverflow } from "./helpers/overflowAudit";

const MOBILE_WIDTHS = [320, 360, 375, 390, 412, 430] as const;

function jsonResponse(data: unknown, delayMs = 0) {
  return async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return { status: 200, contentType: "application/json", body: JSON.stringify(data) };
  };
}

const SUMMARY_MOCK = {
  routingMode: "business_distribution",
  totalToDistributeCents: 12500,
  employeesAwaitingCount: 2,
  lastDistributionAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  sinceLastDistribution: {
    tipCount: 8,
    grossCents: 14200,
    platformFeeCents: 994,
    netCents: 13206,
  },
};

const EMPLOYEES_MOCK = {
  items: [
    {
      employeeId: "emp-1",
      employeeName: "Anna Schmidt",
      grossCents: 8200,
      platformFeeCents: 574,
      netEntitlementCents: 7626,
      distributedCents: 2000,
      remainingCents: 5626,
    },
    {
      employeeId: "emp-2",
      employeeName: "Max Müller",
      grossCents: 6000,
      platformFeeCents: 420,
      netEntitlementCents: 5580,
      distributedCents: 0,
      remainingCents: 5580,
    },
  ],
};

const HISTORY_MOCK = {
  items: [
    {
      id: "batch-1",
      completedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
      totalAmountCents: 4500,
      employeeCount: 2,
      actorName: "Manager",
      paymentReference: "SEPA-2024-001",
    },
  ],
};

async function installTipDistributionMocks(page: import("@playwright/test").Page) {
  await installMockAuthRefresh(page, {
    token: "e2e-test-token",
    user: {
      id: "e2e-manager-1",
      email: "manager@e2e.local",
      role: "MANAGER",
      name: "E2E Manager",
      emailVerified: true,
      hasCompletedOnboarding: true,
      businessId: "e2e-biz-row",
    },
  });
  await primeE2ESessionToken(page);

  await page.route("**/api/business/profile**", async (route) => {
    await route.fulfill(await jsonResponse(PREMIUM_BUSINESS_PROFILE)());
  });

  await page.route("**/api/me/connect/tip-distribution/summary**", async (route) => {
    await route.fulfill(await jsonResponse(SUMMARY_MOCK, 40)());
  });

  await page.route("**/api/me/connect/tip-distribution/employees**", async (route) => {
    await route.fulfill(await jsonResponse(EMPLOYEES_MOCK, 50)());
  });

  await page.route("**/api/me/connect/tip-distribution/history?**", async (route) => {
    await route.fulfill(await jsonResponse(HISTORY_MOCK, 60)());
  });
}

async function waitForTipDistributionShell(page: import("@playwright/test").Page) {
  await page.goto("/dashboard/tips/tip-distribution", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".business-mobile-list").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("Tip distribution mobile overflow", () => {
  for (const width of MOBILE_WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await installTipDistributionMocks(page);
      await waitForTipDistributionShell(page);

      await expect(page.locator(".business-mobile-list").first()).toBeVisible({ timeout: 10_000 });
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
