/**
 * Business main QR (/:businessSlug) — HTML boot must hand off when team UI commits.
 * Run: E2E_BASE_URL=http://localhost:4173 npx playwright test e2e/customer-business-qr-boot-handoff.spec.ts
 */
import { test, expect } from "@playwright/test";

const SLUG = "boot-handoff-cafe";
const DIRECTORY_URL = `**/api/staff/directory/business/${SLUG}**`;

const directoryJson = () =>
  JSON.stringify({
    business: {
      id: "biz-boot",
      name: "Café Sonnenschein",
      slug: SLUG,
      logo: null,
      location: null,
      type: null,
      branding: null,
    },
    employees: [
      {
        id: "emp-boot",
        name: "Anna Müller",
        jobTitle: "Server",
        avatar: null,
        slug: "anna",
      },
    ],
  });

test.describe("Business QR HTML boot handoff", () => {
  test("route-ready dismisses boot once team directory is visible", async ({ page }) => {
    await page.route(DIRECTORY_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: directoryJson(),
      });
    });

    await page.goto(`/${SLUG}`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("[data-customer-team]")).toBeVisible({ timeout: 25_000 });
    await expect(page.locator(".customer-flow")).toBeVisible();
    await expect(page.getByText("Anna Müller")).toBeVisible();

    await expect(page.locator("[data-caretip-route-ready]")).toBeVisible({ timeout: 5_000 });

    const stuckBehindBoot = await page.evaluate(() => {
      const boot = document.getElementById("caretip-html-boot");
      const bootActive = document.documentElement.classList.contains("caretip-html-boot-active");
      const routeReady = Boolean(document.querySelector("[data-caretip-route-ready]"));
      const teamVisible = Boolean(document.querySelector("[data-customer-team]"));
      if (!teamVisible || !routeReady) return true;
      if (!boot && !bootActive) return false;
      const bootStyle = boot ? getComputedStyle(boot) : null;
      const bootCovers =
        boot &&
        bootStyle &&
        bootStyle.display !== "none" &&
        bootStyle.visibility !== "hidden" &&
        parseFloat(bootStyle.opacity || "1") > 0.05;
      return Boolean(bootCovers && bootActive);
    });

    expect(stuckBehindBoot, "team UI must not remain covered by HTML boot after route-ready").toBe(
      false,
    );
  });

  test("boot hands off within 500ms of route-ready appearing", async ({ page }) => {
    await page.route(DIRECTORY_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: directoryJson(),
      });
    });

    await page.goto(`/${SLUG}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-caretip-route-ready]")).toBeVisible({ timeout: 25_000 });

    const readyAt = await page.evaluate(() => performance.now());
    await page.waitForFunction(
      () => !document.documentElement.classList.contains("caretip-html-boot-active"),
      { timeout: 500 },
    );
    const handoffAt = await page.evaluate(() => performance.now());
    expect(handoffAt - readyAt, "handoff delay after route-ready marker visible").toBeLessThan(500);
  });
});
