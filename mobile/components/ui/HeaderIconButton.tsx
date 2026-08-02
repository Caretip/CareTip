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
/** 44dp touch target; visible glyph is smaller (premium dashboard header). */
const DASHBOARD_HERO_TOUCH = 44;
const DASHBOARD_HERO_ICON = 16;
const DASHBOARD_HERO_ICON_COLOR = "#1A1A1A";
const DASHBOARD_HERO_ICON_ACTIVE = "#0D0D0D";

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

  const palette = isDashboardHero
    ? {
        backgroundColor: "transparent",
        borderColor: "transparent",
        iconColor: DASHBOARD_HERO_ICON_COLOR,
        activeBg: "transparent",
        activeBorder: "transparent",
        activeIcon: DASHBOARD_HERO_ICON_ACTIVE,
      }
    : isHero
    ? {
        backgroundColor: authBrand.heroControlFill,
        borderColor: authBrand.heroControlBorder,
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

  const size = isDashboardHero ? DASHBOARD_HERO_TOUCH : isHero ? AUTH_HERO_SIZE : 44;
  const iconSize = isDashboardHero ? DASHBOARD_HERO_ICON : isHero ? 18 : 20;

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
          borderRadius: isDashboardHero ? 0 : size / 2,
          backgroundColor: active ? palette.activeBg : palette.backgroundColor,
          borderColor: active ? palette.activeBorder : palette.borderColor,
          borderWidth: isDashboardHero ? 0 : StyleSheet.hairlineWidth,
        },
        isHero && !isDashboardHero ? styles.buttonHero : null,
        isDashboardHero ? styles.buttonDashboardHero : null,
        !isHero ? styles.buttonSurface : null,
        style,
      ]}
    >
      {isHero && !isDashboardHero && Platform.OS === "ios" ? (
        <BlurView intensity={22} tint="light" style={StyleSheet.absoluteFill} />
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
  },
  buttonHero: {
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  buttonDashboardHero: {
    overflow: "visible",
  },
  buttonSurface: {
    borderRadius: 14,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
