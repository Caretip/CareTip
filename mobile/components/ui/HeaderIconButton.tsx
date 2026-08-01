import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { authBrand } from "@/theme/authBrand";
import { motion, spacing, touchTarget } from "@/theme";
import { useTheme } from "@/hooks/useTheme";
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
  const { colors, isDark } = useTheme();
  const isHero = variant === "onHero";

  const palette = isHero
    ? {
        backgroundColor: authBrand.heroControlFill,
        borderColor: authBrand.heroControlBorder,
        iconColor: authBrand.heroControlIcon,
        activeBg: "rgba(235, 153, 44, 0.32)",
        activeBorder: authBrand.orange,
        activeIcon: authBrand.orangeSoft,
      }
    : {
        backgroundColor: isDark ? colors.cardElevated : "rgba(255, 255, 255, 0.94)",
        borderColor: colors.borderStrong,
        iconColor: colors.foreground,
        activeBg: colors.primarySoft,
        activeBorder: colors.primary,
        activeIcon: colors.primary,
      };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
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
        isHero ? styles.buttonHero : styles.buttonSurface,
        {
          backgroundColor: active ? palette.activeBg : palette.backgroundColor,
          borderColor: active ? palette.activeBorder : palette.borderColor,
        },
        style,
      ]}
    >
      <Animated.View style={[styles.iconWrap, animatedStyle]} collapsable={false}>
        <Ionicons
          name={icon}
          size={20}
          color={active ? palette.activeIcon : palette.iconColor}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  buttonHero: {
    borderRadius: touchTarget / 2,
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  buttonSurface: {
    borderRadius: 14,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
