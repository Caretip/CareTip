/**
 * Cookie banner visibility regression — all required content visible at key viewports.
 * Run: npx tsx scripts/cookie-banner-visibility-runtime.ts
 * Requires dev server on http://localhost:5173
 */
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

const VIEWPORTS: Array<{ name: string; width: number; height: number }> = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x640", width: 360, height: 640 },
  { name: "375x667", width: 375, height: 667 },
  { name: "390x667", width: 390, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "414x896", width: 414, height: 896 },
  { name: "430x932", width: 430, height: 932 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
];

async function assertBannerFullyVisible(page: Page, viewportName: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: /privacy|privatsphäre/i });
  await dialog.waitFor({ state: "visible", timeout: 15_000 });

  const checks = [
    { label: "title", locator: dialog.getByRole("heading", { name: /privatsphäre|privacy/i }) },
    {
      label: "description",
      locator: dialog.locator("#cookie-consent-desc p").first(),
    },
    {
      label: "privacy-link",
      locator: dialog.getByRole("link", { name: /datenschutzerklärung|privacy policy/i }),
    },
    {
      label: "settings",
      locator: dialog.getByRole("button", { name: /cookie-einstellungen|cookie settings/i }),
    },
    {
      label: "reject",
      locator: dialog.getByRole("button", { name: /nicht notwendige ablehnen|reject non-essential/i }),
    },
    {
      label: "accept-all",
      locator: dialog.getByRole("button", { name: /alle akzeptieren|accept all/i }),
    },
  ];

  for (const { label, locator } of checks) {
    await expectVisibleInViewport(page, locator, `${viewportName}:${label}`);
  }

  const panelBox = await dialog.boundingBox();
  assert(panelBox, `${viewportName}: banner panel missing bounding box`);
  const vh = page.viewportSize()?.height ?? 0;
  assert(panelBox.y >= 0, `${viewportName}: banner top clipped above viewport (${panelBox.y})`);
  assert(
    panelBox.y + panelBox.height <= vh + 1,
    `${viewportName}: banner bottom clipped below viewport (${panelBox.y + panelBox.height} > ${vh})`,
  );
}

async function expectVisibleInViewport(page: Page, locator: ReturnType<Page["getByRole"]>, id: string) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  const box = await locator.boundingBox();
  assert(box, `${id}: element has no layout box`);
  const vh = page.viewportSize()?.height ?? 0;
  const vw = page.viewportSize()?.width ?? 0;
  assert(box.y + box.height <= vh + 1, `${id}: bottom outside viewport`);
  assert(box.y >= 0, `${id}: top outside viewport`);
  assert(box.x + box.width <= vw + 1, `${id}: right outside viewport`);
  assert(box.x >= 0, `${id}: left outside viewport`);
}

async function main() {
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "de-DE" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.removeItem("caretip_cookie_consent");
      });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await assertBannerFullyVisible(page, vp.name);
      await context.close();
      console.log(`ok: ${vp.name}`);
    }
    console.log("cookie-banner-visibility-runtime: all viewports passed");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
