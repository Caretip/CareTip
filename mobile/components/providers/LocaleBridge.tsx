import { useEffect, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useI18nStore } from "@/i18n";
import { useUserStore } from "@/store/userStore";
import type { AppLanguage } from "@/i18n/types";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";

/**
 * Hydrates UI language from AsyncStorage / device, then syncs from signed-in preferredLocale.
 */
export function LocaleBridge({ children }: { children: ReactNode }) {
  const hydrate = useI18nStore((s) => s.hydrate);
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const preferredLocale = useUserStore((s) => s.user?.preferredLocale);

  useEffect(() => {
    void (async () => {
      await hydrate();
      const stored = await AsyncStorage.getItem(PREFERENCE_KEYS.language);
      if (stored !== "en" && stored !== "de") {
        await setLanguage(resolveLoginLocale());
      }
    })();
  }, [hydrate, setLanguage]);

  useEffect(() => {
    if (preferredLocale === "en" || preferredLocale === "de") {
      void setLanguage(preferredLocale as AppLanguage);
    }
  }, [preferredLocale, setLanguage]);

  return <>{children}</>;
}
