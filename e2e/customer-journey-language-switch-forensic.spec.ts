/**
 * Forensic: detect customer content disappearance during EN↔DE (not a regression guard yet).
 * Run: E2E_BASE_URL=http://localhost:5173 npx playwright test e2e/customer-journey-language-switch-forensic.spec.ts --trace on
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";

const OUT = path.join("test-results", "customer-lang-forensic");

type DomProbe = {
  ts: number;
  routeReady: boolean;
  customerFlow: boolean;
  langSwitch: boolean;
  softHold: boolean;
  chunkHold: boolean;
  htmlBoot: boolean;
  rootChildren: number;
  outletTextLen: number;
  bodyBg: string;
};

async function probe(page: Page): Promise<DomProbe> {
  return page.evaluate(() => {
    const root = document.getElementById("root");
    const outletText = root?.innerText?.trim() ?? "";
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    return {
      ts: performance.now(),
      routeReady: Boolean(document.querySelector("[data-caretip-route-ready]")),
      customerFlow: Boolean(document.querySelector(".customer-flow")),
      langSwitch: Boolean(document.querySelector(".customer-journey-lang-switch")),
      softHold: Boolean(document.querySelector('[data-testid="soft-spa-route-hold"]')),
      chunkHold: Boolean(
        document.querySelector('[data-testid="public-route-chunk-hold"]') ||
          document.querySelector('[data-testid="public-route-chunk-hold-soft"]'),
      ),
      htmlBoot: Boolean(document.getElementById("caretip-html-boot")),
      rootChildren: root?.childElementCount ?? 0,
      outletTextLen: outletText.length,
      bodyBg,
    };
  });
}

test.describe("Customer language switch forensic", () => {
  test("captures DOM gap during EN→DE (cached locales)", async ({ page }) => {
    await page.route("**/api/staff/forensic-lang", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-forensic",
          name: "Anna Müller",
          jobTitle: "Server",
          businessId: "biz-1",
          businessName: "Café Sonnenschein",
          businessLogo: null,
          avatar: null,
          bio: null,
          slug: "forensic-lang",
        }),
      });
    });
    await page.route("**/api/employees/emp-forensic**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-forensic",
          name: "Anna Müller",
          businessId: "biz-1",
          businessName: "Café Sonnenschein",
          businessLogo: null,
          avatar: null,
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem("caretip_i18n_language", "en");
    });

    await page.goto("/staff/forensic-lang", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/tip-amount/, { timeout: 20_000 });
    await expect(page.locator("[data-caretip-route-ready]")).toBeVisible({ timeout: 20_000 });

    const before = await probe(page);
    await page.screenshot({ path: path.join(OUT, "01-before-en.png"), fullPage: true });

    const samples: DomProbe[] = [];
    const poll = setInterval(async () => {
      samples.push(await probe(page));
    }, 16);

    await page.locator(".customer-journey-lang-switch").getByRole("button", { name: "DE" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "de", { timeout: 15_000 });
    await page.waitForTimeout(400);
    clearInterval(poll);

    const after = await probe(page);
    await page.screenshot({ path: path.join(OUT, "03-after-de.png"), fullPage: true });

    const gap = samples.filter(
      (s) => s.outletTextLen < 40 || (!s.customerFlow && before.customerFlow),
    );
    const holdActive = samples.some((s) => s.softHold || s.chunkHold);

    test.info().attach("forensic-samples.json", {
      body: JSON.stringify({ before, after, sampleCount: samples.length, gap, holdActive }, null, 2),
      contentType: "application/json",
    });

    if (gap.length > 0) {
      await page.screenshot({ path: path.join(OUT, "02-during-gap.png"), fullPage: true });
    }

    expect(after.customerFlow, "customer shell should return after switch").toBe(true);
    expect(after.outletTextLen, "visible copy should return").toBeGreaterThan(40);
  });

  test("delayed alternate locale bundle — content must not fully blank", async ({ page }) => {
    let releaseLocale: (() => void) | null = null;
    const localeGate = new Promise<void>((resolve) => {
      releaseLocale = resolve;
    });

    await page.route("**/locales/de.json**", async (route) => {
      await localeGate;
      await route.continue();
    });

    await page.route("**/api/staff/forensic-slow", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-slow",
          name: "Anna Müller",
          businessId: "biz-1",
          businessName: "Café Sonnenschein",
          businessLogo: null,
          avatar: null,
          slug: "forensic-slow",
        }),
      });
    });
    await page.route("**/api/employees/emp-slow**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "emp-slow",
          name: "Anna Müller",
          businessId: "biz-1",
          businessName: "Café Sonnenschein",
          businessLogo: null,
          avatar: null,
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem("caretip_i18n_language", "en");
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (k.includes("i18n") || k.includes("locale")) localStorage.removeItem(k);
      }
      localStorage.setItem("caretip_i18n_language", "en");
    });

    await page.goto("/staff/forensic-slow", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-caretip-route-ready]")).toBeVisible({ timeout: 20_000 });

    const minTextDuring: number[] = [];
    const poll = setInterval(async () => {
      const p = await probe(page);
      minTextDuring.push(p.outletTextLen);
    }, 16);

    const clickPromise = page
      .locator(".customer-journey-lang-switch")
      .getByRole("button", { name: "DE" })
      .click();

    await page.waitForTimeout(600);
    const mid = await probe(page);
    await page.screenshot({ path: path.join(OUT, "slow-mid-blocked.png"), fullPage: true });

    releaseLocale?.();
    await clickPromise;
    await expect(page.locator("html")).toHaveAttribute("lang", "de", { timeout: 20_000 });
    clearInterval(poll);

    const minLen = minTextDuring.length ? Math.min(...minTextDuring) : mid.outletTextLen;
    test.info().attach("slow-locale-min-text", {
      body: JSON.stringify({ minLen, mid, samples: minTextDuring.length }, null, 2),
      contentType: "application/json",
    });

    expect(minLen, "outlet should retain visible text while DE bundle loads").toBeGreaterThan(20);
  });
});
