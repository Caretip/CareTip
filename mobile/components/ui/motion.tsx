import { useEffect } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { motion } from "@/theme";

type FadeInProps = {
  children: React.ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Subtle fade + upward entrance for dashboard sections.
 * Opacity-only on dense KPI grids; translateY kept small for performance.
 */
export function FadeIn({ children, index = 0, style }: FadeInProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue<number>(motion.entrance.translateY);

  useEffect(() => {
    const delay = Math.min(index * 45, 220);
    opacity.value = withDelay(delay, withTiming(1, { duration: motion.entrance.fade }));
    translateY.value = withDelay(delay, withTiming(0, { duration: motion.entrance.fade }));
  }, [index, opacity, translateY]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[styles.base, animated, style]}>{children}</Animated.View>;
}

type PressableScaleProps = {
  children: React.ReactNode;
  pressed?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PressScale({ children, pressed, style }: PressableScaleProps) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withTiming(pressed ? 0.98 : 1, { duration: motion.duration.instant });
  }, [pressed, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={[animated, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  base: {},
});
