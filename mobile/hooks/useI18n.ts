import { useCallback } from "react";
import { useI18nStore, translate, type AppLanguage, type TranslationParams } from "@/i18n";

export function useI18n() {
  const language = useI18nStore((s) => s.language);
  const hydrated = useI18nStore((s) => s.hydrated);
  const setLanguage = useI18nStore((s) => s.setLanguage);

  const t = useCallback(
    (key: string, params?: TranslationParams) => translate(language, key, params),
    [language],
  );

  return { t, language, hydrated, setLanguage };
}

export type { AppLanguage };
