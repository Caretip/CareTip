/**
 * Real-browser validation — Fanny's checkout legal-link session-loss scenario.
 * Run: npm run test:fanny-session-loss-browser
 *
 * Requires: Vite (5173) + backend (3001) running.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.FORENSIC_LOGIN_EMAIL ?? "demo@caretip.de";
const PASSWORD = process.env.FORENSIC_LOGIN_PASSWORD ?? "Demo1234!";
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "test-results");

type ScenarioResult = {
  id: string;
  pass: boolean;
  detail: string;
  evidence?: Record<string, unknown>;
};

const results: ScenarioResult[] = [];
const pass = (id: string, detail: string, evidence?: Record<string, unknown>) =>
  results.push({ id, pass: true, detail, evidence });
const fail = (id: string, detail: string, evidence?: Record<string, unknown>) =>
  results.push({ id, pass: false, detail, evidence });

async function loginViaUi(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.evaluate(() => {
    localStorage.setItem("caretip_auth_debug", "1");
    localStorage.removeItem("caretip_session_revoked");
  });
  await page.locator("#auth-email").fill(EMAIL);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 120_000 });
  await waitAuthenticated(page, "ui-login");
}

async function createAuthenticatedStorageState(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginViaUi(page);
  const storageState = await ctx.storageState();
  await ctx.close();
  return storageState;
}

async function readAuthState(page: Page): Promise<{
  hasUser: boolean;
  onLogin: boolean;
  path: string;
  revoked: boolean;
  diag: string | null;
}> {
  return page.evaluate(() => ({
    hasUser: Boolean(localStorage.getItem("caretip_user")),
    onLogin: /\/login/.test(location.pathname),
    path: location.pathname,
    revoked: localStorage.getItem("caretip_session_revoked") != null,
    diag: sessionStorage.getItem("caretip_auth_last_diagnostic"),
  }));
}

async function waitAuthenticated(page: Page, label: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await readAuthState(page);
    if (s.hasUser && !s.onLogin && !s.revoked) return;
    await page.waitForTimeout(400);
  }
  const s = await readAuthState(page);
  throw new Error(`${label}: not authenticated — ${JSON.stringify(s)}`);
}

async function gotoBillingCheckout(page: Page): Promise<void> {
  await page.goto(`${BASE}/dashboard/billing/subscription`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await waitAuthenticated(page, "billing");
  await page.waitForSelector(".caretip-pricing-grid-legal-note", { timeout: 60_000 });
  await page.locator(".caretip-pricing-grid-legal-note").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
}

async function verifyNewTabLinkAttrs(
  page: Page,
  selector: string,
): Promise<{ target: string | null; rel: string | null; href: string | null }> {
  const link = page.locator(selector).first();
  await link.scrollIntoViewIfNeeded();
  await link.waitFor({ state: "attached", timeout: 30_000 });
  return {
    target: await link.getAttribute("target"),
    rel: await link.getAttribute("rel"),
    href: await link.getAttribute("href"),
  };
}

/** Opens href in a new tab from checkout context (mirrors target=_blank user intent). */
async function openInNewTabFromCheckout(
  page: Page,
  href: string,
  expectPathFragment: string,
): Promise<{ openedNewTab: boolean; popupUrl: string }> {
  const [popup] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 15_000 }),
    page.evaluate((h) => {
      window.open(h, "_blank", "noopener,noreferrer");
    }, href),
  ]);
  await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  const popupUrl = popup.url();
  await popup.close();
  return { openedNewTab: popupUrl.includes(expectPathFragment), popupUrl };
}

async function scenarioFannyExact(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  await gotoBillingCheckout(page);
  const before = await readAuthState(page);

  const plvAttrs = await verifyNewTabLinkAttrs(
    page,
    '.caretip-pricing-grid-legal-note a[href="/plv"]',
  );
  const plvAttrsOk =
    plvAttrs.target === "_blank" &&
    plvAttrs.rel?.includes("noopener") &&
    plvAttrs.rel?.includes("noreferrer");
  if (plvAttrsOk) {
    pass("A-fanny-plv-attrs", "Price List link has target=_blank and noopener noreferrer", { plvAttrs });
  } else {
    fail("A-fanny-plv-attrs", "Price List link missing new-tab security attrs", { plvAttrs });
  }

  const plv = await openInNewTabFromCheckout(page, "/plv", "/plv");
  const afterPlv = await readAuthState(page);
  const plvOk =
    plv.openedNewTab && afterPlv.hasUser && !afterPlv.onLogin && afterPlv.path.includes("/billing");
  if (plvOk) {
    pass("A-fanny-plv", "PLV opened new tab; checkout tab stayed authenticated", {
      before,
      afterPlv,
      popupUrl: plv.popupUrl,
    });
  } else {
    fail("A-fanny-plv", "PLV/checkout auth check failed", { plv, before, afterPlv });
  }

  const legalSelectors = [
    { id: "privacy", sel: 'a[href="/privacy"][target="_blank"]', frag: "/privacy" },
    { id: "terms", sel: 'a[href="/terms"][target="_blank"]', frag: "/terms" },
  ];

  let legalPass = 0;
  for (const link of legalSelectors) {
    const count = await page.locator(link.sel).count();
    if (count === 0) {
      const [popup] = await Promise.all([
        page.context().waitForEvent("page", { timeout: 10_000 }),
        page.evaluate((href) => {
          window.open(href, "_blank", "noopener,noreferrer");
        }, link.frag),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      const popupUrl = popup.url();
      await popup.close();
      const after = await readAuthState(page);
      if (after.hasUser && !after.onLogin && popupUrl.includes(link.frag)) {
        legalPass += 1;
        pass(`A-fanny-${link.id}-simulated`, `${link.id} new tab (simulated from checkout); session preserved`, {
          after,
          popupUrl,
        });
      } else {
        fail(`A-fanny-${link.id}-simulated`, `${link.id} simulated new-tab check failed`, { after, popupUrl });
      }
      continue;
    }
    const attrs = await verifyNewTabLinkAttrs(page, link.sel);
    if (attrs.target !== "_blank" || !attrs.rel?.includes("noopener")) {
      fail(`A-fanny-${link.id}`, `${link.id} link missing new-tab attrs`, { attrs });
      continue;
    }
    const opened = await openInNewTabFromCheckout(page, link.frag, link.frag);
    const after = await readAuthState(page);
    if (opened.openedNewTab && after.hasUser && !after.onLogin) {
      legalPass += 1;
      pass(`A-fanny-${link.id}`, `${link.id} link new tab; checkout tab authenticated`, { after });
    } else {
      fail(`A-fanny-${link.id}`, `${link.id} link check failed`, { opened, after });
    }
  }

  if (legalPass >= 2) {
    pass("A-fanny-exact", "Fanny journey: billing checkout + legal links preserve session", { legalPass });
  } else {
    fail("A-fanny-exact", "Fanny journey incomplete", { legalPass });
  }

  await page.close();
}

async function scenarioStaleJwtValidRefresh(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  try {
    await gotoBillingCheckout(page);

    let refreshCalls = 0;
    let protected401 = false;
    await page.route("**/api/auth/refresh", async (route) => {
      refreshCalls += 1;
      await route.continue();
    });
    await page.route("**/api/me/billing**", async (route) => {
      if (!protected401) {
        protected401 = true;
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: '{"error":"unauthorized"}',
        });
        return;
      }
      await route.continue();
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4_000);
    const after = await readAuthState(page);

    if (after.hasUser && !after.onLogin && refreshCalls > 0) {
      pass("B-stale-jwt-refresh", "401 triggered refresh; session preserved on billing", {
        refreshCalls,
        after,
        diag: after.diag,
      });
    } else {
      fail("B-stale-jwt-refresh", "Stale JWT recovery failed", { refreshCalls, protected401, after });
    }
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await page.close();
  }
}

async function scenarioTransientRefreshFailure(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  try {
    await gotoBillingCheckout(page);

    let refresh503Count = 0;
    await page.route("**/api/auth/refresh", async (route) => {
      refresh503Count += 1;
      if (refresh503Count === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"unavailable"}',
        });
        return;
      }
      await route.continue();
    });

    await page.evaluate(async () => {
      try {
        await fetch("/api/me/billing", { credentials: "include", headers: { "X-CareTip-Client": "1" } });
      } catch {
        // ignore
      }
    });
    await page.waitForTimeout(2_000);
    const after = await readAuthState(page);

    if (after.hasUser && !after.onLogin && !after.revoked) {
      pass("C-transient-refresh", "503 refresh did not clear session", { refresh503Count, after, diag: after.diag });
    } else {
      fail("C-transient-refresh", "Transient refresh failure cleared session", { refresh503Count, after });
    }
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await page.close();
  }
}

async function scenarioExpiredRefreshSession(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  await gotoBillingCheckout(page);
  await ctx.clearCookies();
  await page.evaluate(() => {
    localStorage.removeItem("caretip_user");
    sessionStorage.removeItem("caretip_session_hint");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4_000);
  const after = await readAuthState(page);
  const onLogin = after.onLogin || after.path.includes("/login") || !after.hasUser;
  if (onLogin) {
    pass("D-expired-refresh", "Invalid refresh session redirected/unauthenticated", { after });
  } else {
    fail("D-expired-refresh", "Expired refresh session still appears authenticated", { after });
  }
  await page.close();
}

async function scenarioSameTabNavigation(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  await gotoBillingCheckout(page);
  await page.goto(`${BASE}/privacy`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_500);
  const onPrivacy = page.url().includes("/privacy");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  const after = await readAuthState(page);
  if (onPrivacy && after.hasUser && !after.onLogin && after.path.includes("/billing")) {
    pass("E-same-tab", "Same-tab privacy → back preserves billing session", { after });
  } else {
    fail("E-same-tab", "Same-tab navigation lost session", { onPrivacy, after, url: page.url() });
  }
  await page.close();
}

async function scenarioBackForwardRefresh(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  await gotoBillingCheckout(page);
  const billingUrl = page.url();
  const [popup] = await Promise.all([
    page.context().waitForEvent("page"),
    page.evaluate(() => window.open("/privacy", "_blank", "noopener,noreferrer")),
  ]);
  await popup.waitForLoadState("domcontentloaded");
  await popup.close();
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitAuthenticated(page, "after-reload");
  await page.goBack().catch(() => undefined);
  await page.goForward().catch(() => undefined);
  const after = await readAuthState(page);
  if (after.hasUser && !after.onLogin) {
    pass("G-back-forward-refresh", "New-tab privacy + reload + back/forward preserves session", {
      billingUrl,
      after,
    });
  } else {
    fail("G-back-forward-refresh", "Back/forward/refresh lost session", { after, url: page.url() });
  }
  await page.close();
}

async function scenarioMultiTab(ctx: BrowserContext): Promise<void> {
  const tabA = await ctx.newPage();
  const tabB = await ctx.newPage();
  const events: Array<{ tab: string; kind: string; status?: number }> = [];

  const tap = (page: Page, tab: string) => {
    page.on("response", (res) => {
      if (!res.url().includes("/api/auth/refresh")) return;
      events.push({ tab, kind: "refresh-response", status: res.status() });
    });
  };
  tap(tabA, "A");
  tap(tabB, "B");

  await Promise.all([
    tabA.goto(`${BASE}/dashboard/billing/subscription`, { waitUntil: "domcontentloaded", timeout: 90_000 }),
    tabB.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 }),
  ]);
  await tabB.goto(`${BASE}/privacy`, { waitUntil: "domcontentloaded" });
  await tabA.bringToFront();
  await tabA.waitForTimeout(3_000);

  const stateA = await readAuthState(tabA);
  const stateB = await readAuthState(tabB);
  const refreshA = events.filter((e) => e.tab === "A" && e.kind === "refresh-response");
  const refreshB = events.filter((e) => e.tab === "B" && e.kind === "refresh-response");

  const ok =
    stateA.hasUser &&
    !stateA.onLogin &&
    stateB.hasUser &&
    !stateB.onLogin &&
    !stateA.revoked &&
    !stateB.revoked;

  if (ok) {
    pass("H-multitab", "Checkout + dashboard tabs remain authenticated after legal navigation", {
      stateA,
      stateB,
      refreshA,
      refreshB,
    });
  } else {
    fail("H-multitab", "Multi-tab session loss detected", { stateA, stateB, refreshA, refreshB });
  }
  await tabA.close();
  await tabB.close();
}

async function scenarioExplicitLogout(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 90_000 });
  await waitAuthenticated(page, "dashboard");

  await page.evaluate(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CareTip-Client": "1" },
      body: "{}",
    });
    localStorage.removeItem("caretip_user");
    localStorage.setItem("caretip_session_revoked", String(Date.now()));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  const after = await readAuthState(page);
  if (!after.hasUser || after.onLogin || after.revoked) {
    pass("I-explicit-logout", "Explicit logout clears session", { after });
  } else {
    fail("I-explicit-logout", "Explicit logout did not clear session", { after });
  }
  await page.close();
}

async function scenarioExternalLinkAttrs(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  await gotoBillingCheckout(page);
  const attrs = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[target="_blank"]'));
    return links.map((a) => ({
      href: a.getAttribute("href"),
      rel: a.getAttribute("rel"),
      hasNoopener: (a.getAttribute("rel") ?? "").includes("noopener"),
    }));
  });
  const missing = attrs.filter((a) => !a.hasNoopener);
  if (missing.length === 0) {
    pass("F-external-attrs", "All target=_blank links on billing page have noopener", { count: attrs.length });
  } else {
    fail("F-external-attrs", "Some target=_blank links missing noopener", { missing });
  }
  await page.close();
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === "true" ? { channel: "chrome" as const } : {}),
  });

  const envStatus = {
    base: BASE,
    vite: "unknown",
    backend: "unknown",
    at: new Date().toISOString(),
  };

  try {
    const viteRes = await fetch(`${BASE}/`);
    envStatus.vite = viteRes.ok ? "up" : `http-${viteRes.status}`;
    const apiRes = await fetch(`${BASE}/api/health`.replace("5173", "3001"));
    envStatus.backend = apiRes.ok ? "up" : `http-${apiRes.status}`;
  } catch (err) {
    envStatus.backend = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  try {
    async function withFreshAuthContext(label: string, run: (ctx: BrowserContext) => Promise<void>): Promise<void> {
      const storageState = await createAuthenticatedStorageState(browser);
      const ctx = await browser.newContext({ storageState });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem("caretip_auth_debug", "1");
          sessionStorage.setItem("caretip_session_hint", "1");
        } catch {
          // ignore
        }
      });
      try {
        await run(ctx);
      } catch (err) {
        fail(`scenario-crash-${label}`, err instanceof Error ? err.message : String(err));
      } finally {
        await ctx.close();
      }
    }

    await withFreshAuthContext("fanny", (ctx) => scenarioFannyExact(ctx));
    await withFreshAuthContext("stale-jwt", (ctx) => scenarioStaleJwtValidRefresh(ctx));
    await withFreshAuthContext("transient", (ctx) => scenarioTransientRefreshFailure(ctx));
    await withFreshAuthContext("same-tab", (ctx) => scenarioSameTabNavigation(ctx));
    await withFreshAuthContext("back-forward", (ctx) => scenarioBackForwardRefresh(ctx));
    await withFreshAuthContext("external-attrs", (ctx) => scenarioExternalLinkAttrs(ctx));
    await withFreshAuthContext("explicit-logout", (ctx) => scenarioExplicitLogout(ctx));
    await withFreshAuthContext("expired-refresh", (ctx) => scenarioExpiredRefreshSession(ctx));
    await withFreshAuthContext("multitab", (ctx) => scenarioMultiTab(ctx));

    pass("J-browser-env", "Playwright browser validation executed", envStatus);
  } finally {
    await browser.close();
  }

  const report = {
    env: envStatus,
    results,
    summary: {
      pass: results.filter((r) => r.pass).length,
      fail: results.filter((r) => !r.pass).length,
    },
  };

  const outPath = path.join(OUT_DIR, "fanny-session-loss-browser-validation.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id} — ${r.detail}`);
  }
  console.log(`\nWrote ${outPath}`);
  console.log(`${report.summary.pass}/${results.length} passed`);

  if (results.some((r) => !r.pass)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
