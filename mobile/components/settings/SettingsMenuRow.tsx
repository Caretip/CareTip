import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import type { LucideIcon } from "@/types/lucide";
import { useTheme } from "@/hooks/useTheme";
import { motion, spacing, surface, touchTarget, typography } from "@/theme";
import { hapticLight } from "@/utils/haptics";

type SettingsMenuRowProps = {
  label: string;
  description?: string;
  icon: LucideIcon;
  onPress: () => void;
  destructive?: boolean;
  showDivider?: boolean;
  /** Flat rows sit on the page background (More tab) — no nested card chrome. */
  flat?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function SettingsMenuRow({
  label,
  description,
  icon: Icon,
  onPress,
  destructive = false,
  showDivider = true,
  flat = false,
}: SettingsMenuRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={description}
        hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
        onPress={() => {
          hapticLight();
          onPress();
        }}
        onPressIn={() => {
          scale.value = withSpring(0.985, motion.spring.press);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, motion.spring.press);
        }}
        style={[styles.row, flat ? styles.rowFlat : null, animatedStyle]}
      >
        <View
          style={[
            styles.iconWell,
            flat ? styles.iconWellFlat : null,
            destructive ? styles.iconWellDestructive : null,
          ]}
        >
          <Icon
            size={20}
            color={destructive ? colors.destructive : colors.primary}
            strokeWidth={2.15}
          />
        </View>
        <View style={styles.text}>
          <Text style={[styles.label, destructive ? styles.labelDestructive : null]}>{label}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
        <ChevronRight size={18} color={colors.mutedForeground} strokeWidth={2.1} />
      </AnimatedPressable>
      {showDivider ? (
        <View style={[styles.divider, flat ? styles.dividerFlat : null]} />
      ) : null}
    </View>
  );
}

type SettingsMenuGroupProps = {
  title?: string;
  children: ReactNode;
  /** Remove the large white card — place rows on the page background. */
  flat?: boolean;
};

export function SettingsMenuGroup({ title, children, flat = false }: SettingsMenuGroupProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.groupWrap, flat ? styles.groupWrapFlat : null]}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <View style={flat ? styles.groupFlat : styles.group}>{children}</View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    groupWrap: {
      gap: spacing.sm,
    },
    groupWrapFlat: {
      gap: spacing.none,
    },
    groupTitle: {
      ...typography.overline,
      color: colors.mutedForeground,
      marginLeft: spacing.xs,
      marginBottom: spacing.xs,
    },
    group: {
      backgroundColor: colors.card,
      borderRadius: surface.groupRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
      marginBottom: spacing.lg,
    },
    groupFlat: {
      backgroundColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      overflow: "visible",
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minHeight: touchTarget + 4,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    rowFlat: {
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.md + 2,
      minHeight: touchTarget + 8,
      borderRadius: surface.iconWellRadius,
    },
    iconWell: {
      width: surface.iconWellSize,
      height: surface.iconWellSize,
      borderRadius: surface.iconWellRadius,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    iconWellFlat: {
      backgroundColor: colors.secondary,
    },
    iconWellDestructive: {
      backgroundColor: colors.destructiveSoft,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    label: {
      ...typography.body,
      fontWeight: "600",
      color: colors.foreground,
      letterSpacing: -0.1,
    },
    labelDestructive: {
      color: colors.destructive,
    },
    description: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: spacing.lg + surface.iconWellSize + spacing.md,
    },
    dividerFlat: {
      marginLeft: spacing.xs + surface.iconWellSize + spacing.md,
      backgroundColor: colors.border,
      opacity: 0.7,
    },
  });
}
