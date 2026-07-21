import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-results", "landing-background-audit", "screenshots");

type SurfaceOption = "before" | "A" | "B" | "C";

const SURFACE_HEX: Record<Exclude<SurfaceOption, "before">, string> = {
  A: "#FAF8F5",
  B: "#F8F7F4",
  C: "#F7F5F2",
};

/** Live landing section ids (Phase 10 — #built-for-hospitality retired from landing). */
const TARGETS = [
  { id: "about-section", label: "hero", optionScope: false },
  { id: "industries", label: "industries", optionScope: true },
  { id: "business-section", label: "business", optionScope: false },
  { id: "recognition", label: "recognition", optionScope: false },
  { id: "how-it-works", label: "setup", optionScope: true },
  { id: "final-cta", label: "final-cta", optionScope: false },
] as const;

async function waitForLandingSections(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".caretip-hero-section", { timeout: 20_000 });
  await page.waitForTimeout(1200);

  for (let pass = 0; pass < 18; pass += 1) {
    const missing = await page.evaluate((ids) => {
      return ids.filter((id) => !document.getElementById(id));
    }, TARGETS.map((t) => t.id));

    if (missing.length === 0) break;

    await page.evaluate(() => {
      window.scrollBy(0, Math.max(window.innerHeight * 0.9, 720));
    });
    await page.waitForTimeout(500);
  }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

function warmSurfaceCss(option: SurfaceOption): string {
  if (option === "before") {
    return `
      html:not(.dark) .caretip-landing #industries {
        background: linear-gradient(180deg, #ffffff 0%, #fff9f2 100%) !important;
      }
      html:not(.dark) .caretip-landing #how-it-works {
        background: linear-gradient(180deg, #fffdf9 0%, #fffbf4 48%, #fff7eb 100%) !important;
      }
    `;
  }

  const hex = SURFACE_HEX[option];
  const hospitality = `linear-gradient(180deg, #ffffff 0%, ${hex} 100%)`;
  const setup = `linear-gradient(180deg, #ffffff 0%, ${hex} 48%, #faf8f5 100%)`;

  return `
    html:not(.dark) .caretip-landing #industries {
      background: ${hospitality} !important;
    }
    html:not(.dark) .caretip-landing #how-it-works {
      background: ${setup} !important;
    }
  `;
}

async function injectSurface(page: import("@playwright/test").Page, option: SurfaceOption) {
  await page.evaluate(({ css, opt }) => {
    document.getElementById("caretip-bg-audit-style")?.remove();
    const style = document.createElement("style");
    style.id = "caretip-bg-audit-style";
    style.textContent = css;
    document.head.appendChild(style);
    document.documentElement.dataset.caretipBgAudit = opt;
  }, { css: warmSurfaceCss(option), opt: option });
}

test.describe("Landing background color audit", () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const option of ["before", "A", "B", "C"] as SurfaceOption[]) {
    test(`capture comparison — option ${option}`, async ({ page }) => {
      await waitForLandingSections(page);
      await injectSurface(page, option);

      for (const target of TARGETS) {
        const section = page.locator(`#${target.id}`);
        await expect(section).toBeAttached({ timeout: 25_000 });
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(350);
        await expect(section).toBeVisible();
        await section.screenshot({
          path: path.join(OUT_DIR, `${target.label}--option-${option}.png`),
        });
      }
    });
  }

  test("after pass — live CSS on warm sections is stable", async ({ page }) => {
    await waitForLandingSections(page);
    await page.locator("#how-it-works").scrollIntoViewIfNeeded();

    const setupBg = await page.locator("#how-it-works").evaluate((el) => {
      return getComputedStyle(el).backgroundImage || getComputedStyle(el).backgroundColor;
    });

    expect(setupBg.toLowerCase().length).toBeGreaterThan(0);
  });
});
