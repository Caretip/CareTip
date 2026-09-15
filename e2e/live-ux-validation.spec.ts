import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Live Chromium validation (no API mocks). Completes Stripe TEST checkout only on localhost.
 * Production: observe landing / login / public tip — never pay with a real card.
 *
 * Run with Vite + API already up:
 *   SKIP_PLAYWRIGHT_INSTALL=true npx playwright test e2e/live-ux-validation.spec.ts --project=chromium
 */

const REPORT = path.join(process.cwd(), "test-results", "live-ux-validation.json");
const LOCAL = (process.env.E2E_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const PRODUCTION = "https://caretip.de";
const DEMO_STAFF = "/brasserie-lindenstrasse/wd-brasserie-employee-demo";
const DEMO_STAFF_ALT = "/staff/wd-brasserie-employee-demo";
const DEMO_EMAIL = "demo@caretip.de";
const DEMO_PASSWORD = "Demo1234!";

type Snapshot = {
  t: number;
  url: string;
  boot: boolean;
  reactOverlay: boolean;
  dualLoader: boolean;
  emptyRoot: boolean;
};

function isLocalOrigin(url: string): boolean {
  return /localhost|127\.0\.0\.1/.test(url);
}

async function dismissCookie(page: Page) {
  const btn = page.getByRole("button", { name: /reject non-essential|nicht notwendige ablehnen/i });
  try {
    await btn.click({ timeout: 2500 });
  } catch {
    /* already consented */
  }
}

async function installObserver(page: Page) {
  await page.addInitScript(`(() => {
    window.__ctUx = { snapshots: [], dualLoaderHits: 0, emptyHits: 0 };
    const tick = () => {
      const bootEl = document.getElementById("caretip-html-boot");
      const bootStyle = bootEl ? getComputedStyle(bootEl) : null;
      const bootCovers = Boolean(bootEl) && bootStyle && bootStyle.display !== "none" && bootStyle.visibility !== "hidden" && bootStyle.opacity !== "0";
      const boot = bootCovers || (Boolean(bootEl) && document.documentElement.classList.contains("caretip-html-boot-active"));
      const reactOverlay = Boolean(document.querySelector(".app-branded-loader.fixed"));
      const landing = document.querySelector(".caretip-landing, [data-caretip-route-ready]");
      const emptyRoot = !bootCovers && !reactOverlay && !landing
        && ((document.getElementById("root") && document.getElementById("root").childElementCount) || 0) === 0;
      const dualLoader = boot && reactOverlay;
      window.__ctUx.snapshots.push({ t: performance.now(), url: location.pathname, boot, reactOverlay, dualLoader, emptyRoot });
      if (window.__ctUx.snapshots.length > 400) window.__ctUx.snapshots.shift();
      if (dualLoader) window.__ctUx.dualLoaderHits += 1;
      if (emptyRoot) window.__ctUx.emptyHits += 1;
    };
    setInterval(tick, 50);
    new MutationObserver(tick).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  })()`);
}

async function uxProbe(page: Page) {
  return page.evaluate("window.__ctUx || { snapshots: [], dualLoaderHits: 0, emptyHits: 0 }");
}

async function firstWorkingPath(page: Page, candidates: string[]): Promise<string | null> {
  for (const p of candidates) {
    const res = await page.goto(p, { waitUntil: "domcontentloaded" });
    if (!res || res.status() >= 400) continue;
    await page.waitForTimeout(800);
    const ready = await page.locator("[data-caretip-route-ready]").count();
    const fail = await page.getByText(/not found|nicht gefunden|couldn't find|konnte nicht/i).count();
    if (ready > 0 && fail === 0) return p;
    const leave = await page.getByRole("button", { name: /leave a tip|trinkgeld|leave tip/i }).count();
    if (leave > 0) return p;
  }
  return null;
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("Live UX — local", () => {
  test.skip(!isLocalOrigin(LOCAL), "local suite only against localhost Vite");

  test("landing, tip journey, Stripe TEST, review, login, QR studio, mobile", async ({ page, context }, testInfo) => {
    const checkoutPosts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /create-tip-session|physical-qr\/orders|payments\/create/i.test(req.url())) {
        checkoutPosts.push(req.url());
      }
    });

    await installObserver(page);
    const t0 = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 25_000 });
    const landingMs = Date.now() - t0;
    await dismissCookie(page);
    const landingUx = await uxProbe(page);

    const staffPath = "/staff/wd-brasserie-employee-demo";
    testInfo.attach("staff-path", { body: staffPath, contentType: "text/plain" });

    let tipOpenMs: number | null = null;
    let dualOnTip = 0;
    let onStripe = false;
    let ratingReached = false;
    let reviewMode: "external" | "internal" | "unknown" | "pending" | "skipped" = "unknown";
    {
      await installObserver(page);
      const s0 = Date.now();
      await page.goto(staffPath, { waitUntil: "domcontentloaded" });
      await Promise.race([
        page.waitForURL(/tip-amount/, { timeout: 25_000 }),
        page.waitForSelector("[data-caretip-route-ready]", { timeout: 25_000 }),
      ]);
      tipOpenMs = Date.now() - s0;
      const tipUx = await uxProbe(page);
      dualOnTip = tipUx.dualLoaderHits;

      if (!/tip-amount/.test(page.url())) {
        const leave = page.getByRole("button", { name: /leave a tip|trinkgeld hinterlassen|leave tip|Trinkgeld/i }).first();
        if (await leave.isVisible().catch(() => false)) {
          await leave.click();
        }
        await page.waitForURL(/tip-amount/, { timeout: 20_000 });
      }
      const euro10 = page.locator("button").filter({ hasText: /€\s*10|10\s*€/ }).first();
      await expect(euro10).toBeVisible({ timeout: 20_000 });
      await euro10.click();
      const pay = page.getByRole("button", { name: /continue|weiter|payment|zahlen|checkout/i }).first();
      await expect(pay).toBeVisible({ timeout: 15_000 });
      const payT0 = Date.now();
      await pay.click();
      await Promise.race([
        page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 }),
        page.waitForTimeout(45_000),
      ]);
      const payMs = Date.now() - payT0;
      testInfo.attach("pay-ms", { body: String(payMs), contentType: "text/plain" });

      onStripe = page.url().includes("checkout.stripe.com");
      if (onStripe) {
        await page.waitForTimeout(2500);
        const email = page.getByLabel(/email|e-mail/i).first();
        if (await email.isVisible().catch(() => false)) {
          await email.fill("live-ux-validation@example.com");
        }
        const frames = page.frames();
        let filled = false;
        for (const fr of frames) {
          const num = fr.locator("input[name='cardnumber'], input[name='cardNumber'], input[autocomplete='cc-number']").first();
          if (await num.count()) {
            await num.fill("4242424242424242", { timeout: 8_000 }).catch(() => {});
            const exp = fr.locator("input[name='exp-date'], input[name='cardExpiry'], input[autocomplete='cc-exp']").first();
            const cvc = fr.locator("input[name='cvc'], input[name='cardCvc'], input[autocomplete='cc-csc']").first();
            await exp.fill("1234").catch(() => {});
            await cvc.fill("123").catch(() => {});
            filled = true;
            break;
          }
        }
        if (!filled) {
          await page.keyboard.type("4242424242424242");
        }
        const payStripe = page.getByRole("button", { name: /pay|zahlen|bezahlen|zahlen sie/i }).first();
        await payStripe.click({ timeout: 20_000 }).catch(() => {});
        await page.waitForURL((url) => /\/rating/.test(url.pathname), { timeout: 90_000 }).catch(() => {});
        ratingReached = /\/rating/.test(page.url());
        if (ratingReached) {
          await page.waitForTimeout(1500);
          const google = await page.getByRole("link", { name: /Google/i }).count();
          const trip = await page.getByRole("link", { name: /TripAdvisor/i }).count();
          const stars = await page.getByRole("radio").count();
          const confirming = await page.getByText(/Confirming tip|Trinkgeld wird/i).count();
          if (confirming > 0 && google === 0 && stars === 0) reviewMode = "pending";
          else if (google + trip > 0 && stars === 0) reviewMode = "external";
          else if (stars > 0 && google + trip === 0) reviewMode = "internal";
        }
      }

      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(
        REPORT,
        JSON.stringify(
          {
            landingMs,
            tipOpenMs,
            dualOnTip,
            landingDual: landingUx.dualLoaderHits,
            landingEmpty: landingUx.emptyHits,
            checkoutPostCount: checkoutPosts.length,
            onStripe,
            ratingReached,
            reviewMode,
            url: page.url(),
          },
          null,
          2,
        ),
      );
      expect(landingUx.emptyHits, "sustained uncovered empty root on landing").toBeLessThan(3);
      expect(dualOnTip, "HTML boot + React overlay stacked on tip page").toBeLessThan(6);
      expect(checkoutPosts.length, "duplicate checkout session creates").toBeLessThanOrEqual(1);
      expect(onStripe, "Pay did not reach Stripe Checkout").toBeTruthy();
    }

    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 20_000 });
    const overflow360 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow360).toBeFalsy();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await dismissCookie(page);
    await expect(page.locator("form, input[type='email']").first()).toBeVisible({ timeout: 20_000 });
    const email = page.locator("input[type='email']").first();
    const password = page.locator("input[type='password']").first();
    await email.fill(DEMO_EMAIL);
    await password.fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in|anmelden|log in/i }).first().click();
    await page.waitForURL(/dashboard|employee|onboarding/, { timeout: 40_000 }).catch(() => {});
    const afterLogin = page.url();
    testInfo.attach("after-login", { body: afterLogin, contentType: "text/plain" });

    if (/dashboard/.test(afterLogin)) {
      await page.goto("/dashboard/qr-studio", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const blank = await page.evaluate(() => {
        const root = document.getElementById("root");
        return (root?.textContent ?? "").trim().length < 8;
      });
      expect(blank, "QR Studio blank screen").toBeFalsy();
      await page.goto("/dashboard/qr-studio/print", { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(800);
    }

    await page.setViewportSize({ width: 412, height: 915 });
    const logout = page.getByRole("button", { name: /log out|abmelden|sign out/i }).first();
    if (await logout.isVisible().catch(() => false)) {
      await logout.click();
      await page.waitForURL(/login|^\/$|\/$/, { timeout: 20_000 }).catch(() => {});
    }
  });
});

test.describe("Live UX — production caretip.de", () => {
  test("landing and login paint without empty root", async ({ browser }) => {
    const page = await browser.newPage();
    await installObserver(page);
    const res = await page.goto(PRODUCTION + "/", { waitUntil: "domcontentloaded", timeout: 40_000 });
    expect(res?.ok() ?? false).toBeTruthy();
    await expect(page.locator(".caretip-landing, #caretip-html-boot")).toBeVisible({ timeout: 25_000 });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 25_000 });
    const ux = await uxProbe(page);
    test.info().attach("prod-emptyHits", { body: String(ux.emptyHits), contentType: "text/plain" });
    await dismissCookie(page);
    await page.goto(PRODUCTION + "/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("input[type='email']").first()).toBeVisible({ timeout: 20_000 });
    const staff = await page.goto(PRODUCTION + DEMO_STAFF, { waitUntil: "domcontentloaded" });
    test.info().attach("prod-staff-status", {
      body: String(staff?.status() ?? "nav"),
      contentType: "text/plain",
    });
    await page.close();
  });
});
