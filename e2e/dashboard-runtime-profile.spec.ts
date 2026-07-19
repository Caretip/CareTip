/**
 * Captures runtime dashboard profile (business overview) with mocked APIs.
 * Evidence only — writes DASHBOARD_RUNTIME_PROFILE.json + .md
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";

function json(data: unknown, delayMs = 0) {
  return async (route: { fulfill: (r: { status: number; contentType: string; body: string }) => Promise<void> }) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  };
}

const manager = {
  token: "e2e-dash-profile-token",
  user: {
    id: "e2e-business-profile",
    email: "biz-profile@e2e.local",
    role: "MANAGER",
    name: "Profile Biz",
    emailVerified: true,
    hasCompletedOnboarding: true,
    businessId: "e2e-biz-profile",
    businessVerificationStatus: "verified" as const,
  },
};

test.describe("Dashboard runtime profiler", () => {
  test("Business overview exports milestone + API + render evidence", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __DASHBOARD_PROFILE_FORCE__: boolean }).__DASHBOARD_PROFILE_FORCE__ = true;
      try {
        localStorage.setItem("caretip_dash_profile", "1");
      } catch {
        /* ignore */
      }
    });

    await installMockAuthRefresh(page, manager);
    await primeE2ESessionToken(page);

    // Register generic first; specific routes last (Playwright LIFO).
    await page.route("**/api/**", json({ ok: true }, 20));
    await page.route("**/api/business/me/stats**", json({
      totalTips: 100,
      tipCount: 4,
      employeeCount: 2,
      chartSeries: [
        { label: "Mon", tips: 10 },
        { label: "Tue", tips: 20 },
      ],
      employees: [],
      goals: [],
      metrics: {
        totalTips: 100,
        tipCount: 4,
        employeeCount: 2,
      },
    }, 450));

    await page.route("**/api/business/profile**", json({
      id: "e2e-biz-profile",
      name: "Profile Biz",
      verificationStatus: "verified",
    }, 80));

    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 2 }, 40));
    await page.route("**/api/me/notifications?**", json({ items: [], total: 0 }, 120));
    await page.route("**/api/auth/refresh", json({
      token: manager.token,
      user: manager.user,
    }));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard?dashProfile=1", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".caretip-dashboard-shell, [data-testid='sign-in-handoff-cover']", {
      timeout: 20_000,
    });

    await page.waitForFunction(
      () => {
        const api = (window as unknown as {
          __DASHBOARD_PROFILE__?: {
            enabled: boolean;
            snapshot: () => {
              milestones: Record<string, number | null>;
              events: unknown[];
              surface: string | null;
            };
          };
        }).__DASHBOARD_PROFILE__;
        if (!api) return false;
        const snap = api.snapshot();
        const m = snap.milestones;
        return Boolean(m.layout_mounted != null || (snap.events?.length ?? 0) > 0);
      },
      undefined,
      { timeout: 45_000 },
    );

    // Allow charts / late APIs / KPI settle
    await page.waitForTimeout(4000);

    const payload = await page.evaluate(() => {
      const api = (window as unknown as {
        __DASHBOARD_PROFILE__?: {
          snapshot: () => unknown;
          exportMarkdown: () => string;
        };
      }).__DASHBOARD_PROFILE__;
      return {
        pathname: window.location.pathname,
        forced: (window as unknown as { __DASHBOARD_PROFILE_FORCE__?: boolean }).__DASHBOARD_PROFILE_FORCE__,
        snapshot: api?.snapshot() ?? null,
        markdown: api?.exportMarkdown() ?? "",
      };
    });

    const outJson = path.resolve("DASHBOARD_RUNTIME_PROFILE.json");
    const outMd = path.resolve("DASHBOARD_RUNTIME_PROFILE.md");
    fs.writeFileSync(outJson, JSON.stringify(payload, null, 2), "utf8");
    fs.writeFileSync(
      outMd,
      payload.markdown ||
        `# Dashboard Runtime Profile\n\nNo markdown (profiler inactive).\n\nPath: ${payload.pathname}\nForced: ${payload.forced}\n`,
      "utf8",
    );

    console.log("pathname", payload.pathname, "forced", payload.forced);
    console.log(
      "Milestones",
      (payload.snapshot as { milestones?: Record<string, number | null> } | null)?.milestones,
    );
    console.log(
      "Top renders",
      (payload.snapshot as { renderCounts?: Record<string, number> } | null)?.renderCounts,
    );

    expect(payload.forced).toBe(true);
    expect(payload.snapshot).toBeTruthy();
    const milestones = (payload.snapshot as { milestones: Record<string, number | null> }).milestones;
    expect(milestones.layout_mounted ?? milestones.header_rendered).not.toBeNull();
  });
});
