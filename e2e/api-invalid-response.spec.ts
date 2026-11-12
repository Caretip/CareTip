import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * A 2xx response whose body is not usable JSON (truncated JSON, or the SPA's index.html from a
 * misrouted /api request) must surface as an error — never as a misleading empty state.
 * Isolated stack only: E2E_SESSION_MANAGER / E2E_SESSION_EMPLOYEE are `{token,user}` JSON files.
 */
const MANAGER = process.env.E2E_SESSION_MANAGER ?? "";
const EMPLOYEE = process.env.E2E_SESSION_EMPLOYEE ?? "";
test.skip(!MANAGER || !EMPLOYEE, "isolated sessions not configured");

async function signedIn(page: Page, sessionFile: string, body: string, contentType: string) {
  const session = readFileSync(sessionFile, "utf8");
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
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.route("**/api/**", (route) => {
    if (route.request().url().includes("/api/auth/refresh")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: session });
    }
    return route.fulfill({ status: 200, contentType, body });
  });
}

for (const [label, body, contentType] of [
  ["truncated JSON", "{not json", "application/json"],
  ["SPA HTML fallback", "<!doctype html><html><body>app</body></html>", "text/html"],
  ["empty 200 body", "", "application/json"],
] as const) {
  test(`billing shows an error, not "No active subscription", on ${label}`, async ({ page }) => {
    await signedIn(page, MANAGER, body, contentType);
    await page.goto("/dashboard/billing");
    await page.waitForTimeout(6000);
    await expect(page.getByText(/no active subscription/i)).toHaveCount(0);
    await expectNoBlank(page);
  });

  test(`employee tip history does not crash on ${label}`, async ({ page }) => {
    const exceptions: string[] = [];
    page.on("pageerror", (e) => exceptions.push(String(e?.message ?? e)));
    await signedIn(page, EMPLOYEE, body, contentType);
    await page.goto("/employee/tip-history");
    await page.waitForTimeout(6000);
    expect(exceptions.filter((m) => /reading 'length'|undefined/.test(m))).toEqual([]);
    await expectNoBlank(page);
  });
}

async function expectNoBlank(page: Page) {
  const len = await page.evaluate(() => document.body?.innerText?.trim().length ?? 0);
  expect(len).toBeGreaterThan(20);
}
