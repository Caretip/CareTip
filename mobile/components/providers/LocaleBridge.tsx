import { useEffect, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18nStore } from "@/i18n";
import { useUserStore } from "@/store/userStore";
import type { AppLanguage } from "@/i18n/types";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import { STARTUP_TASK_TIMEOUT_MS } from "@/constants/startup";
import { withTimeoutFallback } from "@/utils/withTimeout";

/**
 * Hydrates UI language from AsyncStorage / device, then syncs from signed-in preferredLocale.
 */
export function LocaleBridge({ children }: { children: ReactNode }) {
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const preferredLocale = useUserStore((s) => s.user?.preferredLocale);

  useEffect(() => {
    if (useI18nStore.getState().hydrated) return;
    void (async () => {
      const stored = await withTimeoutFallback(
        AsyncStorage.getItem(PREFERENCE_KEYS.language),
        STARTUP_TASK_TIMEOUT_MS,
        "localeBridge.language.read",
        null,
      );
      if (stored !== "en" && stored !== "de") {
        await setLanguage(resolveLoginLocale());
      }
    })();
  }, [setLanguage]);

  useEffect(() => {
    if (preferredLocale === "en" || preferredLocale === "de") {
      void setLanguage(preferredLocale as AppLanguage);
    }
  }, [preferredLocale, setLanguage]);

  return <>{children}</>;
}
