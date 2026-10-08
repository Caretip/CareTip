/** Prefetch lazy public route chunks on hover/focus/idle — faster nav clicks. */

type RouteImporter = () => Promise<unknown>;

const PUBLIC_ROUTE_IMPORTERS: Record<string, RouteImporter> = {
  "/": () => import("../pages/LandingPage"),
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
  "/blog": () => import("../pages/BlogPage"),
  "/careers": () => import("../pages/CareersPage"),
  "/mobile-app": () => import("../pages/MobileAppPage"),
  "/avv": () => import("../pages/AvvPage"),
  "/plv": () => import("../pages/PlvPage"),
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

export function prefetchPublicRoute(path: string, options?: { warmImages?: boolean }) {
  const normalized = path.split("#")[0].split("?")[0];
  if (!normalized) return;
  const warmImages = options?.warmImages !== false;

  // Hover/focus may warm one industry hero. Idle route warming must not.
  if (warmImages && normalized.startsWith("/industries/")) {
    warmIndustryHeroAssets(normalized);
  }

  if (prefetched.has(normalized)) return;
  const factory = PUBLIC_ROUTE_IMPORTERS[normalized];
  if (!factory) return;
  prefetched.add(normalized);
  void factory();
  if (warmImages && normalized === "/") {
    warmLandingHeroAssets();
  }
}

/** Warm the landing page chunk + LCP hero image for instant returns to `/`. */
export function prefetchLandingRoute(): void {
  prefetchPublicRoute("/");
  warmLandingHeroAssets();
}

/** Core header nav — safe on mobile after landing is interactive. */
export function prefetchCoreMarketingNavRoutes() {
  for (const path of ["/features", "/pricing", "/faq"]) {
    prefetchPublicRoute(path);
  }
}

/** Desktop idle — secondary route chunks only. Images wait for hover or the homepage. */
export function prefetchExtendedMarketingNavRoutes() {
  for (const path of ["/contact", "/about", "/login", "/signup"]) {
    prefetchPublicRoute(path, { warmImages: false });
  }
  for (const path of [
    "/industries/gastronomy",
    "/industries/hotels",
    "/industries/midwives",
    "/industries/field-service",
  ]) {
    prefetchPublicRoute(path, { warmImages: false });
  }
}

/** Warm high-traffic nav targets after landing is idle. */
export function prefetchPrimaryNavRoutes() {
  prefetchCoreMarketingNavRoutes();
  prefetchExtendedMarketingNavRoutes();
}
