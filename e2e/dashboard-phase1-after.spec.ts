/**
 * Phase 1 after-capture — same calibration as evidence suite for fair before/after.
 * Writes BUSINESS_DASHBOARD_PROFILE_AFTER + EMPLOYEE_DASHBOARD_PROFILE_AFTER.
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

const LIVE_LARGE = { weekFullMs: 3600, profileMs: 180, notifUnreadMs: 90, notifListMs: 220 };

const manager = {
  token: "e2e-phase1-biz",
  user: {
    id: "e2e-phase1-biz",
    email: "phase1-biz@e2e.local",
    role: "MANAGER",
    name: "Phase1 Biz",
    emailVerified: true,
    hasCompletedOnboarding: true,
    businessId: "e2e-phase1-biz-row",
    businessVerificationStatus: "verified" as const,
  },
};

const employee = {
  token: "e2e-phase1-emp",
  user: {
    id: "e2e-phase1-emp",
    email: "phase1-emp@e2e.local",
    role: "EMPLOYEE",
    name: "Phase1 Emp",
    emailVerified: true,
    hasCompletedOnboarding: false,
    employeeId: "e2e-emp-row",
    businessId: "e2e-phase1-biz-row",
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

test.describe("Phase 1 after profiles", () => {
  test("Business + Employee after Phase 1", async ({ page }) => {
    test.setTimeout(120_000);
    await enableProfiler(page);
    await installMockAuthRefresh(page, manager);
    await primeE2ESessionToken(page);

    await page.route("**/api/**", json({ ok: true }, 20));
    await page.route("**/api/auth/refresh", json({ token: manager.token, user: manager.user }));
    await page.route("**/api/business/me/stats**", async (route) => {
      const tf = new URL(route.request().url()).searchParams.get("timeframe") || "week";
      // Only week should be requested after Phase 1 — still delay for fair compare.
      await new Promise((r) => setTimeout(r, LIVE_LARGE.weekFullMs));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalTips: 65,
          tipCount: 3,
          employeeCount: 5,
          chartSeries: Array.from({ length: 7 }, (_, i) => ({ label: `P${i}`, tips: 10 + i })),
          employees: [],
          goals: [],
          metrics: { totalTips: 65, tipCount: 3, employeeCount: 5 },
          _tf: tf,
        }),
      });
    });
    await page.route(
      "**/api/business/profile**",
      json({ id: "biz", name: "Biz", verificationStatus: "verified" }, LIVE_LARGE.profileMs),
    );
    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 3 }, LIVE_LARGE.notifUnreadMs));
    await page.route("**/api/me/notifications?**", json({ items: [{ id: "1" }], total: 1 }, LIVE_LARGE.notifListMs));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard?dashProfile=1&dashScenario=phase1_after_cold_large", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 30_000 });
    const biz = await dump(page, "BUSINESS_DASHBOARD_PROFILE_AFTER", 5000);
    expect(biz.snapshot).toBeTruthy();

    const bizApis = ((biz.snapshot as { apis?: { url: string }[] }).apis ?? []).map((a) => a.url);
    expect(bizApis.some((u) => u.includes("timeframe=month"))).toBe(false);
    expect(bizApis.some((u) => u.includes("timeframe=year"))).toBe(false);
    expect(bizApis.some((u) => u.includes("/notifications?"))).toBe(false);

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await enableProfiler(page);
    await installMockAuthRefresh(page, employee);
    await primeE2ESessionToken(page);
    await page.route("**/api/**", json({ ok: true }, 20));
    await page.route("**/api/auth/refresh", json({ token: employee.token, user: employee.user }));
    await page.route(
      "**/api/employees/me**",
      json({ id: "e2e-emp-row", slug: "emp", businessName: "Biz", businessLogo: null }, 120),
    );
    await page.route("**/api/tips/employee**", json({
      totalEarningsEur: 120,
      totalSupporters: 4,
      periodTipCount: 2,
      periodAmountEur: 18,
      chartSeries: [{ label: "Mon", amount: 18 }],
      analyticsBundled: true,
    }, 900));
    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 1 }, 50));
    await page.route("**/api/me/notifications?**", json({ items: [], total: 0 }, 100));

    await page.goto("/employee/dashboard?dashProfile=1&dashScenario=phase1_after", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 30_000 });
    const emp = await dump(page, "EMPLOYEE_DASHBOARD_PROFILE_AFTER", 3500);
    expect(emp.snapshot).toBeTruthy();

    const empApis = ((emp.snapshot as { apis?: { url: string }[] }).apis ?? []).map((a) => a.url);
    expect(empApis.filter((u) => u.includes("/tips/employee")).length).toBeLessThanOrEqual(1);
    expect(empApis.some((u) => u.includes("timeframe=week"))).toBe(false);
    expect(empApis.some((u) => u.includes("timeframe=month"))).toBe(false);
  });
});
