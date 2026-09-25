/**
 * DOM regression checks for SEO head tag reconciliation.
 *
 *   npm run test:seo-head-reconciliation
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedRouteSeo } from "../src/app/lib/seo/resolveRouteSeo.ts";
import { applyDocumentSeo } from "../src/app/lib/seo/documentSeo.ts";
import en from "../src/i18n/locales/en.json";
import de from "../src/i18n/locales/de.json";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OG_IMAGE = "https://caretip.de/brand/caretip-logo-tagline.png";

type LocaleBundle = typeof en;

function buildSeo(
  title: string,
  description: string,
  canonicalUrl: string,
  robots: ResolvedRouteSeo["robots"],
): ResolvedRouteSeo {
  return {
    title,
    description,
    canonicalUrl,
    robots,
    og: {
      title,
      description,
      url: canonicalUrl,
      image: OG_IMAGE,
      type: "website",
      siteName: "CareTip",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      image: OG_IMAGE,
    },
    jsonLd: [],
  };
}

/** Minimal DOM head stub — supports selectors used by documentSeo.ts */
class TestElement {
  tagName: string;
  attributes = new Map<string, string>();
  parent: TestHead | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  remove(): void {
    this.parent?.removeChild(this);
  }
}

class TestHead {
  children: TestElement[] = [];

  appendChild(el: TestElement): TestElement {
    el.parent = this;
    this.children.push(el);
    return el;
  }

  removeChild(el: TestElement): void {
    const idx = this.children.indexOf(el);
    if (idx >= 0) this.children.splice(idx, 1);
    el.parent = null;
  }

  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestElement[] {
    return this.children.filter((el) => matchesSelector(el, selector));
  }
}

function parseSelector(selector: string): {
  tag: string | null;
  attrs: Record<string, string>;
  notAttrs: string[];
} {
  const notAttrs: string[] = [];
  let rest = selector;
  const notMatch = rest.match(/:not\(\[([^\]]+)\]\)/);
  if (notMatch) {
    notAttrs.push(notMatch[1]!);
    rest = rest.replace(/:not\(\[[^\]]+\]\)/, "");
  }
  const tag = rest.match(/^([a-z]+)/)?.[1]?.toUpperCase() ?? null;
  const attrs: Record<string, string> = {};
  for (const m of rest.matchAll(/\[(?:([a-zA-Z0-9:_-]+)(?:="([^"]*)")?)\]/g)) {
    attrs[m[1]!] = m[2] ?? "";
  }
  return { tag, attrs, notAttrs };
}

function matchesSelector(el: TestElement, selector: string): boolean {
  const { tag, attrs, notAttrs } = parseSelector(selector);
  if (tag && el.tagName !== tag) return false;
  for (const notAttr of notAttrs) {
    if (el.attributes.has(notAttr)) return false;
  }
  for (const [name, value] of Object.entries(attrs)) {
    if (!el.attributes.has(name)) return false;
    if (value !== "" && el.attributes.get(name) !== value) return false;
  }
  return true;
}

function createMeta(attrs: Record<string, string>): TestElement {
  const el = new TestElement("meta");
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  return el;
}

function createLink(attrs: Record<string, string>): TestElement {
  const el = new TestElement("link");
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  return el;
}

function seedStaticIndexHtmlHead(head: TestHead): void {
  head.appendChild(
    createMeta({
      name: "description",
      content:
        "CareTip ist die digitale Trinkgeld-Plattform für Gastgewerbe: QR-Trinkgeld, Mitarbeiter-Verwaltung und sichere Auszahlungen.",
    }),
  );
  head.appendChild(createMeta({ name: "robots", content: "index,follow" }));
  head.appendChild(createLink({ rel: "canonical", href: "https://caretip.de/" }));
  head.appendChild(
    createMeta({ property: "og:title", content: "CareTip — Digitale Trinkgeld-Plattform" }),
  );
  head.appendChild(
    createMeta({
      property: "og:description",
      content:
        "CareTip ist die digitale Trinkgeld-Plattform für Restaurants, Hotels und Service-Teams.",
    }),
  );
  head.appendChild(createMeta({ property: "og:url", content: "https://caretip.de/" }));
  head.appendChild(createMeta({ property: "og:type", content: "website" }));
  head.appendChild(createMeta({ property: "og:site_name", content: "CareTip" }));
  head.appendChild(createMeta({ property: "og:image", content: OG_IMAGE }));
  head.appendChild(createMeta({ name: "twitter:card", content: "summary_large_image" }));
  head.appendChild(
    createMeta({ name: "twitter:title", content: "CareTip — Digitale Trinkgeld-Plattform" }),
  );
  head.appendChild(
    createMeta({
      name: "twitter:description",
      content:
        "CareTip ist die digitale Trinkgeld-Plattform für Restaurants, Hotels und Service-Teams.",
    }),
  );
  head.appendChild(createMeta({ name: "twitter:image", content: OG_IMAGE }));
}

function installDom(head: TestHead): () => void {
  const htmlEl = {
    lang: "de",
    setAttribute(name: string, value: string) {
      if (name === "lang") this.lang = value;
    },
  };
  const doc = {
    head,
    title: "",
    documentElement: htmlEl,
    createElement(tag: string) {
      return tag.toLowerCase() === "meta"
        ? new TestElement("meta")
        : tag.toLowerCase() === "link"
          ? new TestElement("link")
          : new TestElement(tag);
    },
    querySelector(selector: string) {
      if (selector.startsWith("script[")) {
        return null;
      }
      return head.querySelector(selector);
    },
    querySelectorAll(selector: string) {
      if (selector.startsWith("script[")) {
        return [];
      }
      return head.querySelectorAll(selector);
    },
    getElementById() {
      return null;
    },
  };
  (globalThis as { document?: typeof doc }).document = doc;
  return () => {
    delete (globalThis as { document?: unknown }).document;
  };
}

function metaContent(head: TestHead, name: string): string | undefined {
  return head.querySelector(`meta[name="${name}"]`)?.attributes.get("content");
}

function ogContent(head: TestHead, property: string): string | undefined {
  return head.querySelector(`meta[property="${property}"]`)?.attributes.get("content");
}

function canonicalHref(head: TestHead): string | undefined {
  return head.querySelector('link[rel="canonical"]')?.attributes.get("href");
}

function testFeaturesEn(): void {
  const head = new TestHead();
  const cleanup = installDom(head);
  seedStaticIndexHtmlHead(head);

  applyDocumentSeo(
    buildSeo(
      en.seo.pages.features.title,
      en.seo.pages.features.description,
      "https://caretip.de/features",
      "index,follow",
    ),
  );

  assert.equal(head.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(canonicalHref(head), "https://caretip.de/features");
  assert.equal(head.querySelectorAll('meta[name="description"]').length, 1);
  assert.equal(metaContent(head, "description"), en.seo.pages.features.description);
  assert.equal(head.querySelectorAll('meta[name="robots"]').length, 1);
  assert.equal(metaContent(head, "robots"), "index,follow");
  assert.equal(ogContent(head, "og:url"), "https://caretip.de/features");
  assert.equal(ogContent(head, "og:title"), en.seo.pages.features.title);
  assert.equal(ogContent(head, "og:description"), en.seo.pages.features.description);
  assert.equal(metaContent(head, "twitter:title"), en.seo.pages.features.title);
  assert.equal(metaContent(head, "twitter:description"), en.seo.pages.features.description);
  assert.equal(head.querySelector('link[rel="canonical"]')?.getAttribute("data-caretip-seo"), "1");

  cleanup();
}

function testLoginNoindex(): void {
  const head = new TestHead();
  const cleanup = installDom(head);
  seedStaticIndexHtmlHead(head);

  applyDocumentSeo(
    buildSeo(
      en.seo.pages.private.title,
      en.seo.pages.private.description,
      "https://caretip.de/login",
      "noindex,nofollow",
    ),
  );

  assert.equal(head.querySelectorAll('meta[name="robots"]').length, 1);
  assert.equal(metaContent(head, "robots"), "noindex,nofollow");

  cleanup();
}

function testHomepageCanonical(): void {
  const head = new TestHead();
  const cleanup = installDom(head);
  seedStaticIndexHtmlHead(head);

  applyDocumentSeo(
    buildSeo(
      en.seo.pages.home.title,
      en.seo.pages.home.description,
      "https://caretip.de/",
      "index,follow",
    ),
  );

  assert.equal(head.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(canonicalHref(head), "https://caretip.de/");

  cleanup();
}

function testFeaturesDeLocale(): void {
  const head = new TestHead();
  const cleanup = installDom(head);
  seedStaticIndexHtmlHead(head);

  applyDocumentSeo(
    buildSeo(
      de.seo.pages.features.title,
      de.seo.pages.features.description,
      "https://caretip.de/features",
      "index,follow",
    ),
  );

  assert.equal(metaContent(head, "description"), de.seo.pages.features.description);
  assert.equal(ogContent(head, "og:title"), de.seo.pages.features.title);
  assert.equal(metaContent(head, "twitter:description"), de.seo.pages.features.description);

  cleanup();
}

function testFaqCanonicalQueryStripping(): void {
  const head = new TestHead();
  const cleanup = installDom(head);
  seedStaticIndexHtmlHead(head);

  applyDocumentSeo(
    buildSeo(
      en.seo.pages.faq.title,
      en.seo.pages.faq.description,
      "https://caretip.de/faq",
      "index,follow",
    ),
  );

  assert.equal(canonicalHref(head), "https://caretip.de/faq");
  assert.equal(head.querySelectorAll('link[rel="canonical"]').length, 1);

  cleanup();
}

function testMarketingRoutesCanonical(): void {
  const cases: Array<{ path: string; title: string; description: string }> = [
    {
      path: "/pricing",
      title: en.seo.pages.pricing.title,
      description: en.seo.pages.pricing.description,
    },
    {
      path: "/how-it-works",
      title: en.seo.pages.howItWorks.title,
      description: en.seo.pages.howItWorks.description,
    },
    {
      path: "/about",
      title: en.seo.pages.about.title,
      description: en.seo.pages.about.description,
    },
    {
      path: "/contact",
      title: en.seo.pages.contact.title,
      description: en.seo.pages.contact.description,
    },
    {
      path: "/industries/gastronomy",
      title: en.seo.industries.gastronomy.title,
      description: en.seo.industries.gastronomy.description,
    },
  ];

  for (const { path: pathname, title, description } of cases) {
    const head = new TestHead();
    const cleanup = installDom(head);
    seedStaticIndexHtmlHead(head);
    applyDocumentSeo(
      buildSeo(title, description, `https://caretip.de${pathname}`, "index,follow"),
    );
    assert.equal(head.querySelectorAll('link[rel="canonical"]').length, 1);
    assert.equal(canonicalHref(head), `https://caretip.de${pathname}`);
    cleanup();
  }
}

function testDashboardAndEmployeeNoindex(): void {
  for (const pathname of ["/dashboard", "/employee/dashboard"]) {
    const head = new TestHead();
    const cleanup = installDom(head);
    seedStaticIndexHtmlHead(head);
    applyDocumentSeo(
      buildSeo(
        en.seo.pages.private.title,
        en.seo.pages.private.description,
        `https://caretip.de${pathname}`,
        "noindex,nofollow",
      ),
    );
    assert.equal(head.querySelectorAll('meta[name="robots"]').length, 1);
    assert.equal(metaContent(head, "robots"), "noindex,nofollow");
    cleanup();
  }
}

function testIndexHtmlStillHasStaticTagsForBootstrap(): void {
  const indexHtml = readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /<link rel="canonical" href="https:\/\/caretip\.de\/"\s*\/>/);
  assert.match(indexHtml, /<meta\s+name="description"/);
  assert.match(indexHtml, /<meta\s+name="robots"\s+content="index,follow"\s*\/>/);
}

function run(): void {
  testFeaturesEn();
  testLoginNoindex();
  testHomepageCanonical();
  testFeaturesDeLocale();
  testFaqCanonicalQueryStripping();
  testMarketingRoutesCanonical();
  testDashboardAndEmployeeNoindex();
  testIndexHtmlStillHasStaticTagsForBootstrap();
  console.log("seo-head-reconciliation-runtime: ok");
}

run();
