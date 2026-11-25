import { test, expect, type Page } from "@playwright/test";

/**
 * Session notices, Login navigation and auth-page rendering, with a mocked API (no backend).
 * Run against a production build or dev server: E2E_BASE_URL=... npx playwright test auth-session-ux
 */
// Requests made through the PWA service worker would bypass the mocks (WebKit).
test.use({ serviceWorkers: "block" });

const EXPIRED = /session expired|session has expired|Sitzung ist abgelaufen/i;
const USER = { id: "u1", email: "biz@e2e.local", role: "MANAGER", name: "E2E", emailVerified: true, hasCompletedOnboarding: true, businessId: "b1" };
const AUTH_PAGE_MODULE = /\/(src\/app\/components\/AuthPage\.tsx|assets\/AuthPage-[\w-]+\.js)(\?|$)/;
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Api = { refresh: "401" | "ok" | "down" | "expired"; signin: "401" | "down"; oauth: "401" | "ok"; calls: string[] };

async function prepare(page: Page, api: Partial<Api> = {}): Promise<Api> {
  const state: Api = { refresh: "401", signin: "401", oauth: "401", calls: [], ...api };
  await page.addInitScript(() => {
    localStorage.setItem("caretip_i18n_language", "en");
    localStorage.setItem("caretip-pwa-install-dismissed", "1");
    localStorage.setItem(
      "caretip_cookie_consent",
      JSON.stringify({ essential: true, analytics: false, functional: false, marketing: false, consentDate: new Date().toISOString(), consentVersion: 1 }),
    );
  });
  await page.route(/^https:\/\//, (r) => r.abort());
  await page.route(/\/(api|socket\.io)\//, (r) => {
    const p = new URL(r.request().url()).pathname;
    state.calls.push(p);
    if (p === "/api/auth/refresh") {
      if (state.refresh === "down") return r.abort();
      if (state.refresh === "ok") return r.fulfill(json(200, { token: "e2e", user: USER }));
      return r.fulfill(json(401, { message: "Authentication required" }));
    }
    if (p === "/api/auth/signin") return state.signin === "down" ? r.abort() : r.fulfill(json(401, { message: "Invalid email or password" }));
    if (p === "/api/auth/oauth") return state.oauth === "ok" ? r.fulfill(json(200, { token: "e2e", user: USER })) : r.fulfill(json(401, { message: "We couldn't complete social sign-in.", code: "OAUTH_SIGN_IN_FAILED" }));
    if (p === "/api/auth/logout") return r.fulfill(json(200, { ok: true }));
    if (state.refresh === "ok") return r.fulfill(json(200, {}));
    return r.fulfill(json(401, { message: "Authentication required" }));
  });
  return state;
}

const storedSession = (page: Page) =>
  page.addInitScript((u) => {
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    localStorage.setItem("caretip_user", JSON.stringify({ ...u, role: "business" }));
    sessionStorage.setItem("caretip_session_hint", "1");
  }, USER);
const email = (page: Page) => page.locator('input[type="email"]:visible');
const refreshes = (s: Api) => s.calls.filter((c) => c === "/api/auth/refresh").length;

async function failLogin(page: Page) {
  await email(page).fill("nobody@example.test");
  await page.locator('input[type="password"]:visible').fill("wrong-password-1");
  await page.locator('form button[type="submit"]:visible').first().click();
  await expect(page.getByText(/incorrect email or password/i).locator("visible=true").first()).toBeVisible();
}
async function expectNoExpiry(page: Page) {
  // The toast is brief and can mount late: watch for it, and check that none is queued for later.
  const queued = await page.evaluate(() => sessionStorage.getItem("caretip_session_expired_notice"));
  expect(queued, "no expired notice queued").toBeNull();
  for (let i = 0; i < 12; i += 1) {
    expect(await page.getByText(EXPIRED).count(), "no expired notice shown").toBe(0);
    await page.waitForTimeout(100);
  }
}
async function clickLogin(page: Page, mobile: boolean) {
  if (mobile) await page.locator('button[aria-controls="mobile-main-nav"]').click();
  await page.locator(mobile ? ".caretip-public-mobile-nav-drawer__account-link" : ".caretip-public-nav__cta-primary").first().click();
}

for (const mobile of [true, false]) {
  test.describe(`auth session and login UX (${mobile ? "mobile" : "desktop"})`, () => {
    test.use(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });

    test("first visit: Login opens the form, no refresh request, no notice", async ({ page }) => {
      const api = await prepare(page);
      await page.goto("/");
      await clickLogin(page, mobile);
      await expect(page).toHaveURL(/\/login$/);
      await expect(email(page)).toBeVisible();
      await expectNoExpiry(page);
      expect(refreshes(api)).toBe(0);
    });

    test("Login leaves the landing page at once even while its code is slow", async ({ page }) => {
      await prepare(page);
      // Held until the skeleton has been seen (WebKit warms the code earlier than Chromium).
      let release = () => undefined as void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route(AUTH_PAGE_MODULE, async (r) => {
        await held;
        await r.continue();
      });
      await page.goto("/");
      await clickLogin(page, mobile);
      await expect(page).toHaveURL(/\/login$/, { timeout: 1500 });
      await expect(page.locator("[data-auth-entry-skeleton]")).toBeVisible();
      await expect(page.locator(".app-branded-loader")).toHaveCount(0);
      release();
      await expect(email(page)).toBeVisible();
      await expect(page.locator("[data-auth-entry-skeleton]")).toHaveCount(0);
    });

    test("direct visit and reload of /login", async ({ page }) => {
      const api = await prepare(page);
      await page.goto("/login");
      await expect(email(page)).toBeVisible();
      await page.reload();
      await expect(email(page)).toBeVisible();
      await expectNoExpiry(page);
      expect(refreshes(api)).toBe(0);
    });

    test("wrong credentials, leave, return, reload: login error only, never an expired notice", async ({ page }) => {
      const api = await prepare(page);
      await page.goto("/login");
      await failLogin(page);
      await expectNoExpiry(page);
      await page.goto("/");
      await clickLogin(page, mobile);
      await expect(email(page)).toBeVisible();
      await expectNoExpiry(page);
      await expect(page.getByText(/incorrect email or password/i)).toHaveCount(0);
      await page.reload();
      await expect(email(page)).toBeVisible();
      await expectNoExpiry(page);
      expect(api.calls.filter((c) => c === "/api/auth/signin")).toHaveLength(1);
    });

    test("failed sign-in leaves no error on the sign-up page", async ({ page }) => {
      await prepare(page);
      await page.goto("/signup");
      await expect(email(page)).toBeVisible();
      await page.getByRole(mobile ? "button" : "tab", { name: /^(sign in|log in)$/i }).first().click();
      await expect(page).toHaveURL(/\/login/);
      await failLogin(page);
      await page.goto("/signup");
      await expect(page.getByText(/incorrect email or password/i)).toHaveCount(0);
      await expectNoExpiry(page);
    });

    test("Back and Forward between landing and login", async ({ page }) => {
      await prepare(page);
      await page.goto("/");
      await clickLogin(page, mobile);
      await expect(email(page)).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator(mobile ? 'button[aria-controls="mobile-main-nav"]' : ".caretip-public-nav__cta-primary").first()).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(/\/login$/);
      await expect(email(page)).toBeVisible();
      await expectNoExpiry(page);
    });

    test("protected route without a session goes to login, without a loop or notice", async ({ page }) => {
      const api = await prepare(page);
      const visited: string[] = [];
      page.on("framenavigated", (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
      for (const [path, login] of [["/dashboard", "/login"], ["/employee/dashboard", "/employee/login"], ["/platform-admin/dashboard", "/platform-admin/login"]]) {
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`${login}$`));
        await expect(email(page)).toBeVisible();
        await expectNoExpiry(page);
      }
      expect(visited.length, visited.join(" ")).toBeLessThanOrEqual(9);
      expect(refreshes(api)).toBe(0);
    });

    test("backend down: the form is usable for a first-time visitor", async ({ page }) => {
      await prepare(page, { refresh: "down", signin: "down" });
      await page.goto("/login");
      await expect(email(page)).toBeVisible();
      await email(page).fill("a@example.test");
      await expectNoExpiry(page);
      await expect(email(page)).toHaveValue("a@example.test");
    });

    test("backend down with a stored session: the form is offered within seconds, session kept", async ({ page }) => {
      await prepare(page, { refresh: "down" });
      await storedSession(page);
      await page.goto("/login");
      await expect(email(page)).toBeVisible({ timeout: 6000 });
      await expect(page.locator('form button[type="submit"]:visible').first()).toBeEnabled();
      await expectNoExpiry(page);
      expect(await page.evaluate(() => localStorage.getItem("caretip_user"))).not.toBeNull();
    });

    test("signed in, then the refresh session ends: one notice, one refresh, cleaned up", async ({ page }) => {
      const api = await prepare(page, { refresh: "ok" });
      await storedSession(page);
      await page.goto("/verify-email");
      await page.waitForFunction(() => Boolean(localStorage.getItem("caretip_user")));
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard/);
      await page.waitForTimeout(1500);
      api.refresh = "401";
      const before = refreshes(api);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      // Client-side navigation issues several protected reads at once.
      await page.evaluate(() => {
        history.pushState({}, "", "/dashboard/team/employees");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
      await expect(page.getByText(EXPIRED)).toHaveCount(1);
      expect(refreshes(api) - before).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => localStorage.getItem("caretip_user"))).toBeNull();
      await page.reload();
      await expect(email(page)).toBeVisible();
      await expectNoExpiry(page);
    });

    test("a refused refresh in one tab does not sign out a tab whose own refresh works", async ({ page, context }) => {
      const a = await prepare(page, { refresh: "ok" });
      await storedSession(page);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard/);
      await page.waitForTimeout(800);
      const before = refreshes(a);
      const tab = await context.newPage();
      await prepare(tab, { refresh: "401" });
      await tab.goto("/");
      await expect.poll(() => refreshes(a)).toBeGreaterThan(before);
      await page.waitForTimeout(1500);
      await expect(page).toHaveURL(/\/dashboard/);
      expect(await page.evaluate(() => localStorage.getItem("caretip_user"))).not.toBeNull();
    });

    test("exactly one form and one Google setup; the form never disappears while loading", async ({ page }) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __gone: number; __seen: boolean };
        w.__gone = 0;
        const tick = () => {
          const n = [...document.querySelectorAll<HTMLInputElement>('input[type="email"]')].filter((x) => x.offsetParent).length;
          if (n > 0) w.__seen = true;
          else if (w.__seen) w.__gone += 1;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await prepare(page);
      await page.goto("/login");
      await expect(email(page)).toBeVisible();
      await page.waitForTimeout(800);
      await expect(page.locator('input[type="email"]')).toHaveCount(1);
      await expect(page.locator('input[type="password"]')).toHaveCount(1);
      expect(await page.locator('script[src*="accounts.google.com/gsi"]').count()).toBeLessThanOrEqual(1);
      await failLogin(page);
      await expect(email(page)).toHaveValue("nobody@example.test");
      expect(await page.evaluate(() => (window as unknown as { __gone: number }).__gone)).toBe(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test("typed input survives a switch between phone and desktop layout", async ({ page }) => {
      await prepare(page);
      await page.goto("/login");
      await email(page).fill("keep@example.test");
      await page.setViewportSize(mobile ? { width: 1024, height: 768 } : { width: 390, height: 844 });
      await expect(email(page)).toHaveValue("keep@example.test");
      await expect(page.locator('input[type="email"]')).toHaveCount(1);
    });

    for (const outcome of ["401", "ok"] as const) {
      test(`Google sign-in ${outcome === "ok" ? "succeeds" : "is rejected"}: one setup, no expired notice`, async ({ page }) => {
        test.skip(mobile, "phones use Google's redirect mode (google-oauth-mobile.spec.ts)");
        const api = await prepare(page, { oauth: outcome });
        await page.route("https://accounts.google.com/gsi/client**", (r) =>
          r.fulfill({
            contentType: "text/javascript",
            body: `let cb; window.__gsiInits = 0; window.google = { accounts: { id: {
              initialize: (o) => { window.__gsiInits += 1; cb = o.callback; },
              renderButton: (el) => { el.innerHTML = '<button type="button" id="fake-google">Google</button>'; el.firstChild.onclick = () => cb({ credential: "stub-token" }); },
              prompt() {}, cancel() {} } } };`,
          }),
        );
        await page.goto("/login");
        const google = page.locator("#fake-google");
        test.skip(!(await google.waitFor({ timeout: 8000 }).then(() => true, () => false)), "build has no Google client id");
        expect(await page.evaluate(() => (window as unknown as { __gsiInits: number }).__gsiInits)).toBe(1);
        if (outcome === "ok") api.refresh = "ok";
        await google.click();
        if (outcome === "ok") {
          await expect(page).toHaveURL(/dashboard/);
        } else {
          await expect(page.getByText(/couldn.t complete social sign-in/i).locator("visible=true").first()).toBeVisible();
          await expect(email(page)).toBeVisible();
          await page.reload();
          await expect(email(page)).toBeVisible();
        }
        await expectNoExpiry(page);
        expect(api.calls.filter((c) => c === "/api/auth/oauth")).toHaveLength(1);
      });
    }
  });
}
