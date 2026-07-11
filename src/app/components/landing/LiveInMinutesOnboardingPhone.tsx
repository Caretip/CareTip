import * as React from "react";
import type { ImgHTMLAttributes } from "react";

import {
  getLiveMinutesOnboardingScreenAlt,
  getLiveMinutesOnboardingScreenSources,
  getLiveMinutesOnboardingScreenSrc,
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
  fallback: React.ReactNode;
};

export function LiveInMinutesOnboardingPhone({
  activeIndex,
  language,
  reduceMotion,
  caption,
  demoAriaLabel,
  fallback,
}: LiveInMinutesOnboardingPhoneProps) {
  const locale = React.useMemo(() => resolveLiveMinutesOnboardingLocale(language), [language]);
  const clampedIndex = Math.min(
    Math.max(0, activeIndex),
    LIVE_MINUTES_ONBOARDING_STEP_COUNT - 1,
  );
  const [sourcesReady, setSourcesReady] = React.useState(
    () => getLiveMinutesOnboardingScreenSources(locale).length > 0,
  );
  const screenSources = React.useMemo(
    () => getLiveMinutesOnboardingScreenSources(locale),
    [locale, sourcesReady],
  );
  const activeSrc = getLiveMinutesOnboardingScreenSrc(locale, clampedIndex);
  const [failedSources, setFailedSources] = React.useState<ReadonlySet<string>>(() => new Set());

  React.useEffect(() => {
    let cancelled = false;
    void preloadLiveMinutesOnboardingScreens(locale).then(() => {
      if (!cancelled) setSourcesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const markFailed = React.useCallback((src: string) => {
    setFailedSources((prev) => {
      if (prev.has(src)) return prev;
      const next = new Set(prev);
      next.add(src);
      return next;
    });
  }, []);

  const availableSources = React.useMemo(
    () => screenSources.filter((src) => src && !failedSources.has(src)),
    [failedSources, screenSources],
  );

  const useScreenshots = availableSources.length > 0;
  const activeAvailable = Boolean(activeSrc && !failedSources.has(activeSrc));

  if (!useScreenshots || !activeAvailable) {
    if (import.meta.env.DEV && !activeSrc) {
      console.warn(
        `[Live in Minutes] No onboarding screenshot for ${locale} step ${clampedIndex + 1}; using placeholder.`,
      );
    }
    return <>{fallback}</>;
  }

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
          if (!src || failedSources.has(src)) return null;
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
                markFailed(src);
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
