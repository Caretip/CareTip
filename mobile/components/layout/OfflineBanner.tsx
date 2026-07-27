import { StyleSheet, Text, View } from "react-native";
import { useUiStore } from "@/store/uiStore";
import { colors, spacing, typography } from "@/theme";

export function OfflineBanner() {
  const isOnline = useUiStore((s) => s.isOnline);
  if (isOnline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>You are offline. Some data may be outdated.</Text>
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
