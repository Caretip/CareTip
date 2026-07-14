import { useEffect } from "react";
import { scheduleMobileDeferredWork } from "@/lib/mobilePerf";
import { prefetchAuthLoginRoute } from "../routing/routeLazy";

/** Warm auth login chunk+CSS while the user is in an authenticated shell. */
export function useWarmPrefetchAuthLoginRoute(loginPath: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    scheduleMobileDeferredWork(() => {
      prefetchAuthLoginRoute(loginPath);
    });
  }, [enabled, loginPath]);
}
