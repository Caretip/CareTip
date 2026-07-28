import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, shadows, spacing } from "@/theme";

type AuthGlassCardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Elevated auth form surface — readable on immersive background. */
export function AuthGlassCard({ children, style }: AuthGlassCardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: radius["2xl"],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.65)",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing["2xl"],
    gap: spacing.lg,
    ...shadows.lg,
  },
});
