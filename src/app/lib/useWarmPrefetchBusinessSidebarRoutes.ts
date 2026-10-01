import { useEffect } from "react";
import { runWhenIdle } from "./runWhenIdle";
import { prefetchBusinessSidebarRoutesIdle } from "./businessDashboardRoutePrefetch";

/** After business shell is ready, warm frequent sidebar destinations in idle time. */
export function useWarmPrefetchBusinessSidebarRoutes(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    runWhenIdle(() => prefetchBusinessSidebarRoutesIdle(), 2500);
  }, [enabled]);
}
