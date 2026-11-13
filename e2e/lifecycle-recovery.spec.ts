import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Background/foreground recovery regressions.
 *
 *  1. A route's code request hangs (connection died during sleep / app switch / network change) on a
 *     cold load — what a discarded mobile tab does on return. The page must not stay on the CareTip
 *     loader or fall onto a blank page: it shows "Connection interrupted" on the same URL, and Try
 *     again loads that page once the network is healthy.
 *  2. Token-sync bursts (login, refresh on return) must leave exactly one WebSocket per tab.
 *
 * Needs a mocked session (as in navigation-guards.spec.ts): E2E_SESSION_BUSINESS = path to JSON
 * `{ token, user }` served as the /api/auth/refresh response. Skipped when not configured.
 * The WebSocket test also needs the API's Socket.IO endpoint reachable through the dev/preview server.
 */
const BUSINESS_SESSION = process.env.E2E_SESSION_BUSINESS ?? "";
const LAYOUT_MODULE = /\/(src\/app\/layouts\/BusinessLayout\.tsx|assets\/BusinessLayout-[\w-]+\.js)(\?|$)/;

const RECORDER = String.raw`(() => {
  if (window.__lifeFrames) return;
  window.__lifeFrames = [];
  const big = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false; const r = el.getBoundingClientRect(); return r.width * r.height > innerWidth * innerHeight * 0.25; };
  setInterval(() => {
    try {
      const boot = document.getElementById("caretip-html-boot");
      const bootOn = !!boot && document.documentElement.classList.contains("caretip-html-boot-active") && big(boot);
      const loader = [...document.querySelectorAll(".app-branded-loader")].some(big);
      const root = document.getElementById("root");
      const blank = !bootOn && !loader && ((root && root.innerText) || "").trim().length < 3;
      window.__lifeFrames.push({ t: performance.now(), bootOn, loader, blank });
    } catch {}
  }, 100);
})();`;

async function asBusiness(page: Page) {
  const session = readFileSync(BUSINESS_SESSION, "utf8");
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
  await page.addInitScript(RECORDER);
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 200, contentType: "application/json", body: session }));
}

for (const viewport of ["mobile", "desktop"] as const) {
  test.describe(`lifecycle recovery (${viewport})`, () => {
    test.use(
      viewport === "mobile"
        ? { viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1366, height: 860 } },
    );

    test("hung route code on return: connection screen on the same URL, no blank page, Try again recovers", async ({ page }) => {
      test.skip(!BUSINESS_SESSION, "E2E_SESSION_BUSINESS not configured");
      test.setTimeout(90_000);
      await asBusiness(page);
      let hang = true;
      await page.route(LAYOUT_MODULE, async (route) => {
        if (hang) return; // never answered: a connection that died while the device slept
        await route.continue();
      });
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: /connection interrupted/i })).toBeVisible({ timeout: 40_000 });
      expect(new URL(page.url()).pathname).toBe("/dashboard");
      const frames = await page.evaluate(() => (window as unknown as { __lifeFrames: Array<{ blank: boolean }> }).__lifeFrames);
      expect(frames.filter((f) => f.blank).length, "no blank page before the recovery screen").toBe(0);

      hang = false;
      await page.getByRole("button", { name: /try again/i }).click();
      await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: /connection interrupted/i })).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator(".caretip-dashboard-shell, [data-sidebar], aside").first()).toBeVisible({ timeout: 30_000 });
    });

    test("token-sync bursts leave exactly one WebSocket per tab", async ({ page }) => {
      test.skip(!BUSINESS_SESSION, "E2E_SESSION_BUSINESS not configured");
      test.setTimeout(90_000);
      await asBusiness(page);
      let open = 0;
      page.on("websocket", (ws) => {
        if (!/\/socket\.io\//.test(ws.url())) return;
        open += 1;
        ws.on("close", () => {
          open -= 1;
        });
      });
      await page.goto("/dashboard");
      await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      await expect.poll(() => open, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
      // Several token syncs in one burst (as at login and on returning to the tab).
      await page.evaluate(() => {
        for (let i = 0; i < 6; i++) window.dispatchEvent(new Event("caretip-auth-storage-sync"));
      });
      await page.waitForTimeout(4000);
      // Simulated return from the background: hidden → visible, offline → online.
      await page.context().setOffline(true);
      await page.waitForTimeout(1500);
      await page.context().setOffline(false);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("online"));
        for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("caretip-auth-storage-sync"));
      });
      await page.waitForTimeout(6000);
      expect(open, "open Socket.IO connections").toBe(1);
    });
  });
}
