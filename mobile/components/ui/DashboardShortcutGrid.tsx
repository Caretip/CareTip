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
import { motion, spacing, surface, touchTarget, typography } from "@/theme";
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
      style={[styles.card, animatedStyle]}
    >
      <View style={styles.iconWell}>
        <Icon size={21} color={colors.foreground} strokeWidth={2} />
      </View>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

/** Premium fintech shortcut row — three equal cards beneath the hero balance. */
export const DashboardShortcutGrid = memo(function DashboardShortcutGrid({
  shortcuts,
}: DashboardShortcutGridProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.row}>
      {shortcuts.map((shortcut) => (
        <ShortcutCard key={shortcut.id} {...shortcut} colors={colors} />
      ))}
    </View>
  );
});

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: spacing.md,
    },
    card: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      minHeight: touchTarget + 40,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: surface.shortcutRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...Platform.select({
        ios: {
          shadowColor: "#0B1220",
          shadowOpacity: 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 2 },
        default: {},
      }),
    },
    iconWell: {
      width: surface.iconWellSize,
      height: surface.iconWellSize,
      borderRadius: surface.iconWellRadius,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      ...typography.caption,
      color: colors.foreground,
      fontWeight: "600",
      fontSize: 12,
      textAlign: "center",
      lineHeight: 16,
      letterSpacing: 0.1,
    },
  });
}
