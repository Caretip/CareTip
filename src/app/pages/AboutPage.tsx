import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import "@/styles/bundles/marketing-pages.css";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { AboutPageHero } from "@/components/public/about/AboutPageHero";
import { AboutCompanyStorySection } from "@/components/public/about/AboutCompanyStorySection";
import { AboutMissionSection } from "@/components/public/about/AboutMissionSection";
import { AboutTrustSection } from "@/components/public/about/AboutTrustSection";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { usePublicMountProbe } from "@/lib/publicMountProbe";

export function AboutPage() {
  usePublicMountProbe("AboutPage");
  const { t } = useTranslation();

  return (
    <PublicPageShell maxWidth="full" contentClassName="pb-0" className="bg-background">
      <main
        id="about"
        className="caretip-about-page caretip-about-page--wise"
        aria-label={t("staticPages.about.pageAria")}
      >
        <AboutPageHero />
        <AboutCompanyStorySection />
        <AboutMissionSection />
        <AboutTrustSection />

        <section className="caretip-about-cta-wise" aria-labelledby="about-cta-title">
          <div className="caretip-about-page__inner caretip-about-cta-wise__inner">
            <h2 id="about-cta-title" className="caretip-about-cta-wise__title">
              {t("staticPages.about.ctaTitle")}
            </h2>
            <div className="caretip-about-cta-wise__actions">
              <Link to="/signup" className={publicPagesBrandUi.ctaButtonPrimary}>
                {t("staticPages.about.ctaPrimary")}
              </Link>
              <Link to="/pricing" className="caretip-about-cta-wise__secondary">
                {t("staticPages.about.ctaSecondary")}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </PublicPageShell>
  );
}
