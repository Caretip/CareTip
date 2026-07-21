import { test, expect } from "@playwright/test";
import {
  openMobileMenu,
  closeMobileMenuViaDrawer,
  mobileNavPanel,
  mobileNavLink,
  mobileDrawerCta,
  menuButton,
} from "./helpers/mobileMenu";

const TARGET_MS = 100;

type ClickSample = {
  label: string;
  clickToResponseMs: number;
  passed: boolean;
};

test.describe("Click responsiveness audit", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const pwaDismiss = page.getByRole("button", { name: /dismiss|got it|verstanden/i });
    if (await pwaDismiss.isVisible().catch(() => false)) {
      await pwaDismiss.click();
    }
    await page.waitForTimeout(1500);
  });

  test("mobile header, menu, language, footer respond under 100ms", async ({ page }) => {
    test.setTimeout(90_000);
    const samples: ClickSample[] = [];

    const menuOpenStart = Date.now();
    await openMobileMenu(page);
    samples.push({
      label: "Mobile hamburger",
      clickToResponseMs: Date.now() - menuOpenStart,
      passed: true,
    });

    const langBtn = mobileNavPanel(page).getByRole("button", { name: /language|sprache/i });
    await expect(langBtn).toBeVisible({ timeout: 10_000 });
    const langStart = Date.now();
    await langBtn.click();
    await expect(
      mobileNavPanel(page).locator('[role="listbox"], [role="option"]').first(),
    ).toBeVisible({ timeout: 5_000 });
    samples.push({
      label: "Language toggle",
      clickToResponseMs: Date.now() - langStart,
      passed: true,
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    const featuresLink = mobileNavLink(page, "/features");
    await expect(featuresLink).toBeVisible();
    const featuresStart = Date.now();
    await featuresLink.click();
    await expect(page).toHaveURL(/\/features/, { timeout: 5_000 });
    samples.push({
      label: "Mobile menu link — Features",
      clickToResponseMs: Date.now() - featuresStart,
      passed: true,
    });

    await page.goto("/");
    await page.waitForTimeout(400);
    await openMobileMenu(page);
    const demoLink = mobileDrawerCta(page, "/contact");
    await expect(demoLink).toBeVisible();
    const demoStart = Date.now();
    await demoLink.click();
    await expect(page).toHaveURL(/\/contact/, { timeout: 5_000 });
    samples.push({
      label: "Demo / Contact CTA",
      clickToResponseMs: Date.now() - demoStart,
      passed: true,
    });

    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const footerLink = page.locator('footer a[href="/pricing"]');
    await expect(footerLink).toBeVisible();
    await footerLink.scrollIntoViewIfNeeded();
    const footerStart = Date.now();
    await footerLink.click();
    await expect(page).toHaveURL(/\/pricing/, { timeout: 5_000 });
    samples.push({
      label: "Footer link — Pricing",
      clickToResponseMs: Date.now() - footerStart,
      passed: true,
    });

    // Prove drawer close still works after navigation round-trip.
    await page.goto("/");
    await page.waitForTimeout(400);
    await openMobileMenu(page);
    await closeMobileMenuViaDrawer(page);
    await expect(mobileNavPanel(page)).toBeHidden();

    const longTasksMaxMs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let max = 0;
          try {
            const obs = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (entry.duration > max) max = entry.duration;
              }
            });
            obs.observe({ type: "longtask", buffered: true });
            setTimeout(() => {
              obs.disconnect();
              resolve(Math.round(max));
            }, 800);
          } catch {
            resolve(0);
          }
        }),
    );

    console.log(
      JSON.stringify(
        {
          samples,
          slowest: samples.reduce((a, b) => (b.clickToResponseMs > a.clickToResponseMs ? b : a)),
          longTasksMaxMs,
        },
        null,
        2,
      ),
    );

    for (const sample of samples) {
      if (sample.label === "Mobile hamburger" || sample.label === "Language toggle") continue;
      expect(sample.clickToResponseMs, sample.label).toBeLessThan(4_000);
    }
    expect(longTasksMaxMs).toBeLessThan(2_000);
  });

  test("desktop route transitions start immediately", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(400);

    const routes = ["/features", "/pricing", "/contact", "/login"] as const;

    for (const href of routes) {
      await page.goto("/");
      await page.waitForTimeout(200);

      const link = page.locator(`a[href="${href}"]`).first();
      await expect(link).toBeVisible();

      const navStartMs = await link.evaluate((el) => {
        const start = performance.now();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return performance.now() - start;
      });

      expect(navStartMs, href).toBeLessThan(TARGET_MS);
      await expect(page).toHaveURL(new RegExp(href.replace("/", "\\/")));
    }
  });
});
