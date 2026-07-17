import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { LandingTrustComplianceStrip } from "@/app/components/landing/LandingTrustComplianceStrip";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingCopySentences } from "@/components/landing/LandingCopySentences";
import { landingCopyVisible } from "@/components/landing/landingUi";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { cn } from "@/lib/utils";

/**
 * Landing closing CTA — same Wise elevated band as Features / Pricing / FAQ / About.
 */
export function LandingFinalCtaSection() {
  const { t } = useTranslation();
  const sectionSubtitle = t("landing.finalCta.subtitle");

  return (
    <section
      id="final-cta"
      className="caretip-landing-cta-wise caretip-features-cta-wise relative scroll-mt-[80px]"
      aria-labelledby="landing-final-cta-title"
    >
      <LandingReveal className="caretip-landing-cta-wise__inner caretip-features-cta-wise__inner">
        <h2 id="landing-final-cta-title" className="caretip-features-cta-wise__title">
          {t("landing.finalCta.title")}
        </h2>

        {landingCopyVisible(sectionSubtitle) ? (
          <LandingCopySentences
            text={sectionSubtitle}
            layout="paragraphs"
            className="caretip-pricing-cta-wise__body"
            sentenceClassName="caretip-pricing-cta-wise__body m-0"
          />
        ) : null}

        <div className="caretip-features-cta-wise__actions">
          <Link
            to="/contact?intent=demo"
            className={cn(publicPagesBrandUi.ctaButtonPrimary)}
          >
            {t("landing.finalCta.cta")}
          </Link>
          <Link
            to="/signup"
            className={cn(publicPagesBrandUi.ctaButtonSecondary)}
          >
            {t("landing.finalCta.secondary")}
          </Link>
        </div>

        <LandingTrustComplianceStrip className="caretip-landing-cta-wise__trust" />
      </LandingReveal>
    </section>
  );
}
