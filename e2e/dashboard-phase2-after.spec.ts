/**
 * Phase 2 after-capture — Business overview with week-stats delay calibrated
 * from live `dashboard.timing` after summary-first SQL (cold combined ~1.9s).
 * Writes BUSINESS_DASHBOARD_PROFILE_PHASE2.json/.md
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

/** Live probe (2026-07-18): cold metaSummarySql ~1.9s; context-warm summarySqlOnly ~0.87s. */
const PHASE2 = { weekSummaryMs: 1900, profileMs: 180, notifUnreadMs: 90 };

const manager = {
  token: "e2e-phase2-biz",
  user: {
    id: "e2e-phase2-biz",
    email: "phase2-biz@e2e.local",
    role: "MANAGER",
    name: "Phase2 Biz",
    emailVerified: true,
    hasCompletedOnboarding: true,
    businessId: "e2e-phase2-biz-row",
    businessVerificationStatus: "verified" as const,
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

test.describe("Phase 2 after profiles", () => {
  test("Business after Phase 2 stats backend", async ({ page }) => {
    test.setTimeout(120_000);
    await enableProfiler(page);
    await installMockAuthRefresh(page, manager);
    await primeE2ESessionToken(page);

    await page.route("**/api/**", json({ ok: true }, 20));
    await page.route("**/api/auth/refresh", json({ token: manager.token, user: manager.user }));
    await page.route("**/api/business/me/stats**", async (route) => {
      await new Promise((r) => setTimeout(r, PHASE2.weekSummaryMs));
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
        }),
      });
    });
    await page.route(
      "**/api/business/profile**",
      json({ id: "biz", name: "Biz", verificationStatus: "verified" }, PHASE2.profileMs),
    );
    await page.route(
      "**/api/me/notifications/unread-count**",
      json({ unreadCount: 3 }, PHASE2.notifUnreadMs),
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard?dashProfile=1&dashScenario=phase2_after_cold_large", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 30_000 });
    await page.waitForTimeout(5000);

    const payload = await page.evaluate(() => {
      const api = (window as unknown as {
        __DASHBOARD_PROFILE__?: { snapshot: () => unknown; exportMarkdown: () => string };
      }).__DASHBOARD_PROFILE__;
      return { snapshot: api?.snapshot() ?? null, markdown: api?.exportMarkdown() ?? "" };
    });

    await expect(page.locator(".caretip-dashboard-shell")).toBeVisible();
    if (!payload.snapshot) {
      console.log("BUSINESS_DASHBOARD_PROFILE_PHASE2: profiler snapshot unavailable — shell OK");
      return;
    }
    fs.writeFileSync(
      path.resolve("BUSINESS_DASHBOARD_PROFILE_PHASE2.json"),
      JSON.stringify(payload.snapshot, null, 2),
    );
    fs.writeFileSync(path.resolve("BUSINESS_DASHBOARD_PROFILE_PHASE2.md"), payload.markdown || "");

    const apis = ((payload.snapshot as { apis?: { url: string; durationMs?: number }[] }).apis ?? []);
    const week = apis.find((a) => a.url.includes("timeframe=week"));
    if (week?.durationMs != null) {
      expect(week.durationMs).toBeGreaterThan(500);
      expect(week.durationMs).toBeLessThan(8_000);
    }
  });
});
