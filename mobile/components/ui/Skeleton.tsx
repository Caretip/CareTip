import { useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors, radius, spacing } from "@/theme";

type SkeletonProps = {
  height?: number;
  width?: number | `${number}%`;
  style?: ViewStyle;
  rounded?: keyof typeof radius;
};

export function Skeleton({ height = 16, width = "100%", style, rounded = "lg" }: SkeletonProps) {
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        styles.base,
        { height, width, borderRadius: radius[rounded] },
        animated,
        style,
      ]}
    />
  );
}

export function SkeletonMetricGrid() {
  return (
    <View style={styles.grid}>
      <Skeleton height={128} width="100%" rounded="2xl" style={styles.full} />
      <Skeleton height={112} width="48%" rounded="2xl" />
      <Skeleton height={112} width="48%" rounded="2xl" />
      <Skeleton height={112} width="48%" rounded="2xl" />
      <Skeleton height={112} width="48%" rounded="2xl" />
    </View>
  );
}

export function SkeletonListRows({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton height={44} width={44} rounded="full" />
          <View style={styles.rowText}>
            <Skeleton height={14} width="72%" />
            <Skeleton height={12} width="48%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.skeleton,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  full: {
    minWidth: "100%",
  },
  list: {
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: spacing.lg,
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius["2xl"],
    padding: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowText: {
    flex: 1,
    gap: spacing.sm,
  },
});
