import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors, motion, radius, spacing, surface, touchTarget, typography } from "@/theme";
import { hapticSelection } from "@/utils/haptics";

type PeriodToggleProps<T extends string> = {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
};

export function PeriodToggle<T extends string>({ value, options, onChange }: PeriodToggleProps<T>) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Segment
            key={option.value}
            label={option.label}
            active={active}
            onPress={() => {
              hapticSelection();
              onChange(option.value);
            }}
          />
        );
      })}
    </View>
  );
}

function Segment({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: motion.duration.fast });
  }, [active, progress]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.98 + progress.value * 0.02 }],
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.segment}
    >
      <Animated.View style={[styles.pill, pillStyle]} />
      <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.secondary,
    borderRadius: surface.pillRadius,
    padding: 3,
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    minHeight: touchTarget - 4,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    position: "relative",
  },
  pill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(235, 153, 44, 0.12)",
    shadowColor: "#111827",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  label: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontWeight: "600",
    fontSize: 13,
    zIndex: 1,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: "700",
  },
});
