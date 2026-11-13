import { Navigate, type RouteObject } from "react-router";
import { LandingPage } from "../pages/LandingPage";
import { routeLazy } from "./routeLazy";

/** Public marketing URLs — nested under {@link MarketingShellLayout} at `/`. */
export const marketingChildRoutes: RouteObject[] = [
  { index: true, Component: LandingPage },
  { path: "pricing", lazy: routeLazy(() => import("../pages/PricingPage"), "PricingPage") },
  { path: "privacy", lazy: routeLazy(() => import("../pages/PrivacyPage"), "PrivacyPage") },
  { path: "terms", lazy: routeLazy(() => import("../pages/TermsPage"), "TermsPage") },
  { path: "cookies", lazy: routeLazy(() => import("../pages/CookiesPage"), "CookiesPage") },
  { path: "imprint", lazy: routeLazy(() => import("../pages/ImprintPage"), "ImprintPage") },
  { path: "avv", lazy: routeLazy(() => import("../pages/AvvPage"), "AvvPage") },
  { path: "plv", lazy: routeLazy(() => import("../pages/PlvPage"), "PriceServicesListPage") },
  { path: "about", lazy: routeLazy(() => import("../pages/AboutPage"), "AboutPage") },
  { path: "contact", lazy: routeLazy(() => import("../pages/ContactPage"), "ContactPage") },
  // Placeholder roles and company stats (not real data): development only. Production sends /careers home.
  import.meta.env.DEV
    ? { path: "careers", lazy: routeLazy(() => import("../pages/CareersPage"), "CareersPage") }
    : { path: "careers", element: <Navigate to="/" replace /> },
  // Placeholder articles with no working actions: development only. Production sends /blog home.
  import.meta.env.DEV
    ? { path: "blog", lazy: routeLazy(() => import("../pages/BlogPage"), "BlogPage") }
    : { path: "blog", element: <Navigate to="/" replace /> },
  { path: "faq", lazy: routeLazy(() => import("../pages/FAQPage"), "FAQPage") },
  // Placeholder store stats and download buttons with no target: development only.
  import.meta.env.DEV
    ? { path: "mobile-app", lazy: routeLazy(() => import("../pages/MobileAppPage"), "MobileAppPage") }
    : { path: "mobile-app", element: <Navigate to="/" replace /> },
  { path: "features", lazy: routeLazy(() => import("../pages/FeaturesPage"), "FeaturesPage") },
  { path: "industries/events", element: <Navigate to="/industries/fairs" replace /> },
  {
    path: "industries/:industryId",
    lazy: routeLazy(() => import("../pages/IndustryPage"), "IndustryPage"),
  },
];
