import { useRegisterPagePaintReady } from "./globalAppLoading";
import { useExtendGlobalLoaderUntilReady } from "./useExtendGlobalLoaderUntilReady";

/**
 * Shared business-dashboard page boot: paint latch + keep cold-entry overlay up
 * through first data load. Soft SPA nav uses local skeletons only (no brand text).
 */
export function useBusinessPageBoot(pageKey: string, isInitialLoad: boolean): {
  /** True when local skeletons should render (soft nav only). */
  showInitialSkeleton: boolean;
  coveredByGlobalLoader: boolean;
} {
  useRegisterPagePaintReady(`business-${pageKey}-paint`);
  const coveredByGlobalLoader = useExtendGlobalLoaderUntilReady(
    `business-${pageKey}-boot`,
    isInitialLoad,
  );

  return {
    showInitialSkeleton: isInitialLoad && !coveredByGlobalLoader,
    coveredByGlobalLoader,
  };
}
