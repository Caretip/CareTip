import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Route-guard regressions found by the real-user crawl (isolated stack only).
 *  - E2E_SESSION_EMPLOYEE: path to a JSON `{token,user}` for a seeded employee (served as the refresh
 *    response, so no real cookie or password is needed).
 */
const EMPLOYEE_SESSION = process.env.E2E_SESSION_EMPLOYEE ?? "";
test.skip(!EMPLOYEE_SESSION, "isolated employee session not configured");

async function asEmployee(page: Page) {
  const session = readFileSync(EMPLOYEE_SESSION, "utf8");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("caretip_i18n_language", "en");
      localStorage.setItem("caretip-pwa-install-dismissed", "1");
      sessionStorage.setItem("caretip_session_hint", "1");
      localStorage.setItem(
        "caretip_cookie_consent",
        JSON.stringify({ essential: true, analytics: false, functional: false, marketing: false, consentDate: new Date().toISOString(), consentVersion: 1 }),
      );
    } catch {
      /* ignore */
    }
  });
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 200, contentType: "application/json", body: session }));
  await page.route(/^https:\/\//, (route) => route.abort());
}

test("employee opening a business URL is redirected once, without a render loop", async ({ page }) => {
  const loopWarnings: string[] = [];
  page.on("console", (m) => {
    if (/Maximum update depth exceeded/.test(m.text())) loopWarnings.push(m.text());
  });
  await asEmployee(page);
  await page.goto("/dashboard");
  await page.waitForURL(/\/employee\/dashboard/, { timeout: 30_000 });
  await page.waitForTimeout(2000);
  expect(loopWarnings).toEqual([]);
});

test("unauthorized page is visible immediately (boot overlay released)", async ({ page }) => {
  const diag: string[] = [];
  page.on("console", (m) => {
    if (/DEADLOCK SUSPECT|app-boot timed out/.test(m.text())) diag.push(m.text());
  });
  await asEmployee(page);
  await page.goto("/platform-admin/dashboard");
  await page.waitForURL(/\/unauthorized/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /access denied/i })).toBeVisible({ timeout: 4000 });
  await expect(page.getByText(/preparing your account/i)).toHaveCount(0);
  expect(diag).toEqual([]);
});
