import type { ResolvedRouteSeo } from "./resolveRouteSeo";
import type { SeoRouteMatch } from "./seoRoutes";
import { buildPublicSeoStaticMainHtml } from "./publicSeoStaticContent";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function replaceFirst(pattern: RegExp, html: string, replacement: string): string {
  if (!pattern.test(html)) return html;
  return html.replace(pattern, replacement);
}

function upsertMetaByName(html: string, name: string, content: string): string {
  const escaped = escapeHtml(content);
  const re = new RegExp(
    `<meta\\s+name="${name}"\\s+content="[^"]*"\\s*/>`,
    "i",
  );
  if (re.test(html)) {
    return html.replace(re, `<meta name="${name}" content="${escaped}" />`);
  }
  return html.replace(
    /<head>/i,
    `<head>\n    <meta name="${name}" content="${escaped}" />`,
  );
}

function upsertMetaByProperty(html: string, property: string, content: string): string {
  const escaped = escapeHtml(content);
  const re = new RegExp(
    `<meta\\s+property="${property}"\\s+content="[^"]*"\\s*/>`,
    "i",
  );
  if (re.test(html)) {
    return html.replace(re, `<meta property="${property}" content="${escaped}" />`);
  }
  return html.replace(
    /<head>/i,
    `<head>\n    <meta property="${property}" content="${escaped}" />`,
  );
}

function upsertCanonical(html: string, href: string): string {
  const escaped = escapeHtml(href);
  const re = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/i;
  if (re.test(html)) {
    return html.replace(re, `<link rel="canonical" href="${escaped}" />`);
  }
  return html.replace(
    /<head>/i,
    `<head>\n    <link rel="canonical" href="${escaped}" />`,
  );
}

function upsertTitle(html: string, title: string): string {
  const escaped = escapeHtml(title);
  return replaceFirst(/<title>[^<]*<\/title>/i, html, `<title>${escaped}</title>`);
}

function removeJsonLdBlocks(html: string): string {
  return html.replace(
    /<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\s*/gi,
    "",
  );
}

function buildJsonLdScripts(blocks: Record<string, unknown>[]): string {
  return blocks
    .map((block, index) => {
      const id = index === 0 ? "caretip-seo-jsonld" : `caretip-seo-jsonld-${index}`;
      return `    <script type="application/ld+json" id="${id}" data-caretip-seo="jsonld">${JSON.stringify(block)}</script>`;
    })
    .join("\n");
}

/** @deprecated Use buildPublicSeoStaticMainHtml — kept for tests importing this symbol. */
export function buildStaticCrawlerSummaryHtml(
  seo: ResolvedRouteSeo,
  match: SeoRouteMatch,
  t?: import("i18next").TFunction,
): string {
  if (!t) {
    const title = escapeHtml(seo.title);
    const description = escapeHtml(seo.description);
    return `<main id="caretip-static-summary" lang="de">
      <h1>${title}</h1>
      <p>${description}</p>
    </main>`;
  }
  return buildPublicSeoStaticMainHtml(seo, match, t);
}

/**
 * Applies resolved route SEO to the Vite index.html shell (build-time prerender).
 * Keeps a single canonical and aligns head tags with resolveRouteSeo / applyDocumentSeo.
 */
export function injectRouteSeoIntoHtml(
  html: string,
  seo: ResolvedRouteSeo,
  match: SeoRouteMatch,
  t?: import("i18next").TFunction,
): string {
  let out = html;
  out = upsertTitle(out, seo.title);
  out = upsertMetaByName(out, "description", seo.description);
  out = upsertMetaByName(out, "robots", seo.robots);
  out = upsertCanonical(out, seo.canonicalUrl);

  out = upsertMetaByProperty(out, "og:title", seo.og.title);
  out = upsertMetaByProperty(out, "og:description", seo.og.description);
  out = upsertMetaByProperty(out, "og:url", seo.og.url);
  out = upsertMetaByProperty(out, "og:image", seo.og.image);
  out = upsertMetaByProperty(out, "og:type", seo.og.type);
  out = upsertMetaByProperty(out, "og:site_name", seo.og.siteName);

  out = upsertMetaByName(out, "twitter:card", seo.twitter.card);
  out = upsertMetaByName(out, "twitter:title", seo.twitter.title);
  out = upsertMetaByName(out, "twitter:description", seo.twitter.description);
  out = upsertMetaByName(out, "twitter:image", seo.twitter.image);

  out = removeJsonLdBlocks(out);
  if (seo.jsonLd.length > 0) {
    const scripts = buildJsonLdScripts(seo.jsonLd);
    out = out.replace(/<\/head>/i, `${scripts}\n  </head>`);
  }

  const summary = t
    ? buildPublicSeoStaticMainHtml(seo, match, t)
    : buildStaticCrawlerSummaryHtml(seo, match);
  out = out.replace(
    /<main id="caretip-static-summary"[\s\S]*?<\/main>/i,
    summary,
  );

  return out;
}
