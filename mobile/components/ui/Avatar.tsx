import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { radius, typography } from "@/theme";

type AvatarProps = {
  label: string;
  size?: number;
  tone?: "brand" | "neutral" | "success" | "info";
};

function toneBg(colors: ColorPalette, tone: AvatarProps["tone"]) {
  if (tone === "neutral") return colors.secondary;
  if (tone === "success") return colors.successSoft;
  if (tone === "info") return colors.infoSoft;
  return colors.primarySoft;
}

function toneFg(colors: ColorPalette, tone: AvatarProps["tone"]) {
  if (tone === "neutral") return colors.secondaryForeground;
  if (tone === "success") return colors.success;
  if (tone === "info") return colors.info;
  return colors.primary;
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function Avatar({ label, size = 40, tone = "brand" }: AvatarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: toneBg(colors, tone),
        },
      ]}
      accessibilityLabel={label}
    >
      <Text style={[styles.text, { color: toneFg(colors, tone), fontSize: size * 0.34 }]}>
        {initials(label)}
      </Text>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    base: {
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    text: {
      ...typography.caption,
      fontWeight: "700",
    },
  });
}
