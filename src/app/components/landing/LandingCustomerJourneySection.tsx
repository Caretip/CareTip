import { useEffect, useMemo, type ImgHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { LandingCopySentences } from "@/components/landing/LandingCopySentences";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { parseLandingHeadline } from "@/components/landing/landingRichText";
import { AnimatedHeadingLazy } from "@/components/ui/AnimatedHeading.lazy";
import { cn } from "@/lib/utils";
import mariatesterinImg from "@/assets/landing/customerjourney/mariatesterin.webp";
import teamselectionImg from "@/assets/landing/customerjourney/teamselection.webp";
import tipamountImg from "@/assets/landing/customerjourney/tipamount.webp";
import tipsuccessImg from "@/assets/landing/customerjourney/tipsuccess.webp";
import { warmLandingCustomerJourneyImages } from "@/app/components/landing/warmLandingCustomerJourneyAssets";

const JOURNEY_STEPS = [
  { id: "scan", image: mariatesterinImg, visualClass: "caretip-customerjourney__visual_mariatesterin" },
  { id: "choose", image: teamselectionImg, visualClass: undefined },
  { id: "pay", image: tipamountImg, visualClass: undefined },
  { id: "team", image: tipsuccessImg, visualClass: undefined },
] as const;

const HIGHLIGHT_CLASS =
  "bg-gradient-to-r from-[#ff9e2d] via-[#e9781c] to-[#d96810] bg-clip-text text-transparent";

/**
 * Guest tipping flow on mobile — scan → choose recipient → tip amount → confirmation.
 * Distinct from SimpleSetupSection (business onboarding).
 */
export function LandingCustomerJourneySection() {
  const { t, i18n } = useTranslation();

  const { text: journeyHeadline, highlight: journeyHighlight } = parseLandingHeadline(
    t("landing.customerJourney.title"),
  );

  const steps = useMemo(
    () =>
      JOURNEY_STEPS.map((def, index) => ({
        ...def,
        stepNumber: index + 1,
        title: t(`landing.customerJourney.steps.${def.id}.title`),
        body: t(`landing.customerJourney.steps.${def.id}.body`),
        alt: t(`landing.customerJourney.steps.${def.id}.imageAlt`),
      })),
    [t, i18n.language],
  );

  const eyebrow = t("landing.customerJourney.eyebrow");
  const subtitle = t("landing.customerJourney.subtitle");

  useEffect(() => {
    warmLandingCustomerJourneyImages("high");
  }, []);

  return (
    <section
      id="guesttippingjourney"
      aria-labelledby="guesttippingjourneytitle"
      className={cn(
        landingUi.section,
        landingUi.landingSurface,
        "caretip-customerjourney relative overflow-hidden",
      )}
    >
      <div className={cn(landingUi.sectionShell, "caretip-customerjourney__inner")}>
        <LandingReveal className={cn(landingUi.sectionIntro, "caretip-customerjourney__intro")}>
          <div className="caretip-landing-headline-stack caretip-customerjourney__headline-stack">
            {landingCopyVisible(eyebrow) ? (
              <LandingSectionAccent variant="spark" className="mx-auto">
                {eyebrow}
              </LandingSectionAccent>
            ) : null}
            <h2 id="guesttippingjourneytitle" className={landingUi.sectionTitle}>
              <AnimatedHeadingLazy
                text={journeyHeadline}
                highlight={journeyHighlight}
                highlightClassName={HIGHLIGHT_CLASS}
              />
            </h2>
          </div>
          {landingCopyVisible(subtitle) ? (
            <LandingCopySentences
              text={subtitle}
              className={cn(landingUi.sectionSubtitle, "caretip-customerjourney__subtitle")}
              sentenceClassName={cn(landingUi.sectionSubtitle, "m-0")}
            />
          ) : null}
        </LandingReveal>

        <ol className="caretip-customerjourney__track" aria-label={t("landing.customerJourney.stepsAria")}>
          {steps.map((step, index) => (
            <li key={step.id} className="caretip-customerjourney__step">
              <LandingReveal delay={index * 0.06} className="caretip-customerjourney__stepinner">
                <div className={cn("caretip-customerjourney__visual", step.visualClass)}>
                  <img
                    src={step.image}
                    alt={step.alt}
                    width={320}
                    height={640}
                    loading="eager"
                    decoding="async"
                    {...({ fetchpriority: "low" } as ImgHTMLAttributes<HTMLImageElement>)}
                    className="caretip-customerjourney__mockup"
                  />
                </div>
                <div className="caretip-customerjourney__copy">
                  <div className="caretip-customerjourney__textblock">
                    <div className="caretip-customerjourney__titlerow">
                      <span className="caretip-customerjourney__stepbadge" aria-hidden>
                        {step.stepNumber}
                      </span>
                      <h3 className="caretip-customerjourney__steptitle">{step.title}</h3>
                    </div>
                    <p className="caretip-customerjourney__stepbody">{step.body}</p>
                  </div>
                </div>
              </LandingReveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
