import type { TFunction } from "i18next";
import type { ResolvedRouteSeo } from "./resolveRouteSeo";
import type { SeoPageKey, SeoRouteMatch } from "./seoRoutes";
import { parseStaticFaqItems } from "./faqStaticContent";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripSimpleHtml(text: string): string {
  return text.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim();
}

function paragraph(text: string): string {
  const normalized = text.replace(/\n+/g, " ").trim();
  if (!normalized) return "";
  return `<p>${escapeHtml(normalized)}</p>`;
}

function sectionArticles(
  items: Array<{ title: string; body: string }>,
  sectionLabel: string,
): string {
  if (items.length === 0) return "";
  const articles = items
    .map(
      (item) =>
        `      <article>
        <h2>${escapeHtml(item.title)}</h2>
        ${paragraph(item.body)}
      </article>`,
    )
    .join("\n");
  return `    <section aria-label="${escapeHtml(sectionLabel)}">\n${articles}\n    </section>`;
}

function defaultPageBody(seo: ResolvedRouteSeo): string {
  return `      <h1>${escapeHtml(seo.title)}</h1>\n      ${paragraph(seo.description)}`;
}

function buildHomeStaticContent(): string {
  return `      <h1>CareTip — Digitale Trinkgeld-Plattform</h1>
      <p>
        Trinkgeld per QR-Code, schnell, kontaktlos und steuerfrei. CareTip ist die digitale
        Trinkgeld-Plattform für Gastgewerbe und Service-Teams. Gäste geben per QR-Code Trinkgeld,
        Mitarbeitende behalten den Überblick, Betriebe verwalten Auszahlungen und Verteilung sicher.
      </p>
      <p lang="en">
        CareTip is a digital tipping platform for hospitality and service teams. Guests tip via QR
        code, employees track earnings, and businesses manage tip distribution and secure payouts.
      </p>
      <nav aria-label="CareTip">
        <a href="/features">Funktionen</a> ·
        <a href="/faq">FAQ</a> ·
        <a href="/industries/gastronomy">Gastronomie</a> ·
        <a href="/industries/hotels">Hotels</a> ·
        <a href="/pricing">Preise</a> ·
        <a href="/contact">Kontakt</a>
      </nav>`;
}

function buildFaqStaticContent(seo: ResolvedRouteSeo, t: TFunction): string {
  const subtitle = t("staticPages.faq.pageSubtitle");
  const items = parseStaticFaqItems(t);
  const faqSection = sectionArticles(
    items.map((item) => ({ title: item.question, body: item.answer })),
    t("staticPages.faq.pageEyebrow"),
  );
  return `      <h1>${escapeHtml(seo.title)}</h1>
      ${paragraph(subtitle)}
      ${faqSection}`;
}

function buildFeaturesStaticContent(seo: ResolvedRouteSeo, t: TFunction): string {
  const lead = t("landing.features.subtitle");
  const items = ([1, 2, 3, 4, 5, 6] as const).map((n) => ({
    title: t(`landing.features.i${n}Title`),
    body: t(`landing.features.i${n}Text`),
  }));
  return `      <h1>${escapeHtml(seo.title)}</h1>
      ${paragraph(lead)}
      ${sectionArticles(items, t("nav.features"))}`;
}

function buildPricingStaticContent(seo: ResolvedRouteSeo, t: TFunction): string {
  const subtitle = t("staticPages.pricing.pageSubtitle");
  const highlights = (["stripe", "ready", "gdpr", "trial"] as const).map((key) => ({
    title: t(`staticPages.pricing.hero.features.${key}.title`),
    body: t(`staticPages.pricing.hero.features.${key}.body`),
  }));
  return `      <h1>${escapeHtml(seo.title)}</h1>
      ${paragraph(subtitle)}
      ${sectionArticles(highlights, t("staticPages.pricing.plansAria"))}`;
}

function buildAboutStaticContent(seo: ResolvedRouteSeo, t: TFunction): string {
  const story = [
    t("staticPages.about.story.p1"),
    t("staticPages.about.story.p2"),
    t("staticPages.about.story.p3"),
    t("staticPages.about.story.p4"),
  ];
  const missions = [
    { title: t("staticPages.about.missionSection.m1Title"), body: t("staticPages.about.missionSection.m1Body") },
    { title: t("staticPages.about.missionSection.m2Title"), body: t("staticPages.about.missionSection.m2Body") },
    { title: t("staticPages.about.missionSection.m3Title"), body: t("staticPages.about.missionSection.m3Body") },
  ];
  return `      <h1>${escapeHtml(seo.title)}</h1>
      ${story.map((p) => paragraph(p)).join("\n      ")}
      ${sectionArticles(missions, t("staticPages.about.missionSection.title"))}`;
}

function buildContactStaticContent(seo: ResolvedRouteSeo, t: TFunction): string {
  const headline = stripSimpleHtml(t("staticPages.contact.headline"));
  const supporting = t("staticPages.contact.supportingText");
  const intents = ["demo", "support", "sales"] as const;
  const items = intents.map((id) => ({
    title: t(`staticPages.contact.intent.${id}.title`),
    body: t(`staticPages.contact.intent.${id}.description`),
  }));
  return `      <h1>${escapeHtml(headline || seo.title)}</h1>
      ${paragraph(supporting)}
      ${sectionArticles(items, t("staticPages.contact.servicesAria"))}`;
}

function buildIndustryStaticContent(seo: ResolvedRouteSeo, match: SeoRouteMatch, t: TFunction): string {
  const id = match.industryId;
  if (!id) return defaultPageBody(seo);
  const prefix = `industries.pages.${id}`;
  const headline = t(`${prefix}.headline`);
  const subhead = t(`${prefix}.subhead`);
  const steps = (["s1", "s2", "s3"] as const).map((key) => ({
    title: t(`${prefix}.steps.${key}Title`),
    body: t(`${prefix}.steps.${key}Body`),
  }));
  const faq = [
    { title: t(`${prefix}.faq.q1`), body: t(`${prefix}.faq.a1`) },
    { title: t(`${prefix}.faq.q2`), body: t(`${prefix}.faq.a2`) },
  ].filter((item) => item.title && item.body);
  return `      <h1>${escapeHtml(headline)}</h1>
      ${paragraph(subhead)}
      ${sectionArticles(steps, t(`${prefix}.stepsTitle`))}
      ${sectionArticles(faq, "FAQ")}`;
}

function buildLegalStaticContent(seo: ResolvedRouteSeo, t: TFunction, pageKey: SeoPageKey): string {
  const noteKey = `staticPages.legal.${pageKey}PrerenderNote`;
  const note = t(noteKey, { defaultValue: "" });
  const extra = note && note !== noteKey ? paragraph(note) : "";
  return `      <h1>${escapeHtml(seo.title)}</h1>
      ${paragraph(seo.description)}
      ${extra}`;
}

/**
 * Build-time public body HTML inside #caretip-static-summary (German — matches index.html lang).
 * Removed on client hydration; must mirror public i18n sources, not private APIs.
 */
export function buildPublicSeoStaticMainHtml(
  seo: ResolvedRouteSeo,
  match: SeoRouteMatch,
  t: TFunction,
): string {
  let inner: string;
  switch (match.pageKey) {
    case "home":
      inner = buildHomeStaticContent();
      break;
    case "faq":
      inner = buildFaqStaticContent(seo, t);
      break;
    case "features":
      inner = buildFeaturesStaticContent(seo, t);
      break;
    case "pricing":
      inner = buildPricingStaticContent(seo, t);
      break;
    case "about":
      inner = buildAboutStaticContent(seo, t);
      break;
    case "contact":
      inner = buildContactStaticContent(seo, t);
      break;
    case "industry":
      inner = buildIndustryStaticContent(seo, match, t);
      break;
    case "privacy":
    case "terms":
    case "cookies":
    case "imprint":
    case "avv":
    case "plv":
      inner = buildLegalStaticContent(seo, t, match.pageKey);
      break;
    default:
      inner = defaultPageBody(seo);
  }

  return `<main id="caretip-static-summary" lang="de">\n${inner}\n    </main>`;
}

/** Regression helper: detect metadata-only shells (title + single meta paragraph). */
export function staticSummaryHasSubstantiveContent(html: string): boolean {
  const summary = html.match(/<main id="caretip-static-summary"[\s\S]*?<\/main>/i)?.[0];
  if (!summary) return false;
  const articleCount = (summary.match(/<article>/gi) ?? []).length;
  if (articleCount >= 2) return true;
  const h2Count = (summary.match(/<h2>/gi) ?? []).length;
  if (h2Count >= 2) return true;
  const pCount = (summary.match(/<p>/gi) ?? []).length;
  return pCount >= 3;
}
