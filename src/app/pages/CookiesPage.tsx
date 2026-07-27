import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/styles/bundles/marketing-pages.css";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { CookiesPageHero } from "@/components/public/cookies/CookiesPageHero";
import { FaqAccordionItem } from "@/components/public/faq/FaqAccordionItem";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { openCookieConsentSettings } from "../lib/cookieConsent";

type CookieSection = { q: string; a: string };

export function CookiesPage() {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const sections = useMemo(() => {
    const raw = t("staticPages.cookies.sections", { returnObjects: true });
    const items = Array.isArray(raw) ? raw : [];
    return items.filter(
      (item): item is CookieSection =>
        typeof item === "object" &&
        item !== null &&
        "q" in item &&
        typeof (item as CookieSection).q === "string" &&
        typeof (item as CookieSection).a === "string",
    );
  }, [t]);

  useEffect(() => {
    setOpenIndex(sections.length > 0 ? 0 : null);
  }, [sections.length]);

  return (
    <PublicPageShell maxWidth="full" contentClassName="pb-0" className="bg-background">
      <main
        id="cookies-policy"
        className="caretip-faq-page caretip-faq-page--wise"
        aria-label={t("staticPages.cookies.title")}
      >
        <CookiesPageHero />

        <section className="caretip-faq-content" aria-label={t("staticPages.cookies.contentAria")}>
          <div className="caretip-faq-page__inner caretip-faq-content__inner">
            <p className="caretip-faq-hero-wise__subtitle mx-auto mb-8 max-w-3xl text-center">
              {t("staticPages.cookies.intro")}
            </p>

            <div className="caretip-faq-list">
              {sections.map((section, index) => (
                <FaqAccordionItem
                  key={section.q}
                  question={section.q}
                  answer={section.a}
                  isOpen={openIndex === index}
                  onToggle={() => setOpenIndex(openIndex === index ? null : index)}
                />
              ))}
            </div>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              {t("staticPages.cookies.footerLastLabel")}{" "}
              <span className="font-medium text-foreground">{t("staticPages.cookies.footerLastDate")}</span>
            </p>
            <p className="mt-2 text-center text-sm text-muted-foreground">{t("staticPages.cookies.footerContact")}</p>
          </div>
        </section>

        <section className="caretip-faq-cta-wise" aria-labelledby="cookies-cta-title">
          <div className="caretip-faq-page__inner caretip-faq-cta-wise__inner">
            <h2 id="cookies-cta-title" className="caretip-faq-cta-wise__title">
              {t("staticPages.cookies.ctaTitle")}
            </h2>
            <p className="caretip-faq-cta-wise__body">{t("staticPages.cookies.ctaBody")}</p>
            <div className="caretip-faq-cta-wise__actions">
              <button
                type="button"
                className={publicPagesBrandUi.ctaButtonPrimary}
                onClick={() => openCookieConsentSettings()}
              >
                {t("staticPages.cookies.manageButton")}
              </button>
            </div>
          </div>
        </section>
      </main>
    </PublicPageShell>
  );
}
