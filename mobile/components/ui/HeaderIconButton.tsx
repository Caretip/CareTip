import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { motion, radius, shadows, spacing, touchTarget } from "@/theme";
import { hapticLight } from "@/utils/haptics";

export type HeaderControlVariant = "onHero" | "onSurface";

type HeaderIconButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress?: () => void;
  variant?: HeaderControlVariant;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const variantStyles = {
  onHero: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderColor: "rgba(255, 255, 255, 0.28)",
    iconColor: "#FFFFFF",
  },
  onSurface: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderColor: "rgba(11, 18, 32, 0.08)",
    iconColor: "#111827",
  },
} as const;

export function HeaderIconButton({
  icon,
  accessibilityLabel,
  onPress,
  onLongPress,
  variant = "onHero",
  active = false,
  style,
}: HeaderIconButtonProps) {
  const scale = useSharedValue(1);
  const palette = variantStyles[variant];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        hapticLight();
        onPress();
      }}
      onLongPress={onLongPress}
      onPressIn={() => {
        scale.value = withSpring(0.92, motion.spring.press);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.spring.press);
      }}
      style={[
        styles.button,
        shadows.sm,
        {
          backgroundColor: active ? "rgba(235, 153, 44, 0.22)" : palette.backgroundColor,
          borderColor: active ? "#EB992C" : palette.borderColor,
        },
        animatedStyle,
        style,
      ]}
    >
      <Ionicons name={icon} size={20} color={active ? "#EB992C" : palette.iconColor} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: touchTarget - 4,
    height: touchTarget - 4,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      android: { elevation: 2 },
      default: {},
    }),
  },
});
