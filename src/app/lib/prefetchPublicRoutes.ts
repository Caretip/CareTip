/** Prefetch lazy public route chunks on hover/focus/idle — faster nav clicks. */

type RouteImporter = () => Promise<unknown>;

const PUBLIC_ROUTE_IMPORTERS: Record<string, RouteImporter> = {
  "/": () => import("../pages/LandingPage"),
  "/how-it-works": () => import("../pages/HowItWorksPage"),
  "/features": () => import("../pages/FeaturesPage"),
  "/about": () => import("../pages/AboutPage"),
  "/pricing": () => import("../pages/PricingPage"),
  "/contact": () => import("../pages/ContactPage"),
  "/faq": () => import("../pages/FAQPage"),
  "/login": () => import("../components/AuthPage"),
  "/signup": () => import("../components/AuthPage"),
  "/privacy": () => import("../pages/PrivacyPage"),
  "/terms": () => import("../pages/TermsPage"),
  "/cookies": () => import("../pages/CookiesPage"),
  "/imprint": () => import("../pages/ImprintPage"),
  "/industries/gastronomy": () => import("../pages/IndustryPage"),
  "/industries/hotels": () => import("../pages/IndustryPage"),
  "/industries/logistics": () => import("../pages/IndustryPage"),
  "/industries/midwives": () => import("../pages/IndustryPage"),
  "/industries/fairs": () => import("../pages/IndustryPage"),
  "/industries/field-service": () => import("../pages/IndustryPage"),
};

const prefetched = new Set<string>();

function warmLandingHeroAssets(): void {
  void import("@/lib/landingHeroStoryAssets").then((mod) => {
    void mod.warmLandingHeroLcpImage();
  });
}

function warmIndustryHeroAssets(path: string): void {
  void import("@/lib/industryHeroAssets").then((mod) => {
    mod.warmIndustryHeroFromPath(path);
  });
}

export function prefetchPublicRoute(path: string) {
  const normalized = path.split("#")[0].split("?")[0];
  if (!normalized) return;

  // Industry heroes must re-warm on every hover — chunk prefetch alone is a no-op after first visit.
  if (normalized.startsWith("/industries/")) {
    warmIndustryHeroAssets(normalized);
  }

  if (prefetched.has(normalized)) return;
  const factory = PUBLIC_ROUTE_IMPORTERS[normalized];
  if (!factory) return;
  prefetched.add(normalized);
  void factory();
  if (normalized === "/") {
    warmLandingHeroAssets();
  }
}

/** Warm the landing page chunk + LCP hero image for instant returns to `/`. */
export function prefetchLandingRoute(): void {
  prefetchPublicRoute("/");
  warmLandingHeroAssets();
}

/** Warm high-traffic nav targets after landing is idle. */
export function prefetchPrimaryNavRoutes() {
  for (const path of ["/features", "/pricing", "/faq", "/contact", "/login", "/signup"]) {
    prefetchPublicRoute(path);
  }
  // Industry page chunk + heroes — hover then feels instant.
  for (const path of [
    "/industries/gastronomy",
    "/industries/hotels",
    "/industries/midwives",
    "/industries/field-service",
  ]) {
    prefetchPublicRoute(path);
  }
  void import("@/lib/industryHeroAssets").then((mod) => {
    mod.warmAllIndustryHeroesIdle();
  });
}
