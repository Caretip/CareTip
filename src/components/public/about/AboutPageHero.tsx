import { useTranslation } from "react-i18next";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";

/** White page intro — no colored banner (template: Final Changes 20.07). */
export function AboutPageHero() {
  const { t } = useTranslation();

  return (
    <header className="caretip-about-hero-wise">
      <PublicPageBackLink className="caretip-about-hero-wise__back" />
      <h1 id="about-hero-title" className="sr-only">
        {t("staticPages.about.hero.title")}
      </h1>
    </header>
  );
}
