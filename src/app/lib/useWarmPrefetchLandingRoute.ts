import { useEffect } from "react";
import { scheduleMobileDeferredWork } from "@/lib/mobilePerf";
import { prefetchLandingRoute } from "./prefetchPublicRoutes";

/** Warm landing chunk + LCP hero while the user is away from `/` (authenticated shells). */
export function useWarmPrefetchLandingRoute(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    scheduleMobileDeferredWork(
      () => {
        prefetchLandingRoute();
      },
      { desktopTimeoutMs: 1800, mobileTimeoutMs: 2800 },
    );
  }, [enabled]);
}
