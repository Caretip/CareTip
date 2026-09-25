import type { ResolvedRouteSeo } from "./resolveRouteSeo";

const MANAGED = "data-caretip-seo";
const JSON_LD_ID = "caretip-seo-jsonld";

function upsertMeta(
  key: string,
  content: string,
  kind: "name" | "property",
): void {
  if (typeof document === "undefined") return;
  const selector =
    kind === "name"
      ? `meta[${MANAGED}][name="${key}"]`
      : `meta[${MANAGED}][property="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(MANAGED, "1");
    if (kind === "name") el.setAttribute("name", key);
    else el.setAttribute("property", key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string): void {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector<HTMLLinkElement>(`link[${MANAGED}][rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute(MANAGED, "1");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function removeManagedJsonLd(): void {
  document.querySelectorAll(`script[${MANAGED}="jsonld"]`).forEach((node) => node.remove());
}

function applyJsonLd(blocks: Record<string, unknown>[]): void {
  removeManagedJsonLd();
  blocks.forEach((block, index) => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute(MANAGED, "jsonld");
    script.id = index === 0 ? JSON_LD_ID : `${JSON_LD_ID}-${index}`;
    script.textContent = JSON.stringify(block);
    document.head.appendChild(script);
  });
}

export function applyDocumentSeo(seo: ResolvedRouteSeo): void {
  if (typeof document === "undefined") return;

  document.title = seo.title;
  document.documentElement.lang = document.documentElement.lang || "de";

  upsertMeta("description", seo.description, "name");
  upsertMeta("robots", seo.robots, "name");
  upsertLink("canonical", seo.canonicalUrl);

  upsertMeta("og:title", seo.og.title, "property");
  upsertMeta("og:description", seo.og.description, "property");
  upsertMeta("og:url", seo.og.url, "property");
  upsertMeta("og:image", seo.og.image, "property");
  upsertMeta("og:type", seo.og.type, "property");
  upsertMeta("og:site_name", seo.og.siteName, "property");

  upsertMeta("twitter:card", seo.twitter.card, "name");
  upsertMeta("twitter:title", seo.twitter.title, "name");
  upsertMeta("twitter:description", seo.twitter.description, "name");
  upsertMeta("twitter:image", seo.twitter.image, "name");

  applyJsonLd(seo.jsonLd);
}

export function removeStaticCrawlerSummary(): void {
  document.getElementById("caretip-static-summary")?.remove();
}
