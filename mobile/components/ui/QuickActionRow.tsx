import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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

/** Payment-wallet template — circular icon shortcuts below hero balance. */
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
            <Ionicons name={action.icon} size={22} color={colors.primary} />
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
      gap: spacing.sm,
    },
    chip: {
      flex: 1,
      alignItems: "center",
      gap: spacing.sm,
      minHeight: touchTarget + 20,
      paddingVertical: spacing.xs,
    },
    pressed: {
      opacity: 0.82,
    },
    iconWell: {
      width: surface.iconWellSize,
      height: surface.iconWellSize,
      borderRadius: surface.iconWellRadius,
      backgroundColor: colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primarySoft,
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
