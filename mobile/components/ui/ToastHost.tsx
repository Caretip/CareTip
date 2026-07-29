import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useToastStore } from "@/store/toastStore";
import { authBrand } from "@/theme/authBrand";
import { radius, spacing, typography } from "@/theme";
import { hapticSuccess } from "@/utils/haptics";

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const toast = useToastStore((s) => s.toast);
  const clearToast = useToastStore((s) => s.clearToast);
  const translateY = useSharedValue(-24);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!toast) return;
    if (toast.tone !== "error") hapticSuccess();
    opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(-16, { duration: 180 });
      dismissTimer = setTimeout(() => clearToast(), 200);
    }, toast.durationMs);
    return () => {
      clearTimeout(timer);
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, [clearToast, opacity, toast, translateY]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!toast) return null;

  const toneStyles =
    toast.tone === "error"
      ? { bg: "#1F1315", icon: "alert-circle" as const, accent: "#FB7185" }
      : toast.tone === "info"
        ? { bg: "#121820", icon: "information-circle" as const, accent: "#60A5FA" }
        : { bg: "#122016", icon: "checkmark-circle" as const, accent: "#2DD4BF" };

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + spacing.sm }]}>
      <Animated.View style={[styles.toast, { backgroundColor: toneStyles.bg }, anim]}>
        <Ionicons name={toneStyles.icon} size={20} color={toneStyles.accent} />
        <Text style={styles.message}>{toast.message}</Text>
        <Pressable onPress={clearToast} hitSlop={10} accessibilityRole="button">
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 1000,
    alignItems: "center",
  },
  toast: {
    maxWidth: 480,
    width: "100%",
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  message: {
    ...typography.body,
    color: authBrand.white,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
});
