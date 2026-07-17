import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { LandingTrustComplianceStrip } from "@/app/components/landing/LandingTrustComplianceStrip";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingCopySentences } from "@/components/landing/LandingCopySentences";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";

export function LandingFinalCtaSection() {
  const { t } = useTranslation();
  const sectionSubtitle = t("landing.finalCta.subtitle");

  return (
    <section
      id="final-cta"
      className={cn(
        "caretip-landing-final-cta caretip-landing-final-cta--light relative scroll-mt-[80px]",
        "px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-[4.5rem]",
      )}
    >
      <LandingReveal
        data-polish-view
        className="caretip-final-cta-stage caretip-final-cta-card relative z-[1] mx-auto w-full min-w-0 text-center"
      >
        <p className="caretip-final-cta-eyebrow font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-primary sm:text-xs">
          {t("landing.finalCta.eyebrow")}
        </p>

        <h2 className="caretip-final-cta-headline font-sans text-balance text-foreground">
          {t("landing.finalCta.title")}
        </h2>

        {landingCopyVisible(sectionSubtitle) ? (
          <LandingCopySentences
            text={sectionSubtitle}
            layout="paragraphs"
            className="caretip-final-cta-subtitle mx-auto max-w-md text-pretty font-sans text-muted-foreground"
            sentenceClassName="caretip-final-cta-subtitle mx-auto max-w-md text-pretty font-sans text-muted-foreground m-0"
          />
        ) : null}

        <div className="caretip-final-cta-actions w-full min-w-0 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <div className={cn(landingUi.sectionCtaUnit, "caretip-final-cta-action relative")}>
            <Link
              to="/contact?intent=demo"
              className={cn(
                landingUi.sectionCtaPrimary,
                "caretip-final-cta-button relative z-[1] gap-2",
              )}
            >
              {t("nav.requestDemo")}
            </Link>
          </div>
          <div className={landingUi.sectionCtaUnit}>
            <Link to="/signup" className={landingUi.sectionCtaSecondary}>
              {t("nav.becomePartner")}
            </Link>
          </div>
        </div>

        <LandingTrustComplianceStrip />
      </LandingReveal>
    </section>
  );
}
