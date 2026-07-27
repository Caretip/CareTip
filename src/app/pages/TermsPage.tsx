import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "@/styles/bundles/marketing-pages.css";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { LegalDocumentsSidebar } from "@/components/public/legal/LegalDocumentsSidebar";
import { LegalSectionBody } from "@/components/public/legal/LegalSectionBody";

type TermsSection = { id: string; q: string; a: string };
type TermsHighlight = { title: string; body: string };

export function TermsPage() {
  const { t } = useTranslation();

  const sections = useMemo(() => {
    const raw = t("staticPages.terms.sections", { returnObjects: true });
    const items = Array.isArray(raw) ? raw : [];
    return items.filter(
      (item): item is TermsSection =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        typeof (item as TermsSection).id === "string" &&
        "q" in item &&
        typeof (item as TermsSection).q === "string" &&
        typeof (item as TermsSection).a === "string",
    );
  }, [t]);

  const highlights = useMemo(() => {
    const raw = t("staticPages.terms.highlights", { returnObjects: true });
    const items = Array.isArray(raw) ? raw : [];
    return items.filter(
      (item): item is TermsHighlight =>
        typeof item === "object" &&
        item !== null &&
        "title" in item &&
        typeof (item as TermsHighlight).title === "string" &&
        typeof (item as TermsHighlight).body === "string",
    );
  }, [t]);

  const sectionAnchors = sections.map((section) => ({ id: section.id, title: section.q }));

  return (
    <PublicPageShell maxWidth="full" contentClassName="pb-0" className="caretip-legal-document-page bg-background">
      <main id="terms-of-service" className="caretip-legal-document-page__main" aria-label={t("staticPages.terms.title")}>
        <PublicPageBackLink className="caretip-legal-document-page__back" />

        <div className="caretip-legal-document-page__grid">
          <article className="caretip-legal-document__article">
            <header className="caretip-legal-document__header">
              <p className="caretip-legal-document__eyebrow">{t("staticPages.terms.pageEyebrow")}</p>
              <h1 className="caretip-legal-document__title">{t("staticPages.terms.pageTitle")}</h1>
              <p className="caretip-legal-document__effective">{t("staticPages.terms.effectiveDateLine")}</p>
              <p className="caretip-legal-document__intro">{t("staticPages.terms.intro")}</p>

              {highlights.length > 0 ? (
                <div className="caretip-legal-document__highlights">
                  {highlights.map((item) => (
                    <div key={item.title} className="caretip-legal-document__highlight">
                      <p className="caretip-legal-document__highlight-title">{item.title}</p>
                      <p className="caretip-legal-document__highlight-body">{item.body}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </header>

            <div className="caretip-legal-document__sections">
              {sections.map((section) => (
                <section key={section.id} id={section.id} className="caretip-legal-document__section" aria-labelledby={`${section.id}-title`}>
                  <h2 id={`${section.id}-title`} className="caretip-legal-document__section-title">
                    {section.q}
                  </h2>
                  <LegalSectionBody text={section.a} />
                </section>
              ))}
            </div>

            <footer className="caretip-legal-document__footer">
              <p className="caretip-legal-document__footer-meta">
                <strong>{t("staticPages.terms.footerLastLabel")}</strong> {t("staticPages.terms.footerLastDate")}
              </p>
              <p className="caretip-legal-document__footer-contact">{t("staticPages.terms.footerContact")}</p>
            </footer>
          </article>

          <LegalDocumentsSidebar activeDocument="terms" sectionAnchors={sectionAnchors} />
        </div>
      </main>
    </PublicPageShell>
  );
}
