import { useTranslation } from "react-i18next";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { PublicPageHeroCard } from "@/components/public/PublicPageHeroCard";
import { publicPageUi } from "@/components/public/publicPageUi";
import { cn } from "@/lib/utils";

export function FaqPageHero() {
  const { t } = useTranslation();

  return (
    <section className="caretip-faq-hero-wise" aria-labelledby="faq-hero-title">
      <PublicPageBackLink className="caretip-faq-hero-wise__back" />

      <PublicPageHeroCard variant="fullBleed" innerClassName="caretip-faq-page__inner caretip-faq-hero-wise__inner">
        <p className="caretip-faq-hero-wise__eyebrow">{t("staticPages.faq.pageEyebrow")}</p>

        <h1 id="faq-hero-title" className={cn(publicPageUi.title, "caretip-faq-hero-wise__title")}>
          {t("staticPages.faq.pageTitle")}
        </h1>

        <p className="caretip-faq-hero-wise__subtitle">{t("staticPages.faq.pageSubtitle")}</p>
      </PublicPageHeroCard>
    </section>
  );
}
