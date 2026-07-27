import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors, motion, radius, spacing, touchTarget, typography } from "@/theme";

type PeriodToggleProps<T extends string> = {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
};

/** Modern segmented control with animated active state. */
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
            onPress={() => onChange(option.value)}
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
  progress.value = withTiming(active ? 1 : 0, { duration: motion.duration.fast });
  const pillStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.96 + progress.value * 0.04 }],
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.segment}
    >
      <Animated.View style={[styles.pill, active ? styles.pillActive : null, pillStyle]} />
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
    borderRadius: radius.xl,
    padding: 4,
    gap: 2,
  },
  segment: {
    flex: 1,
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    position: "relative",
  },
  pill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
  },
  pillActive: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  label: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontWeight: "600",
    zIndex: 1,
  },
  labelActive: {
    color: colors.foreground,
    fontWeight: "700",
  },
});
