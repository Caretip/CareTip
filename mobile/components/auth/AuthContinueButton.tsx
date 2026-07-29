import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { authBrand } from "@/theme/authBrand";
import { motion, spacing, touchTarget, typography } from "@/theme";

type AuthContinueButtonProps = PressableProps & {
  label: string;
  loading?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function AuthContinueButton({
  label,
  loading = false,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: AuthContinueButtonProps) {
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={isDisabled}
      android_ripple={{ color: "rgba(255,255,255,0.22)" }}
      onPressIn={(e) => {
        scale.value = withSpring(0.97, motion.spring.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.spring.press);
        onPressOut?.(e);
      }}
      style={[styles.wrap, isDisabled ? styles.disabled : null, animatedStyle]}
      {...rest}
    >
      <LinearGradient
        colors={[authBrand.orangeSoft, authBrand.orange, authBrand.orangeDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {loading ? (
          <ActivityIndicator color={authBrand.white} />
        ) : (
          <Text style={styles.label}>{label}</Text>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 18,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: authBrand.orangeDeep,
        shadowOpacity: 0.42,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  gradient: {
    minHeight: touchTarget + 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  label: {
    ...typography.button,
    color: authBrand.white,
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.55,
  },
});
