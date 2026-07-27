import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

type StatusPillProps = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand";
};

const TONE = {
  neutral: { bg: colors.secondary, fg: colors.secondaryForeground },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.destructiveSoft, fg: colors.destructive },
  info: { bg: colors.infoSoft, fg: colors.info },
  brand: { bg: colors.primarySoft, fg: colors.primary },
} as const;

export function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  const palette = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  label: {
    ...typography.caption,
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
