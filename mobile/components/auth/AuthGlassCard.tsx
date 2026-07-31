import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { layered } from "@/theme/layered";

type AuthGlassCardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * @deprecated Floating glass card removed — auth forms render directly on the layered foreground sheet.
 */
export function AuthGlassCard({ children, style }: AuthGlassCardProps) {
  return <View style={[styles.content, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  content: {
    gap: layered.sectionGap,
  },
});
