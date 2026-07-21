/**
 * Pre-commit validation for performance improvements (lazy load, prefetch, charts, dashboards).
 * Run: npm run test:e2e:with-server e2e/performance-stability-validation.spec.ts
 */
import { test, expect } from "@playwright/test";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";

const ACTIVE_BUSINESS_PROFILE = {
  id: "e2e-biz-row",
  name: "E2E Business",
  logo: null,
  subscriptionTier: "premium",
  hasActiveSubscription: true,
  accessSource: "subscription",
  subscriptionStatus: "active",
};

function jsonResponse(data: unknown, delayMs = 0) {
  return async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return { status: 200, contentType: "application/json", body: JSON.stringify(data) };
  };
}

const PROTECTED_API_PATTERNS = [
  "**/api/business/me/stats**",
  "**/api/business/customer-feedback**",
  "**/api/tips/employee**",
  "**/api/platform/stats**",
  "**/api/platform/analytics**",
];

test.describe("Performance change stability validation", () => {
  test("Landing: below-fold mounts on scroll; no permanent empty main sections", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator(".caretip-hero-section, .caretip-hero-copy h1").first()).toBeVisible();

    const belowFoldBefore = page.locator("#how-it-works, #business-section, #industries, #recognition").first();
    const countBefore = await belowFoldBefore.count();
    if (countBefore === 0) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
      await page.waitForTimeout(400);
    }

    await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight * 0.55, 2400)));
    await expect(
      page.locator("#how-it-works, #business-section, #industries, #recognition, #for-employees").first(),
    ).toBeVisible({ timeout: 12_000 });
  });

  test("Landing idle prefetch does not call protected dashboard APIs", async ({ page }) => {
    const protectedHits: string[] = [];
    for (const pattern of PROTECTED_API_PATTERNS) {
      await page.route(pattern, async (route) => {
        protectedHits.push(route.request().url());
        return route.fulfill(await jsonResponse({})());
      });
    }

    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    expect(protectedHits, `Unexpected protected API calls: ${protectedHits.join(", ")}`).toEqual([]);
  });

  test("Business dashboard: charts survive month → year period toggle", async ({ page }) => {
    await installMockAuthRefresh(page, {
      token: "e2e-test-token",
      user: {
        id: "e2e-business-1",
        email: "biz@e2e.local",
        role: "MANAGER",
        name: "E2E Business",
        emailVerified: true,
        hasCompletedOnboarding: true,
        businessId: "e2e-biz-row",
      },
    });
    await primeE2ESessionToken(page);

    const statsByPeriod: Record<string, number> = { week: 0, month: 0, year: 0 };

    await page.route("**/api/business/profile**", async (route) =>
      route.fulfill(await jsonResponse(ACTIVE_BUSINESS_PROFILE)()),
    );

    await page.route("**/api/business/me/stats?**", async (route) => {
      const url = new URL(route.request().url());
      const timeframe = url.searchParams.get("timeframe") ?? "month";
      statsByPeriod[timeframe] = (statsByPeriod[timeframe] ?? 0) + 1;
      return route.fulfill(
        await jsonResponse({
          totalTips: timeframe === "year" ? 900 : timeframe === "week" ? 40 : 240,
          tipCount: timeframe === "year" ? 120 : timeframe === "week" ? 5 : 18,
          employeeCount: 4,
          dailyTipDistribution: [{ day: "Mon", amount: timeframe === "year" ? 30 : 12 }],
          employees: [
            {
              id: "1",
              name: "Alex Smith",
              tipsTotal: 90,
              isActive: true,
              activationStatus: "active",
              emailVerified: true,
            },
          ],
          employeeGoals: [{ employeeId: "1", status: "on_track", percent: 80, goalAmount: 100, currentAmount: 80, goalPeriod: "monthly", name: "Alex" }],
        })(),
      );
    });

    await page.route("**/api/business/customer-feedback?**", async (route) =>
      route.fulfill(await jsonResponse({ items: [], summary: { feedbackCount: 0, averageRating: null } })()),
    );

    await page.goto("/dashboard");
    await expect(page.locator(".business-dashboard-hero, .business-dashboard-body").first()).toBeVisible({
      timeout: 15_000,
    });

    await page.evaluate(() => {
      document.querySelector(".business-dashboard-chart-card")?.scrollIntoView({ block: "center" });
    });

    await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 15_000 });

    const monthBtn = page.getByRole("button", { name: /month|monat/i }).first();
    const yearBtn = page.getByRole("button", { name: /year|jahr/i }).first();
    await yearBtn.click();
    await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 10_000 });

    await monthBtn.click();
    await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 10_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".business-dashboard-body").first()).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      document.querySelector(".business-dashboard-chart-card")?.scrollIntoView({ block: "center" });
    });
    await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 15_000 });

    expect(statsByPeriod.month).toBeGreaterThanOrEqual(1);
    expect(statsByPeriod.year).toBeGreaterThanOrEqual(1);
  });

  test("Business dashboard: monthly charts load after delayed entitlements (no refresh)", async ({ page }) => {
    await installMockAuthRefresh(page, {
      token: "e2e-test-token",
      user: {
        id: "e2e-business-1",
        email: "biz@e2e.local",
        role: "MANAGER",
        name: "E2E Business",
        emailVerified: true,
        hasCompletedOnboarding: true,
        businessId: "e2e-biz-row",
      },
    });
    await primeE2ESessionToken(page);

    const statsCalls: Array<{ scope: string | null; timeframe: string | null }> = [];

    await page.route("**/api/business/profile**", async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      return route.fulfill(await jsonResponse(ACTIVE_BUSINESS_PROFILE)());
    });

    await page.route("**/api/business/me/stats?**", async (route) => {
      const url = new URL(route.request().url());
      const scope = url.searchParams.get("scope");
      const timeframe = url.searchParams.get("timeframe");
      statsCalls.push({ scope, timeframe });

      if (scope === "summary") {
        return route.fulfill(
          await jsonResponse({
            totalTips: 180,
            tipCount: 12,
            employeeCount: 3,
            employees: [
              {
                id: "1",
                name: "Alex Smith",
                tipsTotal: 90,
                isActive: true,
                activationStatus: "active",
                emailVerified: true,
              },
            ],
          })(),
        );
      }

      return route.fulfill(
        await jsonResponse({
          totalTips: 240,
          tipCount: 18,
          employeeCount: 4,
          dailyTipDistribution: [
            { day: "1", amount: 8 },
            { day: "2", amount: 14 },
            { day: "3", amount: 10 },
          ],
          employees: [
            {
              id: "1",
              name: "Alex Smith",
              tipsTotal: 90,
              isActive: true,
              activationStatus: "active",
              emailVerified: true,
            },
          ],
          employeeGoals: [],
        })(),
      );
    });

    await page.route("**/api/business/customer-feedback?**", async (route) =>
      route.fulfill(await jsonResponse({ items: [], summary: { feedbackCount: 0, averageRating: null } })()),
    );

    await page.goto("/dashboard");
    await expect(page.locator(".business-dashboard-body").first()).toBeVisible({ timeout: 15_000 });

    await expect.poll(() => statsCalls.some((call) => call.scope === "full"), { timeout: 20_000 }).toBe(true);

    await page.evaluate(() => {
      document.querySelector(".business-dashboard-chart-card")?.scrollIntoView({ block: "center" });
    });

    await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 20_000 });
  });

  test("Business dashboard: language and theme toggles keep shell visible", async ({ page }) => {
    await installMockAuthRefresh(page, {
      token: "e2e-test-token",
      user: {
        id: "e2e-business-1",
        email: "biz@e2e.local",
        role: "MANAGER",
        name: "E2E Business",
        emailVerified: true,
        hasCompletedOnboarding: true,
        businessId: "e2e-biz-row",
      },
    });
    await primeE2ESessionToken(page);

    await page.route("**/api/business/profile**", async (route) =>
      route.fulfill(await jsonResponse(ACTIVE_BUSINESS_PROFILE)()),
    );
    await page.route("**/api/business/me/stats?**", async (route) =>
      route.fulfill(
        await jsonResponse({
          totalTips: 100,
          tipCount: 5,
          employeeCount: 2,
          dailyTipDistribution: [],
          employees: [],
          employeeGoals: [],
        })(),
      ),
    );
    await page.route("**/api/business/customer-feedback?**", async (route) =>
      route.fulfill(await jsonResponse({ items: [], summary: { feedbackCount: 0, averageRating: null } })()),
    );

    await page.goto("/dashboard");
    await expect(page.locator(".business-dashboard-body").first()).toBeVisible({ timeout: 15_000 });

    const langBtn = page.getByRole("button", { name: /language|sprache/i }).first();
    if (await langBtn.isVisible().catch(() => false)) {
      await langBtn.click();
      await expect(page.locator('[role="listbox"]').first()).toBeVisible({ timeout: 3000 });
      await page.keyboard.press("Escape");
    }

    const themeBtn = page.getByRole("button", { name: /theme|design|dark|light|modus/i }).first();
    if (await themeBtn.isVisible().catch(() => false)) {
      await themeBtn.click();
    }

    await expect(page.locator(".business-dashboard-body").first()).toBeVisible();
  });

  test("Employee dashboard: first visit charts load after scroll", async ({ page }) => {
    await installMockAuthRefresh(page, {
      token: "e2e-test-token",
      user: {
        id: "e2e-employee-1",
        email: "staff@e2e.local",
        role: "EMPLOYEE",
        name: "E2E Staff",
        emailVerified: true,
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
      return route.fulfill(
        await jsonResponse({
          id: "e2e-emp-row",
          name: "E2E Staff",
          slug: "e2e-staff",
          subscriptionTier: "premium",
          hasActiveSubscription: true,
          subscriptionStatus: "active",
        })(),
      );
    });

    await page.route("**/api/tips/employee?**", async (route) => {
      const scope = new URL(route.request().url()).searchParams.get("scope") ?? "full";
      if (scope === "account") {
        return route.fulfill(
          await jsonResponse({ totalEarningsEur: 1200, availableBalanceEur: 100, totalSupporters: 44 })(),
        );
      }
      if (scope === "summary") {
        return route.fulfill(
          await jsonResponse({
            periodTipCount: 3,
            periodAmountEur: 24,
            monthlyGoal: 200,
            currentMonthTotal: 80,
            tips: [],
          })(),
        );
      }
      return route.fulfill(
        await jsonResponse({
          chartSeries: [{ label: "Mon", amount: 24 }],
          tips: [],
        })(),
      );
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/employee/dashboard");
    await expect(page.locator(".employee-dashboard-hero").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/€\s*24|24\s*€/)).toBeVisible({ timeout: 15_000 });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45));
    await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 15_000 });
  });
});
