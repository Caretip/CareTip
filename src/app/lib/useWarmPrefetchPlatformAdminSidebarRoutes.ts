import { useEffect } from "react";
import { runWhenIdle } from "./runWhenIdle";
import { prefetchPlatformAdminSidebarRoutesIdle } from "./platformAdminRoutePrefetch";

export function useWarmPrefetchPlatformAdminSidebarRoutes(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    runWhenIdle(() => prefetchPlatformAdminSidebarRoutesIdle(), 2500);
  }, [enabled]);
}
