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
 * Opacity-only entrance — avoids Reanimated layout animations that can
 * overlap siblings in flex-wrap KPI grids on Android.
 */
export function FadeIn({ children, index = 0, style }: FadeInProps) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withDelay(
      Math.min(index * 35, 200),
      withTiming(1, { duration: motion.entrance.fade }),
    );
  }, [index, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
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
