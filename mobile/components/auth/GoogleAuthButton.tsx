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
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      android_ripple={{ color: "rgba(255, 255, 255, 0.12)" }}
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
          <ActivityIndicator color={authBrand.fieldText} />
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

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.xl,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000000",
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 5 },
      default: {},
    }),
  },
  content: {
    minHeight: touchTarget + 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: authBrand.fieldFill,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: authBrand.fieldBorder,
    paddingHorizontal: spacing.xl,
  },
  label: {
    ...typography.button,
    color: authBrand.fieldText,
    fontWeight: "600",
    fontSize: 16,
    letterSpacing: 0.1,
  },
  disabled: {
    opacity: 0.55,
  },
});
