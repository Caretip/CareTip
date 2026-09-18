import { test, expect, type Page } from "@playwright/test";
import { menuButton, openMobileMenu } from "./helpers/mobileMenu";

const CALENDLY_URL = "https://calendly.com/caretip-info/30min";
const DEMO_SELECTOR = '[data-caretip-request-demo="true"]';

async function gotoPublic(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

async function dismissPwaIfPresent(page: Page) {
  const pwaDismiss = page.getByRole("button", { name: /dismiss|got it|verstanden/i });
  if (await pwaDismiss.isVisible().catch(() => false)) {
    await pwaDismiss.click();
  }
}

async function expectCalendlyPopupOrFallback(page: Page) {
  const popupIframe = page.locator('iframe[src*="calendly.com"]');
  const calendlyOverlay = page.locator(".calendly-popup-content, .calendly-overlay");

  const popupTab = page.waitForEvent("popup", { timeout: 10_000 }).catch(() => null);
  const overlayVisible = expect(popupIframe.or(calendlyOverlay).first())
    .toBeVisible({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  const tab = await popupTab;
  if (tab) {
    await expect(tab).toHaveURL(/calendly\.com\/caretip-info\/30min/);
    await tab.close().catch(() => undefined);
    return;
  }

  expect(await overlayVisible).toBeTruthy();
}

/** Landing demo CTAs are lazy-mounted — scroll to force IntersectionObserver mounts. */
async function revealLandingDemoCtas(page: Page) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate((step) => {
      window.scrollTo({ top: (document.body.scrollHeight / 8) * (step + 1), behavior: "instant" });
    }, i);
    await page.waitForTimeout(250);
    if ((await page.locator(DEMO_SELECTOR).count()) > 0) return;
  }
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
}

test.describe("Request Demo → Calendly", () => {
  test("landing desktop Request Demo opens Calendly without leaving CareTip", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoPublic(page, "/");
    await dismissPwaIfPresent(page);
    await revealLandingDemoCtas(page);

    const cta = page.locator(DEMO_SELECTOR).first();
    await expect(cta).toBeVisible({ timeout: 30_000 });
    await expect(cta).toHaveAttribute("href", CALENDLY_URL);

    const urlBefore = page.url();
    await cta.click();
    await expectCalendlyPopupOrFallback(page);
    await expect(page).toHaveURL(urlBefore);
  });

  test("pricing page Request Demo opens Calendly", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoPublic(page, "/pricing");
    await dismissPwaIfPresent(page);

    const cta = page.locator(DEMO_SELECTOR).first();
    await expect(cta).toBeVisible({ timeout: 20_000 });
    await cta.click();
    await expectCalendlyPopupOrFallback(page);
    await expect(page).toHaveURL(/\/pricing/);
  });

  test("how-it-works Request Demo opens Calendly", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoPublic(page, "/how-it-works");
    await dismissPwaIfPresent(page);

    const cta = page.locator(DEMO_SELECTOR).first();
    await expect(cta).toBeVisible({ timeout: 20_000 });
    await cta.click();
    await expectCalendlyPopupOrFallback(page);
  });

  test("mobile nav Request Demo opens Calendly", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPublic(page, "/");
    await expect(menuButton(page)).toBeVisible({ timeout: 20_000 });
    await dismissPwaIfPresent(page);
    await openMobileMenu(page);

    const cta = page.locator("#mobile-main-nav").locator(DEMO_SELECTOR).first();
    await expect(cta).toBeVisible();
    await cta.click();
    await expectCalendlyPopupOrFallback(page);
  });

  test("Calendly widget assets load at most once after click", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoPublic(page, "/pricing");
    await dismissPwaIfPresent(page);

    await expect(page.locator("script[data-caretip-calendly-script]")).toHaveCount(0);

    const cta = page.locator(DEMO_SELECTOR).first();
    await expect(cta).toBeVisible({ timeout: 20_000 });
    await cta.click();
    await expectCalendlyPopupOrFallback(page);

    await expect(page.locator("script[data-caretip-calendly-script]")).toHaveCount(1);
    await expect(page.locator("link[data-caretip-calendly-style]")).toHaveCount(1);

    // Remove overlay and click another CTA — loader must not inject a second script/style.
    await page.evaluate(() => {
      document.querySelectorAll(".calendly-overlay").forEach((el) => el.remove());
    });

    const demos = page.locator(DEMO_SELECTOR);
    const count = await demos.count();
    if (count > 1) {
      await demos.nth(1).click();
      await expectCalendlyPopupOrFallback(page);
    } else {
      await demos.first().click();
      await expectCalendlyPopupOrFallback(page);
    }

    await expect(page.locator("script[data-caretip-calendly-script]")).toHaveCount(1);
    await expect(page.locator("link[data-caretip-calendly-style]")).toHaveCount(1);
  });
});
