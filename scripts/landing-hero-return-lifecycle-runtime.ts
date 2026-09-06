/**
 * Landing hero return-lifecycle regressions (no browser).
 * Run: npm run test:landing-hero-return-lifecycle
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) {
    throw new Error(`missing file: ${rel}`);
  }
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const storyCss = read("src/styles/caretip-landing-hero-story.css");
const shellCss = read("src/styles/bundles/marketing-shell.css");
const showcase = read("src/components/landing/LandingHeroStoryShowcase.tsx");
const assets = read("src/lib/landingHeroStoryAssets.ts");
const routes = read("src/app/routes.tsx");
const landingPage = read("src/app/pages/LandingPage.tsx");
const shellReady = read("src/app/lib/useLandingShellReady.ts");

assert(
  storyCss.includes(".caretip-hero-media-clip:not(.caretip-hero-media-clip--background) .caretip-hero-story-frame"),
  "card fade must be scoped away from the full-bleed hero clip",
);
assert(
  !/^\.caretip-landing \.caretip-hero-media-clip \.caretip-hero-story-frame \{/m.test(storyCss),
  "unscoped story-frame opacity:0 must not apply to the background hero",
);
assert(
  storyCss.includes("caretip-hero-story-frame--bg-cover.caretip-hero-story-frame--displayed"),
  "displayed cover frames must win opacity without relying on equal-specificity order",
);
assert(
  shellCss.includes('caretip-landing-hero-story.css'),
  "hero story visibility CSS must stay loaded on public pages after leaving /",
);
assert(
  showcase.includes("isLandingHeroLcpWarm()"),
  "showcase must seed LCP ready state from the warm bitmap on remount",
);
assert(
  showcase.includes("useLayoutEffect"),
  "LCP complete sync must run before paint, not after",
);
assert(
  assets.includes("warmImageBySrc") && assets.includes("getWarmLandingHeroImage"),
  "warm cache helper must exist without inventing new network preloads",
);
assert(
  routes.includes("path: '/'") && routes.includes("import('./pages/LandingPage')"),
  "landing remains a lazy route (no keep-alive of the whole page)",
);
assert(
  shellReady.includes("softNav") && shellReady.includes("isAppShellInteractive()"),
  "return visits must not reopen the branded overlay",
);
assert(
  landingPage.includes("void warmLandingHeroLcpImage()"),
  "landing chunk still warms LCP on evaluate",
);
const heroHost = read("src/components/landing/CareTipLandingHero.tsx");
assert(heroHost.includes('variant="background"'), "CareTipLandingHero uses background variant");

console.log("landing-hero-return-lifecycle: ok");
