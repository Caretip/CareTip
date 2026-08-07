import { useEffect, type ReactNode } from "react";
import { useSplashStore } from "@/store/splashStore";
import { useStartupStore } from "@/store/startupStore";
import { sessionManager } from "@/services/auth/sessionManager";
import { useI18nStore } from "@/i18n";
import {
  ensureSplashPrevented,
  resetSplashLifecycle,
  scheduleSplashWatchdog,
} from "@/utils/splashLifecycle";
import { cleanupShareTempFiles } from "@/services/share";

/**
 * Idempotent cold/warm start — resets splash state, bounds bootstrap, arms watchdog.
 */
export function StartupBridge({ children }: { children: ReactNode }) {
  useEffect(() => {
    useStartupStore.getState().reset();
    useSplashStore.getState().reset();
    resetSplashLifecycle();
    ensureSplashPrevented();
    scheduleSplashWatchdog();

    // Clear orphaned share temps / interrupted export files from prior sessions.
    void cleanupShareTempFiles({ includeExport: true });

    void Promise.all([
      useI18nStore.getState().hydrate(),
      sessionManager.bootstrapSession(),
    ]);
  }, []);

  return <>{children}</>;
}
