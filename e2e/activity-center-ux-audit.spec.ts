import { test, expect } from "@playwright/test";
import { installMockAuthRefresh, primeE2ESessionToken } from "./helpers/mockAuthRefresh";

import { getQrScanSourceCategory, translateActivitySource } from "../src/app/lib/activitySourceTranslator";

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
  token: "e2e-activity-center-ux-audit",
  user: {
    id: "e2e-activity-center-ux-audit",
    email: "activity-center@e2e.local",
    role: "MANAGER",
    name: "E2E Activity Biz",
    emailVerified: true,
    hasCompletedOnboarding: true,
    businessId: "e2e-activity-center-biz",
    businessVerificationStatus: "verified" as const,
  },
};

test.describe("Activity Center UX audit (Phase 13.9)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Keep assertions deterministic across CI/dev machines.
      localStorage.setItem("caretip_i18n_language", "en");
    });

    await installMockAuthRefresh(page, manager);
    await primeE2ESessionToken(page);

    // Default blanket stub so other dashboard requests don't crash the shell.
    await page.route("**/api/**", json({ ok: true }, 20));

    // Required by ApprovedBusinessGate / timezone cache.
    await page.route("**/api/business/profile**", json({
      id: manager.user.businessId,
      name: "E2E Activity Biz",
      timezone: "Europe/Berlin",
      subscriptionTier: "basic",
      subscriptionStatus: "active",
      onboardingVerificationStatus: "approved",
      hasActiveSubscription: true,
      accessSource: "subscription",
    }));

    // Activity feed (client filters by `filter` and `source`).
    await page.route("**/api/business/activity**", async (route) => {
      const now = Date.now();
      const todayButNotRelative = new Date(now - 5 * 60 * 60 * 1000).toISOString(); // ~5 hours ago
      const items = [
        {
          id: "a_tip_1",
          type: "tip.received",
          source: "TIPS",
          priority: "NORMAL",
          occurredAt: todayButNotRelative,
          titleKey: "activity.tip.received",
          params: { amountEur: 15, employeeName: "Guest" },
          subject: null,
          actorEmployeeId: null,
          locationId: null,
          tableId: null,
        },
        {
          id: "a_qr_1",
          type: "qr.scanned",
          source: "QR",
          priority: "NORMAL",
          occurredAt: todayButNotRelative,
          titleKey: "activity.qr.scanned",
          params: { scanType: "business_directory" },
          subject: { type: "scan", id: "scan_1" },
          actorEmployeeId: null,
          locationId: null,
          tableId: null,
        },
      ];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items, nextCursor: null }),
      });
    });

    await page.route("**/api/me/notifications/unread-count**", json({ unreadCount: 0 }, 5));
  });

  test("Today filter hides relative timestamps", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/tips/live", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 30_000 });

    // Click the "Today" filter chip.
    await page.getByRole("button", { name: "Today" }).click();

    // Relative timestamps must never appear in Today filter.
    await expect(page.locator("text=/hours ago/")).toHaveCount(0);
    await expect(page.locator("text=/minutes ago/")).toHaveCount(0);
    await expect(page.locator("text=/Just now/")).toHaveCount(0);

    // Venue-local calendar label remains.
    await expect(page.getByText(/Today\s*·\s*/)).toBeVisible();
  });

  test("QR filter never shows backend scan keys", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/tips/live", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".caretip-dashboard-shell", { timeout: 30_000 });

    // Click the "QR" filter chip.
    await page.getByRole("button", { name: "QR" }).click();

    await expect(page.getByText("Business QR scanned")).toBeVisible();
    await expect(page.getByText("Guest scanned your Business QR")).toBeVisible();

    // Must not leak internal backend scanType keys.
    await expect(page.locator("text=business_directory")).toHaveCount(0);
    await expect(page.locator("text=employee_directory")).toHaveCount(0);
  });

  test("QR scan-type translator maps known keys", async () => {
    const t = (_key: string, opts?: Record<string, unknown>) => String(opts?.defaultValue ?? "");

    expect(getQrScanSourceCategory("business_directory")).toBe("business");
    expect(getQrScanSourceCategory("employee_profile")).toBe("employee");
    expect(getQrScanSourceCategory("location")).toBe("location");
    expect(getQrScanSourceCategory("table_slug")).toBe("table");
    expect(getQrScanSourceCategory("venue")).toBe("venue");

    const activity = {
      type: "qr.scanned",
      params: { scanType: "business_directory" },
    };
    const translated = translateActivitySource(activity, t);
    expect(translated).not.toBeNull();
    expect(translated?.title).toContain("Business QR");
    expect(translated?.subtitle).toContain("Guest scanned your Business QR");
  });
});

