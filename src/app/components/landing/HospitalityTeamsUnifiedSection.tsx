import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { HospitalityFeatureList } from "@/components/landing/HospitalityFeatureList";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import HospitalityBusinessesMarquee from "@/components/ui/team";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { cn } from "@/lib/utils";

export function HospitalityTeamsUnifiedSection() {
  const { t, i18n } = useTranslation();
  const isDe = i18n.language?.toLowerCase().startsWith("de");

  const outcomes = useMemo(
    () =>
      [
        { title: t("landing.hospitality.f1Title"), text: t("landing.hospitality.f1Text") },
        { title: t("landing.hospitality.f2Title"), text: t("landing.hospitality.f2Text") },
        { title: t("landing.hospitality.f3Title"), text: t("landing.hospitality.f3Text") },
      ].filter((f) => landingCopyVisible(f.title) && landingCopyVisible(f.text)),
    [t, i18n.language],
  );

  const lead = t("landing.hospitality.lead");
  const hasLead = landingCopyVisible(lead);
  const industriesTitle = t("landing.industries.title");
  const hasIndustriesTitle = landingCopyVisible(industriesTitle);

  return (
    <section
      id="built-for-hospitality"
      data-landing-lang={isDe ? "de" : "en"}
      lang={isDe ? "de" : "en"}
      className={cn(landingUi.hospitalitySection, "caretip-landing-hospitality")}
    >
      <div className="caretip-hospitality-shell mx-auto w-full max-w-7xl min-w-0">
        <LandingReveal delay={landingStaggerDelay(0)} className="caretip-hospitality-editorial">
          <header className="caretip-hospitality-intro">
            <h2
              className={cn(
                "caretip-hospitality-title",
                isDe && "text-pretty hyphens-auto",
              )}
            >
              {t("landing.hospitality.title")}
            </h2>
            {hasLead ? (
              <p className={cn("caretip-hospitality-lead", isDe && "text-pretty")}>{lead}</p>
            ) : null}
          </header>

          <div className="caretip-hospitality-visual">
            <div className="caretip-hospitality-showcase">
              <div className="caretip-hospitality-showcase-visual">
                <HospitalityBusinessesMarquee />
              </div>
              {hasIndustriesTitle ? (
                <p
                  className={cn(
                    "caretip-hospitality-showcase-footer",
                    isDe && "text-pretty hyphens-auto",
                  )}
                >
                  {industriesTitle}
                </p>
              ) : null}
            </div>
          </div>

          <div className="caretip-hospitality-outcomes-wrap">
            <HospitalityFeatureList features={outcomes} />
          </div>
        </LandingReveal>
      </div>
    </section>
  );
}
