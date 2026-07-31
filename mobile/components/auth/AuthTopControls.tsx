import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { spacing } from "@/theme";

/** Compact language + theme controls for authentication screens. */
export function AuthTopControls() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.wrap, { top: Math.max(insets.top, spacing.lg), right: spacing["2xl"] }]}
      pointerEvents="box-none"
    >
      <View style={styles.row}>
        <LanguageSwitcher variant="onHero" />
        <ThemeToggle variant="onHero" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    zIndex: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
});
