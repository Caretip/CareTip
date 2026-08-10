import { StyleSheet, View } from "react-native";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { spacing } from "@/theme";

/** Dashboard header utilities — theme + language on the orange hero (top-right). */
export function HeaderUtilityStack() {
  return (
    <View style={styles.row}>
      <ThemeToggle variant="onDashboardHero" />
      <LanguageSwitcher variant="onDashboardHero" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: spacing.xs,
  },
});
