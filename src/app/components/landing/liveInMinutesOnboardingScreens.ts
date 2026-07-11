export type OnboardingLocale = "en" | "de";

/** Step index 0–3 aligned with SimpleSetupSection (account → team → QR → tips). */
export const LIVE_MINUTES_ONBOARDING_STEP_COUNT = 4;

type ImageModule = { default: string };

const ONBOARDING_SCREEN_LOADERS: Record<
  OnboardingLocale,
  readonly (() => Promise<ImageModule>)[]
> = {
  en: [
    () => import("../../../../images/en-step-01-create-account.webp"),
    () => import("../../../../images/en-step-02-add-team.webp"),
    () => import("../../../../images/en-step-03-activate-qr.webp"),
    () => import("../../../../images/en-step-04-receive-tips.webp"),
  ],
  de: [
    () => import("../../../../images/de-step-01-konto-erstellen.webp"),
    () => import("../../../../images/de-step-02-team-einladen.webp"),
    () => import("../../../../images/de-step-03-qr-aktivieren.webp"),
    () => import("../../../../images/de-step-04-tipps-empfangen.webp"),
  ],
};

const resolvedSources: Record<OnboardingLocale, (string | undefined)[]> = {
  en: [],
  de: [],
};

const resolvePromises = new Map<OnboardingLocale, Promise<readonly string[]>>();

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

async function resolveLocaleSources(locale: OnboardingLocale): Promise<readonly string[]> {
  const cached = resolvedSources[locale];
  if (
    cached.length === ONBOARDING_SCREEN_LOADERS[locale].length &&
    cached.every(Boolean)
  ) {
    return cached as string[];
  }

  const existing = resolvePromises.get(locale);
  if (existing) return existing;

  const promise = Promise.all(
    ONBOARDING_SCREEN_LOADERS[locale].map((load) => load().then((mod) => mod.default)),
  ).then((urls) => {
    resolvedSources[locale] = urls;
    return urls;
  });

  resolvePromises.set(locale, promise);
  return promise;
}

export function getLiveMinutesOnboardingScreenSources(
  locale: OnboardingLocale,
): readonly string[] {
  return resolvedSources[locale].filter(Boolean) as string[];
}

export function getLiveMinutesOnboardingScreenSrc(
  locale: OnboardingLocale,
  stepIndex: number,
): string | undefined {
  const sources = resolvedSources[locale];
  const clamped = Math.min(Math.max(0, stepIndex), sources.length - 1);
  const src = sources[clamped];
  return src || undefined;
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

/** Resolve, fetch, and decode onboarding screenshots for the active locale only. */
export function preloadLiveMinutesOnboardingScreens(
  locales: OnboardingLocale | OnboardingLocale[] = "en",
): Promise<void> {
  const list = Array.isArray(locales) ? locales : [locales];
  const uniqueLocales = [...new Set(list)];

  return Promise.all(
    uniqueLocales.map(async (locale) => {
      const sources = await resolveLocaleSources(locale);
      await Promise.all(sources.map((src) => preloadSingleOnboardingScreen(src)));
    }),
  ).then(() => undefined);
}

export function isLiveMinutesOnboardingScreenPreloaded(src: string): boolean {
  return preloadedSources.has(src);
}

if (import.meta.env.DEV) {
  for (const locale of ["en", "de"] as const) {
    if (ONBOARDING_SCREEN_LOADERS[locale].length !== LIVE_MINUTES_ONBOARDING_STEP_COUNT) {
      console.warn(
        `[Live in Minutes] Expected ${LIVE_MINUTES_ONBOARDING_STEP_COUNT} onboarding screenshots for ${locale}.`,
      );
    }
  }
}
