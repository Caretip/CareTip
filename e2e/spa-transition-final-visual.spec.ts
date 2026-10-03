import { test, expect, type Page } from "@playwright/test";

type TransitionSample = {
  path: string;
  holdSoftMs: number;
  holdRootMs: number;
  holdBrandedMs: number;
  brandedLoaderMs: number;
  shellNavVisible: boolean;
  samples: number;
};

function installTransitionProbe(): void {
  (window as unknown as { __caretipTransitionProbe?: unknown }).__caretipTransitionProbe = {
    lastPath: "",
    running: false,
    result: null as TransitionSample | null,
    raf: 0,
    holdSoftMs: 0,
    holdRootMs: 0,
    holdBrandedMs: 0,
    brandedLoaderMs: 0,
    samples: 0,
    shellNavVisible: false,
    startNavigation(path: string) {
      this.running = true;
      this.lastPath = path;
      this.result = null;
      this.holdSoftMs = 0;
      this.holdRootMs = 0;
      this.holdBrandedMs = 0;
      this.brandedLoaderMs = 0;
      this.samples = 0;
      this.shellNavVisible = false;
      const started = performance.now();
      const tick = () => {
        if (!this.running) return;
        const t = performance.now();
        this.samples += 1;
        const soft = document.querySelector('[data-testid="public-route-chunk-hold-soft"]');
        const root = document.querySelector('[data-testid="root-spa-route-hold"]');
        const brandedHold = document.querySelector('[data-testid="public-route-chunk-hold"]');
        const brandedOverlay = document.querySelector(".app-branded-loader.app-setup-loading--instant");
        if (soft && getComputedStyle(soft).display !== "none") this.holdSoftMs += 16;
        if (root && getComputedStyle(root).display !== "none") this.holdRootMs += 16;
        if (brandedHold && getComputedStyle(brandedHold).display !== "none") this.holdBrandedMs += 16;
        if (brandedOverlay && getComputedStyle(brandedOverlay).display !== "none") this.brandedLoaderMs += 16;
        this.shellNavVisible =
          this.shellNavVisible ||
          Boolean(
            document.querySelector(
              ".caretip-dashboard-shell, .business-sidebar, .employee-sidebar, .admin-sidebar, .caretip-landing nav, header.caretip-marketing-nav, nav[aria-label]",
            ),
          );
        if (t - started > 8000) {
          this.stopNavigation();
          return;
        }
        this.raf = window.requestAnimationFrame(tick);
      };
      this.raf = window.requestAnimationFrame(tick);
    },
    stopNavigation() {
      this.running = false;
      if (this.raf) window.cancelAnimationFrame(this.raf);
      if (!this.result && this.lastPath) {
        this.result = {
          path: this.lastPath,
          holdSoftMs: this.holdSoftMs,
          holdRootMs: this.holdRootMs,
          holdBrandedMs: this.holdBrandedMs,
          brandedLoaderMs: this.brandedLoaderMs,
          shellNavVisible: this.shellNavVisible,
          samples: this.samples,
        };
      }
    },
    readResult(): TransitionSample | null {
      return this.result;
    },
  };
}

async function warmShell(page: Page) {
  await page.goto("/", { waitUntil: "load", timeout: 60_000 });
  await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function measureSpaNav(page: Page, href: string, pathLabel: string): Promise<TransitionSample> {
  await page.evaluate((p) => {
    const probe = (window as unknown as { __caretipTransitionProbe?: { startNavigation: (x: string) => void } })
      .__caretipTransitionProbe;
    probe?.startNavigation(p);
  }, pathLabel);

  const clicked = await page.evaluate((targetHref) => {
    const anchors = Array.from(document.querySelectorAll(`a[href="${targetHref}"]`));
    const link = anchors.find((a) => {
      const r = a.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (link) {
      (link as HTMLAnchorElement).click();
      return true;
    }
    const any = anchors[0] as HTMLAnchorElement | undefined;
    if (any) {
      any.click();
      return true;
    }
    return false;
  }, href);
  if (!clicked) {
    await page.goto(href, { waitUntil: "domcontentloaded" });
  }

  await page.waitForURL(new RegExp(href.replace("/", "\\/")), { timeout: 30_000 });
  await expect(
    page.locator("[data-caretip-route-ready], .caretip-landing, main, .caretip-marketing-page").first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const probe = (window as unknown as { __caretipTransitionProbe?: { stopNavigation: () => void } })
      .__caretipTransitionProbe;
    probe?.stopNavigation();
  });

  const result = await page.evaluate(() => {
    const probe = (window as unknown as { __caretipTransitionProbe?: { readResult: () => TransitionSample | null } })
      .__caretipTransitionProbe;
    return probe?.readResult() ?? null;
  });

  return (
    result ?? {
      path: pathLabel,
      holdSoftMs: 0,
      holdRootMs: 0,
      holdBrandedMs: 0,
      brandedLoaderMs: 0,
      shellNavVisible: false,
      samples: 0,
    }
  );
}

const viewports = [
  { name: "320", width: 320, height: 640 },
  { name: "375", width: 375, height: 812 },
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
] as const;

test.describe("SPA transition visual probe — marketing", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installTransitionProbe);
  });

  for (const vp of viewports) {
    test(`marketing hops @ ${vp.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await warmShell(page);

      const hops = ["/features", "/pricing", "/faq", "/contact"];
      const results: TransitionSample[] = [];
      for (const href of hops) {
        results.push(await measureSpaNav(page, href, href));
      }

      const industry = page.locator('a[href^="/industries/"]').first();
      if ((await industry.count()) > 0) {
        results.push(await measureSpaNav(page, await industry.getAttribute("href")!, "industries"));
      } else {
        results.push(await measureSpaNav(page, "/industries/hotels", "/industries/hotels"));
      }

      for (const r of results) {
        console.info(`[spa-transition-probe] ${vp.name}px ${r.path}`, JSON.stringify(r));
        expect(r.holdBrandedMs, `${r.path} must not show cold branded public-route-chunk-hold`).toBeLessThan(80);
        expect(r.brandedLoaderMs, `${r.path} must not show AppBrandedLoadingScreen overlay`).toBeLessThan(80);
        expect(r.holdRootMs, `${r.path} root hold should not cover marketing in-shell nav`).toBeLessThan(120);
        expect(r.holdSoftMs, `${r.path} soft hold should be brief on local/dev`).toBeLessThan(2500);
      }
    });
  }
});

test.describe("SPA transition — throttled network", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installTransitionProbe);
  });

  test("marketing / → /pricing under Slow 3G (no branded boot)", async ({ page, context }) => {
    test.setTimeout(180_000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput: (500 * 1024) / 8,
      latency: 400,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "load", timeout: 120_000 });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 60_000 });

    const r = await measureSpaNav(page, "/pricing", "/pricing-slow3g");
    console.info("[spa-transition-probe] slow3g /pricing", JSON.stringify(r));
    expect(r.holdBrandedMs).toBeLessThan(80);
    expect(r.brandedLoaderMs).toBeLessThan(80);
    expect(r.holdSoftMs).toBeLessThan(6000);
  });
});

test.describe("SPA transition — customer tip path (eager steps)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installTransitionProbe);
  });

  test("tip-amount route paints without branded hold after warm start", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await warmShell(page);
    const r = await measureSpaNav(page, "/tip-amount", "/tip-amount");
    expect(r.holdBrandedMs).toBeLessThan(80);
    expect(r.brandedLoaderMs).toBeLessThan(80);
  });
});
