import { Pressable, StyleSheet, Text, View } from "react-native";
import { useUiStore } from "@/store/uiStore";
import { useI18n } from "@/hooks/useI18n";
import { formatUserFacingError } from "@/utils/userFacingError";
import { colors, spacing, typography } from "@/theme";

export function ErrorBanner() {
  const { t } = useI18n();
  const error = useUiStore((s) => s.globalError);
  const clearGlobalError = useUiStore((s) => s.clearGlobalError);
  if (!error) return null;

  const message = formatUserFacingError(error.raw ?? error, t("errors.generic"), t);

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={clearGlobalError} hitSlop={8}>
        <Text style={styles.dismiss}>{t("errors.dismiss")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.destructive,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  text: {
    ...typography.caption,
    color: colors.destructiveForeground,
    flex: 1,
    fontWeight: "600",
  },
  dismiss: {
    ...typography.caption,
    color: colors.destructiveForeground,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
