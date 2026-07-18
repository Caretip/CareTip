import * as React from "react";
import { useTranslation } from "react-i18next";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { landingCopyVisible } from "@/components/landing/landingUi";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LiveInMinutesOnboardingPhone } from "@/app/components/landing/LiveInMinutesOnboardingPhone";

export const LIVE_DEMO_SLIDE_IDS = ["signup", "team", "qr", "dashboard"] as const;
export type LiveDemoSlideId = (typeof LIVE_DEMO_SLIDE_IDS)[number];

/** Matches SimpleSetupSection step buttons: account → team → QR → tips */
export const SETUP_JOURNEY_STEP_COUNT = 4;

const SETUP_STEP_TITLE_KEYS = [
  "step1Title",
  "step2Title",
  "step3Title",
  "step4Title",
] as const;

type LiveInMinutesLaptopDemoProps = {
  videoSrc?: string;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
};

export function LiveInMinutesLaptopDemo({
  videoSrc,
  activeIndex = 0,
}: LiveInMinutesLaptopDemoProps) {
  const { t, i18n } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const index = Math.min(Math.max(0, activeIndex), SETUP_JOURNEY_STEP_COUNT - 1);

  const captions = React.useMemo(
    () => [
      t("landing.simpleSetup.visualCaption1"),
      t("landing.simpleSetup.visualCaption2"),
      t("landing.simpleSetup.visualCaption3"),
      t("landing.simpleSetup.visualCaption4"),
    ],
    [t, i18n.language],
  );

  const caption = captions[index];

  if (videoSrc) {
    return (
      <LandingReveal className="caretip-live-minutes-stage caretip-live-minutes-device-lift relative mx-auto w-full max-w-[min(100%,15.75rem)] overflow-hidden rounded-[1.35rem] shadow-[0_20px_40px_-24px_rgba(30,24,16,0.26),0_8px_18px_-10px_rgba(30,24,16,0.12)] ring-1 ring-neutral-900/[0.06] sm:max-w-[20rem] sm:rounded-[1.5rem] lg:max-w-[22rem] dark:ring-white/[0.08]">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="aspect-[6/5] w-full object-cover sm:aspect-[3/4]"
          src={videoSrc}
        />
      </LandingReveal>
    );
  }

  return (
    <div className="caretip-live-minutes-stage caretip-live-minutes-stage--onboarding relative mx-auto w-full max-w-[min(100%,18rem)] sm:max-w-[20rem]">
      <div className="caretip-live-minutes-onboarding-preview">
        <LandingReveal className="caretip-live-minutes-onboarding-slot relative flex items-center justify-center">
          <LiveInMinutesOnboardingPhone
            activeIndex={index}
            language={i18n.language}
            reduceMotion={reduceMotion}
            caption={caption}
            demoAriaLabel={t("landing.liveDemo.demoAria", {
              label: landingCopyVisible(caption)
                ? caption
                : t(`landing.simpleSetup.${SETUP_STEP_TITLE_KEYS[index]}`),
            })}
          />
        </LandingReveal>

        {landingCopyVisible(caption) ? (
          <p className="caretip-live-minutes-caption mt-1 font-sans text-[12px] leading-snug tracking-tight text-neutral-600 dark:text-neutral-400 sm:mt-1.5 sm:text-[13px] lg:text-sm">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}
