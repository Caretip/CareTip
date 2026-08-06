import { useEffect, useRef } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import splashLogo from "@/assets/splash-native.png";
import { authBrand } from "@/theme/authBrand";
import { radius, spacing, typography } from "@/theme";

type BrandSplashOverlayProps = {
  /** 0–1 progress fill for the CareTip orange bar. */
  progress: number;
  /** Fade the entire overlay out when revealing the app. */
  visible: boolean;
  message: string;
  /** Fired once the overlay has laid out (safe to hide native splash). */
  onReady?: () => void;
};

/**
 * JS splash companion — keeps the existing CareTip splash logo and adds a
 * thin orange progress bar + status copy below it (template-inspired).
 */
export function BrandSplashOverlay({
  progress,
  visible,
  message,
  onReady,
}: BrandSplashOverlayProps) {
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(1);
  const bar = useSharedValue(Math.max(0.04, Math.min(1, progress)));
  const readySent = useRef(false);

  useEffect(() => {
    bar.value = withTiming(Math.max(0.04, Math.min(1, progress)), {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
  }, [bar, progress]);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
  }, [opacity, visible]);

  const rootAnim = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const fillAnim = useAnimatedStyle(() => ({
    width: `${bar.value * 100}%`,
  }));

  const handleReady = () => {
    if (readySent.current) return;
    readySent.current = true;
    onReady?.();
  };

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.root, rootAnim]}
      onLayout={handleReady}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "yes" : "no-hide-descendants"}
    >
      <View style={styles.center}>
        <Image
          source={splashLogo}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          accessibilityRole="image"
          accessibilityLabel="CareTip"
        />
      </View>

      <View style={[styles.loadingBlock, { paddingBottom: Math.max(insets.bottom, spacing.xl) + spacing["5xl"] }]}>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fillAnim]} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: authBrand.orange,
    zIndex: 50,
    justifyContent: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["4xl"],
  },
  logo: {
    width: 168,
    height: 168,
  },
  loadingBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing["5xl"],
  },
  message: {
    ...typography.caption,
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    letterSpacing: 0.35,
    fontWeight: "500",
    textAlign: "center",
  },
  track: {
    width: "72%",
    maxWidth: 240,
    height: 3,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  fill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: authBrand.white,
  },
});
