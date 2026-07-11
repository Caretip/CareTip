/** Prefetch lazy public route chunks on hover/focus/idle — faster nav clicks. */

type RouteImporter = () => Promise<unknown>;

const PUBLIC_ROUTE_IMPORTERS: Record<string, RouteImporter> = {
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
};

const prefetched = new Set<string>();

export function prefetchPublicRoute(path: string) {
  const normalized = path.split("#")[0].split("?")[0];
  if (!normalized || prefetched.has(normalized)) return;
  const factory = PUBLIC_ROUTE_IMPORTERS[normalized];
  if (!factory) return;
  prefetched.add(normalized);
  void factory();
}

/** Warm high-traffic nav targets after landing is idle. */
export function prefetchPrimaryNavRoutes() {
  for (const path of ["/features", "/pricing", "/faq", "/contact", "/login", "/signup"]) {
    prefetchPublicRoute(path);
  }
}
