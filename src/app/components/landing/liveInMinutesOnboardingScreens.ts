import enStep01 from "../../../../images/en-step-01-create-account.webp";
import enStep02 from "../../../../images/en-step-02-add-team.webp";
import enStep03 from "../../../../images/en-step-03-activate-qr.webp";
import enStep04 from "../../../../images/en-step-04-receive-tips.webp";
import deStep01 from "../../../../images/de-step-01-konto-erstellen.webp";
import deStep02 from "../../../../images/de-step-02-team-einladen.webp";
import deStep03 from "../../../../images/de-step-03-qr-aktivieren.webp";
import deStep04 from "../../../../images/de-step-04-tipps-empfangen.webp";

export type OnboardingLocale = "en" | "de";

/** Step index 0–3 aligned with SimpleSetupSection (account → team → QR → tips). */
export const LIVE_MINUTES_ONBOARDING_STEP_COUNT = 4;

const ONBOARDING_SCREENS: Record<OnboardingLocale, readonly string[]> = {
  en: [enStep01, enStep02, enStep03, enStep04],
  de: [deStep01, deStep02, deStep03, deStep04],
};

const STEP_LABELS: Record<OnboardingLocale, readonly string[]> = {
  en: [
    "Create your account",
    "Add your team",
    "Activate QR codes",
    "Start receiving tips",
  ],
  de: [
    "Account erstellen",
    "Team hinzufügen",
    "QR-Codes aktivieren",
    "Tipps empfangen",
  ],
};

const preloadPromises = new Map<string, Promise<void>>();
const preloadedSources = new Set<string>();

export function resolveLiveMinutesOnboardingLocale(language?: string): OnboardingLocale {
  return language?.toLowerCase().startsWith("de") ? "de" : "en";
}

export function getLiveMinutesOnboardingScreenSources(
  locale: OnboardingLocale,
): readonly string[] {
  return ONBOARDING_SCREENS[locale];
}

export function getLiveMinutesOnboardingScreenSrc(
  locale: OnboardingLocale,
  stepIndex: number,
): string {
  const sources = ONBOARDING_SCREENS[locale];
  const clamped = Math.min(Math.max(0, stepIndex), sources.length - 1);
  return sources[clamped];
}

export function getLiveMinutesOnboardingScreenAlt(
  locale: OnboardingLocale,
  stepIndex: number,
): string {
  const clamped = Math.min(Math.max(0, stepIndex), STEP_LABELS[locale].length - 1);
  return STEP_LABELS[locale][clamped] ?? "CareTip onboarding";
}

function preloadSingleOnboardingScreen(src: string): Promise<void> {
  const existing = preloadPromises.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const finish = () => {
      preloadedSources.add(src);
      resolve();
    };

    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (typeof img.decode === "function") {
        void img.decode().then(finish).catch(finish);
      } else {
        finish();
      }
    };
    img.onerror = finish;
    img.src = src;
  });

  preloadPromises.set(src, promise);
  return promise;
}

/** Fetch and decode onboarding screenshots for the active locale only. */
export function preloadLiveMinutesOnboardingScreens(
  locales: OnboardingLocale | OnboardingLocale[] = "en",
): Promise<void> {
  const list = Array.isArray(locales) ? locales : [locales];
  const uniqueLocales = [...new Set(list)];

  return Promise.all(
    uniqueLocales.map(async (locale) => {
      const sources = ONBOARDING_SCREENS[locale];
      await Promise.all(sources.map((src) => preloadSingleOnboardingScreen(src)));
    }),
  ).then(() => undefined);
}

export function isLiveMinutesOnboardingScreenPreloaded(src: string): boolean {
  return preloadedSources.has(src);
}

if (import.meta.env.DEV) {
  for (const locale of ["en", "de"] as const) {
    if (ONBOARDING_SCREENS[locale].length !== LIVE_MINUTES_ONBOARDING_STEP_COUNT) {
      console.warn(
        `[Live in Minutes] Expected ${LIVE_MINUTES_ONBOARDING_STEP_COUNT} onboarding screenshots for ${locale}.`,
      );
    }
  }
}
