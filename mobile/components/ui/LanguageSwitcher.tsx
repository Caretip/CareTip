import { useCallback, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeaderIconButton, type HeaderControlVariant } from "@/components/ui/HeaderIconButton";
import { useI18n } from "@/hooks/useI18n";
import type { AppLanguage } from "@/i18n/types";
import { brand, radius, shadows, spacing, touchTarget, typography } from "@/theme";
import { hapticSelection } from "@/utils/haptics";

const LANGUAGE_OPTIONS: Array<{ code: AppLanguage; flag: string; labelKey: "settings.english" | "settings.german" }> =
  [
    { code: "de", flag: "🇩🇪", labelKey: "settings.german" },
    { code: "en", flag: "🇬🇧", labelKey: "settings.english" },
  ];

type LanguageSwitcherProps = {
  variant?: HeaderControlVariant;
};

export function LanguageSwitcher({ variant = "onHero" }: LanguageSwitcherProps) {
  const { t, language, setLanguage } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({
    top: insets.top + spacing.lg,
    right: spacing["2xl"],
  });

  const current = LANGUAGE_OPTIONS.find((o) => o.code === language) ?? LANGUAGE_OPTIONS[1];

  const openMenu = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      setMenuPos({ top: y + h + spacing.sm, right: Math.max(spacing["2xl"], width - x - w) });
      setOpen(true);
    });
  }, [width]);

  const selectLanguage = useCallback(
    async (code: AppLanguage) => {
      if (code === language) {
        setOpen(false);
        return;
      }
      hapticSelection();
      await setLanguage(code);
      setOpen(false);
    },
    [language, setLanguage],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <HeaderIconButton
          icon="globe-outline"
          accessibilityLabel={t("preferences.selectLanguage")}
          onPress={openMenu}
          variant={variant}
          active={open}
        />
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel={t("common.cancel")} />
          <Animated.View
            entering={ZoomIn.duration(200).springify().damping(18)}
            style={[styles.menu, shadows.lg, { top: menuPos.top, right: menuPos.right }]}
          >
            <Text style={styles.menuTitle}>{t("preferences.selectLanguage")}</Text>
            {LANGUAGE_OPTIONS.map((option) => {
              const active = option.code === language;
              return (
                <Pressable
                  key={option.code}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => void selectLanguage(option.code)}
                  style={[styles.option, active ? styles.optionActive : null]}
                >
                  <Text style={styles.flag}>{option.flag}</Text>
                  <Text style={[styles.optionLabel, active ? styles.optionLabelActive : null]}>
                    {t(option.labelKey)}
                  </Text>
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            })}
            <View style={styles.currentRow}>
              <Text style={styles.currentHint}>
                {current?.flag} {current ? t(current.labelKey) : ""}
              </Text>
            </View>
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
    paddingHorizontal: spacing.md,
  },
  optionActive: {
    backgroundColor: brand.orangeSoft,
  },
  flag: {
    fontSize: 18,
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
  currentRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(11, 18, 32, 0.08)",
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  currentHint: {
    ...typography.caption,
    color: "#6B7280",
    fontWeight: "600",
  },
});
