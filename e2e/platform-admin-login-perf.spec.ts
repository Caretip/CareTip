import { test, expect } from "@playwright/test";

/**
 * Platform admin login must paint immediately for cold anonymous visitors:
 * no global bootstrap overlay, no refresh until a stored session exists.
 */
test.describe("Platform admin login public shell", () => {
  test("cold visit paints login form without bootstrap overlay", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      (window as unknown as { __caretipAuthOverlaySeen?: boolean }).__caretipAuthOverlaySeen = false;
      const obs = new MutationObserver(() => {
        const overlay = document.querySelector('.app-setup-loading.fixed[aria-busy="true"]');
        if (overlay) {
          (window as unknown as { __caretipAuthOverlaySeen: boolean }).__caretipAuthOverlaySeen = true;
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });

    let apiCalls = 0;
    await page.route("**/api/**", async (route) => {
      apiCalls += 1;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unauthorized" }),
      });
    });

    const t0 = Date.now();
    await page.goto("/platform-admin/login", { waitUntil: "domcontentloaded" });

    const email = page.locator("#platform-admin-email");
    await expect(email).toBeVisible({ timeout: 5_000 });
    const formPaintMs = Date.now() - t0;

    const overlaySeen = await page.evaluate(
      () => (window as unknown as { __caretipAuthOverlaySeen?: boolean }).__caretipAuthOverlaySeen ?? false,
    );
    expect(overlaySeen, "global auth bootstrap overlay").toBe(false);
    expect(apiCalls, "no API calls before login on cold visit").toBe(0);
    // Cold Vite/dev paint is environment-dependent; keep a generous localhost ceiling.
    expect(formPaintMs, "login form paint under 5s on localhost").toBeLessThan(5_000);
  });
});
