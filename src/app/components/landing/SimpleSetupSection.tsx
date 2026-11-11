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

const AUTO_ADVANCE_MS = 4500;

function formatStepNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function SimpleSetupSection() {
  const { t, i18n } = useTranslation();
  const [activeStep, setActiveStep] = useState(0);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const [cycleKey, setCycleKey] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const onboardingIntentSent = useRef(false);
  const { text: setupHeadline, highlight: setupHighlight } = parseLandingHeadline(
    t("landing.simpleSetup.title"),
  );

  useEffect(() => {
    const locale = resolveLiveMinutesOnboardingLocale(i18n.language);
    void preloadLiveMinutesOnboardingScreens(locale);
  }, [i18n.language]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), {
      threshold: 0.35,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

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

  useEffect(() => {
    if (!inView || paused || !pageVisible || prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % steps.length);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [inView, paused, pageVisible, steps.length, cycleKey]);

  const selectStep = (idx: number) => {
    setActiveStep(idx);
    setCycleKey((k) => k + 1);
    if (idx > 0 && !onboardingIntentSent.current) {
      onboardingIntentSent.current = true;
      dispatchLandingIntent("onboarding_attempt");
    }
  };

  return (
    <section
      ref={sectionRef}
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
            <div className="caretip-landing-headline-stack max-md:items-center lg:items-start">
              <LandingSectionAccent variant="spark">{t("landing.simpleSetup.pill")}</LandingSectionAccent>
              <h2 className={landingUi.headline}>
                <AnimatedHeadingLazy
                  text={setupHeadline}
                  highlight={setupHighlight}
                  highlightClassName="bg-gradient-to-r from-[#ff9e2d] via-[#eb992c] to-[#eb992c] bg-clip-text text-transparent"
                />
              </h2>
            </div>
            {landingCopyVisible(pillSub) ? (
              <div className={cn(landingUi.sectionAccentRow, "max-md:flex-col max-md:items-center")}>
                <LandingSectionAccent variant="arrow" muted>
                  {pillSub}
                </LandingSectionAccent>
              </div>
            ) : null}
            {landingCopyVisible(sectionSubtitle) ? (
              <p className={cn(landingUi.subtitle, "max-md:max-w-[min(100%,34ch)]")}>{sectionSubtitle}</p>
            ) : null}
          </div>

          <div
            role="list"
            aria-label={t("landing.simpleSetup.stepsAria")}
            className={cn("relative w-full", landingUi.mobileStackAfter)}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") setPaused(true);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setPaused(false);
            }}
            onFocus={(e) => {
              if (e.target.matches(":focus-visible")) setPaused(true);
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
            }}
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
                      onClick={() => selectStep(idx)}
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
