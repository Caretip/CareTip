/**
 * Phase 4 after-capture — React render isolation.
 * Writes BUSINESS / EMPLOYEE / ADMIN_DASHBOARD_PROFILE_PHASE4.json/.md
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";

function json(data: unknown, delayMs = 0) {
  return async (route: {
    fulfill: (r: { status: number; contentType: string; body: string }) => Promise<void>;
  }) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  };
}

const manager = {
  token: "e2e-phase4-biz",
  user: {
    id: "e2e-phase4-biz",
    email: "phase4-biz@e2e.local",
    role: "MANAGER",
    name: "Phase4 Biz",
    emailVerified: true,
    hasCompletedOnboarding: true,
    businessId: "e2e-phase4-biz-row",
    businessVerificationStatus: "verified" as const,
  },
};

const employee = {
  token: "e2e-phase4-emp",
  user: {
    id: "e2e-phase4-emp",
    email: "phase4-emp@e2e.local",
    role: "EMPLOYEE",
    name: "Phase4 Emp",
    emailVerified: true,
    hasCompletedOnboarding: false,
    employeeId: "e2e-emp-row",
    businessId: "e2e-phase4-biz-row",
  },
};

const admin = {
  token: "e2e-phase4-admin",
  user: {
    id: "e2e-phase4-admin",
    email: "phase4-admin@e2e.local",
    role: "platform_admin",
    name: "Phase4 Admin",
    emailVerified: true,
    hasCompletedOnboarding: true,
  },
};

async function enableProfiler(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as { __DASHBOARD_PROFILE_FORCE__: boolean }).__DASHBOARD_PROFILE_FORCE__ = true;
    try {
      localStorage.setItem("caretip_dash_profile", "1");
    } catch {
      /* ignore */
    }
  });
}

async function dump(page: import("@playwright/test").Page, basename: string, settleMs: number) {
  await page.waitForTimeout(settleMs);
  const payload = await page.evaluate(() => {
    const api = (window as unknown as {
      __DASHBOARD_PROFILE__?: { snapshot: () => unknown; exportMarkdown: () => string };
    }).__DASHBOARD_PROFILE__;
    return { snapshot: api?.snapshot() ?? null, markdown: api?.exportMarkdown() ?? "" };
  });
  fs.writeFileSync(path.resolve(`${basename}.json`), JSON.stringify(payload.snapshot, null, 2));
  fs.writeFileSync(path.resolve(`${basename}.md`), payload.markdown || "");
  return payload;
}

const statsBody = {
  totalTips: 65,
  tipCount: 3,
  employeeCount: 5,
  chartSeries: Array.from({ length: 7 }, (_, i) => ({ label: `P${i}`, tips: 10 + i })),
  employees: [],
  goals: [],
  metrics: { totalTips: 65, tipCount: 3, employeeCount: 5 },
  dailyTipDistribution: Array.from({ length: 7 }, (_, i) => ({ day: `D${i}`, amount: 10 })),
  totalEarningsEur: 120,
  totalSupporters: 4,
  periodTipCount: 2,
  periodAmountEur: 18,
  analyticsBundled: true,
};

test.describe("Phase 4 render profiles", () => {
  test("Business Phase 4", async ({ page }) => {
    test.setTimeout(90_000);
    await enableProfiler(page);
    await installMockAuthRefresh(page, manager);
    await primeE2ESessionToken(page);
    await page.route("**/api/**", json({ ok: true }, 15));
    await page.route("**/api/auth/refresh", json({ token: manager.token, user: manager.user }));
    await page.route("**/api/business/me/stats**", json(statsBody, 400));
    await page.route(
      "**/api/business/profile**",
      json({ id: "biz", name: "Biz", verificationStatus: "verified" }, 80),
    );
    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 2 }, 50));
    await page.route("**/api/me/notifications?**", json({ items: [], total: 0 }, 80));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard?dashProfile=1&dashScenario=phase4_business", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 30_000 });
    const biz = await dump(page, "BUSINESS_DASHBOARD_PROFILE_PHASE4", 4500);
    expect(biz.snapshot).toBeTruthy();
  });

  test("Employee Phase 4", async ({ page }) => {
    test.setTimeout(90_000);
    await enableProfiler(page);
    await installMockAuthRefresh(page, employee);
    await primeE2ESessionToken(page);
    await page.route("**/api/**", json({ ok: true }, 15));
    await page.route("**/api/auth/refresh", json({ token: employee.token, user: employee.user }));
    await page.route("**/api/tips/employee**", json(statsBody, 350));
    await page.route(
      "**/api/employees/me**",
      json({
        id: "e2e-emp-row",
        name: "Emp",
        slug: "emp",
        businessName: "Biz",
        businessLogo: null,
        emailVerified: true,
      }, 80),
    );
    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 1 }, 40));
    await page.route("**/api/me/notifications?**", json({ items: [], total: 0 }, 60));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/employee/dashboard?dashProfile=1&dashScenario=phase4_employee", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    const emp = await dump(page, "EMPLOYEE_DASHBOARD_PROFILE_PHASE4", 4000);
    expect(emp.snapshot).toBeTruthy();
  });

  test("Admin Phase 4", async ({ page }) => {
    test.setTimeout(90_000);
    await enableProfiler(page);
    await installMockAuthRefresh(page, admin);
    await primeE2ESessionToken(page);
    await page.route("**/api/**", json({ ok: true }, 15));
    await page.route("**/api/auth/refresh", json({ token: admin.token, user: admin.user }));
    const platformPayload = {
      ok: true,
      database: "online",
      stripe: "online",
      employeesCount: 10,
      successTransactionCount: 100,
      businessesCount: 5,
      businesses: [],
      items: [],
      total: 0,
      approved: 4,
      submitted: 1,
      rejected: 0,
      growth: [],
      widgets: { failedPaymentsToday: 0 },
      segments: { premiumOpportunities: [], growthCandidates: [], atRisk: [] },
    };
    for (const frag of [
      "**/api/platform/health**",
      "**/api/platform/stats**",
      "**/api/platform/onboarding/metrics**",
      "**/api/platform/businesses**",
      "**/api/platform/audit-logs**",
      "**/api/platform/analytics**",
      "**/api/platform/subscriptions/monitoring**",
      "**/api/platform/commercial-intelligence**",
    ]) {
      const delay =
        frag.includes("health") || frag.includes("/stats")
          ? 400
          : frag.includes("commercial") || frag.includes("analytics") || frag.includes("subscriptions")
            ? 900
            : 600;
      await page.route(frag, json(platformPayload, delay));
    }
    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 0 }, 30));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/platform-admin/dashboard?dashProfile=1&dashScenario=phase4_admin", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    const adm = await dump(page, "ADMIN_DASHBOARD_PROFILE_PHASE4", 4000);
    expect(adm.snapshot).toBeTruthy();
  });
});
