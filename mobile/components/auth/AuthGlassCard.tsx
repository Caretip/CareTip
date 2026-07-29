import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { authBrand } from "@/theme/authBrand";
import { radius, spacing } from "@/theme";

type AuthGlassCardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Floating glassmorphism surface for auth forms. */
export function AuthGlassCard({ children, style }: AuthGlassCardProps) {
  return (
    <View style={[styles.shadowWrap, style]}>
      <View style={styles.clip}>
        {Platform.OS === "web" ? (
          <View style={[StyleSheet.absoluteFill, styles.webFallback]} pointerEvents="none" />
        ) : (
          <BlurView intensity={52} tint="light" style={StyleSheet.absoluteFill} pointerEvents="none" />
        )}
        <View style={styles.glassTint} pointerEvents="none" />
        <View style={styles.content}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    borderRadius: radius["3xl"],
    ...Platform.select({
      ios: {
        shadowColor: "#0B1220",
        shadowOpacity: 0.16,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 14 },
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  clip: {
    borderRadius: radius["3xl"],
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: authBrand.glassBorder,
  },
  webFallback: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  glassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: authBrand.glassFill,
  },
  content: {
    paddingHorizontal: spacing["2xl"] + spacing.xs,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing["3xl"],
    gap: spacing["2xl"],
  },
});
