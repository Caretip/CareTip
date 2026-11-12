import { test, expect } from "@playwright/test";

/**
 * A guest scanning a stale or mistyped QR code must see a clear error quickly — not the boot loader
 * until its safety timeout (previously ~15 s). Runs against an isolated stack (E2E_BASE_URL).
 */
const CASES: Array<[string, RegExp]> = [
  ["/no-such-venue-xyz", /couldn.t find this business/i],
  ["/no-such-venue/no-such-person", /couldn.t find this business/i],
  ["/qr/employee/doesnotexist", /couldn.t find that team member/i],
  ["/qr/table/doesnotexist", /couldn.t find that table/i],
  ["/qr/location/doesnotexist", /couldn.t find that location/i],
  ["/qr-landing/doesnotexist", /couldn.t find this business/i],
];

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

for (const [path, message] of CASES) {
  test(`stale QR ${path} shows an error within 5s with a way home`, async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("caretip_i18n_language", "en");
      } catch {
        /* ignore */
      }
    });
    await page.route(/^https:\/\//, (route) => route.abort());
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // Measured from first paint of the app shell (dev-server compile time excluded).
    await expect(page.getByText(message)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("link", { name: /go home/i }).or(page.getByRole("button", { name: /go home/i })).first()).toBeVisible();
  });
}
