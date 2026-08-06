import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { BrandSplashOverlay } from "@/components/brand/BrandSplashOverlay";
import { useBootstrapReady } from "@/hooks/useAppReady";
import { useI18n } from "@/hooks/useI18n";
import { useNavigationReady } from "@/hooks/useNavigationReady";
import { useTheme } from "@/hooks/useTheme";
import { useSplashStore } from "@/store/splashStore";
import { hideSplashOnce, logSplash } from "@/utils/splashLifecycle";

const REVEAL_MS = 380;
const FIRST_SCREEN_FALLBACK_MS = 1200;
const PROGRESS_TICK_MS = 180;
const COMPLETE_HOLD_MS = 220;

type NativeSplashGateProps = {
  children: ReactNode;
};

/**
 * Native splash + branded JS companion (logo + progress).
 * Hides native splash once the JS overlay has painted, then fades into the app
 * when bootstrap + navigation + first screen are ready.
 */
export function NativeSplashGate({ children }: NativeSplashGateProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: colors.background },
        flex: { flex: 1 },
      }),
    [colors.background],
  );
  const bootstrapReady = useBootstrapReady();
  const navigationReady = useNavigationReady();
  const firstScreenReady = useSplashStore((s) => s.firstScreenReady);
  const contentOpacity = useSharedValue(0);
  const completed = useRef(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [progress, setProgress] = useState(0.08);

  const reveal = (reason: string) => {
    if (completed.current) return;
    completed.current = true;
    logSplash("gate.reveal", { reason });
    setProgress(1);
    hideSplashOnce(reason);
    setTimeout(() => {
      setOverlayVisible(false);
      contentOpacity.value = withTiming(1, {
        duration: REVEAL_MS,
        easing: Easing.out(Easing.cubic),
      });
    }, COMPLETE_HOLD_MS);
  };

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
    if (!bootstrapReady || !navigationReady || !firstScreenReady) return;
    reveal("first-screen-ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reveal is stable for gate lifetime
  }, [bootstrapReady, navigationReady, firstScreenReady]);

  useEffect(() => {
    if (!bootstrapReady || !navigationReady) return;
    const timer = setTimeout(() => reveal("first-screen-fallback"), FIRST_SCREEN_FALLBACK_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapReady, navigationReady]);

  const contentAnim = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.flex, contentAnim]}>{children}</Animated.View>
      <BrandSplashOverlay
        progress={progress}
        visible={overlayVisible}
        message={t("auth.splashPreparing")}
        onReady={() => hideSplashOnce("js-overlay-ready")}
      />
    </View>
  );
}
