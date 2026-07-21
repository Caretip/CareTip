import { test, expect } from "@playwright/test";
import { openMobileMenu, mobileNavPanel } from "./helpers/mobileMenu";

const LANDING_PROBE_INIT = `
(() => {
  if (window.__caretipLandingProbe) return;
  window.__caretipLandingProbe = { milestones: {}, network: {} };

  let navStart = performance.now();
  let lastLongTaskAt = performance.now();

  try {
    const ltObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) lastLongTaskAt = performance.now();
      }
    });
    ltObs.observe({ type: "longtask", buffered: true });
  } catch {}

  function mark(name) {
    if (window.__caretipLandingProbe.milestones[name] != null) return;
    window.__caretipLandingProbe.milestones[name] = Math.round(performance.now() - navStart);
  }

  function watchInteractive() {
    if (performance.now() - lastLongTaskAt >= 80) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => mark("interactive"));
      });
      return;
    }
    if (performance.now() - navStart > 15000) mark("interactive");
    else requestAnimationFrame(watchInteractive);
  }

  function poll(selectors, milestone, then) {
    if (!selectors) {
      then?.();
      return;
    }
    const list = selectors.split(",").map((s) => s.trim());
    const started = performance.now();
    function tick() {
      for (const sel of list) {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect().height > 0) {
          mark(milestone);
          then?.();
          return;
        }
      }
      if (performance.now() - started > 12000) {
        then?.();
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  window.__caretipLandingProbe.begin = () => {
    navStart = performance.now();
    window.__caretipLandingProbe.milestones = {};
  };

  window.__caretipLandingProbe.watch = () => {
    poll(".caretip-hero-section, .caretip-hero-copy h1", "heroVisible", () => {
      poll(".caretip-hero-story-frame--active, .caretip-hero-showcase-img", "heroImageVisible", () => {
        poll('.caretip-hero-section a[href="/signup"], .caretip-hero-copy a[href="/signup"]', "primaryCta", () => {
          poll("nav, .caretip-public-nav", "navigation", () => {
            poll(
              'nav a[href="/features"], nav a[href="/pricing"], button[aria-controls="mobile-main-nav"]',
              "navInteractive",
              watchInteractive,
            );
          });
        });
      });
    });
  };

  window.__caretipLandingProbe.summarizeNetwork = () => {
    const heroMs = window.__caretipLandingProbe.milestones.heroVisible ?? Infinity;
    const resources = performance.getEntriesByType("resource");
    const chunkLoadedBeforeHero = (needle) =>
      resources.some((entry) => {
        if (typeof entry.name !== "string" || !entry.name.includes(needle)) return false;
        const end = entry.responseEnd || entry.startTime + entry.duration;
        return end <= heroMs + 80;
      });

    return {
      vendorMotionBeforeHero: chunkLoadedBeforeHero("vendor-motion"),
      belowFoldChunkBeforeHero: chunkLoadedBeforeHero("LandingPageBelowFold"),
      vendorMotionLoadedEventually: resources.some(
        (entry) => typeof entry.name === "string" && entry.name.includes("vendor-motion"),
      ),
    };
  };
})();
`;

test.describe("Landing page performance profile", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(LANDING_PROBE_INIT);
  });

  test("render path milestones on /", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.evaluate(() => {
      window.__caretipLandingProbe.begin();
      window.__caretipLandingProbe.watch();
    });

    await page.waitForFunction(
      () => window.__caretipLandingProbe?.milestones?.interactive != null,
      undefined,
      { timeout: 45_000 },
    );

    const result = await page.evaluate(() => ({
      milestones: window.__caretipLandingProbe?.milestones ?? {},
      network: window.__caretipLandingProbe?.summarizeNetwork?.() ?? {},
    }));

    console.log(JSON.stringify({ route: "/", ...result }, null, 2));

    expect(result.milestones.heroVisible).not.toBeNull();
    expect(result.milestones.primaryCta).not.toBeNull();
    expect(result.network.vendorMotionBeforeHero).toBe(false);
    expect(result.network.belowFoldChunkBeforeHero).toBe(false);
    expect(result.milestones.heroVisible).toBeLessThan(result.milestones.interactive ?? Infinity);
  });

  test("language toggle and mobile menu still work", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForTimeout(1500);

    await openMobileMenu(page);
    const langBtn = mobileNavPanel(page).getByRole("button", { name: /language|sprache/i });
    await expect(langBtn).toBeVisible();
    await langBtn.click();
    await expect(
      mobileNavPanel(page).locator('[role="listbox"], [role="option"]').first(),
    ).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");

    await expect(mobileNavPanel(page)).toBeVisible({ timeout: 3000 });
  });
});

declare global {
  interface Window {
    __caretipLandingProbe?: {
      begin: () => void;
      watch: () => void;
      summarizeNetwork: () => {
        vendorMotionBeforeHero: boolean;
        belowFoldChunkBeforeHero: boolean;
        vendorMotionLoadedEventually: boolean;
      };
      milestones: Record<string, number | null>;
    };
  }
}
