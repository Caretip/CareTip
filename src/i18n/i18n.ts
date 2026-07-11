import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18N_STORAGE_KEY } from "./constants";
import {
  beginAppLanguageChange,
  endAppLanguageChange,
} from "../app/lib/appLanguageLoading";
import { registerI18nIntegrityDev } from "./i18nIntegrityDev";
import { scheduleMobileDeferredWork } from "../lib/mobilePerf";

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

let initPromise: Promise<typeof i18n> | null = null;

async function loadLocaleBundle(lng: AppLanguage): Promise<TranslationBundle> {
  const mod =
    lng === "en"
      ? await import("./locales/en.json")
      : await import("./locales/de.json");
  return (mod as { default?: TranslationBundle }).default ?? (mod as TranslationBundle);
}

function scheduleFallbackLocaleLoad(activeLng: AppLanguage): void {
  const fallbackLng: AppLanguage = activeLng === "de" ? "en" : "de";
  scheduleMobileDeferredWork(() => {
    void (async () => {
      if (i18n.hasResourceBundle(fallbackLng, "translation")) return;
      const bundle = await loadLocaleBundle(fallbackLng);
      i18n.addResourceBundle(fallbackLng, "translation", bundle, true, true);
    })();
  });
}

/** Ensure translation resources exist before switching language. */
export async function ensureLocaleBundle(lng: AppLanguage): Promise<void> {
  await ensureI18nReady();
  if (i18n.hasResourceBundle(lng, "translation")) return;
  const bundle = await loadLocaleBundle(lng);
  i18n.addResourceBundle(lng, "translation", bundle, true, true);
}

/**
 * Switch UI language after the target locale bundle is loaded (avoids missing keys).
 */
export async function changeAppLanguage(lng: AppLanguage): Promise<void> {
  const current = i18n.language?.startsWith("de") ? "de" : "en";
  if (current === lng) return;
  beginAppLanguageChange();
  try {
    await ensureLocaleBundle(lng);
    await i18n.changeLanguage(lng);
  } finally {
    endAppLanguageChange();
  }
}

/**
 * Initialize i18n before first React render.
 * Active locale loads first; the alternate locale is deferred to idle.
 */
export function ensureI18nReady(): Promise<typeof i18n> {
  if (i18n.isInitialized) return Promise.resolve(i18n);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const lng = readStoredLanguage();
    const primary = await loadLocaleBundle(lng);
    const resources: Record<string, { translation: TranslationBundle }> = {
      [lng]: { translation: primary },
    };

    await i18n.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: "en",
      supportedLngs: ["de", "en"],
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });

    scheduleFallbackLocaleLoad(lng);

    i18n.on("languageChanged", (nextLng) => {
      try {
        if (nextLng === "en" || nextLng === "de") {
          localStorage.setItem(I18N_STORAGE_KEY, nextLng);
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
