/**
 * Phase 3 after-capture — Admin progressive loading.
 * Critical APIs (health/stats) settle faster than heavy (commercial/analytics).
 * Writes ADMIN_DASHBOARD_PROFILE_PHASE3.json/.md
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

/** Staggered calibration: critical faster than secondary/heavy (live-class). */
const CRITICAL_MS = 480;
const SECONDARY_MS = 850;
const HEAVY_MS = 1200;

const admin = {
  token: "e2e-phase3-admin",
  user: {
    id: "e2e-phase3-admin",
    email: "phase3-admin@e2e.local",
    role: "platform_admin",
    name: "Phase3 Admin",
    emailVerified: true,
    hasCompletedOnboarding: true,
  },
};

const platformPayload = {
  ok: true,
  status: "ok",
  database: "online",
  stripe: "online",
  businesses: [],
  items: [],
  total: 0,
  employeesCount: 10,
  successTransactionCount: 100,
  businessesCount: 5,
  transactionCount: 100,
  totalVolumeEur: 1000,
  totalVolumeEurFormatted: "€1,000",
  locationsCount: 2,
  activeUsersCount: 8,
  approved: 4,
  submitted: 1,
  rejected: 0,
  growth: [{ date: "2026-07-01", newUsers: 1, newBusinesses: 1, newTips: 1 }],
  userDistribution: [],
  tipStatus: [],
  tipVolume: [],
  topBusinessesByTips: [],
  rangeDays: 30,
  widgets: { failedPaymentsToday: 0 },
  segments: {
    premiumOpportunities: [{ id: "1" }],
    growthCandidates: [{ id: "2" }],
    atRisk: [],
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

test.describe("Phase 3 admin progressive", () => {
  test("Admin overview progressive stages", async ({ page }) => {
    test.setTimeout(120_000);
    await enableProfiler(page);
    await installMockAuthRefresh(page, admin);
    await primeE2ESessionToken(page);

    await page.route("**/api/**", json({ ok: true }, 20));
    await page.route("**/api/auth/refresh", json({ token: admin.token, user: admin.user }));
    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 0 }, 40));
    await page.route("**/api/me/notifications?**", json({ items: [], total: 0 }, 80));

    const routeDelay = (frag: string, delayMs: number) =>
      page.route(frag, json(platformPayload, delayMs));

    await routeDelay("**/api/platform/health**", CRITICAL_MS);
    await routeDelay("**/api/platform/stats**", CRITICAL_MS);
    await routeDelay("**/api/platform/onboarding/metrics**", SECONDARY_MS);
    await routeDelay("**/api/platform/businesses**", SECONDARY_MS);
    await routeDelay("**/api/platform/audit-logs**", SECONDARY_MS);
    await routeDelay("**/api/platform/analytics**", HEAVY_MS);
    await routeDelay("**/api/platform/subscriptions/monitoring**", HEAVY_MS);
    await routeDelay("**/api/platform/commercial-intelligence**", HEAVY_MS);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/platform-admin/dashboard?dashProfile=1&dashScenario=phase3_after", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 45_000 });
    await page.waitForTimeout(4500);

    const payload = await page.evaluate(() => {
      const api = (window as unknown as {
        __DASHBOARD_PROFILE__?: { snapshot: () => unknown; exportMarkdown: () => string };
      }).__DASHBOARD_PROFILE__;
      return { snapshot: api?.snapshot() ?? null, markdown: api?.exportMarkdown() ?? "" };
    });

    expect(payload.snapshot).toBeTruthy();
    fs.writeFileSync(
      path.resolve("ADMIN_DASHBOARD_PROFILE_PHASE3.json"),
      JSON.stringify(payload.snapshot, null, 2),
    );
    fs.writeFileSync(path.resolve("ADMIN_DASHBOARD_PROFILE_PHASE3.md"), payload.markdown || "");

    const snap = payload.snapshot as {
      milestones?: Record<string, number | null>;
      apis?: { url: string; durationMs?: number }[];
    };
    const firstKpi = snap.milestones?.first_kpi_rendered ?? 0;
    const apis = snap.apis ?? [];

    const health = apis.find((a) => a.url.includes("/platform/health"));
    const commercial = apis.find((a) => a.url.includes("commercial-intelligence"));

    // Critical KPIs must not wait for commercial-intelligence.
    expect(firstKpi).toBeGreaterThan(0);
    expect(firstKpi).toBeLessThan(900);
    expect(health?.durationMs ?? 0).toBeLessThan(700);
    expect(commercial?.durationMs ?? 0).toBeGreaterThan(1000);
    // First KPI before heavy commercial settles (timeline proof via milestones vs durations).
    expect(firstKpi).toBeLessThan((commercial?.durationMs ?? 0) + 200);
  });
});
