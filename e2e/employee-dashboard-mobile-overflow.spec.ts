import { test, expect } from "@playwright/test";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";
import { findOverflowOffenders, readPageOverflow } from "./helpers/overflowAudit";

const MOBILE_WIDTHS = [320, 360, 375, 390, 430] as const;

function jsonResponse(data: unknown, delayMs = 0) {
  return async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return { status: 200, contentType: "application/json", body: JSON.stringify(data) };
  };
}

async function installEmployeeDashboardMocks(page: import("@playwright/test").Page) {
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
    await route.fulfill(
      await jsonResponse({
        id: "e2e-emp-row",
        name: "E2E Staff",
        slug: "e2e-staff",
        businessSlug: "e2e-venue",
        businessName: "E2E Venue",
        businessLogo: null,
        avatar: null,
        subscriptionTier: "premium",
        hasActiveSubscription: true,
        accessSource: "subscription",
        subscriptionStatus: "active",
      })(),
    );
  });

  await page.route("**/api/tips/employee?**", async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    if (scope === "summary") {
      return route.fulfill(
        await jsonResponse(
          {
            periodTipCount: 3,
            periodAmountEur: 24.5,
            monthlyGoal: 200,
            currentMonthTotal: 80,
            goal: { goalAmount: 200, currentAmount: 80, status: "on_track", percent: 40 },
            chartSeries: [],
            tips: [],
            totalEarningsEur: 120.5,
            availableBalanceEur: 45.25,
            totalSupporters: 12,
            averageRating: 4.8,
            ratingCount: 6,
          },
          80,
        )(),
      );
    }
    if (scope === "analytics") {
      return route.fulfill(
        await jsonResponse(
          {
            chartSeries: [
              { label: "Mon", amount: 8 },
              { label: "Tue", amount: 12 },
              { label: "Wed", amount: 4 },
            ],
            tips: [
              { id: "t1", amount: 8, createdAt: new Date().toISOString() },
              { id: "t2", amount: 12, createdAt: new Date(Date.now() - 3600000).toISOString() },
            ],
          },
          120,
        )(),
      );
    }
    return route.fallback();
  });

  await page.route("**/api/business/profile**", async (route) =>
    route.fulfill(
      await jsonResponse({
        id: "e2e-biz-row",
        name: "E2E Venue",
        verificationStatus: "verified",
        subscriptionTier: "premium",
        hasActiveSubscription: true,
        accessSource: "subscription",
        subscriptionStatus: "active",
      })(),
    ),
  );
}

async function waitForEmployeeDashboardShell(page: import("@playwright/test").Page) {
  await page.goto("/employee/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".employee-dashboard-hero")).toBeVisible({ timeout: 20_000 });
}

async function assertHeaderLeadingContained(page: import("@playwright/test").Page, viewportWidth: number) {
  const metrics = await page.evaluate(() => {
    const leading = document.querySelector(".caretip-dashboard-header-leading");
    const picture = document.querySelector(".caretip-dashboard-header-leading picture");
    return {
      leadingWidth: leading?.getBoundingClientRect().width ?? 0,
      logoWidth: picture?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(metrics.leadingWidth).toBeGreaterThan(0);
  expect(metrics.leadingWidth).toBeLessThanOrEqual(viewportWidth);
  if (metrics.logoWidth > 0) {
    expect(metrics.logoWidth).toBeLessThanOrEqual(viewportWidth * 0.45);
  }
}

test.describe("Employee dashboard mobile overflow", () => {
  for (const width of MOBILE_WIDTHS) {
    test(`no horizontal overflow at ${width}px — initial paint`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await installEmployeeDashboardMocks(page);
      await waitForEmployeeDashboardShell(page);

      await assertHeaderLeadingContained(page, width);
      const metrics = await readPageOverflow(page);
      const offenders = await findOverflowOffenders(page, 8);

      expect(
        metrics.docScrollWidth,
        `doc scrollWidth ${metrics.docScrollWidth} > innerWidth ${metrics.innerWidth}; offenders: ${JSON.stringify(offenders)}`,
      ).toBeLessThanOrEqual(metrics.innerWidth + 1);
    });

    test(`no horizontal overflow at ${width}px — after analytics load`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await installEmployeeDashboardMocks(page);
      await waitForEmployeeDashboardShell(page);

      await expect(page.locator(".employee-dashboard-stats-grid")).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);

      await assertHeaderLeadingContained(page, width);
      const metrics = await readPageOverflow(page);
      const offenders = await findOverflowOffenders(page, 8);

      expect(
        metrics.docScrollWidth,
        `after data load: ${JSON.stringify({ metrics, offenders })}`,
      ).toBeLessThanOrEqual(metrics.innerWidth + 1);
    });

    test(`no horizontal overflow at ${width}px — skeleton then settled`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await installEmployeeDashboardMocks(page);

      await page.route("**/api/tips/employee?**", async (route) => {
        const scope = new URL(route.request().url()).searchParams.get("scope");
        if (scope === "summary") {
          await new Promise((r) => setTimeout(r, 600));
          return route.fulfill(
            await jsonResponse({
              periodTipCount: 0,
              periodAmountEur: 0,
              monthlyGoal: null,
              currentMonthTotal: 0,
              chartSeries: [],
              tips: [],
              totalEarningsEur: 0,
              availableBalanceEur: 0,
              totalSupporters: 0,
            })(),
          );
        }
        if (scope === "analytics") {
          await new Promise((r) => setTimeout(r, 900));
          return route.fulfill(await jsonResponse({ chartSeries: [], tips: [] })());
        }
        return route.fallback();
      });

      await page.goto("/employee/dashboard", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".employee-dashboard-hero")).toBeVisible({ timeout: 20_000 });

      const skeletonMetrics = await readPageOverflow(page);
      await assertHeaderLeadingContained(page, width);
      expect(skeletonMetrics.docScrollWidth).toBeLessThanOrEqual(skeletonMetrics.innerWidth + 1);

      await page.waitForTimeout(1200);
      await assertHeaderLeadingContained(page, width);
      const settledMetrics = await readPageOverflow(page);
      const offenders = await findOverflowOffenders(page, 8);

      expect(
        settledMetrics.docScrollWidth,
        `settled: ${JSON.stringify({ settledMetrics, offenders })}`,
      ).toBeLessThanOrEqual(settledMetrics.innerWidth + 1);
    });
  }
});
