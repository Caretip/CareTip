import { createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, devices, type Page, type Request, type Route } from "@playwright/test";

/**
 * Google SIGN-UP and merchant legal acceptance, end to end. Same isolated harness as
 * google-oauth-mobile.spec.ts: accounts.google.com is replaced by a GIS stand-in and ID tokens are
 * signed with a test key the disposable backend trusts.
 *
 * Regression: on phones (redirect mode) the freshly mounted, unticked form saved its own state over the
 * user's acceptance before the auth page had read it, so every attempt ended back on the form asking
 * to accept the documents again, and no account was ever created.
 */
const CLIENT_ID = process.env.E2E_GOOGLE_CLIENT_ID ?? "";
const KEY_PATH = process.env.E2E_GOOGLE_TEST_KEY ?? "";
const BROWSER = (process.env.E2E_OAUTH_BROWSER ?? "chromium") as "chromium" | "webkit" | "firefox";

test.skip(!CLIENT_ID || !KEY_PATH, "isolated Google OAuth harness not configured");
// Service workers bypass request interception in WebKit (the GIS stand-in would not load).
test.use({ browserName: BROWSER, serviceWorkers: "block" });

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");
function googleIdToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url(JSON.stringify({ alg: "RS256", kid: "caretip-test", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, iat: now, exp: now + 600, email_verified: true, ...claims }),
  )}`;
  return `${data}.${b64url(createSign("RSA-SHA256").update(data).sign(readFileSync(KEY_PATH, "utf8")))}`;
}

const GSI = `(() => {
  const state = { cfg: null };
  window.google = { accounts: { id: {
    initialize(cfg) { state.cfg = cfg; },
    renderButton(el, opts) {
      const f = document.createElement('iframe'); f.title = 'Sign in with Google'; f.setAttribute('data-testid', 'gsi-button');
      f.style.cssText = 'border:0;height:40px;width:' + ((opts && opts.width) || 240) + 'px';
      f.srcdoc = '<button id="b" style="width:100%;height:38px">Continue with Google</button>';
      f.addEventListener('load', () => { f.contentDocument.getElementById('b').addEventListener('click', () => window.__gsiClick()); });
      el.appendChild(f);
    }, prompt() {}, cancel() {}, disableAutoSelect() {}, storeCredential() {}, revoke() {},
  } } };
  window.__gsiClick = () => {
    const cfg = state.cfg;
    if (cfg.ux_mode === 'redirect') {
      const csrf = 'csrf' + Math.random().toString(36).slice(2);
      document.cookie = 'g_csrf_token=' + csrf + '; path=/';
      const form = document.createElement('form'); form.method = 'POST'; form.action = cfg.login_uri;
      const add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; form.appendChild(i); };
      add('credential', window.__gsiCredential || '');
      add('g_csrf_token', window.__gsiScenario === 'csrf_mismatch' ? 'tampered' : csrf);
      document.body.appendChild(form); form.submit();
      return;
    }
    setTimeout(() => cfg.callback({ credential: window.__gsiCredential, select_by: 'btn' }), 300);
  };
})();`;

async function setup(page: Page, credential: string, scenario = "success") {
  await page.route("https://accounts.google.com/gsi/client**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: GSI }),
  );
  await page.route(/^https:\/\/(?!accounts\.google\.com\/gsi\/client)/, (route) => route.abort());
  await page.addInitScript(
    ([cred, sc]) => {
      Object.assign(window, { __gsiCredential: cred, __gsiScenario: sc });
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
    },
    [credential, scenario],
  );
}

const identity = () => {
  const id = randomUUID();
  return { sub: `g-signup-${id}`, email: `g-signup-${id}@example.test`, name: "New Manager" };
};
const googleButton = (page: Page) => page.frameLocator('iframe[data-testid="gsi-button"]').first().locator("#b");
const legalBox = (page: Page) => page.locator("#merchant-legal-acceptance");
const isExchange = (r: Request) => r.method() === "POST" && new URL(r.url()).pathname === "/api/auth/oauth";
function exchanges(page: Page): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (isExchange(r)) bodies.push(r.postDataJSON() as Record<string, unknown>);
  });
  return bodies;
}
async function openSignup(page: Page, path = "/signup") {
  await page.goto(path);
  await googleButton(page).waitFor({ timeout: 40_000 });
}
/** Programmatic click: the blocked button has pointer-events: none, so a real click cannot reach it. */
async function tryGoogle(page: Page) {
  await googleButton(page).click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}
const DESTINATION = /\/(dashboard|onboarding)/;
const visibleError = (page: Page) => page.locator('[role="alert"]:visible').filter({ hasText: /\S{3,}/ }).first();

const { defaultBrowserType: _ignored, isMobile, ...phone } = devices[BROWSER === "webkit" ? "iPhone 13" : "Pixel 5"];
const layouts = [
  { name: "phone (redirect)", use: BROWSER === "firefox" ? phone : { ...phone, isMobile } },
  { name: "desktop (popup)", use: { viewport: { width: 1366, height: 860 }, hasTouch: false } },
];

for (const layout of layouts) {
  test.describe(`Google sign-up: ${layout.name}`, () => {
    test.use(layout.use);
    test.setTimeout(120_000);

    test("accepting the documents creates the account once and survives an immediate reload", async ({ page }) => {
      const who = identity();
      const sent = exchanges(page);
      await setup(page, googleIdToken(who));
      await openSignup(page);
      await legalBox(page).check();
      let created: { status: number; email?: string } | null = null;
      page.on("response", async (r) => {
        if (!isExchange(r.request())) return;
        const body = (await r.json().catch(() => ({}))) as { user?: { email?: string } };
        created = { status: r.status(), email: body.user?.email };
      });
      await googleButton(page).click();
      await page.waitForURL(DESTINATION, { timeout: 45_000 });
      expect(created).toEqual({ status: 201, email: who.email });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ isLogin: false, intendedRole: "MANAGER", merchantLegalAccepted: true });
      const cookies = await page.context().cookies();
      expect(cookies.find((c) => c.name === "caretip_refresh"), "refresh cookie delivered").toMatchObject({ httpOnly: true });

      await page.reload();
      await page.waitForTimeout(3000);
      await expect(page).toHaveURL(DESTINATION);
      await expect(legalBox(page)).toHaveCount(0);
      expect(sent).toHaveLength(1);
    });

    test("without acceptance Google cannot be started and nothing is sent", async ({ page }) => {
      const sent = exchanges(page);
      await setup(page, googleIdToken(identity()));
      await openSignup(page);
      await expect(legalBox(page)).not.toBeChecked();
      await tryGoogle(page);
      expect(new URL(page.url()).pathname).toBe("/signup");
      await legalBox(page).check();
      await legalBox(page).uncheck();
      await tryGoogle(page);
      expect(new URL(page.url()).pathname).toBe("/signup");
      expect(sent).toHaveLength(0);
    });

    test("reached from the login page by the sign-up link", async ({ page }) => {
      const sent = exchanges(page);
      await setup(page, googleIdToken(identity()));
      await openSignup(page, "/login");
      await page.locator(".mw-auth-footer__action:visible, .caretip-auth-page button:visible, .caretip-auth-page a:visible").filter({ hasText: /sign ?up|create|register/i }).first().click();
      await page.waitForURL(/\/signup/);
      await legalBox(page).check();
      await googleButton(page).click();
      await page.waitForURL(DESTINATION, { timeout: 45_000 });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ isLogin: false, merchantLegalAccepted: true });
    });

    test("a failed exchange shows one error, keeps the choice and lets the user retry", async ({ page }) => {
      const sent = exchanges(page);
      await setup(page, googleIdToken(identity()));
      let failing = true;
      await page.route("**/api/auth/oauth", (route) =>
        failing
          ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Simulated failure" }) })
          : route.fallback(),
      );
      await openSignup(page);
      await legalBox(page).check();
      await googleButton(page).click();
      await expect(visibleError(page)).toBeVisible({ timeout: 30_000 });
      await expect(visibleError(page)).not.toContainText(/Please confirm that you have read/i);
      expect(new URL(page.url()).pathname).toBe("/signup");
      await expect(legalBox(page)).toBeChecked();
      const before = sent.length;
      expect(before).toBeGreaterThan(0);
      await page.waitForTimeout(2500);
      expect(sent.length, "no automatic retry loop").toBe(before);
      failing = false;
      await googleButton(page).click();
      await page.waitForURL(DESTINATION, { timeout: 45_000 });
    });

    test("an already registered Google account: one clear error on sign-up, then sign-in works", async ({ browser }) => {
      const who = identity();
      const run = async () => {
        const context = await browser.newContext({ ...layout.use, serviceWorkers: "block" });
        const page = await context.newPage();
        await setup(page, googleIdToken(who));
        return { context, page, sent: exchanges(page) };
      };
      const a = await run();
      await openSignup(a.page);
      await legalBox(a.page).check();
      await googleButton(a.page).click();
      await a.page.waitForURL(DESTINATION, { timeout: 45_000 });
      await a.context.close();

      const b = await run();
      await openSignup(b.page);
      await legalBox(b.page).check();
      await googleButton(b.page).click();
      await expect(b.page.getByText(/couldn.t complete social sign-in/i).first()).toBeVisible({ timeout: 30_000 });
      expect(b.sent).toHaveLength(1);
      await openSignup(b.page, "/login");
      await googleButton(b.page).click();
      await b.page.waitForURL(DESTINATION, { timeout: 45_000 });
      expect(b.sent[1]).toMatchObject({ isLogin: true });
      await b.context.close();
    });
  });
}

test.describe("Google sign-up: redirect details", () => {
  test.use(layouts[0].use);
  test.setTimeout(120_000);

  test("sign-up page, then Log in, then Google: returns to the login page, no documents asked", async ({ page }) => {
    const who = identity();
    await setup(page, googleIdToken(who));
    const sent = exchanges(page);
    await openSignup(page);
    await page.locator(".mw-auth-footer__action").click();
    await page.waitForURL((u) => u.pathname === "/login");
    await googleButton(page).waitFor();
    await googleButton(page).click();
    // Not registered: the login error, on the login page.
    await expect(page.getByText(/couldn.t complete social sign-in/i).first()).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ isLogin: true });
  });

  test("a rejected state (CSRF) never carries the earlier acceptance over", async ({ page }) => {
    const sent = exchanges(page);
    await setup(page, googleIdToken(identity()), "csrf_mismatch");
    await openSignup(page);
    await legalBox(page).check();
    await googleButton(page).click();
    await page.waitForURL(/\/auth\/google\/complete/);
    await page.getByRole("link", { name: /try again/i }).click();
    await page.waitForURL(/\/signup/);
    await googleButton(page).waitFor();
    await expect(legalBox(page)).not.toBeChecked();
    expect(sent).toHaveLength(0);
  });

  test("a saved acceptance is never applied without a Google return", async ({ page }) => {
    await setup(page, googleIdToken(identity()));
    await openSignup(page);
    await legalBox(page).check();
    await page.reload();
    await googleButton(page).waitFor({ timeout: 40_000 });
    await expect(legalBox(page)).not.toBeChecked();
  });

  test("an expired hand-off asks for Google again instead of looping, acceptance not assumed", async ({ page }) => {
    const sent = exchanges(page);
    await setup(page, googleIdToken(identity()));
    await openSignup(page);
    await legalBox(page).check();
    await page.evaluate(() =>
      sessionStorage.setItem("caretip_google_redirect_handoff", JSON.stringify({ handoff: "gh1.x", at: Date.now() - 600_000 })),
    );
    await page.reload();
    await expect(page.getByText(/Google sign-in expired/i).first()).toBeVisible({ timeout: 30_000 });
    expect(sent).toHaveLength(0);
  });
});
