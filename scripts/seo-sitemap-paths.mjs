/**
 * Indexable public marketing + legal URLs for sitemap.xml generation.
 * Keep in sync with src/app/lib/seo/seoRoutes.ts (SITEMAP_PATHS).
 */

export const CARETIP_SEO_SITE_ORIGIN = (
  process.env.BASE_URL ||
  process.env.VITE_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://caretip.de"
)
  .replace(/\/+$/, "");

export const CARETIP_SITEMAP_PATHS = [
  "/",
  "/features",
  "/pricing",
  "/how-it-works",
  "/about",
  "/contact",
  "/faq",
  "/industries/gastronomy",
  "/industries/hotels",
  "/industries/logistics",
  "/industries/midwives",
  "/industries/fairs",
  "/industries/field-service",
  "/privacy",
  "/terms",
  "/cookies",
  "/imprint",
  "/avv",
  "/plv",
];
