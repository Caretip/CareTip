import { useEffect, useMemo, useRef, useState } from "react";
import { dispatchLandingIntent } from "../../lib/landingAiIntent";
import { useTranslation } from "react-i18next";
import { LiveInMinutesLaptopDemo } from "./LiveInMinutesLaptopDemo";
import {
  preloadLiveMinutesOnboardingScreens,
  resolveLiveMinutesOnboardingLocale,
} from "./liveInMinutesOnboardingScreens";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { parseLandingHeadline } from "@/components/landing/landingRichText";
import { AnimatedHeadingLazy } from "@/components/ui/AnimatedHeading.lazy";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { cn } from "@/lib/utils";

function formatStepNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function SimpleSetupSection() {
  const { t, i18n } = useTranslation();
  const [activeStep, setActiveStep] = useState(0);
  const onboardingIntentSent = useRef(false);
  const { text: setupHeadline, highlight: setupHighlight } = parseLandingHeadline(
    t("landing.simpleSetup.title"),
  );

  useEffect(() => {
    const locale = resolveLiveMinutesOnboardingLocale(i18n.language);
    void preloadLiveMinutesOnboardingScreens(locale);
  }, [i18n.language]);

  useEffect(() => {
    if (activeStep > 0 && !onboardingIntentSent.current) {
      onboardingIntentSent.current = true;
      dispatchLandingIntent("onboarding_attempt");
    }
  }, [activeStep]);

  const pillSub = t("landing.simpleSetup.pillSub");
  const sectionSubtitle = t("landing.simpleSetup.subtitle");

  const steps = useMemo(
    () =>
      [
        { title: t("landing.simpleSetup.step1Title"), description: t("landing.simpleSetup.step1Desc") },
        { title: t("landing.simpleSetup.step2Title"), description: t("landing.simpleSetup.step2Desc") },
        { title: t("landing.simpleSetup.step3Title"), description: t("landing.simpleSetup.step3Desc") },
        { title: t("landing.simpleSetup.step4Title"), description: t("landing.simpleSetup.step4Desc") },
      ],
    [t, i18n.language],
  );

  return (
    <section
      id="how-it-works"
      className={cn(
        landingUi.section,
        landingUi.landingSurface,
        "caretip-live-minutes-section relative overflow-x-clip",
      )}
    >
      <div
        className={cn(
          landingUi.splitGrid,
          landingUi.sectionShell,
          "caretip-live-minutes-split relative",
        )}
      >
        <div className={cn(landingUi.copyColumn, "caretip-live-minutes-copy lg:order-1")}>
          <div
            className={cn(landingUi.copyStack, landingUi.mobileStackIntro, "caretip-live-minutes-intro")}
          >
            <div className={cn(landingUi.sectionAccentRow, "max-md:flex-col max-md:items-center")}>
              <LandingSectionAccent variant="spark">{t("landing.simpleSetup.pill")}</LandingSectionAccent>
              {landingCopyVisible(pillSub) ? (
                <LandingSectionAccent variant="arrow" muted>
                  {pillSub}
                </LandingSectionAccent>
              ) : null}
            </div>

            <h2 className={landingUi.headline}>
              <AnimatedHeadingLazy
                text={setupHeadline}
                highlight={setupHighlight}
                highlightClassName="bg-gradient-to-r from-[#ff9e2d] via-[#e9781c] to-[#d96810] bg-clip-text text-transparent"
              />
            </h2>
            {landingCopyVisible(sectionSubtitle) ? (
              <p className={cn(landingUi.subtitle, "max-md:max-w-[min(100%,34ch)]")}>{sectionSubtitle}</p>
            ) : null}
          </div>

          <div
            role="list"
            aria-label={t("landing.simpleSetup.stepsAria")}
            className={cn("relative w-full", landingUi.mobileStackAfter)}
          >
            <div
              className="caretip-process-steps caretip-process-steps--editorial relative flex flex-col"
              style={
                {
                  "--caretip-live-minutes-progress": `${((activeStep + 1) / steps.length) * 100}%`,
                } as React.CSSProperties
              }
            >
              {steps.map((step, idx) => {
                const isActive = activeStep === idx;
                const isPast = idx < activeStep;
                return (
                  <LandingReveal
                    key={step.title}
                    delay={landingStaggerDelay(idx)}
                    className="relative w-full"
                  >
                    <button
                      type="button"
                      role="listitem"
                      aria-current={isActive ? "step" : undefined}
                      onClick={() => setActiveStep(idx)}
                      className={cn(
                        "caretip-process-step group relative w-full text-left",
                        isActive && "caretip-process-step--active",
                        isPast && "caretip-process-step--past",
                      )}
                    >
                      <span className="caretip-process-step__rail" aria-hidden>
                        <span className="caretip-process-step__dot" />
                        {idx < steps.length - 1 ? (
                          <span className="caretip-process-step__line" />
                        ) : null}
                      </span>
                      <span className="caretip-process-step__content">
                        <span className="caretip-process-step__head">
                          <span className="caretip-process-step-number tabular-nums" aria-hidden>
                            {formatStepNumber(idx)}
                          </span>
                          <span className="caretip-process-step__sep" aria-hidden>
                            —
                          </span>
                          <span
                            className={cn(
                              "caretip-process-step-title",
                              isActive
                                ? "caretip-process-step-title--active"
                                : "caretip-process-step-title--inactive",
                            )}
                          >
                            {step.title}
                          </span>
                        </span>
                        {landingCopyVisible(step.description) ? (
                          <p
                            className={cn(
                              "caretip-process-step-desc max-w-prose",
                              isActive
                                ? "caretip-process-step-desc--active"
                                : "caretip-process-step-desc--inactive",
                            )}
                          >
                            {step.description}
                          </p>
                        ) : null}
                        {isActive ? (
                          <span className="caretip-process-step__current">
                            {t("landing.simpleSetup.currentStep")}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </LandingReveal>
                );
              })}
            </div>
          </div>
        </div>

        <LandingReveal
          className={cn(
            landingUi.visualColumn,
            "caretip-live-minutes-visual-wrap lg:order-2 lg:flex lg:items-center lg:justify-start lg:pt-0",
          )}
        >
          <LiveInMinutesLaptopDemo
            videoSrc={import.meta.env.VITE_LIVE_IN_MINUTES_DEMO_VIDEO}
            activeIndex={activeStep}
          />
        </LandingReveal>
      </div>
    </section>
  );
}
