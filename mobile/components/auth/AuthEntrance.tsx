import { useEffect, type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { motion } from "@/theme";

type AuthEntranceProps = {
  children: ReactNode;
  /** Stagger index — 0 = first element after hero. */
  index?: number;
  style?: StyleProp<ViewStyle>;
};

const BASE_DELAY_MS = 100;
const STAGGER_MS = 65;

/**
 * Subtle auth form entrance — fade + upward motion, no flashy effects.
 */
export function AuthEntrance({ children, index = 0, style }: AuthEntranceProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue<number>(motion.entrance.translateY);

  useEffect(() => {
    const delay = BASE_DELAY_MS + index * STAGGER_MS;
    const ease = Easing.out(Easing.cubic);
    opacity.value = withDelay(delay, withTiming(1, { duration: 420, easing: ease }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 420, easing: ease }));
  }, [index, opacity, translateY]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[animated, style]} collapsable={false}>
      {children}
    </Animated.View>
  );
}
