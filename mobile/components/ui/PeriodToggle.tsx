import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { brand, motion, radius, spacing, surface, touchTarget, typography } from "@/theme";
import { hapticSelection } from "@/utils/haptics";

type PeriodToggleVariant = "surface" | "hero";

type PeriodToggleProps<T extends string> = {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  variant?: PeriodToggleVariant;
};

export function PeriodToggle<T extends string>({
  value,
  options,
  onChange,
  variant = "surface",
}: PeriodToggleProps<T>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors, variant), [colors, variant]);

  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Segment
            key={option.value}
            label={option.label}
            active={active}
            styles={styles}
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
  styles,
  onPress,
}: {
  label: string;
  active: boolean;
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: motion.duration.fast });
  }, [active, progress]);

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
      <Animated.View style={[styles.pill, pillStyle]} />
      <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"], variant: PeriodToggleVariant) {
  const isHero = variant === "hero";

  return StyleSheet.create({
    track: {
      flexDirection: "row",
      backgroundColor: isHero ? "rgba(255, 255, 255, 0.16)" : colors.secondary,
      borderRadius: surface.pillRadius,
      padding: 4,
      gap: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isHero ? "rgba(255, 255, 255, 0.28)" : colors.border,
    },
    segment: {
      flex: 1,
      minHeight: touchTarget - 6,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.sm,
      position: "relative",
    },
    pill: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.lg,
      backgroundColor: isHero ? "#FFFFFF" : colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isHero ? "rgba(255, 255, 255, 0.6)" : colors.border,
      shadowColor: isHero ? "#000000" : colors.foreground,
      shadowOpacity: isHero ? 0.08 : 0.04,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: isHero ? 2 : 1,
    },
    label: {
      ...typography.caption,
      color: isHero ? "rgba(255, 255, 255, 0.78)" : colors.mutedForeground,
      fontWeight: "600",
      fontSize: 13,
      letterSpacing: 0.1,
      zIndex: 1,
    },
    labelActive: {
      color: isHero ? brand.orange : colors.primary,
      fontWeight: "700",
    },
  });
}
