import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Section } from "@/components/ui/Section";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { patchBusinessProfile } from "@/services/api/settingsService";
import { queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { formatUserRole } from "@/utils/labels";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { typography } from "@/theme";

export function BusinessGeneralSettingsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: queryKeys.businessProfile,
    queryFn: fetchBusinessProfile,
    staleTime: queryStaleTimes.profile,
  });
  const [contactPhone, setContactPhone] = useState("");

  useEffect(() => {
    setContactPhone(String(profileQuery.data?.contactPhone ?? ""));
  }, [profileQuery.data?.contactPhone]);

  const saveMutation = useMutation({
    mutationFn: () => patchBusinessProfile({ contactPhone: contactPhone.trim() || null }),
    onSuccess: () => {
      showSuccessToast(t("success.saved"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.businessProfile });
    },
    onError: (e) => showErrorToast(friendlyErrorMessage(e, t("settings.saveError"), t)),
  });

  return (
    <SettingsSectionLayout
      title={t("settings.menu.general")}
      subtitle={t("settings.menu.generalDesc")}
      keyboardAware
    >
      <Section title={t("settings.profileTitle")}>
        <Text style={styles.body}>{user?.name}</Text>
        <Text style={styles.muted}>{user?.email}</Text>
        <Text style={styles.body}>{t("settings.role", { role: formatUserRole(user?.role) })}</Text>
      </Section>
      <Section title={t("settings.menu.contactPhone")}>
        <TextField
          label={t("settings.menu.contactPhone")}
          value={contactPhone}
          onChangeText={setContactPhone}
          keyboardType="phone-pad"
        />
        <Button
          label={t("common.save")}
          onPress={() => void saveMutation.mutate()}
          loading={saveMutation.isPending}
        />
      </Section>
    </SettingsSectionLayout>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    body: { ...typography.body, color: colors.foreground },
    muted: { ...typography.body, color: colors.mutedForeground },
  });
}
