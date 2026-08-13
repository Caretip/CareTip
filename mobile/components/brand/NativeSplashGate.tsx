import { useEffect, useRef, type ReactNode } from "react";
import { useBootstrapReady } from "@/hooks/useAppReady";
import { useNavigationReady } from "@/hooks/useNavigationReady";
import { useSplashStore } from "@/store/splashStore";
import {
  shouldRevealAfterDestination,
  shouldRevealAfterFallback,
} from "@/utils/splashHandoffPolicy";
import {
  hideSplashOnce,
  logSplash,
  setSplashWatchdogReveal,
} from "@/utils/splashLifecycle";

/**
 * After bootstrap + nav, wait briefly for SplashScreenAnchor if it never fires
 * (broken destination). Not an artificial minimum splash duration.
 */
const FIRST_SCREEN_FALLBACK_MS = 1600;

type NativeSplashGateProps = {
  children: ReactNode;
};

/**
 * Owns native Expo splash hide only. No React splash, logo, progress, or underlay.
 * App tree renders underneath the native splash; hideAsync runs when the real
 * destination has painted (or fallback / watchdog).
 */
export function NativeSplashGate({ children }: NativeSplashGateProps) {
  const bootstrapReady = useBootstrapReady();
  const navigationReady = useNavigationReady();
  const firstScreenReady = useSplashStore((s) => s.firstScreenReady);
  const completed = useRef(false);

  const reveal = (reason: string) => {
    if (completed.current) return;
    completed.current = true;
    logSplash("gate.reveal", { reason });
    hideSplashOnce(reason, { duration: 0, fade: false });
  };

  useEffect(() => {
    setSplashWatchdogReveal(() => reveal("watchdog"));
    return () => setSplashWatchdogReveal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register once per mount
  }, []);

  useEffect(() => {
    logSplash("gate.state", { bootstrapReady, navigationReady, firstScreenReady });
  }, [bootstrapReady, navigationReady, firstScreenReady]);

  useEffect(() => {
    if (
      !shouldRevealAfterDestination({
        bootstrapReady,
        navigationReady,
        firstScreenReady,
      })
    ) {
      return;
    }
    reveal("first-screen-ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapReady, navigationReady, firstScreenReady]);

  useEffect(() => {
    if (!shouldRevealAfterFallback({ bootstrapReady, navigationReady })) return;
    const timer = setTimeout(() => reveal("first-screen-fallback"), FIRST_SCREEN_FALLBACK_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapReady, navigationReady]);

  return <>{children}</>;
}
