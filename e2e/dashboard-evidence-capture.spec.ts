/**
 * Captures Business / Employee / Admin dashboard runtime profiles.
 * Uses live-calibrated API delays from DEV dashboard.timing logs (evidence-backed mocks)
 * plus real React/layout/render instrumentation in the app.
 *
 * Writes:
 *   BUSINESS_DASHBOARD_PROFILE.json/.md
 *   EMPLOYEE_DASHBOARD_PROFILE.json/.md
 *   ADMIN_DASHBOARD_PROFILE.json/.md
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";

type Role = "business" | "employee" | "admin";

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

/** Calibrated from live backend logs in this repo session (myStats.full / sqlBundle). */
const LIVE_LARGE = {
  weekFullMs: 3600,
  monthFullMs: 5600,
  yearFullMs: 4200,
  profileMs: 180,
  notifListMs: 220,
  notifUnreadMs: 90,
};

const LIVE_SMALL = {
  weekFullMs: 420,
  monthFullMs: 480,
  yearFullMs: 450,
  profileMs: 60,
  notifListMs: 80,
  notifUnreadMs: 40,
};

const manager = {
  token: "e2e-evidence-biz",
  user: {
    id: "e2e-evidence-biz",
    email: "evidence-biz@e2e.local",
    role: "MANAGER",
    name: "Evidence Biz",
    emailVerified: true,
    hasCompletedOnboarding: true,
    businessId: "e2e-evidence-biz-row",
    businessVerificationStatus: "verified" as const,
  },
};

const employee = {
  token: "e2e-evidence-emp",
  user: {
    id: "e2e-evidence-emp",
    email: "evidence-emp@e2e.local",
    role: "EMPLOYEE",
    name: "Evidence Emp",
    emailVerified: true,
    hasCompletedOnboarding: false,
    employeeId: "e2e-emp-row",
    businessId: "e2e-evidence-biz-row",
  },
};

const admin = {
  token: "e2e-evidence-admin",
  user: {
    id: "e2e-evidence-admin",
    email: "evidence-admin@e2e.local",
    role: "platform_admin",
    name: "Evidence Admin",
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

async function dumpProfile(
  page: import("@playwright/test").Page,
  basename: string,
  settleMs: number,
) {
  await page.waitForTimeout(settleMs);
  // Profiler may attach slightly after shell mount — retry briefly.
  for (let i = 0; i < 8; i += 1) {
    const ready = await page.evaluate(() => {
      const api = (window as unknown as {
        __DASHBOARD_PROFILE__?: { snapshot: () => unknown };
      }).__DASHBOARD_PROFILE__;
      return Boolean(api?.snapshot?.());
    });
    if (ready) break;
    await page.waitForTimeout(500);
  }
  const payload = await page.evaluate(() => {
    const api = (window as unknown as {
      __DASHBOARD_PROFILE__?: {
        snapshot: () => unknown;
        exportMarkdown: () => string;
      };
    }).__DASHBOARD_PROFILE__;
    return {
      snapshot: api?.snapshot() ?? null,
      markdown: api?.exportMarkdown() ?? "",
      pathname: window.location.pathname,
    };
  });

  const jsonPath = path.resolve(`${basename}.json`);
  const mdPath = path.resolve(`${basename}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(payload.snapshot, null, 2), "utf8");
  fs.writeFileSync(mdPath, payload.markdown || `# ${basename}\n\n(empty)\n`, "utf8");
  console.log("Wrote", jsonPath);
  return payload;
}

async function gotoDashboard(page: import("@playwright/test").Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/ERR_ABORTED|net::ERR|Navigation/.test(msg) || attempt === 2) throw err;
      await page.waitForTimeout(750);
    }
  }
}

test.describe("Dashboard performance evidence capture", () => {
  test("Business cold large + warm + Employee + Admin", async ({ page }) => {
    test.setTimeout(180_000);
    await enableProfiler(page);

    // --- Business large (cold) ---
    await installMockAuthRefresh(page, manager);
    await primeE2ESessionToken(page);

    await page.route("**/api/**", json({ ok: true }, 25));
    await page.route("**/api/auth/refresh", json({ token: manager.token, user: manager.user }));
    await page.route(
      "**/api/business/me/stats**",
      async (route) => {
        const url = route.request().url();
        const tf = new URL(url).searchParams.get("timeframe") || "week";
        const delay =
          tf === "month" ? LIVE_LARGE.monthFullMs : tf === "year" ? LIVE_LARGE.yearFullMs : LIVE_LARGE.weekFullMs;
        await new Promise((r) => setTimeout(r, delay));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            totalTips: tf === "year" ? 2000 : tf === "month" ? 450 : 65,
            tipCount: tf === "year" ? 148 : tf === "month" ? 33 : 3,
            employeeCount: 5,
            chartSeries: Array.from({ length: tf === "year" ? 12 : tf === "month" ? 31 : 7 }, (_, i) => ({
              label: `P${i}`,
              tips: 10 + i,
            })),
            employees: Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, name: `E${i}`, slug: `e${i}` })),
            goals: [],
            metrics: { totalTips: 65, tipCount: 3, employeeCount: 5 },
          }),
        });
      },
    );
    await page.route(
      "**/api/business/profile**",
      json(
        {
          id: "biz",
          name: "Biz",
          verificationStatus: "verified",
          subscriptionTier: "premium",
          hasActiveSubscription: true,
          accessSource: "subscription",
          subscriptionStatus: "active",
        },
        LIVE_LARGE.profileMs,
      ),
    );
    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 3 }, LIVE_LARGE.notifUnreadMs));
    await page.route("**/api/me/notifications?**", json({ items: [{ id: "1" }], total: 1 }, LIVE_LARGE.notifListMs));

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDashboard(page, "/dashboard?dashProfile=1&dashScenario=cold_large");
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    const bizCold = await dumpProfile(page, "BUSINESS_DASHBOARD_PROFILE", 8000);
    expect(bizCold.snapshot).toBeTruthy();

    // Warm: reload same session (second navigation)
    await gotoDashboard(page, "/dashboard?dashProfile=1&dashScenario=warm_large");
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    const bizWarm = await dumpProfile(page, "BUSINESS_DASHBOARD_PROFILE_WARM", 5000);
    expect(bizWarm.snapshot).toBeTruthy();

    // Hard refresh
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    await dumpProfile(page, "BUSINESS_DASHBOARD_PROFILE_HARD_REFRESH", 6000);

    // Small dataset scenario — re-route faster stats
    await page.unroute("**/api/business/me/stats**");
    await page.route(
      "**/api/business/me/stats**",
      async (route) => {
        await new Promise((r) => setTimeout(r, LIVE_SMALL.weekFullMs));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            totalTips: 12,
            tipCount: 1,
            employeeCount: 1,
            chartSeries: [{ label: "Mon", tips: 12 }],
            employees: [],
            goals: [],
            metrics: { totalTips: 12, tipCount: 1, employeeCount: 1 },
          }),
        });
      },
    );
    await gotoDashboard(page, "/dashboard?dashProfile=1&dashScenario=cold_small");
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    await dumpProfile(page, "BUSINESS_DASHBOARD_PROFILE_SMALL", 2500);

    // Merge primary business file should remain the cold_large capture — rewrite primary from cold
    // (cold was overwritten by warm filenames; re-assert primary exists)
    expect(fs.existsSync(path.resolve("BUSINESS_DASHBOARD_PROFILE.json"))).toBe(true);

    // --- Employee ---
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await enableProfiler(page);
    await installMockAuthRefresh(page, employee);
    await primeE2ESessionToken(page);
    await page.route("**/api/**", json({ ok: true }, 20));
    await page.route("**/api/auth/refresh", json({ token: employee.token, user: employee.user }));
    await page.route(
      "**/api/employees/me**",
      json(
        {
          id: "e2e-emp-row",
          slug: "emp",
          businessName: "Biz",
          businessLogo: null,
          subscriptionTier: "premium",
          hasActiveSubscription: true,
          accessSource: "subscription",
          subscriptionStatus: "active",
        },
        120,
      ),
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

    await gotoDashboard(page, "/employee/dashboard?dashProfile=1&dashScenario=cold");
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    const emp = await dumpProfile(page, "EMPLOYEE_DASHBOARD_PROFILE", 4000);
    expect(emp.snapshot).toBeTruthy();

    // --- Admin ---
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await enableProfiler(page);
    await installMockAuthRefresh(page, admin);
    await primeE2ESessionToken(page);
    await page.route("**/api/**", json({ ok: true }, 30));
    await page.route("**/api/auth/refresh", json({ token: admin.token, user: admin.user }));
    const platformDelay = 700;
    for (const pathFrag of [
      "**/api/platform/health**",
      "**/api/platform/stats**",
      "**/api/platform/analytics**",
      "**/api/platform/onboarding/metrics**",
      "**/api/platform/businesses**",
      "**/api/platform/subscriptions/monitoring**",
      "**/api/platform/audit-logs**",
      "**/api/platform/commercial-intelligence**",
    ]) {
      await page.route(pathFrag, json({
        ok: true,
        status: "ok",
        businesses: [],
        items: [],
        total: 0,
        staffCount: 10,
        transactionCount: 100,
        series: [{ day: "1", tips: 1 }],
        failedPayments: 0,
        activeBusinesses: 3,
        pendingReviews: 1,
        atRisk: 0,
        upgrades: 0,
        trials: 0,
      }, platformDelay));
    }
    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 0 }, 40));
    await page.route("**/api/me/notifications?**", json({ items: [], total: 0 }, 80));

    await gotoDashboard(page, "/platform-admin/dashboard?dashProfile=1&dashScenario=cold");
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    const adm = await dumpProfile(page, "ADMIN_DASHBOARD_PROFILE", 5000);
    expect(adm.snapshot).toBeTruthy();

    // Write combined evidence index
    const index = {
      generatedAt: new Date().toISOString(),
      note: "API delays calibrated from live dashboard.timing (large business). React/layout metrics are real instrumentation.",
      calibration: { LIVE_LARGE, LIVE_SMALL },
      files: [
        "BUSINESS_DASHBOARD_PROFILE.json",
        "BUSINESS_DASHBOARD_PROFILE_WARM.json",
        "BUSINESS_DASHBOARD_PROFILE_HARD_REFRESH.json",
        "BUSINESS_DASHBOARD_PROFILE_SMALL.json",
        "EMPLOYEE_DASHBOARD_PROFILE.json",
        "ADMIN_DASHBOARD_PROFILE.json",
      ],
    };
    fs.writeFileSync(path.resolve("DASHBOARD_PROFILE_CAPTURE_INDEX.json"), JSON.stringify(index, null, 2));
  });
});
