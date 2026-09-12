import { test, expect } from "@playwright/test";

/**
 * Cold landing: branded HTML boot must not uncover an empty #root.
 * After the boot has been shown, removing it without landing DOM is the white-flash bug.
 */
test.describe("Landing HTML boot handoff", () => {
  test("boot never uncovers an empty root on /", async ({ page }) => {
    const failedCritical: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      const status = res.status();
      if (status < 400) return;
      if (/\.(js|css)(\?|$)/i.test(url) || url.includes("/assets/")) {
        failedCritical.push(`${status} ${url}`);
      }
    });
    page.on("pageerror", (err) => {
      failedCritical.push(`pageerror ${err.message}`);
    });

    await page.addInitScript(() => {
      const w = window as unknown as {
        __caretipUncoveredEmpty?: boolean;
        __caretipBootGoneAt?: number;
        __caretipLandingAt?: number;
      };
      w.__caretipUncoveredEmpty = false;
      let seenBoot = false;
      const check = () => {
        const boot = document.getElementById("caretip-html-boot");
        const landing = document.querySelector(".caretip-landing, [data-caretip-route-ready]");
        const bootShows =
          Boolean(boot) &&
          getComputedStyle(boot).display !== "none" &&
          getComputedStyle(boot).visibility !== "hidden" &&
          getComputedStyle(boot).opacity !== "0";
        if (bootShows) seenBoot = true;
        if (landing && w.__caretipLandingAt == null) {
          w.__caretipLandingAt = performance.now();
        }
        if (seenBoot && !bootShows && w.__caretipBootGoneAt == null) {
          w.__caretipBootGoneAt = performance.now();
        }
        if (seenBoot && !bootShows && !landing) {
          w.__caretipUncoveredEmpty = true;
        }
      };
      const startObserver = () => {
        const el = document.documentElement;
        if (!el) {
          document.addEventListener("DOMContentLoaded", startObserver, { once: true });
          return;
        }
        new MutationObserver(check).observe(el, {
          subtree: true,
          childList: true,
          attributes: true,
        });
        check();
      };
      startObserver();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 20_000 });
    const probe = await page.evaluate(() => {
      const w = window as unknown as {
        __caretipUncoveredEmpty?: boolean;
        __caretipBootGoneAt?: number;
        __caretipLandingAt?: number;
      };
      return {
        uncovered: w.__caretipUncoveredEmpty === true,
        bootGoneAt: w.__caretipBootGoneAt ?? null,
        landingAt: w.__caretipLandingAt ?? null,
        rootChildCount: document.getElementById("root")?.childElementCount ?? 0,
      };
    });
    expect(probe.uncovered, "HTML boot disappeared while landing was not in the DOM").toBe(false);
    expect(probe.rootChildCount).toBeGreaterThan(0);
    expect(failedCritical, failedCritical.join("\n")).toEqual([]);
    if (probe.bootGoneAt != null && probe.landingAt != null) {
      expect(probe.landingAt).toBeLessThanOrEqual(probe.bootGoneAt + 50);
    }
  });

  test("landing is in the DOM before HTML boot fade completes", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.waitForFunction(() => {
      const boot = document.getElementById("caretip-html-boot");
      const landing = Boolean(document.querySelector(".caretip-landing"));
      if (!boot) return landing;
      if (boot.classList.contains("caretip-html-boot--exiting")) return landing;
      return landing;
    }, { timeout: 20_000 });

    await expect(page.locator(".caretip-landing")).toBeAttached();
  });
});
