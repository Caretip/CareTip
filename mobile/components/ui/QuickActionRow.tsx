import { memo, useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { surface } from "@/theme/surfaces";
import type { ColorPalette } from "@/theme/colors";
import { spacing, touchTarget, typography } from "@/theme";
import { hapticLight } from "@/utils/haptics";

export type QuickAction = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

type QuickActionRowProps = {
  actions: QuickAction[];
};

/** Circular icon shortcuts below hero balance — matches dashboard shortcut styling. */
export const QuickActionRow = memo(function QuickActionRow({ actions }: QuickActionRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => {
            hapticLight();
            action.onPress();
          }}
          style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
        >
          <View style={styles.iconWell}>
            <Ionicons name={action.icon} size={21} color={colors.foreground} />
          </View>
          <Text style={styles.label} numberOfLines={2}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
});

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    chip: {
      flex: 1,
      alignItems: "center",
      gap: spacing.md,
      minHeight: touchTarget + 36,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.xs,
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
    pressed: {
      opacity: 0.88,
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
