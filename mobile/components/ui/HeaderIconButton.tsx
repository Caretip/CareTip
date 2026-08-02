import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { authBrand } from "@/theme/authBrand";
import { motion } from "@/theme";
import { useTheme } from "@/hooks/useTheme";
import { hapticLight } from "@/utils/haptics";

export type HeaderControlVariant = "onHero" | "onDashboardHero" | "onSurface";

type HeaderIconButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress?: () => void;
  variant?: HeaderControlVariant;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

const AUTH_HERO_SIZE = 40;
const DASHBOARD_HERO_SIZE = 48;

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
  const isDashboardHero = variant === "onDashboardHero";
  const isHero = variant === "onHero" || isDashboardHero;

  const palette = isHero
    ? {
        backgroundColor: isDashboardHero
          ? "rgba(255, 255, 255, 0.18)"
          : authBrand.heroControlFill,
        borderColor: isDashboardHero
          ? "rgba(255, 255, 255, 0.32)"
          : authBrand.heroControlBorder,
        iconColor: "#FFFFFF",
        activeBg: "rgba(255, 255, 255, 0.28)",
        activeBorder: "rgba(255, 255, 255, 0.55)",
        activeIcon: "#FFFFFF",
      }
    : {
        backgroundColor: isDark ? colors.cardElevated : colors.cardGlass,
        borderColor: colors.borderStrong,
        iconColor: colors.foreground,
        activeBg: colors.primarySoft,
        activeBorder: colors.primary,
        activeIcon: colors.primary,
      };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const size = isDashboardHero ? DASHBOARD_HERO_SIZE : isHero ? AUTH_HERO_SIZE : 44;
  const iconSize = isDashboardHero ? 22 : isHero ? 18 : 20;

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
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: active ? palette.activeBg : palette.backgroundColor,
          borderColor: active ? palette.activeBorder : palette.borderColor,
        },
        isHero ? styles.buttonHero : styles.buttonSurface,
        isDashboardHero ? styles.buttonDashboardHero : null,
        style,
      ]}
    >
      {isHero && Platform.OS === "ios" ? (
        <BlurView
          intensity={isDashboardHero ? 28 : 22}
          tint="light"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Animated.View style={[styles.iconWrap, animatedStyle]} collapsable={false}>
        <Ionicons
          name={icon}
          size={iconSize}
          color={active ? palette.activeIcon : palette.iconColor}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonHero: {
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  buttonDashboardHero: {
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  buttonSurface: {
    borderRadius: 14,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
