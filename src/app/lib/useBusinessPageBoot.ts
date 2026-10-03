import { useRegisterPagePaintReady } from "./globalAppLoading";

/**
 * Shared business-dashboard page boot: one-frame paint latch only.
 * Optional page data must not register `business-*-boot` on the global overlay —
 * use local skeletons / inline loading after the shell is ready.
 */
export function useBusinessPageBoot(pageKey: string, isInitialLoad: boolean): {
  /** True while first paint data is pending — render page skeleton/spinner. */
  showInitialSkeleton: boolean;
  /** @deprecated Always false — page data no longer extends the global branded loader. */
  coveredByGlobalLoader: boolean;
} {
  useRegisterPagePaintReady(`business-${pageKey}-paint`);

  return {
    showInitialSkeleton: isInitialLoad,
    coveredByGlobalLoader: false,
  };
}
