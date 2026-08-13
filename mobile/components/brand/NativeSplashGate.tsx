import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { BrandSplashOverlay } from "@/components/brand/BrandSplashOverlay";
import { useBootstrapReady } from "@/hooks/useAppReady";
import { useI18n } from "@/hooks/useI18n";
import { useNavigationReady } from "@/hooks/useNavigationReady";
import { useSplashStore } from "@/store/splashStore";
import { authBrand } from "@/theme/authBrand";
import {
  shouldRevealAfterDestination,
  shouldRevealAfterFallback,
} from "@/utils/splashHandoffPolicy";
import {
  hideSplashOnce,
  logSplash,
  setSplashWatchdogReveal,
} from "@/utils/splashLifecycle";

/** Destination should paint shortly after route resolve; still requires bootstrap+nav. */
const FIRST_SCREEN_FALLBACK_MS = 1600;
const PROGRESS_TICK_MS = 180;
/** Let the React overlay paint Preparing… under native before peeling the underlay. */
const NATIVE_HANDOFF_DELAY_MS = 48;

type NativeSplashGateProps = {
  children: ReactNode;
};

/**
 * Native underlay + React BrandSplashOverlay (SSOT startup narrative).
 * Destination paints under the overlay; reveal only hides the overlay.
 * After reveal, this gate must not keep an orange canvas between screens.
 */
export function NativeSplashGate({ children }: NativeSplashGateProps) {
  const { t } = useI18n();
  const bootstrapReady = useBootstrapReady();
  const navigationReady = useNavigationReady();
  const firstScreenReady = useSplashStore((s) => s.firstScreenReady);
  const completed = useRef(false);
  const nativeHandoffStarted = useRef(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [progress, setProgress] = useState(0.08);

  const reveal = (reason: string) => {
    if (completed.current) return;
    completed.current = true;
    logSplash("gate.reveal", { reason });
    setProgress(1);
    hideSplashOnce(reason, { duration: 120, fade: true });
    setOverlayVisible(false);
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
    if (completed.current) return;
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 0.86) return prev;
        const step = prev < 0.4 ? 0.07 : prev < 0.7 ? 0.045 : 0.02;
        return Math.min(0.86, prev + step);
      });
    }, PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

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

  const handoffNativeSplash = () => {
    if (nativeHandoffStarted.current || completed.current) return;
    nativeHandoffStarted.current = true;
    setTimeout(() => {
      hideSplashOnce("js-overlay-ready", { duration: 160, fade: true });
    }, NATIVE_HANDOFF_DELAY_MS);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: overlayVisible ? authBrand.orange : "transparent",
        },
        flex: { flex: 1 },
      }),
    [overlayVisible],
  );

  return (
    <View style={styles.root}>
      <View style={styles.flex}>{children}</View>
      <BrandSplashOverlay
        progress={progress}
        visible={overlayVisible}
        message={t("auth.splashPreparing")}
        onReady={handoffNativeSplash}
      />
    </View>
  );
}
