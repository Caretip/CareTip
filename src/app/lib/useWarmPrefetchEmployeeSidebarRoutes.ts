import { useEffect } from "react";
import { runWhenIdle } from "./runWhenIdle";
import { prefetchEmployeeSidebarRoutesIdle } from "./employeeDashboardRoutePrefetch";

export function useWarmPrefetchEmployeeSidebarRoutes(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    runWhenIdle(() => prefetchEmployeeSidebarRoutesIdle(), 2500);
  }, [enabled]);
}
