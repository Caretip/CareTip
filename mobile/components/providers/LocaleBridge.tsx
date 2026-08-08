import { useEffect, type ReactNode } from "react";
import { useI18nStore } from "@/i18n";
import { useUserStore } from "@/store/userStore";
import type { AppLanguage } from "@/i18n/types";

/**
 * Locale sync after StartupBridge hydrate — avoids a second AsyncStorage race
 * that could flip splash copy mid-overlay.
 */
export function LocaleBridge({ children }: { children: ReactNode }) {
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const preferredLocale = useUserStore((s) => s.user?.preferredLocale);

  useEffect(() => {
    // Idempotent — StartupBridge usually hydrates first.
    void useI18nStore.getState().hydrate();
  }, []);

  useEffect(() => {
    if (preferredLocale === "en" || preferredLocale === "de") {
      void setLanguage(preferredLocale as AppLanguage);
    }
  }, [preferredLocale, setLanguage]);

  return <>{children}</>;
}
