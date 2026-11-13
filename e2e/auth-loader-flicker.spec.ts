import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Auth loader flicker regressions. A recorder samples every animation frame and notes whether a
 * CareTip loader (HTML boot, global overlay or inline page loader) or a blank #root is on screen.
 * Each transition below must go straight from the old page to the new one.
 *
 * The AuthPage module response is delayed so "login page code not loaded yet" — the condition that
 * produced the loader flashes — is deterministic in dev (Vite module) and production (hashed chunk).
 *
 * Logout tests need a mocked session (as in navigation-guards.spec.ts):
 *   E2E_SESSION_BUSINESS / E2E_SESSION_EMPLOYEE = path to JSON `{ token, user }` served as the
 *   /api/auth/refresh response. They are skipped when not configured.
 */
const BUSINESS_SESSION = process.env.E2E_SESSION_BUSINESS ?? "";
const EMPLOYEE_SESSION = process.env.E2E_SESSION_EMPLOYEE ?? "";
const AUTH_PAGE_MODULE = /\/(src\/app\/components\/AuthPage\.tsx|assets\/AuthPage-[\w-]+\.js)(\?|$)/;
const AUTH_PAGE_DELAY_MS = 900;

const RECORDER = String.raw`(() => {
  if (window.__flickerFrames) return;
  window.__flickerFrames = [];
  const big = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width * r.height > innerWidth * innerHeight * 0.25;
  };
  const tick = () => {
    try {
      const boot = document.getElementById("caretip-html-boot");
      const bootOn = !!boot && document.documentElement.classList.contains("caretip-html-boot-active") && big(boot);
      const loader = [...document.querySelectorAll(".app-branded-loader")].some(big);
      const root = document.getElementById("root");
      const blank = !bootOn && !loader && ((root && root.innerText) || "").trim().length < 3;
      window.__flickerFrames.push({ t: performance.now(), path: location.pathname, bootOn, loader, blank });
    } catch {}
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

type Frame = { t: number; path: string; bootOn: boolean; loader: boolean; blank: boolean };

async function prepare(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("caretip_i18n_language", "en");
      localStorage.setItem("caretip-pwa-install-dismissed", "1");
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
  await page.route(AUTH_PAGE_MODULE, async (route) => {
    await new Promise((r) => setTimeout(r, AUTH_PAGE_DELAY_MS));
    await route.continue();
  });
}

const markNow = (page: Page) => page.evaluate(() => performance.now());
const framesSince = (page: Page, t: number) =>
  page.evaluate((since) => ((window as unknown as { __flickerFrames: Frame[] }).__flickerFrames ?? []).filter((f) => f.t >= since), t);

function expectNoLoaderOrBlank(frames: Frame[]) {
  const bad = frames.filter((f) => f.bootOn || f.loader || f.blank);
  expect(frames.length, "recorder captured the transition").toBeGreaterThan(3);
  expect(bad.map((f) => `${Math.round(f.t)}ms ${f.path} boot=${f.bootOn} loader=${f.loader} blank=${f.blank}`)).toEqual([]);
}

function asSession(page: Page, sessionFile: string) {
  const session = readFileSync(sessionFile, "utf8");
  return page.addInitScript(() => {
    try {
      sessionStorage.setItem("caretip_session_hint", "1");
    } catch {
      /* ignore */
    }
  }).then(() => page.route("**/api/auth/refresh", (route) => route.fulfill({ status: 200, contentType: "application/json", body: session })));
}

async function openMobileProfileAndSignOut(page: Page) {
  await page
    .locator('[data-dashboard-mobile-profile-trigger], button[aria-haspopup="menu"], header button:has(img), header button[aria-label*="profile" i], header button[aria-label*="account" i]')
    .last()
    .click();
  await page.getByRole("menuitem", { name: /sign out/i }).or(page.getByRole("button", { name: /sign out/i })).first().click();
}

for (const viewport of ["mobile", "desktop"] as const) {
  test.describe(`auth loader flicker (${viewport})`, () => {
    test.use(
      viewport === "mobile"
        ? { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1440, height: 900 } },
    );

    test("Login button keeps the current page until the login form is ready — no loader frame", async ({ page }) => {
      await prepare(page);
      await page.goto("/");
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      if (viewport === "mobile") {
        await page.locator('button[aria-label*="menu" i], button[aria-controls]').first().click();
      }
      const t0 = await markNow(page);
      await page
        .locator(viewport === "mobile" ? ".caretip-public-mobile-nav-drawer__account-link" : ".caretip-public-nav__cta-primary")
        .first()
        .click();
      await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 20_000 });
      await expect(page).toHaveURL(/\/login$/);
      expectNoLoaderOrBlank(await framesSince(page, t0));
    });

    test("wrong password: one sign-in request and the form is never covered", async ({ page }) => {
      await prepare(page);
      let signins = 0;
      await page.route("**/api/auth/refresh", (route) =>
        route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Unauthorized"}' }),
      );
      await page.route("**/api/auth/signin", (route) => {
        signins += 1;
        return route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Invalid email or password"}' });
      });
      await page.goto("/login");
      await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(500);
      await page.locator('input[type="email"]').first().fill("user@example.test");
      await page.locator('input[type="password"]').first().fill("wrong-password-1");
      const t0 = await markNow(page);
      await page.locator('form button[type="submit"]').first().click();
      await expect(
        // Desktop shows it in the role="alert" slot, small screens in an inline paragraph.
        page.getByText(/incorrect email or password/i).locator("visible=true").first(),
      ).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(600);
      expect(signins, "the rejected password is sent once").toBe(1);
      await expect(page.getByTestId("sign-in-handoff-cover")).toHaveCount(0);
      expectNoLoaderOrBlank(await framesSince(page, t0));
    });

    for (const [who, file, dashboard, loginPath] of [
      ["business", BUSINESS_SESSION, "/dashboard", "/login"],
      ["employee", EMPLOYEE_SESSION, "/employee/dashboard", "/employee/login"],
    ] as const) {
      test(`${who} sign-out from a fresh dashboard load — no loader or blank frame, one logout request`, async ({ page }) => {
        test.skip(!file, `E2E_SESSION_${who.toUpperCase()} not configured`);
        await prepare(page);
        await asSession(page, file);
        let logouts = 0;
        await page.route("**/api/auth/logout", (route) => {
          logouts += 1;
          return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
        });
        await page.goto(dashboard);
        await page.waitForURL(new RegExp(`${dashboard.replace(/\//g, "\\/")}$`), { timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
        await page.waitForTimeout(1000);
        // Signed out from here on: the login page must not restore the old session.
        await page.unroute("**/api/auth/refresh");
        await page.route("**/api/auth/refresh", (route) =>
          route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Unauthorized"}' }),
        );
        const t0 = await markNow(page);
        if (viewport === "mobile") await openMobileProfileAndSignOut(page);
        else await page.getByRole("button", { name: /sign out/i }).first().click();
        await page.waitForURL(new RegExp(`${loginPath.replace(/\//g, "\\/")}$`), { timeout: 20_000 });
        await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 10_000 });
        await page.waitForTimeout(400);
        expectNoLoaderOrBlank(await framesSince(page, t0));
        expect(logouts, "one logout request").toBe(1);
      });
    }
  });
}
