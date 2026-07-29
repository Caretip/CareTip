import { useEffect, useRef, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useBootstrapReady } from "@/hooks/useAppReady";
import { useNavigationReady } from "@/hooks/useNavigationReady";
import { useSplashStore } from "@/store/splashStore";
import { colors } from "@/theme";
import { hideSplashOnce, logSplash } from "@/utils/splashLifecycle";

const REVEAL_MS = 300;
const FIRST_SCREEN_FALLBACK_MS = 1200;

type NativeSplashGateProps = {
  children: ReactNode;
};

/**
 * Native splash only — no JS splash overlay.
 * Hides native splash once bootstrap + navigation + first screen paint (with fallback).
 */
export function NativeSplashGate({ children }: NativeSplashGateProps) {
  const bootstrapReady = useBootstrapReady();
  const navigationReady = useNavigationReady();
  const firstScreenReady = useSplashStore((s) => s.firstScreenReady);
  const contentOpacity = useSharedValue(0);
  const completed = useRef(false);

  const reveal = (reason: string) => {
    if (completed.current) return;
    completed.current = true;
    logSplash("gate.reveal", { reason });
    hideSplashOnce(reason);
    contentOpacity.value = withTiming(1, {
      duration: REVEAL_MS,
      easing: Easing.out(Easing.cubic),
    });
  };

  useEffect(() => {
    logSplash("gate.state", { bootstrapReady, navigationReady, firstScreenReady });
  }, [bootstrapReady, navigationReady, firstScreenReady]);

  useEffect(() => {
    if (!bootstrapReady || !navigationReady || !firstScreenReady) return;
    reveal("first-screen-ready");
  }, [bootstrapReady, navigationReady, firstScreenReady]);

  useEffect(() => {
    if (!bootstrapReady || !navigationReady) return;
    const timer = setTimeout(() => reveal("first-screen-fallback"), FIRST_SCREEN_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [bootstrapReady, navigationReady]);

  const contentAnim = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.flex, contentAnim]}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
});
