import { useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { useTheme } from "@/hooks/useTheme";
import { authBrand } from "@/theme/authBrand";
import type { ColorPalette } from "@/theme/colors";
import { motion, radius, shadows, spacing, touchTarget, typography } from "@/theme";
import { textA11y } from "@/theme/a11y";
import { hapticLight } from "@/utils/haptics";

type GoogleAuthButtonVariant = "hero" | "surface";

type GoogleAuthButtonProps = PressableProps & {
  label: string;
  loading?: boolean;
  /** Hero = floating glass on auth image; surface = bottom sheets and cards. */
  variant?: GoogleAuthButtonVariant;
};

export function GoogleAuthButton({
  label,
  loading = false,
  disabled,
  variant = "hero",
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: GoogleAuthButtonProps) {
  const { colors } = useTheme();
  const { styles, labelColor, rippleColor } = useMemo(
    () => createStyles(colors, variant),
    [colors, variant],
  );
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      android_ripple={{ color: rippleColor }}
      onPress={onPress}
      onPressIn={(e) => {
        if (!isDisabled) hapticLight();
        scale.value = withSpring(0.98, motion.spring.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.spring.press);
        onPressOut?.(e);
      }}
      style={[styles.button, isDisabled ? styles.disabled : null]}
      {...rest}
    >
      <Animated.View style={[styles.content, animatedStyle]} collapsable={false}>
        {loading ? (
          <ActivityIndicator color={labelColor} />
        ) : (
          <>
            <GoogleIcon size={20} />
            <Text style={styles.label} {...textA11y}>
              {label}
            </Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: ColorPalette, variant: GoogleAuthButtonVariant) {
  const isSurface = variant === "surface";
  const backgroundColor = isSurface ? colors.authSurfaceGoogleBg : authBrand.fieldFill;
  const borderColor = isSurface ? colors.authSurfaceGoogleBorder : authBrand.fieldBorder;
  const labelColor = isSurface ? colors.authSurfaceGoogleText : authBrand.fieldText;
  const rippleColor = isSurface ? colors.authSurfaceGoogleRipple : "rgba(255, 255, 255, 0.12)";

  const styles = StyleSheet.create({
    button: {
      borderRadius: radius["2xl"],
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
              shadowOpacity: 0.18,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 8 },
            },
            android: { elevation: 5 },
            default: {},
          })),
    },
    content: {
      minHeight: touchTarget + 6,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      backgroundColor,
      borderRadius: radius["2xl"],
      borderWidth: 1.5,
      borderColor,
      paddingHorizontal: spacing.xl,
    },
    label: {
      ...typography.button,
      color: labelColor,
      fontWeight: "600",
      fontSize: 16,
      letterSpacing: 0.1,
    },
    disabled: {
      opacity: 0.55,
    },
  });

  return { styles, labelColor, rippleColor };
}
