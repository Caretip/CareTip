import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { LucideIcon } from "@/types/lucide";
import { colors, motion, spacing, surface, touchTarget, typography } from "@/theme";
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

function ShortcutCard({ label, icon: Icon, onPress }: DashboardShortcut) {
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
        scale.value = withSpring(0.96, motion.spring.press);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.spring.press);
      }}
      style={[styles.card, animatedStyle]}
    >
      <View style={styles.iconWell}>
        <Icon size={22} color={colors.primary} strokeWidth={2.2} />
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
  return (
    <View style={styles.row}>
      {shortcuts.map((shortcut) => (
        <ShortcutCard key={shortcut.id} {...shortcut} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
  card: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: touchTarget + 36,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.secondary,
    borderRadius: surface.cardRadius,
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
    fontWeight: "700",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 15,
  },
});
