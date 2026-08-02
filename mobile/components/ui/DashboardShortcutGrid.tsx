import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import type { LucideIcon } from "@/types/lucide";
import type { ColorPalette } from "@/theme/colors";
import { premiumPalette } from "@/theme/dashboardPremium";
import { motion, spacing, typography } from "@/theme";
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
const ICON_SIZE = 18;

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
        scale.value = withSpring(0.98, motion.spring.press);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.spring.press);
      }}
      style={[styles.card, animatedStyle]}
    >
      <Icon size={ICON_SIZE} color={premiumPalette.textSecondary} strokeWidth={2} />
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
    gap: spacing.sm,
  },
});

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    card: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      minHeight: 72,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xs,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: premiumPalette.border,
    },
    label: {
      ...typography.caption,
      color: premiumPalette.textPrimary,
      fontWeight: "600",
      fontSize: 11,
      textAlign: "center",
      lineHeight: 14,
      letterSpacing: 0.02,
    },
  });
}
