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
import { authBrand } from "@/theme/authBrand";
import { motion, radius, spacing, touchTarget, typography } from "@/theme";
import { textA11y } from "@/theme/a11y";
import { hapticLight } from "@/utils/haptics";

type GoogleAuthButtonProps = PressableProps & {
  label: string;
  loading?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function GoogleAuthButton({
  label,
  loading = false,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: GoogleAuthButtonProps) {
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      android_ripple={{ color: "rgba(11, 18, 32, 0.08)" }}
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
      style={[styles.button, isDisabled ? styles.disabled : null, animatedStyle]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={authBrand.dark} />
      ) : (
        <>
          <GoogleIcon size={20} />
          <Text style={styles.label} {...textA11y}>
            {label}
          </Text>
        </>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget + 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: "rgba(11, 18, 32, 0.1)",
    paddingHorizontal: spacing.xl,
    ...Platform.select({
      ios: {
        shadowColor: "#0B1220",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  label: {
    ...typography.button,
    color: authBrand.dark,
    fontWeight: "600",
    fontSize: 16,
    letterSpacing: 0.1,
  },
  disabled: {
    opacity: 0.55,
  },
});
