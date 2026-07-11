import { useTranslation } from "react-i18next";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { PublicPageHeroCard } from "@/components/public/PublicPageHeroCard";
import { publicPageUi } from "@/components/public/publicPageUi";
import { cn } from "@/lib/utils";

export function AboutPageHero() {
  const { t } = useTranslation();

  return (
    <section className="caretip-about-hero-wise" aria-labelledby="about-hero-title">
      <PublicPageBackLink className="caretip-about-hero-wise__back" />

      <PublicPageHeroCard innerClassName="caretip-about-page__inner caretip-about-hero-wise__inner">
        <h1
          id="about-hero-title"
          className={cn(publicPageUi.title, "caretip-about-hero-wise__title")}
        >
          {t("staticPages.about.hero.title")}
        </h1>
        <p className="caretip-about-hero-wise__mission">{t("staticPages.about.hero.mission")}</p>
      </PublicPageHeroCard>
    </section>
  );
}
