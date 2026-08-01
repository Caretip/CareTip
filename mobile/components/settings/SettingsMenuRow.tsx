import { useMemo } from "react";
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
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function SettingsMenuRow({
  label,
  description,
  icon: Icon,
  onPress,
  destructive = false,
  showDivider = true,
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
        onPress={() => {
          hapticLight();
          onPress();
        }}
        onPressIn={() => {
          scale.value = withSpring(0.99, motion.spring.press);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, motion.spring.press);
        }}
        style={[styles.row, animatedStyle]}
      >
        <View style={[styles.iconWell, destructive ? styles.iconWellDestructive : null]}>
          <Icon
            size={20}
            color={destructive ? colors.destructive : colors.primary}
            strokeWidth={2.2}
          />
        </View>
        <View style={styles.text}>
          <Text style={[styles.label, destructive ? styles.labelDestructive : null]}>{label}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
        <ChevronRight size={18} color={colors.mutedForeground} strokeWidth={2.2} />
      </AnimatedPressable>
      {showDivider ? <View style={styles.divider} /> : null}
    </View>
  );
}

type SettingsMenuGroupProps = {
  title?: string;
  children: React.ReactNode;
};

export function SettingsMenuGroup({ title, children }: SettingsMenuGroupProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.groupWrap}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    groupWrap: {
      gap: spacing.sm,
    },
    groupTitle: {
      ...typography.overline,
      color: colors.mutedForeground,
      marginLeft: spacing.xs,
    },
    group: {
      backgroundColor: colors.card,
      borderRadius: surface.groupRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
      marginBottom: spacing.lg,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minHeight: touchTarget + 4,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    iconWell: {
      width: surface.iconWellSize,
      height: surface.iconWellSize,
      borderRadius: surface.iconWellRadius,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
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
  });
}
