import type { TFunction } from "i18next";
import { getAppPublicBaseUrl } from "@/app/lib/appPublicUrl";
import type { SeoRouteMatch } from "./seoRoutes";

const ORG_LOGO = "/brand/caretip-logo-tagline.png";

function siteOrigin(): string {
  return getAppPublicBaseUrl() || "https://caretip.de";
}

function absoluteUrl(path: string): string {
  const origin = siteOrigin().replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

export function buildOrganizationJsonLd(): Record<string, unknown> {
  const origin = siteOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "CareTip",
    url: origin,
    logo: absoluteUrl(ORG_LOGO),
  };
}

export function buildSoftwareApplicationJsonLd(t: TFunction): Record<string, unknown> {
  const origin = siteOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "CareTip",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: origin,
    description: t("seo.pages.home.description"),
  };
}

export function buildFaqPageJsonLd(t: TFunction): Record<string, unknown> | null {
  const raw = t("staticPages.faq.items", { returnObjects: true });
  if (!Array.isArray(raw)) return null;
  const entities = raw
    .filter((item): item is { q: string; a?: string; aLead?: string; aBody?: string } => {
      return typeof item === "object" && item !== null && "q" in item && typeof item.q === "string";
    })
    .map((item) => {
      const answer =
        item.a ??
        (item.aLead && item.aBody ? `${item.aLead} ${item.aBody}` : "");
      if (!answer.trim()) return null;
      return {
        "@type": "Question",
        name: item.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      };
    })
    .filter(Boolean);

  if (entities.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entities,
  };
}

export function buildBreadcrumbJsonLd(
  match: SeoRouteMatch,
  t: TFunction,
): Record<string, unknown> | null {
  if (match.pageKey === "industry" && match.industryId) {
    const label = t(`nav.industriesMenu.${match.industryId}`);
    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: t("seo.breadcrumb.home"),
          item: absoluteUrl("/"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: label,
          item: absoluteUrl(match.pathname),
        },
      ],
    };
  }
  return null;
}

export function buildJsonLdForRoute(match: SeoRouteMatch, t: TFunction): Record<string, unknown>[] {
  if (!match.indexable) return [];

  const blocks: Record<string, unknown>[] = [];

  if (match.pageKey === "home") {
    blocks.push(buildOrganizationJsonLd(), buildSoftwareApplicationJsonLd(t));
  }

  if (match.pageKey === "faq") {
    const faq = buildFaqPageJsonLd(t);
    if (faq) blocks.push(faq);
  }

  const breadcrumb = buildBreadcrumbJsonLd(match, t);
  if (breadcrumb) blocks.push(breadcrumb);

  return blocks;
}
