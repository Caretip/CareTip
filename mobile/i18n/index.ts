import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { en } from "./locales/en";
import { de } from "./locales/de";
import type { AppLanguage, MobileMessages, TranslationParams } from "./types";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import { STARTUP_TASK_TIMEOUT_MS } from "@/constants/startup";
import { withTimeoutFallback } from "@/utils/withTimeout";

const catalogs: Record<AppLanguage, MobileMessages> = { en, de };

type I18nState = {
  language: AppLanguage;
  hydrated: boolean;
  setLanguage: (lng: AppLanguage) => Promise<void>;
  hydrate: () => Promise<void>;
};

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    params[key] != null ? String(params[key]) : "",
  );
}

export function translate(
  language: AppLanguage,
  key: string,
  params?: TranslationParams,
): string {
  const primary = getByPath(catalogs[language], key);
  const fallback = language === "en" ? undefined : getByPath(catalogs.en, key);
  const raw = typeof primary === "string" ? primary : typeof fallback === "string" ? fallback : key;
  return interpolate(raw, params);
}

export const useI18nStore = create<I18nState>((set, get) => ({
  language: "en",
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const stored = await withTimeoutFallback(
        AsyncStorage.getItem(PREFERENCE_KEYS.language),
        STARTUP_TASK_TIMEOUT_MS,
        "i18n.language.read",
        null,
      );
      if (stored === "en" || stored === "de") {
        set({ language: stored, hydrated: true });
        return;
      }
    } catch {
      /* fall through — never block startup on locale I/O */
    }
    set({ hydrated: true });
  },
  setLanguage: async (lng) => {
    set({ language: lng });
    try {
      await AsyncStorage.setItem(PREFERENCE_KEYS.language, lng);
    } catch {
      /* non-fatal */
    }
  },
}));

export function getLanguage(): AppLanguage {
  return useI18nStore.getState().language;
}

export function uiLocaleTag(): string {
  return getLanguage() === "de" ? "de-DE" : "en-GB";
}

export function t(key: string, params?: TranslationParams): string {
  return translate(getLanguage(), key, params);
}

export type { AppLanguage, TranslationParams };
