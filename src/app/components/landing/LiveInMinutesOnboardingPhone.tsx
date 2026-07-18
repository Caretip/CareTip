import * as React from "react";
import type { ImgHTMLAttributes } from "react";

import {
  getLiveMinutesOnboardingScreenAlt,
  getLiveMinutesOnboardingScreenSources,
  LIVE_MINUTES_ONBOARDING_STEP_COUNT,
  preloadLiveMinutesOnboardingScreens,
  resolveLiveMinutesOnboardingLocale,
  type OnboardingLocale,
} from "@/app/components/landing/liveInMinutesOnboardingScreens";
import { cn } from "@/lib/utils";

type LiveInMinutesOnboardingPhoneProps = {
  activeIndex: number;
  language: string;
  reduceMotion: boolean | null;
  caption: string;
  demoAriaLabel: string;
};

export function LiveInMinutesOnboardingPhone({
  activeIndex,
  language,
  reduceMotion,
  caption,
  demoAriaLabel,
}: LiveInMinutesOnboardingPhoneProps) {
  const locale = React.useMemo(() => resolveLiveMinutesOnboardingLocale(language), [language]);
  const clampedIndex = Math.min(
    Math.max(0, activeIndex),
    LIVE_MINUTES_ONBOARDING_STEP_COUNT - 1,
  );
  const screenSources = getLiveMinutesOnboardingScreenSources(locale);

  React.useEffect(() => {
    void preloadLiveMinutesOnboardingScreens(locale);
  }, [locale]);

  return (
    <div
      className="caretip-live-minutes-onboarding-device relative z-[1] mx-auto w-full"
      data-reduce-motion={reduceMotion ? "true" : undefined}
    >
      <div
        className="caretip-live-minutes-onboarding-device__frame relative z-[1] flex w-full items-center justify-center"
        role="img"
        aria-label={demoAriaLabel || getLiveMinutesOnboardingScreenAlt(locale, clampedIndex)}
      >
        {screenSources.map((src, index) => {
          const isActive = index === clampedIndex;
          return (
            <img
              key={src}
              src={src}
              alt={isActive ? getLiveMinutesOnboardingScreenAlt(locale, index) : ""}
              aria-hidden={!isActive}
              className={cn(
                "caretip-live-minutes-onboarding-device__img block max-h-full max-w-full select-none",
                isActive && "caretip-live-minutes-onboarding-device__img--active",
              )}
              loading="eager"
              decoding="sync"
              {...({
                fetchpriority: index === 0 ? "high" : "low",
              } as ImgHTMLAttributes<HTMLImageElement>)}
              onError={() => {
                if (import.meta.env.DEV) {
                  console.warn(
                    `[Live in Minutes] Failed to load onboarding screenshot (${locale} step ${index + 1}).`,
                  );
                }
              }}
            />
          );
        })}
      </div>
      <span className="sr-only">{caption}</span>
    </div>
  );
}

export type { OnboardingLocale };
