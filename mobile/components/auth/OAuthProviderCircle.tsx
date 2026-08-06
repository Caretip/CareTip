import { useMemo, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { authBrand } from "@/theme/authBrand";
import type { ColorPalette } from "@/theme/colors";
import { motion, shadows, touchTarget } from "@/theme";
import { hapticLight } from "@/utils/haptics";

export type OAuthProviderCircleVariant = "hero" | "surface";

const CIRCLE_SIZE = touchTarget; // 48 — accessible minimum

type OAuthProviderCircleProps = PressableProps & {
  accessibilityLabel: string;
  icon: ReactNode;
  loading?: boolean;
  variant?: OAuthProviderCircleVariant;
  /** Optional brand fill (e.g. Apple black, Facebook blue). */
  fillColor?: string;
  borderColor?: string;
  spinnerColor?: string;
};

/**
 * Compact circular OAuth provider control (Dharma-inspired layout, CareTip branding).
 * Icon-only — labels via accessibilityLabel for VoiceOver / TalkBack.
 */
export function OAuthProviderCircle({
  accessibilityLabel,
  icon,
  loading = false,
  disabled,
  variant = "hero",
  fillColor,
  borderColor,
  spinnerColor: spinnerOverride,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: OAuthProviderCircleProps) {
  const { colors } = useTheme();
  const { styles, spinnerColor, rippleColor } = useMemo(
    () => createStyles(colors, variant, fillColor, borderColor, spinnerOverride),
    [borderColor, colors, fillColor, spinnerOverride, variant],
  );
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      android_ripple={{ color: rippleColor, borderless: true, radius: CIRCLE_SIZE / 2 }}
      hitSlop={6}
      onPress={onPress}
      onPressIn={(e) => {
        if (!isDisabled) hapticLight();
        scale.value = withSpring(0.92, motion.spring.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.spring.press);
        onPressOut?.(e);
      }}
      style={[styles.button, isDisabled ? styles.disabled : null]}
      {...rest}
    >
      <Animated.View style={[styles.inner, animatedStyle]} collapsable={false}>
        {loading ? <ActivityIndicator color={spinnerColor} size="small" /> : icon}
      </Animated.View>
    </Pressable>
  );
}

function createStyles(
  colors: ColorPalette,
  variant: OAuthProviderCircleVariant,
  fillColor?: string,
  borderColorOverride?: string,
  spinnerOverride?: string,
) {
  const isSurface = variant === "surface";
  const backgroundColor =
    fillColor ?? (isSurface ? colors.card : authBrand.glassFill);
  const borderColor =
    borderColorOverride ?? (isSurface ? colors.borderStrong : authBrand.glassBorder);
  const spinnerColor =
    spinnerOverride ?? (fillColor ? "#FFFFFF" : isSurface ? colors.foreground : authBrand.dark);
  const rippleColor = isSurface ? colors.authSurfaceGoogleRipple : "rgba(255, 255, 255, 0.2)";

  const styles = StyleSheet.create({
    button: {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: CIRCLE_SIZE / 2,
      overflow: "hidden",
      ...(isSurface
        ? {
            ...shadows.sm,
            shadowColor: colors.foreground,
            shadowOpacity: Platform.OS === "ios" ? 0.08 : 0,
          }
        : Platform.select({
            ios: {
              shadowColor: "#000000",
              shadowOpacity: 0.16,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
            },
            android: { elevation: 4 },
            default: {},
          })),
    },
    inner: {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: CIRCLE_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor,
      borderWidth: borderColor === "transparent" || fillColor === "transparent" ? 0 : 1.5,
      borderColor: borderColor === "transparent" ? "transparent" : borderColor,
      overflow: "hidden",
    },
    disabled: {
      opacity: 0.5,
    },
  });

  return { styles, spinnerColor, rippleColor };
}
