import { test, expect } from "@playwright/test";

/**
 * After HTML boot, SPA navigations that replace the root Outlet must never uncover empty #root.
 * Login is eager; /pricing stays lazy and must be covered by RootSpaRouteHold, PublicRouteChunkHold, or destination paint.
 */
function rootHoldProbeScript(): void {
  (window as unknown as { __caretipRootUncoveredNow?: () => boolean }).__caretipRootUncoveredNow = () => {
    const boot = document.getElementById("caretip-html-boot");
    const bootShows =
      Boolean(boot) &&
      getComputedStyle(boot).display !== "none" &&
      getComputedStyle(boot).visibility !== "hidden" &&
      getComputedStyle(boot).opacity !== "0";
    const hold = Boolean(
      document.querySelector(
        '[data-testid="root-spa-route-hold"], [data-testid="public-route-chunk-hold"], [data-testid="auth-logout-handoff-cover"], [data-testid="sign-in-handoff-cover"]',
      ),
    );
    const pageUi = Boolean(
      document.querySelector(
        '.caretip-landing, [data-caretip-route-ready], .caretip-auth-page, .caretip-auth-form, [data-testid="public-route-chunk-hold"], form',
      ),
    );
    const root = document.getElementById("root");
    const rootEmpty = !root || root.childElementCount === 0;
    return !bootShows && rootEmpty && !hold && !pageUi;
  };
}

test.describe("Public SPA root visual continuity", () => {
  test("landing → login never uncovers an empty root", async ({ page }) => {
    await page.addInitScript(rootHoldProbeScript);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 20_000 });
    await page.locator('a[href="/login"]').first().click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.locator(".caretip-auth-page, .caretip-auth-form, form").first()).toBeVisible({
      timeout: 20_000,
    });

    const uncovered = await page.evaluate(
      () => (window as unknown as { __caretipRootUncoveredNow?: () => boolean }).__caretipRootUncoveredNow?.() === true,
    );
    expect(uncovered, "login destination must not leave #root empty without a hold/cover").toBe(false);
    await expect(page.locator("#root")).not.toBeEmpty();
  });

  test("landing → pricing never uncovers an empty root", async ({ page }) => {
    await page.addInitScript(rootHoldProbeScript);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".caretip-landing")).toBeVisible({ timeout: 20_000 });
    const pricing = page.locator('a[href="/pricing"]').first();
    if ((await pricing.count()) === 0) {
      await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    } else {
      await pricing.click();
    }
    await expect(page).toHaveURL(/\/pricing/, { timeout: 20_000 });
    await expect(
      page.locator('[data-caretip-route-ready], [data-testid="public-route-chunk-hold"], .caretip-landing').first(),
    ).toBeVisible({ timeout: 20_000 });

    const uncovered = await page.evaluate(
      () => (window as unknown as { __caretipRootUncoveredNow?: () => boolean }).__caretipRootUncoveredNow?.() === true,
    );
    expect(uncovered, "pricing destination must not leave #root empty without a hold").toBe(false);
    await expect(page.locator("#root")).not.toBeEmpty();
  });
});
