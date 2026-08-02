import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { surface } from "@/theme/surfaces";
import type { ColorPalette } from "@/theme/colors";
import { premiumSoftShadow } from "@/theme/dashboardPremium";
import { spacing, typography } from "@/theme";
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

const ICON_SIZE = 20;

/** Quick action shortcuts — matches business dashboard shortcut styling. */
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
          style={({ pressed }) => [styles.chip, premiumSoftShadow, pressed ? styles.pressed : null]}
        >
          <View style={styles.iconWell}>
            <Ionicons name={action.icon} size={ICON_SIZE} color={colors.primary} />
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
      gap: spacing.sm,
      minHeight: 96,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.xs,
      backgroundColor: colors.card,
      borderRadius: surface.shortcutRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    pressed: {
      opacity: 0.88,
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
      fontWeight: "600",
      fontSize: 11,
      textAlign: "center",
      lineHeight: 14,
    },
  });
}
