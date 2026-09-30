import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18N_STORAGE_KEY } from "./constants";
import {
  beginAppLanguageChange,
  endAppLanguageChange,
} from "../app/lib/appLanguageLoading";
import { registerI18nIntegrityDev } from "./i18nIntegrityDev";
import { markLandingColdLoad } from "../app/lib/landingColdLoadMarks";

export type AppLanguage = "de" | "en";

type TranslationBundle = Record<string, unknown>;

export function readStoredLanguage(): AppLanguage {
  if (typeof window === "undefined") return "de";
  try {
    const v = localStorage.getItem(I18N_STORAGE_KEY);
    if (v === "en" || v === "de") return v;
  } catch {
    /* ignore */
  }
  return "de";
}

/**
 * Language already applied to the document by `boot-locale.js` (first paint).
 * Prefer this over i18n `resolvedLanguage` so React cannot paint the other locale
 * while the HTML boot sentence is still German (or English).
 */
export function readDocumentOrStoredLanguage(): AppLanguage {
  if (typeof document !== "undefined") {
    const raw = document.documentElement.getAttribute("lang")?.toLowerCase() ?? "";
    if (raw === "en" || raw.startsWith("en-")) return "en";
    if (raw === "de" || raw.startsWith("de-")) return "de";
  }
  return readStoredLanguage();
}

export function resolveAppLanguageFromCode(lng: string | undefined): AppLanguage {
  const raw = (lng ?? "").toLowerCase();
  if (raw === "de" || raw.startsWith("de-")) return "de";
  if (raw === "en" || raw.startsWith("en-")) return "en";
  return "de";
}

let initPromise: Promise<typeof i18n> | null = null;
let alternateLocalePrefetch: Promise<void> | null = null;

export function getAlternateAppLanguage(lng?: string): AppLanguage {
  const current = resolveAppLanguageFromCode(lng ?? i18n.language);
  return current === "en" ? "de" : "en";
}

async function loadLocaleBundle(lng: AppLanguage): Promise<TranslationBundle> {
  const mod =
    lng === "en"
      ? await import("./locales/en.json")
      : await import("./locales/de.json");
  return (mod as { default?: TranslationBundle }).default ?? (mod as TranslationBundle);
}

/** Ensure translation resources exist before switching language. */
export async function ensureLocaleBundle(lng: AppLanguage): Promise<void> {
  await ensureI18nReady();
  if (i18n.hasResourceBundle(lng, "translation")) return;
  const bundle = await loadLocaleBundle(lng);
  i18n.addResourceBundle(lng, "translation", bundle, true, true);
}

/**
 * Idle prefetch of the non-active locale (~350KB JSON chunk) so DE↔EN switches
 * do not wait on network. Does not change the active language or block first paint.
 */
export function prefetchAlternateLocaleBundle(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return ensureI18nReady().then(() => {
    const alternate = getAlternateAppLanguage();
    if (i18n.hasResourceBundle(alternate, "translation")) return;
    if (!alternateLocalePrefetch) {
      alternateLocalePrefetch = loadLocaleBundle(alternate).then((bundle) => {
        i18n.addResourceBundle(alternate, "translation", bundle, true, true);
      });
    }
    return alternateLocalePrefetch;
  });
}

/** Prefetch EN + DE once the guest tipping journey starts (instant DE↔EN toggles). */
export async function prefetchCustomerJourneyLocaleBundles(): Promise<void> {
  if (typeof window === "undefined") return;
  await ensureI18nReady();
  await Promise.all([ensureLocaleBundle("en"), ensureLocaleBundle("de")]);
}

export type ChangeAppLanguageOptions = {
  /**
   * Guest QR / in-journey switches: keep the current page painted; do not signal
   * global language-change loading (avoids blank chrome / overlay flash).
   */
  keepPageVisible?: boolean;
};

/**
 * Switch UI language after the target locale bundle is loaded (avoids missing keys).
 */
export async function changeAppLanguage(
  lng: AppLanguage,
  options?: ChangeAppLanguageOptions,
): Promise<void> {
  const current = resolveAppLanguageFromCode(i18n.language);
  if (current === lng) return;
  const keepPageVisible = options?.keepPageVisible === true;
  if (!keepPageVisible) {
    beginAppLanguageChange();
  }
  try {
    markLandingColdLoad("lang-switch-start");
    await ensureLocaleBundle(lng);
    await i18n.changeLanguage(lng);
    markLandingColdLoad("lang-switch-complete");
  } finally {
    if (!keepPageVisible) {
      endAppLanguageChange();
    }
  }
}

/** Customer QR tipping — same persistence as {@link changeAppLanguage}, no global loader signal. */
export async function changeCustomerJourneyLanguage(lng: AppLanguage): Promise<void> {
  await changeAppLanguage(lng, { keepPageVisible: true });
}

/**
 * Initialize i18n before first React render.
 * Load only the active locale. Never fall back to the other product language
 * (English must not appear while the customer is in German, and vice versa).
 * Locale preference matches public/boot-locale.js (default `de`).
 */
export function ensureI18nReady(): Promise<typeof i18n> {
  if (i18n.isInitialized) return Promise.resolve(i18n);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const lng = readDocumentOrStoredLanguage();
    const primary = await loadLocaleBundle(lng);
    const resources: Record<string, { translation: TranslationBundle }> = {
      [lng]: { translation: primary },
    };

    await i18n.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: lng,
      supportedLngs: ["de", "en"],
      load: "currentOnly",
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });

    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", lng);
    }

    i18n.on("languageChanged", (nextLng) => {
      try {
        if (nextLng === "en" || nextLng === "de") {
          localStorage.setItem(I18N_STORAGE_KEY, nextLng);
          if (typeof document !== "undefined") {
            document.documentElement.setAttribute("lang", nextLng);
          }
        }
      } catch {
        /* ignore */
      }
    });

    registerI18nIntegrityDev(i18n);

    return i18n;
  })();

  return initPromise;
}

export default i18n;
