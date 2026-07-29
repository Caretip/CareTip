import { useAuth } from "@/hooks/useAuth";
import { useFontsReady } from "@/hooks/useFontsReady";
import { useI18nStore } from "@/i18n";

/**
 * Bootstrap gate — fonts, auth session, and locale preferences.
 * Does not include navigation or first-screen paint (see NativeSplashGate).
 */
export function useBootstrapReady(): boolean {
  const fontsReady = useFontsReady();
  const { isHydrated, status } = useAuth();
  const i18nHydrated = useI18nStore((s) => s.hydrated);

  const authReady = isHydrated && status !== "idle" && status !== "bootstrapping";
  return fontsReady && authReady && i18nHydrated;
}

/** @deprecated Prefer useBootstrapReady — kept for existing imports. */
export function useAppReady(): boolean {
  return useBootstrapReady();
}
