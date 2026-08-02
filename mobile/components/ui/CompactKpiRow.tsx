import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { dashboardTextColors, premiumPalette } from "@/theme/dashboardPremium";
import { spacing, typography } from "@/theme";
import { metricTextA11y, textA11y } from "@/theme/a11y";

export type CompactKpiItem = {
  label: string;
  value: string;
  hint?: string;
};

type CompactKpiRowProps = {
  items: [CompactKpiItem, CompactKpiItem];
};

/** Single-row dual KPI — replaces two separate metric cards. */
export const CompactKpiRow = memo(function CompactKpiRow({ items }: CompactKpiRowProps) {
  const { isDark } = useTheme();
  const text = dashboardTextColors(isDark);
  const styles = useMemo(() => createStyles(text), [text]);
  const [left, right] = items;

  return (
    <View style={styles.row}>
      <View style={styles.cell}>
        <Text style={styles.label} {...textA11y}>
          {left.label}
        </Text>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit {...metricTextA11y}>
          {left.value}
        </Text>
        {left.hint ? (
          <Text style={styles.hint} numberOfLines={1}>
            {left.hint}
          </Text>
        ) : null}
      </View>
      <View style={styles.divider} />
      <View style={styles.cell}>
        <Text style={styles.label} {...textA11y}>
          {right.label}
        </Text>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit {...metricTextA11y}>
          {right.value}
        </Text>
        {right.hint ? (
          <Text style={styles.hint} numberOfLines={1}>
            {right.hint}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

function createStyles(text: ReturnType<typeof dashboardTextColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "stretch",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: premiumPalette.border,
      paddingVertical: spacing.lg,
    },
    cell: {
      flex: 1,
      minWidth: 0,
      gap: spacing.xxs,
      paddingHorizontal: spacing.xs,
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: premiumPalette.border,
      marginVertical: spacing.xxs,
    },
    label: {
      ...typography.caption,
      color: text.muted,
      fontSize: 12,
      fontWeight: "500",
      letterSpacing: 0.1,
    },
    value: {
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "700",
      color: text.primary,
      letterSpacing: -0.4,
    },
    hint: {
      ...typography.caption,
      color: text.secondary,
      fontSize: 12,
      lineHeight: 16,
    },
  });
}
