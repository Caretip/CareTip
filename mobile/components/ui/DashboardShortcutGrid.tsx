import { memo, useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import type { LucideIcon } from "@/types/lucide";
import type { ColorPalette } from "@/theme/colors";
import { premiumSoftShadow } from "@/theme/dashboardPremium";
import { motion, spacing, surface, typography } from "@/theme";
import { hapticLight } from "@/utils/haptics";

export type DashboardShortcut = {
  id: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
};

type DashboardShortcutGridProps = {
  shortcuts: DashboardShortcut[];
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const ICON_SIZE = 20;

type ShortcutCardProps = DashboardShortcut & {
  colors: ColorPalette;
};

function ShortcutCard({ label, icon: Icon, onPress, colors }: ShortcutCardProps) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        hapticLight();
        onPress();
      }}
      onPressIn={() => {
        scale.value = withSpring(0.97, motion.spring.press);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.spring.press);
      }}
      style={[styles.card, premiumSoftShadow, animatedStyle]}
    >
      <View style={styles.iconWell}>
        <Icon size={ICON_SIZE} color={colors.primary} strokeWidth={2.2} />
      </View>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

export const DashboardShortcutGrid = memo(function DashboardShortcutGrid({
  shortcuts,
}: DashboardShortcutGridProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      {shortcuts.map((shortcut) => (
        <ShortcutCard key={shortcut.id} {...shortcut} colors={colors} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
});

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    card: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      minHeight: 96,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: surface.shortcutRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    iconWell: {
      width: surface.iconWellSize,
      height: surface.iconWellSize,
      borderRadius: surface.iconWellRadius,
      backgroundColor: colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      ...typography.caption,
      color: colors.foreground,
      fontWeight: "600",
      fontSize: 11,
      textAlign: "center",
      lineHeight: 14,
      letterSpacing: 0.05,
    },
  });
}
