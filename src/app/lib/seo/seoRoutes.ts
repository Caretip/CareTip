/**
 * Central SEO route classification — keep sitemap list aligned with scripts/seo-sitemap-paths.mjs
 */

import { isIndustryPageId, type IndustryPageId } from "@/app/data/industryPages";
import { isPublicBusinessSlugPath } from "@/app/lib/publicRoutes";

export const SITEMAP_PATHS = [
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
] as const;

export type SeoPageKey =
  | "home"
  | "features"
  | "pricing"
  | "howItWorks"
  | "about"
  | "contact"
  | "faq"
  | "privacy"
  | "terms"
  | "cookies"
  | "imprint"
  | "avv"
  | "plv"
  | "industry"
  | "blog"
  | "careers"
  | "mobileApp"
  | "notFound"
  | "private";

export type SeoRouteMatch = {
  pageKey: SeoPageKey;
  pathname: string;
  industryId?: IndustryPageId;
  indexable: boolean;
};

const INDEXABLE_EXACT: Record<string, SeoPageKey> = {
  "/": "home",
  "/features": "features",
  "/pricing": "pricing",
  "/how-it-works": "howItWorks",
  "/about": "about",
  "/contact": "contact",
  "/faq": "faq",
  "/privacy": "privacy",
  "/terms": "terms",
  "/cookies": "cookies",
  "/imprint": "imprint",
  "/avv": "avv",
  "/plv": "plv",
  "/blog": "blog",
  "/careers": "careers",
  "/mobile-app": "mobileApp",
};

/** Placeholder marketing pages — keep out of sitemap; noindex until content is production-ready. */
const PLACEHOLDER_NOINDEX = new Set<SeoPageKey>(["blog", "careers", "mobileApp"]);

const NOINDEX_PREFIXES = [
  "/dashboard",
  "/employee",
  "/employee-dashboard",
  "/platform-admin",
  "/admin",
  "/login",
  "/auth",
  "/signup",
  "/join",
  "/employee/login",
  "/business/login",
  "/forgot-password",
  "/reset-password",
  "/activate",
  "/verify",
  "/verify-email",
  "/check-email",
  "/mobile-auth",
  "/onboarding",
  "/awaiting-approval",
  "/verification-pending",
  "/subscription",
  "/payment",
  "/tip-amount",
  "/success",
  "/rating",
  "/tip-complete",
  "/qr",
  "/qr-landing",
  "/table",
  "/staff",
  "/hero-demo",
  "/hero-animation-demo",
  "/saas-3d-hero",
  "/unauthorized",
  "/get-started",
  "/select-employee",
  "/create-rule",
  "/create-skill",
  "/help",
  "/dpa",
];

function normalizePathname(pathname: string): string {
  const base = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (!base || base === "") return "/";
  if (base.length > 1 && base.endsWith("/")) return base.slice(0, -1);
  return base;
}

function matchesNoindexPrefix(pathname: string): boolean {
  return NOINDEX_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function matchSeoRoute(pathname: string): SeoRouteMatch {
  const path = normalizePathname(pathname);
  const exact = INDEXABLE_EXACT[path];
  if (exact) {
    return {
      pageKey: exact,
      pathname: path,
      indexable: !PLACEHOLDER_NOINDEX.has(exact),
    };
  }

  const industryMatch = /^\/industries\/([^/]+)$/.exec(path);
  if (industryMatch) {
    const rawId = industryMatch[1] ?? "";
    if (isIndustryPageId(rawId)) {
      return { pageKey: "industry", pathname: path, industryId: rawId, indexable: true };
    }
    return { pageKey: "notFound", pathname: path, indexable: false };
  }

  if (matchesNoindexPrefix(path) || isPublicBusinessSlugPath(path)) {
    return { pageKey: "private", pathname: path, indexable: false };
  }

  return { pageKey: "notFound", pathname: path, indexable: false };
}

/** Canonical path without tracking/query noise. */
export function resolveCanonicalPathname(pathname: string, search: string): string {
  const path = normalizePathname(pathname);
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete("lang");
  if (path === "/contact") {
    params.delete("intent");
    params.delete("plan");
  }
  if (path === "/faq") {
    params.delete("q");
  }
  const remainder = params.toString();
  return remainder ? `${path}?${remainder}` : path;
}
