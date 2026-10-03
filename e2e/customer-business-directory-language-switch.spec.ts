/**
 * Business QR (/:businessSlug) — language switch must not refetch directory or blank the page.
 * Run: E2E_BASE_URL=http://localhost:4173 npx playwright test e2e/customer-business-directory-language-switch.spec.ts
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const SLUG = "lang-dir-cafe";
const DIRECTORY_URL = `**/api/staff/directory/business/${SLUG}**`;

const directoryBody = () =>
  JSON.stringify({
    business: {
      id: "biz-lang-dir",
      name: "Café Sonnenschein",
      slug: SLUG,
      logo: null,
      location: null,
      type: null,
      branding: null,
    },
    employees: [
      {
        id: "emp-lang-dir",
        name: "Anna Müller",
        jobTitle: "Server",
        avatar: null,
        slug: "anna",
      },
    ],
  });

type VisibilitySample = {
  customerFlow: boolean;
  teamCard: boolean;
  pageLoader: boolean;
  textLen: number;
};

async function sampleVisibility(page: Page): Promise<VisibilitySample> {
  return page.evaluate(() => {
    const root = document.getElementById("root");
    return {
      customerFlow: Boolean(document.querySelector(".customer-flow")),
      teamCard: Boolean(document.querySelector("[data-customer-team]")),
      pageLoader: Boolean(document.querySelector(".app-branded-loader")),
      textLen: (root?.innerText ?? "").trim().length,
    };
  });
}

function assertContinuousVisibility(samples: VisibilitySample[], label: string): void {
  const bad = samples.filter(
    (s) => !s.customerFlow || !s.teamCard || s.pageLoader || s.textLen < 40,
  );
  expect(
    bad.length,
    `${label}: customer content must stay visible (no loader / empty root). Bad frames: ${bad.length}`,
  ).toBe(0);
}

async function mockDirectory(page: Page, delayMs = 0) {
  let fetchCount = 0;
  await page.route(DIRECTORY_URL, async (route) => {
    fetchCount += 1;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: directoryBody(),
    });
  });
  return () => fetchCount;
}

async function waitForDirectoryReady(page: Page) {
  await expect(page.locator(".customer-flow")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("Anna Müller")).toBeVisible();
  await expect(page.locator(".customer-journey-lang-switch")).toBeVisible();
}

test.describe("Business directory language switch", () => {
  test("EN → DE → EN keeps team visible; no extra directory fetch", async ({ page }) => {
    const getFetchCount = await mockDirectory(page);
    await page.addInitScript(() => {
      localStorage.setItem("caretip_i18n_language", "en");
    });

    await page.goto(`/${SLUG}`, { waitUntil: "domcontentloaded" });
    await waitForDirectoryReady(page);
    expect(getFetchCount(), "initial directory load").toBe(1);

    const switcher = page.locator(".customer-journey-lang-switch");
    const samples: VisibilitySample[] = [];
    const poll = setInterval(() => {
      void sampleVisibility(page).then((s) => samples.push(s));
    }, 16);

    await switcher.getByRole("button", { name: "DE" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de", { timeout: 15_000 });
    await expect(page.getByText("Anna Müller")).toBeVisible();
    await page.waitForTimeout(300);

    await switcher.getByRole("button", { name: "EN" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: 15_000 });
    await expect(page.getByText("Anna Müller")).toBeVisible();
    await page.waitForTimeout(300);
    clearInterval(poll);

    assertContinuousVisibility(samples, "EN→DE→EN");
    expect(getFetchCount(), "language switch must not refetch directory").toBe(1);
  });

  test("DE → EN → DE with cold alternate locale bundle", async ({ page }) => {
    let releaseDe: (() => void) | null = null;
    const deGate = new Promise<void>((resolve) => {
      releaseDe = resolve;
    });

    await page.route("**/locales/de.json**", async (route) => {
      await deGate;
      await route.continue();
    });
    await page.route("**/assets/*de*.json**", async (route) => {
      await deGate;
      await route.continue();
    });

    const getFetchCount = await mockDirectory(page, 80);
    await page.addInitScript(() => {
      localStorage.setItem("caretip_i18n_language", "de");
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
    });

    await page.goto(`/${SLUG}`, { waitUntil: "domcontentloaded" });
    await waitForDirectoryReady(page);
    const loadsBeforeSwitch = getFetchCount();

    const switcher = page.locator(".customer-journey-lang-switch");
    const samples: VisibilitySample[] = [];
    const poll = setInterval(() => {
      void sampleVisibility(page).then((s) => samples.push(s));
    }, 16);

    const enClick = switcher.getByRole("button", { name: "EN" }).click();
    await page.waitForTimeout(200);
    releaseDe?.();
    await enClick;
    await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: 20_000 });
    await expect(page.getByText("Anna Müller")).toBeVisible();

    await switcher.getByRole("button", { name: "DE" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de", { timeout: 15_000 });
    await page.waitForTimeout(300);
    clearInterval(poll);

    assertContinuousVisibility(samples, "DE→EN→DE");
    expect(getFetchCount(), "only initial load(s), not per locale toggle").toBe(loadsBeforeSwitch);
  });
});
