import { useTranslation } from "react-i18next";
import { resolveAppLoadingContextMessage } from "./appLoadingContexts";
import { useRegisterPagePaintReady } from "./globalAppLoading";
import { useExtendGlobalLoaderUntilReady } from "./useExtendGlobalLoaderUntilReady";

/**
 * Shared business-dashboard page boot: paint latch + keep CareTip overlay up
 * through first data load so pages never flash skeleton after the global loader.
 */
export function useBusinessPageBoot(pageKey: string, isInitialLoad: boolean): {
  /** True when local skeletons should render (soft nav only). */
  showInitialSkeleton: boolean;
  coveredByGlobalLoader: boolean;
} {
  const { t } = useTranslation();
  useRegisterPagePaintReady(`business-${pageKey}-paint`);
  const coveredByGlobalLoader = useExtendGlobalLoaderUntilReady(
    `business-${pageKey}-boot`,
    isInitialLoad,
    resolveAppLoadingContextMessage("dashboard", t),
  );

  return {
    showInitialSkeleton: isInitialLoad && !coveredByGlobalLoader,
    coveredByGlobalLoader,
  };
}
