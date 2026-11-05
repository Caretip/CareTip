import { scheduleIdleWork } from "@/lib/publicRouteDefer";
import { fetchBusinessBrandingSettings } from "./api";
import { fetchVenueCatalog } from "./businessVenueCatalog";

let warmed = false;

/** A refresh has no navigation intent, so warming would only spend the user's API budget. */
function isDocumentReload(): boolean {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return navigation?.type === "reload";
}

/** Idle prefetch for QR Studio routes — venue catalog + branding settings. */
export function preloadQrStudioDashboardData(): void {
  if (warmed || typeof window === "undefined" || isDocumentReload()) return;
  warmed = true;
  scheduleIdleWork(() => {
    void fetchVenueCatalog().catch(() => {});
    void fetchBusinessBrandingSettings().catch(() => {});
  }, 2_500);
}

export function resetQrStudioWarmCache(): void {
  warmed = false;
}
