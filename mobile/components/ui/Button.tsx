import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { motion, shadows, spacing, surface, touchTarget, typography } from "@/theme";
import { textA11y } from "@/theme/a11y";
import { hapticLight } from "@/utils/haptics";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";

type ButtonProps = PressableProps & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function createVariantStyles(colors: ColorPalette): Record<
  ButtonVariant,
  { container: ViewStyle; label: TextStyle }
> {
  return {
    primary: {
      container: { backgroundColor: colors.primary, ...shadows.sm },
      label: { color: colors.primaryForeground },
    },
    secondary: {
      container: { backgroundColor: colors.secondary },
      label: { color: colors.secondaryForeground },
    },
    outline: {
      container: {
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
      },
      label: { color: colors.foreground },
    },
    ghost: {
      container: { backgroundColor: "transparent" },
      label: { color: colors.foreground },
    },
    destructive: {
      container: { backgroundColor: colors.destructive, ...shadows.sm },
      label: { color: colors.destructiveForeground },
    },
  };
}

export function Button({
  label,
  variant = "primary",
  loading = false,
  disabled,
  style,
  labelStyle,
  onPressIn,
  onPressOut,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const variantStyles = useMemo(() => createVariantStyles(colors), [colors]);
  const palette = variantStyles[variant];
  const isDisabled = disabled || loading;
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const { accessibilityLabel: accessibilityLabelProp, ...pressableRest } = rest;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelProp ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPressIn={(e) => {
        scale.value = withSpring(0.97, motion.spring.press);
        if (!isDisabled) hapticLight();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.spring.press);
        onPressOut?.(e);
      }}
      style={[styles.base, palette.container, isDisabled ? styles.disabled : null, animatedStyle, style]}
      {...pressableRest}
    >
      {loading ? (
        <ActivityIndicator color={palette.label.color as string} />
      ) : (
        <Text style={[styles.label, palette.label, labelStyle]} {...textA11y}>
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    borderRadius: surface.pillRadius,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  label: {
    ...typography.button,
  },
  disabled: {
    opacity: 0.45,
  },
});
