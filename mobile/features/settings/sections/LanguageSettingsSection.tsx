import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Section } from "@/components/ui/Section";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { fetchAccountSettings, patchAccountSettings } from "@/services/api/settingsService";
import { saveUserSnapshot } from "@/services/auth/tokenStorage";
import { queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { useUserStore } from "@/store/userStore";
import { showErrorToast } from "@/store/toastStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, touchTarget, typography } from "@/theme";

export function LanguageSettingsSection() {
  const { t, setLanguage } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const [locale, setLocale] = useState<"en" | "de">(user?.preferredLocale === "de" ? "de" : "en");
  const [saving, setSaving] = useState(false);

  const accountQuery = useQuery({
    queryKey: queryKeys.accountSettings,
    queryFn: fetchAccountSettings,
    staleTime: queryStaleTimes.settings,
  });

  useEffect(() => {
    const fromAccount = accountQuery.data?.preferredLocale;
    if (fromAccount === "de" || fromAccount === "en") setLocale(fromAccount);
  }, [accountQuery.data?.preferredLocale]);

  const patchAccount = useMutation({ mutationFn: patchAccountSettings });

  const handleLocaleChange = async (next: "en" | "de") => {
    if (next === locale || saving) return;
    const prev = locale;
    setLocale(next);
    setSaving(true);
    try {
      await setLanguage(next);
      await patchAccount.mutateAsync({ preferredLocale: next });
      if (user) {
        const updated = { ...user, preferredLocale: next };
        useUserStore.getState().setUser(updated);
        await saveUserSnapshot(updated);
      }
    } catch (e) {
      setLocale(prev);
      await setLanguage(prev);
      showErrorToast(friendlyErrorMessage(e, t("settings.languageError"), t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSectionLayout
      title={t("settings.menu.appearance")}
      subtitle={t("settings.languageSubtitle")}
    >
      <Section title={t("settings.language")}>
        <View style={styles.localeRow}>
          {(["en", "de"] as const).map((code) => {
            const active = locale === code;
            return (
              <Pressable
                key={code}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: saving }}
                disabled={saving}
                onPress={() => void handleLocaleChange(code)}
                style={[styles.localeChip, active ? styles.localeChipActive : null]}
              >
                <Text style={[styles.localeChipLabel, active ? styles.localeChipLabelActive : null]}>
                  {code === "en" ? t("settings.english") : t("settings.german")}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>
    </SettingsSectionLayout>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    localeRow: { flexDirection: "row", gap: spacing.sm },
    localeChip: {
      flex: 1,
      minHeight: touchTarget,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    localeChipActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    localeChipLabel: {
      ...typography.body,
      fontWeight: "600",
      color: colors.mutedForeground,
    },
    localeChipLabelActive: { color: colors.primary },
  });
}
