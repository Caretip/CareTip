import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  NAV_INTERACTION_PROFILER_INIT,
  bottleneckHumanLabel,
  profileNavTarget,
  summarizeProfiles,
  type NavInteractionProfile,
  type NavProfileTarget,
} from "./helpers/navigationInteractionProfiler";

const REPORT_DIR = path.join(process.cwd(), "test-results", "nav-interaction-profile");

async function openMobileMenu(page: import("@playwright/test").Page): Promise<void> {
  const hamburger = page.locator('button[aria-controls="mobile-main-nav"]').first();
  if ((await hamburger.getAttribute("aria-expanded")) === "true") {
    await expect(page.locator("#mobile-main-nav")).toBeVisible({ timeout: 3000 });
    return;
  }
  await hamburger.click();
  await expect(page.locator("#mobile-main-nav")).toBeVisible({ timeout: 3000 });
}

const DESKTOP_TARGETS: NavProfileTarget[] = [
  {
    label: "Features",
    href: "/features",
    linkSelector: 'header a[href="/features"]',
    paintSelector: "main h1",
  },
  {
    label: "Pricing",
    href: "/pricing",
    linkSelector: 'header a[href="/pricing"]',
    paintSelector: "main h1",
  },
  {
    label: "Contact",
    href: "/contact",
    linkSelector: 'footer a[href="/contact"]',
    paintSelector: "#name, main h1",
    prepare: async (page) => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
    },
  },
  {
    label: "Login",
    href: "/login",
    linkSelector: 'header a[href="/login"]',
    paintSelector: ".caretip-auth-card, .caretip-auth-form",
  },
  {
    label: "Demo CTA",
    href: "/contact",
    linkSelector: 'header a[href="/contact"], footer a[href="/contact"]',
    paintSelector: "#name, main h1",
  },
];

const MOBILE_TARGETS: NavProfileTarget[] = [
  {
    label: "Mobile menu — Features",
    href: "/features",
    linkSelector: '#mobile-main-nav a.caretip-public-mobile-nav-drawer__nav-link[href="/features"]',
    paintSelector: "main h1",
    prepare: openMobileMenu,
  },
  {
    label: "Mobile menu — Pricing",
    href: "/pricing",
    linkSelector: '#mobile-main-nav a.caretip-public-mobile-nav-drawer__nav-link[href="/pricing"]',
    paintSelector: "main h1",
    prepare: openMobileMenu,
  },
  {
    label: "Mobile menu — Login",
    href: "/login",
    linkSelector: '#mobile-main-nav a.caretip-public-mobile-nav-drawer__account-link[href="/login"]',
    paintSelector: ".caretip-auth-card, .caretip-auth-form",
    prepare: openMobileMenu,
  },
  {
    label: "Mobile menu — Demo CTA",
    href: "/contact",
    linkSelector: '#mobile-main-nav a.caretip-public-mobile-nav-drawer__cta-secondary[href="/contact"]',
    paintSelector: "#name, main h1",
    prepare: openMobileMenu,
  },
];

function writeReport(
  filename: string,
  profiles: NavInteractionProfile[],
  meta: Record<string, unknown>,
): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const summary = summarizeProfiles(profiles);
  const payload = {
    generatedAt: new Date().toISOString(),
    profiler: "Chrome Performance timeline + in-page phase instrumentation",
    phases: [
      "pointerdown → click handler start",
      "click handler → navigate()",
      "navigate() → first route paint",
      "route paint → fully interactive",
    ],
    ...meta,
    summary: {
      slowest: summary.slowest,
      bottleneckCounts: summary.bottleneckCounts,
    },
    profiles: summary.profiles.map((profile) => ({
      ...profile,
      bottleneckLabel: bottleneckHumanLabel(profile.bottleneck),
    })),
  };
  fs.writeFileSync(
    path.join(REPORT_DIR, filename),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(payload, null, 2));
}

test.describe("Navigation interaction profiling audit", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(NAV_INTERACTION_PROFILER_INIT);
  });

  test("desktop nav — phased interaction profile", async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const profiles: NavInteractionProfile[] = [];

    for (const target of DESKTOP_TARGETS) {
      await context.tracing.start({
        screenshots: false,
        snapshots: true,
        title: `nav-profile-desktop-${target.label}`,
      });

      const profile = await profileNavTarget(page, target, "desktop");
      profiles.push(profile);

      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const traceName = `desktop-${target.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`;
      await context.tracing.stop({
        path: path.join(REPORT_DIR, traceName),
      });
    }

    writeReport("desktop-nav-profile.json", profiles, {
      viewport: "desktop",
      chromePerformanceTraces: DESKTOP_TARGETS.map(
        (t) => `test-results/nav-interaction-profile/desktop-${t.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`,
      ),
    });

    for (const profile of profiles) {
      if ((profile.phases.total ?? 0) === 0) continue; // fallback navigation-only path
      expect(profile.phases.pointerdownToClickHandler, profile.label).toBeLessThan(500);
      expect(profile.phases.total, profile.label).toBeLessThan(12_000);
    }
  });

  test("mobile menu — phased interaction profile", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const profiles: NavInteractionProfile[] = [];

    for (const target of MOBILE_TARGETS) {
      await context.tracing.start({
        screenshots: false,
        snapshots: true,
        title: `nav-profile-mobile-${target.label}`,
      });

      const profile = await profileNavTarget(page, target, "mobile");
      profiles.push(profile);

      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const traceName = `mobile-${target.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`;
      await context.tracing.stop({
        path: path.join(REPORT_DIR, traceName),
      });
    }

    writeReport("mobile-nav-profile.json", profiles, {
      viewport: "mobile",
      chromePerformanceTraces: MOBILE_TARGETS.map(
        (t) => `test-results/nav-interaction-profile/mobile-${t.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`,
      ),
    });

    for (const profile of profiles) {
      expect(profile.phases.total, profile.label).toBeLessThan(15_000);
    }
  });
});
