import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { spacing } from "@/theme";

/** Compact language control for authentication screens (theme lives in Settings). */
export function AuthTopControls() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.wrap, { top: Math.max(insets.top, spacing.lg), right: spacing["2xl"] }]}
      pointerEvents="box-none"
    >
      <LanguageSwitcher variant="onHero" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    zIndex: 10,
  },
});
