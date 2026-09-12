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
  !showcase.includes("isLandingHeroLcpWarm()"),
  "showcase must not treat the off-DOM warm Image as a painted LCP (logout remount)",
);
assert(
  showcase.includes("naturalWidth > 0"),
  "LCP complete must wait for the mounted <img> bitmap",
);
assert(
  showcase.includes("useLayoutEffect"),
  "LCP complete sync must run before paint, not after",
);
assert(
  showcase.includes("LandingHeroFloatingCards"),
  "card variant must keep LandingHeroFloatingCards imported",
);
assert(
  showcase.includes('visibilityState === "hidden"'),
  "hero crossfade must settle when the document hides, not on every visibility tick",
);

const mediaResume = read("src/lib/landingMediaResume.ts");
assert(
  mediaResume.includes("paintRecoveryPending") && mediaResume.includes("decodeInFlight"),
  "resume decode() must be guarded (once per hide/show, not every pageshow/focus)",
);
assert(
  landingPage.includes("noteLandingDocumentHidden") && landingPage.includes("consumeLandingPaintRecovery"),
  "landing must decode only after a real hide/bfcache restore",
);
assert(
  storyCss.includes("caretip-hero-bg-frame-layer:first-child"),
  "first cover frame must stay opaque so both frames cannot be opacity 0",
);
assert(
  assets.includes("isDomLandingHeroLcpComplete"),
  "DOM LCP completeness must be distinct from the warm Image Map",
);
assert(
  assets.includes("warmImageBySrc") && assets.includes("getWarmLandingHeroImage"),
  "warm cache helper must exist without inventing new network preloads",
);
assert(
  /path:\s*'\/',\s*\n\s*\/\/ Eager[\s\S]*?Component:\s*LandingPage/.test(routes) &&
    !/path:\s*'\/',\s*\n\s*lazy:/.test(routes),
  "/ must ship LandingPage eagerly so the first Outlet commit is the landing page, not an empty lazy hole",
);
assert(
  shellReady.includes("softNav") && shellReady.includes("isAppShellInteractive()"),
  "return visits must not reopen the branded overlay",
);
assert(
  shellReady.includes("useAppLoadingRegistration") && shellReady.includes("false"),
  "landing must not hold the global overlay for hero LCP",
);
assert(
  !shellReady.includes("HERO_LCP_WAIT_MS"),
  "landing overlay must not wait up to 2.5s for hero decode",
);
assert(
  !shellReady.includes("isHeroLcpPainted"),
  "landing overlay must not wait for LCP completeness",
);

const indexHtml = read("index.html");
assert(
  !indexHtml.includes("manrope-latin-800"),
  "do not preload Manrope on the critical path (competes with LCP image)",
);
assert(
  read("src/main.tsx").includes('import("./app/pages/LandingPage")'),
  "landing JS must prefetch in parallel with i18n",
);
assert(
  /path:\s*'\/',\s*\n\s*\/\/ Eager[\s\S]*?Component:\s*LandingPage/.test(routes) &&
    !/path:\s*'\/',\s*\n\s*lazy:/.test(routes),
  "/ must ship LandingPage eagerly so the first Outlet commit is the landing page, not an empty lazy hole",
);
assert(
  read("src/app/context/AppLoadingManager.tsx").includes("isPublicShellPath"),
  "public shells must skip the React app-boot overlay",
);
assert(
  read("src/app/context/AppLoadingManager.tsx").includes("completeHtmlBootAfterPublicPaint"),
  "HTML boot fade must wait for public route commit, not React mount",
);
assert(
  shellReady.includes("completeHtmlBootAfterPublicPaint"),
  "landing must fade HTML boot only after LandingPage commits",
);
assert(
  read("src/app/lib/htmlMarketingBootBridge.ts").includes("isCustomerJourneyPath"),
  "HTML boot retain must cover guest tip URLs as well as /",
);
assert(
  read("public/boot-locale.js").includes("installPublicLandingBootRetain"),
  "pre-React boot-locale must refuse HTML boot removal on / until landing commits",
);
assert(
  read("src/app/context/AppLoadingManager.tsx").includes(
    "HTML boot must stay until completeHtmlBootAfterPublicPaint",
  ),
  "React overlay exit must not dismiss HTML boot while / landing is still loading",
);
assert(
  read("src/app/context/AppLoadingManager.tsx").includes("requestAnimationFrame"),
  "HTML boot fade must wait for a landing paint frame, not an arbitrary timeout",
);
assert(
  read("public/_headers").includes("max-age=31536000, immutable"),
  "hashed assets must be immutable-cached in production headers",
);
assert(
  landingPage.includes("prefetchLandingBelowFoldSections"),
  "landing must prefetch below-fold sections only after LCP warm",
);
assert(
  read("src/app/pages/LandingPageBelowFold.tsx").includes("prefetchLandingBelowFoldSections"),
  "below-fold prefetch helper must exist",
);
const heroHost = read("src/components/landing/CareTipLandingHero.tsx");
assert(heroHost.includes('variant="background"'), "CareTipLandingHero uses background variant");
assert(
  !showcase.includes('loading="lazy"') && showcase.includes('loading="eager"'),
  "hero story frames must never use native lazy loading",
);
assert(
  showcase.includes("isLcpFrame") && showcase.includes('fetchpriority: "high"') && showcase.includes('fetchpriority: "low"'),
  "only the LCP hero frame may use fetchpriority high; the second frame stays low",
);

console.log("landing-hero-return-lifecycle: ok");
