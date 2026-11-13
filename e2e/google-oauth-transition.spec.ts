import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, devices, type Page, type Route } from "@playwright/test";

/**
 * Google sign-in transition regressions (frame by frame). Same isolated harness as
 * google-oauth-mobile.spec.ts: accounts.google.com is replaced by a GIS stand-in and ID tokens are
 * signed with a test key the disposable backend trusts. This proves CareTip's side of the flow, NOT
 * Google's real pages.
 *
 *  E2E_BASE_URL, E2E_GOOGLE_CLIENT_ID, E2E_GOOGLE_TEST_KEY, E2E_GOOGLE_LINKED_SUB / _EMAIL
 *
 * Root causes covered:
 *  - Returning from Google (redirect mode) painted the login form until the credential exchange
 *    began, then a loader: the form "flashed back". → a "Signing you in with Google" state from the
 *    first paint until the post-sign-in cover takes over; the form never reappears.
 *  - No feedback between tapping Google and leaving the page (redirect mode). → "Opening Google…".
 *  - Popup mode exchanged the credential behind an unchanged form. → same progress state.
 *  - The CareTip loader appeared between those steps (boot screen, sign-in cover). → only the Google
 *    progress state is shown from the return until the destination renders.
 */
const CLIENT_ID = process.env.E2E_GOOGLE_CLIENT_ID ?? "";
const KEY_PATH = process.env.E2E_GOOGLE_TEST_KEY ?? "";
const LINKED_SUB = process.env.E2E_GOOGLE_LINKED_SUB ?? "g-sub-harbor-manager";
const LINKED_EMAIL = process.env.E2E_GOOGLE_LINKED_EMAIL ?? "harbor.demo@caretip.de";
const BROWSER = (process.env.E2E_OAUTH_BROWSER ?? "chromium") as "chromium" | "webkit" | "firefox";

test.skip(!CLIENT_ID || !KEY_PATH, "isolated Google OAuth harness not configured");
test.use({ browserName: BROWSER });

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
      el.appendChild(f); window.__gsiRenders = (window.__gsiRenders || 0) + 1;
    }, prompt() {}, cancel() {}, disableAutoSelect() {}, storeCredential() {}, revoke() {},
  } } };
  window.__gsiClick = () => {
    const cfg = state.cfg;
    if (cfg.ux_mode === 'redirect') {
      setTimeout(() => {
        const csrf = 'csrf' + Math.random().toString(36).slice(2);
        document.cookie = 'g_csrf_token=' + csrf + '; path=/';
        const form = document.createElement('form'); form.method = 'POST'; form.action = cfg.login_uri;
        const add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; form.appendChild(i); };
        add('credential', window.__gsiCredential || ''); add('g_csrf_token', csrf);
        document.body.appendChild(form); form.submit();
      }, Number(window.__gsiLeaveDelay || 400));
      return;
    }
    setTimeout(() => cfg.callback({ credential: window.__gsiCredential, select_by: 'btn' }), 400);
  };
})();`;

/** Records, every frame, which auth state is on screen (top document only). */
const RECORDER = String.raw`(() => {
  if (window.top !== window || window.__gotFrames) return;
  window.__gotFrames = [];
  const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  const tick = () => {
    try {
      const boot = document.getElementById("caretip-html-boot");
      const bootOn = !!boot && document.documentElement.classList.contains("caretip-html-boot-active") && vis(boot);
      const brandLoader = [...document.querySelectorAll(".app-branded-loader")].some(vis);
      const oauth = [...document.querySelectorAll("[data-oauth-progress]")].some(vis);
      const form = [...document.querySelectorAll('input[type="email"], input[type="password"]')].some(vis);
      // The boot screen counts as the CareTip loader only while its CareTip mark is actually visible.
      const bootMark = bootOn && !boot.hasAttribute("data-oauth-progress") && vis(boot.querySelector(".caretip-html-boot__mark"));
      const loader = bootMark || brandLoader;
      window.__gotFrames.push({ t: Date.now(), path: location.pathname, k: loader ? (bootMark ? "loader" : "loader") : oauth ? "oauth" : form ? "form" : "other", src: bootMark ? "boot" : brandLoader ? "react" : "" });
      sessionStorage.setItem("__gotFrames", JSON.stringify(window.__gotFrames.slice(-4000)));
    } catch {}
    requestAnimationFrame(tick);
  };
  try { const prev = JSON.parse(sessionStorage.getItem("__gotFrames") || "[]"); window.__gotFrames.push(...prev); } catch {}
  requestAnimationFrame(tick);
})();`;

type Frame = { t: number; path: string; k: "oauth" | "form" | "loader" | "other" };

async function setup(page: Page, credential: string) {
  await page.route("https://accounts.google.com/gsi/client**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: GSI }),
  );
  await page.route(/^https:\/\/(?!accounts\.google\.com\/gsi\/client)/, (route) => route.abort());
  await page.addInitScript((cred) => {
    (window as unknown as Record<string, unknown>).__gsiCredential = cred;
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
  }, credential);
  await page.addInitScript(RECORDER);
}

const gsiButton = (page: Page) => page.frameLocator('iframe[data-testid="gsi-button"]').first().locator("#b");
const frames = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("__gotFrames") || "[]") as Frame[]);

async function openLogin(page: Page) {
  await page.goto("/login");
  await gsiButton(page).waitFor({ timeout: 40_000 });
  await page.waitForTimeout(500);
}

test.describe("Google sign-in transition — mobile redirect", () => {
  const { defaultBrowserType: _ignored, isMobile, ...phone } = devices[BROWSER === "webkit" ? "iPhone 13" : "Pixel 5"];
  test.use(BROWSER === "firefox" ? phone : { ...phone, isMobile });

  test("tap shows Opening Google, return shows the Google progress state, the login form never flashes back", async ({ page }) => {
    test.setTimeout(90_000);
    await setup(page, googleIdToken({ sub: LINKED_SUB, email: LINKED_EMAIL, name: "Harbor Demo" }));
    let exchanges = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/auth/oauth") exchanges += 1;
    });
    await openLogin(page);
    // Phones mount both auth shells (one hidden by CSS): one render per button host, no redraw after.
    const hosts = await page.locator(".caretip-oauth-gsi-host").count();
    const rendersAtLoad = await page.evaluate(() => (window as unknown as { __gsiRenders?: number }).__gsiRenders ?? 0);
    expect(rendersAtLoad, "Google button rendered once per host").toBe(hosts);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as unknown as { __gsiRenders?: number }).__gsiRenders ?? 0), "no redraw after mount").toBe(rendersAtLoad);
    const clickAt = Date.now();
    await gsiButton(page).click();
    // The tap is detected through focus moving into Google's iframe; Firefox's mobile emulation does
    // not produce that signal with the same-origin stand-in, so this feedback is asserted elsewhere.
    if (BROWSER !== "firefox") {
      await expect(page.locator("[data-google-leaving]")).toBeVisible({ timeout: 2000 });
    }
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 45_000 });
    await page.waitForTimeout(800);
    // Frames from the return onwards: the first frame on the completion page marks coming back.
    const all = (await frames(page)).filter((f) => f.t > clickAt);
    const backAt = all.findIndex((f) => f.path === "/auth/google/complete");
    expect(backAt, "returned through /auth/google/complete").toBeGreaterThanOrEqual(0);
    const returned = all.slice(backAt).filter((f) => f.path === "/login");
    expect(returned.length, "frames recorded on /login after returning").toBeGreaterThan(0);
    expect(returned.filter((f) => f.k === "form").map((f) => f.t), "login form shown after returning from Google").toEqual([]);
    expect(returned.some((f) => f.k === "oauth"), "Google progress state shown").toBe(true);
    // Only the Google progress state from the return until the destination: no CareTip loader.
    const loaderFrames = all.slice(backAt).filter((f) => f.k === "loader" && !/\/(dashboard|onboarding)/.test(f.path));
    expect(loaderFrames.map((f) => `${f.path} ${f.t} ${(f as Frame & { src?: string }).src ?? ""}`), "CareTip loader shown during Google sign-in").toEqual([]);
    expect(exchanges, "one credential exchange").toBe(1);
  });

  test("unlinked Google account: progress clears, the form returns with an error, nothing stuck", async ({ page }) => {
    test.setTimeout(90_000);
    await setup(page, googleIdToken({ sub: `g-sub-unlinked-${Date.now()}`, email: "unlinked.person@example.test", name: "Unlinked" }));
    await openLogin(page);
    await gsiButton(page).click();
    await page.waitForURL(/\/login/, { timeout: 45_000 });
    await expect(page.locator("[data-oauth-progress]")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('input[type="email"]:visible').first()).toBeVisible();
    await expect(page.locator('[role="alert"]:visible, p:visible').filter({ hasText: /google|couldn|incorrect|not|sign/i }).first()).toBeVisible();
  });
});

test.describe("Google sign-in transition — desktop popup", () => {
  test.use({ viewport: { width: 1366, height: 860 } });

  test("credential exchange shows the Google progress state, one request even on a double click", async ({ page }) => {
    test.setTimeout(90_000);
    await setup(page, googleIdToken({ sub: LINKED_SUB, email: LINKED_EMAIL, name: "Harbor Demo" }));
    let exchanges = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/auth/oauth") exchanges += 1;
    });
    await openLogin(page);
    const clickAt = Date.now();
    await Promise.all([gsiButton(page).click(), gsiButton(page).click().catch(() => undefined)]);
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 45_000 });
    await page.waitForTimeout(500);
    const onLogin = (await frames(page)).filter((f) => f.path === "/login");
    expect(onLogin.some((f) => f.k === "oauth"), "Google progress state shown during the exchange").toBe(true);
    const loaderFrames = (await frames(page)).filter((f) => f.t > clickAt && f.k === "loader" && f.path === "/login");
    expect(loaderFrames.length, "no CareTip loader between the Google progress state and the destination").toBe(0);
    expect(exchanges, "one credential exchange").toBe(1);
  });
});
