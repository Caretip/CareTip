import { useAuth } from "@/hooks/useAuth";
import { useFontsReady } from "@/hooks/useFontsReady";
import { useI18nStore } from "@/i18n";
import { useStartupStore } from "@/store/startupStore";

/**
 * True when fonts, auth, and locale are ready — or startup settled (incl. timeout).
 */
export function useBootstrapReady(): boolean {
  const fontsReady = useFontsReady();
  const { isHydrated, status } = useAuth();
  const i18nHydrated = useI18nStore((s) => s.hydrated);
  const bootstrapSettled = useStartupStore((s) => s.bootstrapSettled);

  const authReady = isHydrated && status !== "idle" && status !== "bootstrapping";
  return (fontsReady && authReady && i18nHydrated) || bootstrapSettled;
}

/** Routing gates (index redirects) — never wait past bootstrap settlement. */
export function useSessionRoutingReady(): boolean {
  const { isHydrated, status } = useAuth();
  const bootstrapSettled = useStartupStore((s) => s.bootstrapSettled);

  if (bootstrapSettled) return true;
  return isHydrated && status !== "idle" && status !== "bootstrapping";
}

/** @deprecated Prefer useBootstrapReady */
export function useAppReady(): boolean {
  return useBootstrapReady();
}
