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

    void (async () => {
      await useI18nStore.getState().hydrate();
      await sessionManager.bootstrapSession();
    })();
  }, []);

  return <>{children}</>;
}
