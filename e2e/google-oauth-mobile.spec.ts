import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, devices, type Page, type Route } from "@playwright/test";

/**
 * Google sign-in journeys (mobile white-screen regression + failure cases).
 *
 * Runs against an ISOLATED stack only:
 *  - E2E_BASE_URL            SPA (Vite) whose /api proxies to a disposable backend
 *  - E2E_GOOGLE_CLIENT_ID    the test client id configured on both sides
 *  - E2E_GOOGLE_TEST_KEY     PEM private key whose public half the backend trusts (test-only preload)
 *  - E2E_GOOGLE_LINKED_SUB / E2E_GOOGLE_LINKED_EMAIL  a Google subject linked to a seeded manager
 *
 * accounts.google.com is never contacted: the GIS client script is replaced by a controlled stand-in
 * that behaves like GIS (popup → callback; redirect → form POST to login_uri with g_csrf_token).
 * This proves CareTip's side of the flow; it does NOT prove the real Google pages.
 */

const CLIENT_ID = process.env.E2E_GOOGLE_CLIENT_ID ?? "";
const KEY_PATH = process.env.E2E_GOOGLE_TEST_KEY ?? "";
const LINKED_SUB = process.env.E2E_GOOGLE_LINKED_SUB ?? "g-sub-harbor-manager";
const LINKED_EMAIL = process.env.E2E_GOOGLE_LINKED_EMAIL ?? "harbor.demo@caretip.de";
const BROWSER = (process.env.E2E_OAUTH_BROWSER ?? "chromium") as "chromium" | "webkit" | "firefox";

test.skip(!CLIENT_ID || !KEY_PATH, "isolated Google OAuth harness not configured");
test.use({ browserName: BROWSER });

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function googleIdToken(claims: Record<string, unknown>, keyPem = readFileSync(KEY_PATH, "utf8")): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: "caretip-test", typ: "JWT" };
  const payload = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    iat: now,
    exp: now + 600,
    email_verified: true,
    ...claims,
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign("RSA-SHA256").update(data).sign(keyPem);
  return `${data}.${b64url(sig)}`;
}

/** GIS stand-in. `scenario`: success | stall | csrf_mismatch | no_credential */
function fakeGsiScript(): string {
  return `
(() => {
  const state = { cfg: null };
  window.google = { accounts: { id: {
    initialize(cfg) { state.cfg = cfg; },
    renderButton(el, opts) {
      const f = document.createElement('iframe');
      f.title = 'Sign in with Google';
      f.setAttribute('data-testid', 'gsi-button');
      f.style.cssText = 'border:0;height:40px;width:' + ((opts && opts.width) || 240) + 'px';
      f.srcdoc = '<button id="b" style="width:100%;height:38px">Continue with Google</button>';
      f.addEventListener('load', () => {
        f.contentDocument.getElementById('b').addEventListener('click', () => window.__gsiClick());
      });
      el.appendChild(f);
    },
    prompt() {}, cancel() {}, disableAutoSelect() {}, storeCredential() {}, revoke() {},
  } } };
  window.__gsiClick = () => {
    const cfg = state.cfg; const scenario = window.__gsiScenario || 'success';
    window.__gsiClicks = (window.__gsiClicks || 0) + 1;
    if (cfg.ux_mode === 'redirect') {
      const csrf = 'csrf' + Math.random().toString(36).slice(2);
      document.cookie = 'g_csrf_token=' + csrf + '; path=/';
      const form = document.createElement('form');
      form.method = 'POST'; form.action = cfg.login_uri;
      const add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; form.appendChild(i); };
      if (scenario !== 'no_credential') add('credential', window.__gsiCredential || '');
      add('g_csrf_token', scenario === 'csrf_mismatch' ? 'tampered' : csrf);
      document.body.appendChild(form); form.submit();
      return;
    }
    if (scenario === 'success') setTimeout(() => cfg.callback({ credential: window.__gsiCredential, select_by: 'btn' }), 300);
    // 'stall': like a blank/closed Google popup — nothing ever comes back.
  };
})();`;
}

async function installGis(page: Page, opts: { credential: string; scenario?: string }) {
  await page.route("https://accounts.google.com/gsi/client**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: fakeGsiScript() }),
  );
  await page.route(/^https:\/\/(?!accounts\.google\.com\/gsi\/client)/, (route) => route.abort());
  await page.addInitScript(
    ([credential, scenario]) => {
      (window as unknown as Record<string, unknown>).__gsiCredential = credential;
      (window as unknown as Record<string, unknown>).__gsiScenario = scenario;
      try {
        localStorage.setItem("caretip_i18n_language", "en");
        localStorage.setItem(
          "caretip_cookie_consent",
          JSON.stringify({ essential: true, analytics: false, functional: false, marketing: false, consentDate: new Date().toISOString(), consentVersion: 1 }),
        );
      } catch {
        /* ignore */
      }
    },
    [opts.credential, opts.scenario ?? "success"],
  );
}

async function clickGoogle(page: Page) {
  const frame = page.frameLocator('iframe[data-testid="gsi-button"]').first();
  await frame.locator("#b").click();
}

/** Fails if the page is blank (no visible text) — the core regression this spec guards. */
async function expectNotBlank(page: Page) {
  await expect
    .poll(async () => (await page.evaluate(() => document.body?.innerText?.trim().length ?? 0)), { timeout: 15_000 })
    .toBeGreaterThan(20);
}

test.describe("Google sign-in — mobile (redirect mode, no popup tab)", () => {
  // Device metrics only (browser is chosen at file level via E2E_OAUTH_BROWSER).
  const { defaultBrowserType: _ignored, isMobile, ...phone } = devices[BROWSER === "webkit" ? "iPhone 13" : "Pixel 5"];
  // Firefox has no isMobile emulation: phone viewport + touch + mobile UA only.
  test.use(BROWSER === "firefox" ? phone : { ...phone, isMobile });

  test("linked Google account signs in and lands on the dashboard", async ({ page }) => {
    const oauthCalls: number[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/auth/oauth") && r.method() === "POST") oauthCalls.push(Date.now());
    });
    await installGis(page, { credential: googleIdToken({ sub: LINKED_SUB, email: LINKED_EMAIL }) });
    await page.goto("/login");
    await clickGoogle(page);
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
    await expectNotBlank(page);
    expect(page.url()).not.toContain("handoff=");
    expect(oauthCalls.length).toBe(1);
    // Back must not replay the hand-off or strand the user on a blank page.
    await page.goBack();
    await expectNotBlank(page);
  });

  test("CSRF mismatch shows a recoverable error, never a blank page", async ({ page }) => {
    await installGis(page, { credential: googleIdToken({ sub: LINKED_SUB, email: LINKED_EMAIL }), scenario: "csrf_mismatch" });
    await page.goto("/login");
    await clickGoogle(page);
    await page.waitForURL(/\/auth\/google\/complete/);
    await expect(page.getByRole("alert")).toContainText(/couldn.t be confirmed/i);
    await expect(page.getByRole("link", { name: /try again/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in with email/i })).toBeVisible();
    await page.getByRole("link", { name: /sign in with email/i }).click();
    await page.waitForURL(/\/login/);
    await expectNotBlank(page);
  });

  test("token signed by the wrong key is rejected with a clear error", async ({ page }) => {
    const { generateKeyPairSync } = await import("node:crypto");
    const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await installGis(page, { credential: googleIdToken({ sub: LINKED_SUB, email: LINKED_EMAIL }, wrongKey) });
    await page.goto("/login");
    await clickGoogle(page);
    await page.waitForURL(/\/auth\/google\/complete/);
    await expect(page.getByRole("alert")).toContainText(/could not confirm/i);
  });

  test("missing credential shows an error with retry", async ({ page }) => {
    await installGis(page, { credential: "", scenario: "no_credential" });
    await page.goto("/login");
    await clickGoogle(page);
    await page.waitForURL(/\/auth\/google\/complete/);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("link", { name: /try again/i }).click();
    await page.waitForURL(/\/login/);
    await expectNotBlank(page);
  });

  test("unlinked Google account gets the uniform sign-in error on the login page", async ({ page }) => {
    await installGis(page, { credential: googleIdToken({ sub: "g-sub-unlinked-" + Date.now(), email: "nobody.unlinked@example.test" }) });
    await page.goto("/login");
    await clickGoogle(page);
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    await expect(page.locator("text=/couldn.t complete social sign-in/i").first()).toBeVisible({ timeout: 20_000 });
    await expectNotBlank(page);
  });

  for (const status of [401, 429, 500, 503]) {
    test(`API ${status} on /api/auth/oauth shows an error on the login page`, async ({ page }) => {
      await installGis(page, { credential: googleIdToken({ sub: LINKED_SUB, email: LINKED_EMAIL }) });
      await page.route("**/api/auth/oauth", (route) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ message: "Simulated failure" }) }),
      );
      await page.goto("/login");
      const oauthCall = page.waitForResponse((r) => r.url().includes("/api/auth/oauth"), { timeout: 30_000 });
      await clickGoogle(page);
      // The hand-off must actually reach the API (not just bounce back to /login).
      expect((await oauthCall).status()).toBe(status);
      await page.waitForURL(/\/login/, { timeout: 30_000 });
      await expectNotBlank(page);
      // Sign-in form stays usable for retry / email login.
      await expect(page.getByRole("button", { name: /sign in|log in|anmelden/i }).first()).toBeVisible();
      expect(page.url()).not.toMatch(/\/(dashboard|onboarding)/);
    });
  }

  test("refreshing the completion page does not replay the credential", async ({ page }) => {
    await installGis(page, { credential: googleIdToken({ sub: LINKED_SUB, email: LINKED_EMAIL }) });
    await page.route("**/api/auth/oauth", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.goto("/login");
    const oauthCall = page.waitForResponse((r) => r.url().includes("/api/auth/oauth"), { timeout: 30_000 });
    await clickGoogle(page);
    await oauthCall;
    await page.goto("/auth/google/complete");
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("caretip_google_redirect_handoff"))).toBeNull();
  });
});

test.describe("Google sign-in — desktop (popup mode)", () => {
  test.use({ viewport: { width: 1366, height: 860 }, hasTouch: false });

  test("popup credential signs in once even on repeated taps", async ({ page }) => {
    const oauthCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/auth/oauth") && r.method() === "POST") oauthCalls.push(r.url());
    });
    await installGis(page, { credential: googleIdToken({ sub: LINKED_SUB, email: LINKED_EMAIL }) });
    await page.goto("/login");
    await clickGoogle(page);
    await clickGoogle(page).catch(() => undefined);
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
    await expectNotBlank(page);
    expect(oauthCalls.length).toBe(1);
  });

  test("closed / blank popup offers recovery instead of silence", async ({ page }) => {
    await installGis(page, { credential: "", scenario: "stall" });
    await page.goto("/login");
    await clickGoogle(page);
    // User returns to the CareTip tab without a credential.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByRole("status").filter({ hasText: /didn.t finish/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
  });
});
