import type { TFunction } from "i18next";
import { getAppPublicBaseUrl } from "@/app/lib/appPublicUrl";
import { buildJsonLdForRoute } from "./structuredData";
import {
  matchSeoRoute,
  resolveCanonicalPathname,
  type SeoPageKey,
  type SeoRouteMatch,
} from "./seoRoutes";

export type ResolvedRouteSeo = {
  title: string;
  description: string;
  canonicalUrl: string;
  robots: "index,follow" | "noindex,nofollow";
  og: {
    title: string;
    description: string;
    url: string;
    image: string;
    type: string;
    siteName: string;
  };
  twitter: {
    card: "summary_large_image";
    title: string;
    description: string;
    image: string;
  };
  jsonLd: Record<string, unknown>[];
};

const OG_IMAGE_PATH = "/brand/caretip-logo-tagline.png";

function absoluteOrigin(): string {
  const fromEnv = getAppPublicBaseUrl();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "https://caretip.de";
}

function absoluteAsset(path: string): string {
  return `${absoluteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

function canonicalUrl(pathname: string, search: string): string {
  const canonicalPath = resolveCanonicalPathname(pathname, search);
  const origin = absoluteOrigin();
  if (canonicalPath.startsWith("http")) return canonicalPath;
  return `${origin}${canonicalPath.startsWith("/") ? canonicalPath : `/${canonicalPath}`}`;
}

function pageCopyKey(match: SeoRouteMatch): string {
  if (match.pageKey === "industry" && match.industryId) {
    return `seo.industries.${match.industryId}`;
  }
  if (match.pageKey === "notFound") return "seo.pages.notFound";
  if (match.pageKey === "private") return "seo.pages.private";
  return `seo.pages.${match.pageKey}`;
}

function resolveTitleDescription(
  match: SeoRouteMatch,
  t: TFunction,
): { title: string; description: string } {
  const baseKey = pageCopyKey(match);
  const title = t(`${baseKey}.title`, { defaultValue: t("seo.pages.fallback.title") });
  const description = t(`${baseKey}.description`, {
    defaultValue: t("seo.pages.fallback.description"),
  });
  return { title, description };
}

export function resolveRouteSeo(
  pathname: string,
  search: string,
  t: TFunction,
  overrides?: Partial<Pick<ResolvedRouteSeo, "title" | "description" | "robots">>,
): ResolvedRouteSeo {
  const match = matchSeoRoute(pathname);
  const { title: baseTitle, description: baseDescription } = resolveTitleDescription(match, t);
  const title = overrides?.title ?? baseTitle;
  const description = overrides?.description ?? baseDescription;
  const canonical = canonicalUrl(pathname, search);
  const robots =
    overrides?.robots ?? (match.indexable ? "index,follow" : "noindex,nofollow");
  const image = absoluteAsset(OG_IMAGE_PATH);
  const siteName = t("seo.siteName");

  return {
    title,
    description,
    canonicalUrl: canonical,
    robots,
    og: {
      title,
      description,
      url: canonical,
      image,
      type: "website",
      siteName,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      image,
    },
    jsonLd: buildJsonLdForRoute(match, t),
  };
}

export function resolveForcedNoindexSeo(pathname: string, search: string, t: TFunction): ResolvedRouteSeo {
  return resolveRouteSeo(pathname, search, t, { robots: "noindex,nofollow" });
}

export type { SeoPageKey, SeoRouteMatch } from "./seoRoutes";
