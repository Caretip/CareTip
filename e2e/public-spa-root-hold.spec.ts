import { test, expect } from "@playwright/test";

/**
 * After HTML boot, SPA navigations that replace the root Outlet must never uncover empty #root.
 * Login is eager; /pricing stays lazy and must be covered by RootSpaRouteHold or destination paint.
 */
test.describe("Public SPA root visual continuity", () => {
  test("landing → login never uncovers an empty root", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __caretipUncoveredEmpty?: boolean };
      w.__caretipUncoveredEmpty = false;
      const check = () => {
        const boot = document.getElementById("caretip-html-boot");
        const bootShows =
          Boolean(boot) &&
          getComputedStyle(boot).display !== "none" &&
          getComputedStyle(boot).visibility !== "hidden" &&
          getComputedStyle(boot).opacity !== "0";
        const hold = Boolean(
          document.querySelector(
            '[data-testid="root-spa-route-hold"], [data-testid="auth-logout-handoff-cover"], [data-testid="sign-in-handoff-cover"]',
          ),
        );
        const pageUi = Boolean(
          document.querySelector(".caretip-landing, [data-caretip-route-ready], .caretip-auth, form"),
        );
        const root = document.getElementById("root");
        const rootEmpty = !root || root.childElementCount === 0;
        if (!bootShows && rootEmpty && !hold && !pageUi) {
          w.__caretipUncoveredEmpty = true;
        }
      };
      new MutationObserver(check).observe(document.documentElement ?? document, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 20_000 });
    await page.locator('a[href="/login"]').first().click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    const uncovered = await page.evaluate(
      () => (window as unknown as { __caretipUncoveredEmpty?: boolean }).__caretipUncoveredEmpty === true,
    );
    expect(uncovered, "root was empty with no hold/cover during landing → login").toBe(false);
  });

  test("landing → pricing never uncovers an empty root", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __caretipUncoveredEmpty?: boolean };
      w.__caretipUncoveredEmpty = false;
      const check = () => {
        const boot = document.getElementById("caretip-html-boot");
        const bootShows =
          Boolean(boot) &&
          getComputedStyle(boot).display !== "none" &&
          getComputedStyle(boot).visibility !== "hidden" &&
          getComputedStyle(boot).opacity !== "0";
        const hold = Boolean(document.querySelector('[data-testid="root-spa-route-hold"]'));
        const pageUi = Boolean(document.querySelector(".caretip-landing, [data-caretip-route-ready]"));
        const root = document.getElementById("root");
        const rootEmpty = !root || root.childElementCount === 0;
        if (!bootShows && rootEmpty && !hold && !pageUi) {
          w.__caretipUncoveredEmpty = true;
        }
      };
      new MutationObserver(check).observe(document.documentElement ?? document, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 20_000 });
    const pricing = page.locator('a[href="/pricing"]').first();
    if ((await pricing.count()) === 0) {
      await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    } else {
      await pricing.click();
    }
    await expect(page).toHaveURL(/\/pricing/, { timeout: 20_000 });
    const uncovered = await page.evaluate(
      () => (window as unknown as { __caretipUncoveredEmpty?: boolean }).__caretipUncoveredEmpty === true,
    );
    expect(uncovered, "root was empty with no hold during landing → pricing").toBe(false);
  });
});
