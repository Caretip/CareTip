import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { BrandMarkWhite } from "@/components/brand/BrandMarkWhite";
import { brand } from "@/theme/colors";
import { spacing, typography } from "@/theme";
import { useI18n } from "@/hooks/useI18n";

type BootstrapScreenProps = {
  /** Optional override; defaults to localized tagline. */
  tagline?: string;
};

/**
 * In-app branded bootstrap — shown after native splash while session initializes.
 * No artificial delay; parent dismisses when auth hydration finishes.
 */
export function BootstrapScreen({ tagline }: BootstrapScreenProps) {
  const { t } = useI18n();
  const scale = useSharedValue(0.96);
  const opacity = useSharedValue(0.85);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    opacity.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity, scale]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.root} accessibilityLabel="CareTip">
      <Animated.View style={[styles.logoWrap, logoStyle]}>
        <BrandMarkWhite height={44} />
      </Animated.View>
      <Text style={styles.tagline}>{tagline ?? t("bootstrap.tagline")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: brand.orange,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["3xl"],
    gap: spacing.xl,
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  tagline: {
    ...typography.body,
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    fontWeight: "500",
    letterSpacing: 0.2,
  },
});
