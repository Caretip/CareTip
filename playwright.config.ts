import { defineConfig, devices } from "@playwright/test";

/**
 * Run E2E in one of two ways:
 * 1) Preferred: `npm run dev` in one terminal, then `npm run test:e2e` here (no auto server).
 * 2) One shot: `npm run test:e2e:with-server` — uses `scripts/playwright-with-server.mjs` (NOT Playwright `webServer`).
 *
 * Browsers: Playwright 1.52+ expects **chromium** + **chromium-headless-shell** unless you use a system browser:
 * - `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` → custom `chrome.exe` / Chromium path
 * - `PLAYWRIGHT_USE_SYSTEM_CHROME=true` → use installed Google Chrome (`channel: 'chrome'`)
 *
 * `pretest:e2e` runs `scripts/install-playwright.mjs` (skipped when `SKIP_PLAYWRIGHT_INSTALL=true`).
 *
 * `E2E_BASE_URL` overrides the app origin (default `http://localhost:5173`).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

const chromiumExe = (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "").trim();
const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === "true";

const chromiumUse = chromiumExe
  ? {
      launchOptions: {
        executablePath: chromiumExe,
      },
    }
  : useSystemChrome
    ? {
        /** Uses a locally installed Google Chrome (not bundled Chromium). */
        channel: "chrome" as const,
      }
    : {};

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    navigationTimeout: 20_000,
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile-menu\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumUse,
      },
    },
    {
      name: "click-audit-mobile",
      testMatch: /click-responsiveness\.spec\.ts/,
      grepInvert: /desktop route transitions/,
      use: {
        ...devices["Pixel 5"],
        ...chromiumUse,
      },
    },
    {
      name: "click-audit-desktop",
      testMatch: /click-responsiveness\.spec\.ts/,
      grep: /desktop route transitions/,
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumUse,
      },
    },
    {
      name: "customer-journey-header",
      testMatch: /customer-journey-header\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        ...chromiumUse,
      },
    },
    {
      name: "navigation-flash",
      testMatch: /navigation-flash\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        ...chromiumUse,
      },
    },
    {
      name: "employee-dashboard-mobile",
      testMatch: /employee-dashboard-mobile-overflow\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        ...chromiumUse,
      },
    },
    {
      name: "dashboard-refresh-webkit",
      testMatch: /dashboard-refresh-resilience.spec.ts/,
      use: {
        ...devices["Desktop Safari"],
      },
    },
    {
      name: "dashboard-refresh-iphone-webkit",
      testMatch: /dashboard-refresh-resilience.spec.ts/,
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "iphone-safari",
      testMatch: /mobile-menu\.spec\.ts/,
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "chrome-android",
      testMatch: /mobile-menu\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
      },
    },
    {
      name: "samsung-internet",
      testMatch: /mobile-menu\.spec\.ts/,
      use: {
        ...devices["Galaxy S9+"],
        userAgent:
          "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      },
    },
  ],
});
