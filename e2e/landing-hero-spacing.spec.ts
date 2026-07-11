import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-results", "landing-hero-spacing", "screenshots");

const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 700 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-430", width: 430, height: 860 },
  { name: "desktop-1280", width: 1280, height: 800 },
] as const;

test.describe("Landing hero spacing polish", () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`capture hero copy — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".caretip-hero-copy-block", { timeout: 20_000 });

      const copy = page.locator(".caretip-hero-copy-block");
      await expect(copy).toBeVisible();

      const spacing = await copy.evaluate(() => {
        const headline = document.querySelector(".caretip-hero-headline");
        const subtitle = document.querySelector(".caretip-hero-subtitle");
        const cta = document.querySelector(".caretip-hero-cta-cluster");
        const showcase = document.querySelector(".caretip-hero-bg-layer");
        const paras = subtitle?.querySelectorAll("p") ?? [];

        const rect = (el: Element | null) => el?.getBoundingClientRect();

        const h = rect(headline);
        const s = rect(subtitle);
        const c = rect(cta);
        const v = rect(showcase);
        const p0 = rect(paras[0] ?? null);
        const p1 = rect(paras[1] ?? null);

        return {
          viewportHeight: window.innerHeight,
          headlineTopPx: h ? Math.round(h.top) : null,
          ctaBottomPx: c ? Math.round(c.bottom) : null,
          headlineToBodyPx: h && s ? Math.round(s.top - h.bottom) : null,
          paragraphGapPx:
            p0 && p1 ? Math.round(p1.top - p0.bottom) : null,
          bodyToCtaPx: s && c ? Math.round(c.top - s.bottom) : null,
          ctaToVisualPx: c && v ? Math.round(v.top - c.bottom) : null,
          bodyMaxWidthPx: subtitle ? Math.round(subtitle.getBoundingClientRect().width) : null,
        };
      });

      expect(spacing.headlineToBodyPx).toBeGreaterThanOrEqual(22);
      expect(spacing.bodyToCtaPx).toBeGreaterThanOrEqual(26);
      if (viewport.width < 768 && spacing.headlineTopPx != null && spacing.ctaBottomPx != null) {
        expect(spacing.headlineTopPx).toBeLessThan(viewport.height * 0.42);
        expect(spacing.ctaBottomPx).toBeLessThanOrEqual(viewport.height + 8);
      }
      if (viewport.width < 1024 && spacing.ctaToVisualPx != null) {
        // Full-bleed hero: copy sits above the background layer (negative gap is expected).
        expect(spacing.ctaToVisualPx).toBeLessThanOrEqual(28);
      }
      if (spacing.paragraphGapPx != null) {
        expect(spacing.paragraphGapPx).toBeGreaterThanOrEqual(18);
        expect(spacing.paragraphGapPx).toBeLessThanOrEqual(24);
      }

      await copy.screenshot({
        path: path.join(OUT_DIR, `hero-copy--${viewport.name}.png`),
      });
    });
  }
});
