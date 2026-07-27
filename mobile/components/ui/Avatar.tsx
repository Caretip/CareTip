import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

type AvatarProps = {
  label: string;
  size?: number;
  tone?: "brand" | "neutral" | "success" | "info";
};

const TONE_BG = {
  brand: colors.primarySoft,
  neutral: colors.secondary,
  success: colors.successSoft,
  info: colors.infoSoft,
} as const;

const TONE_FG = {
  brand: colors.primary,
  neutral: colors.secondaryForeground,
  success: colors.success,
  info: colors.info,
} as const;

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function Avatar({ label, size = 40, tone = "brand" }: AvatarProps) {
  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: TONE_BG[tone],
        },
      ]}
      accessibilityLabel={label}
    >
      <Text style={[styles.text, { color: TONE_FG[tone], fontSize: size * 0.34 }]}>
        {initials(label)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
