import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme";

type StatusPillProps = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand";
};

function tonePalette(colors: ColorPalette, tone: NonNullable<StatusPillProps["tone"]>) {
  if (tone === "success") return { bg: colors.successSoft, fg: colors.success };
  if (tone === "warning") return { bg: colors.warningSoft, fg: colors.warning };
  if (tone === "danger") return { bg: colors.destructiveSoft, fg: colors.destructive };
  if (tone === "info") return { bg: colors.infoSoft, fg: colors.info };
  if (tone === "brand") return { bg: colors.primarySoft, fg: colors.primary };
  return { bg: colors.secondary, fg: colors.secondaryForeground };
}

export function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(), []);
  const palette = tonePalette(colors, tone);

  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
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
}
