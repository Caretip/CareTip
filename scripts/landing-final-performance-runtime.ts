/**
 * Landing final performance architecture (source contract).
 * Run: node ./backend/node_modules/tsx/dist/cli.mjs ./scripts/landing-final-performance-runtime.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const i18n = read("src/i18n/i18n.ts");
const landing = read("src/app/pages/LandingPage.tsx");
const heroShowcase = read("src/components/landing/LandingHeroStoryShowcase.tsx");
const heroAssets = read("src/lib/landingHeroStoryAssets.ts");

assert(i18n.includes("prefetchAlternateLocaleBundle"), "idle alternate locale prefetch");
assert(i18n.includes('load: "currentOnly"'), "initial boot loads only active locale");
assert(landing.includes("prefetchAlternateLocaleBundle"), "landing schedules locale prefetch");
assert(landing.includes('preloadLiveMinutesOnboardingScreens(["en", "de"])'), "both onboarding locales warmed");
assert(heroShowcase.includes("getWarmLandingHeroImage"), "hero syncs LCP from warm cache");
assert(heroAssets.includes("warmLandingHeroLcpImage"), "hero LCP warm helper exists");
assert(heroShowcase.includes('loading="eager"'), "LCP hero img is eager");
assert(read("src/components/landing/CareTipLandingHero.tsx").includes("memo("), "hero is memoized");

console.log("landing-final-performance-runtime: ok");
