import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/hooks/useI18n";
import { useUiStore } from "@/store/uiStore";
import { colors, spacing, typography } from "@/theme";

export function OfflineBanner() {
  const { t } = useI18n();
  const isOnline = useUiStore((s) => s.isOnline);
  if (isOnline) return null;

  return (
    <View style={styles.banner} accessibilityRole="text">
      <Text style={styles.text}>{t("common.offlineHint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: {
    ...typography.caption,
    color: colors.warningForeground,
    textAlign: "center",
    fontWeight: "600",
  },
});
