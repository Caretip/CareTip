import { useTranslation } from "react-i18next";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { PublicPageHeroCard } from "@/components/public/PublicPageHeroCard";
import { publicPageUi } from "@/components/public/publicPageUi";
import { cn } from "@/lib/utils";

export function FeaturesPageHero() {
  const { t } = useTranslation();

  return (
    <section className="caretip-features-hero-wise" aria-labelledby="features-hero-title">
      <PublicPageBackLink className="caretip-features-hero-wise__back" />

      <PublicPageHeroCard variant="fullBleed" innerClassName="caretip-features-page__inner caretip-features-hero-wise__inner">
        <h1
          id="features-hero-title"
          className={cn(publicPageUi.title, "caretip-features-hero-wise__title")}
        >
          {t("staticPages.features.title")}
        </h1>
        <p className="caretip-features-hero-wise__lead">{t("staticPages.features.subtitleLead")}</p>
        <p className="caretip-features-hero-wise__body">{t("staticPages.features.subtitleBody")}</p>
      </PublicPageHeroCard>
    </section>
  );
}
