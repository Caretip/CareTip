import { useCallback, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { HeaderIconButton, type HeaderControlVariant } from "@/components/ui/HeaderIconButton";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeMode } from "@/store/themeStore";
import { brand, radius, shadows, spacing, touchTarget, typography } from "@/theme";
import { hapticSelection } from "@/utils/haptics";

type ThemeToggleProps = {
  variant?: HeaderControlVariant;
};

const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: "sunny-outline" | "moon-outline" | "phone-portrait-outline"; labelKey: string }> =
  [
    { mode: "light", icon: "sunny-outline", labelKey: "preferences.themeLight" },
    { mode: "dark", icon: "moon-outline", labelKey: "preferences.themeDark" },
    { mode: "system", icon: "phone-portrait-outline", labelKey: "preferences.themeSystem" },
  ];

const MENU_ENTER = Platform.OS === "android" ? undefined : ZoomIn.duration(200).springify().damping(18);
const BACKDROP_ENTER = Platform.OS === "android" ? undefined : FadeIn.duration(160);
const BACKDROP_EXIT = Platform.OS === "android" ? undefined : FadeOut.duration(120);

export function ThemeToggle({ variant = "onHero" }: ThemeToggleProps) {
  const { t } = useI18n();
  const { mode, resolvedMode, setThemeMode, toggleLightDark } = useTheme();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({
    top: insets.top + spacing.lg,
    right: spacing["2xl"],
  });

  const icon = resolvedMode === "dark" ? "moon-outline" : "sunny-outline";

  const openMenu = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      setMenuPos({ top: y + h + spacing.sm, right: Math.max(spacing["2xl"], width - x - w) });
      setOpen(true);
    });
  }, [width]);

  const selectMode = useCallback(
    async (next: ThemeMode) => {
      if (next === mode) {
        setOpen(false);
        return;
      }
      hapticSelection();
      await setThemeMode(next);
      setOpen(false);
    },
    [mode, setThemeMode],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <HeaderIconButton
          icon={icon}
          accessibilityLabel={t("preferences.theme")}
          onPress={() => void toggleLightDark()}
          onLongPress={openMenu}
          variant={variant}
          active={mode === "system"}
        />
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Animated.View entering={BACKDROP_ENTER} exiting={BACKDROP_EXIT} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel={t("common.cancel")} />
          <Animated.View
            entering={MENU_ENTER}
            style={[styles.menu, shadows.lg, { top: menuPos.top, right: menuPos.right }]}
          >
            <Text style={styles.menuTitle}>{t("preferences.theme")}</Text>
            {THEME_OPTIONS.map((option) => {
              const active = option.mode === mode;
              return (
                <Pressable
                  key={option.mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => void selectMode(option.mode)}
                  style={[styles.option, active ? styles.optionActive : null]}
                >
                  <View style={[styles.optionIconWell, active ? styles.optionIconWellActive : null]}>
                    <Ionicons
                      name={option.icon}
                      size={18}
                      color={active ? brand.orange : "#6B7280"}
                    />
                  </View>
                  <Text style={[styles.optionLabel, active ? styles.optionLabelActive : null]}>
                    {t(option.labelKey)}
                  </Text>
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            })}
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(11, 18, 32, 0.28)",
  },
  menu: {
    position: "absolute",
    minWidth: 196,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(11, 18, 32, 0.08)",
    gap: spacing.xs,
  },
  menuTitle: {
    ...typography.caption,
    color: "#6B7280",
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: touchTarget,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
  },
  optionActive: {
    backgroundColor: brand.orangeSoft,
  },
  optionIconWell: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  optionIconWellActive: {
    backgroundColor: brand.orangeSoft,
  },
  optionLabel: {
    ...typography.body,
    color: "#111827",
    fontWeight: "600",
    flex: 1,
  },
  optionLabelActive: {
    color: brand.orange,
  },
  check: {
    ...typography.body,
    color: brand.orange,
    fontWeight: "700",
  },
});
