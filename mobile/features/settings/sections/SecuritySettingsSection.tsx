import { useMemo, useState } from "react";
import { Alert, Image, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Section } from "@/components/ui/Section";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import {
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  fetchTwoFactorStatus,
  setupTwoFactor,
} from "@/services/api/settingsService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { TwoFactorSetup } from "@/types/settings";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme";

type SecuritySettingsSectionProps = {
  includeMfa?: boolean;
};

export function SecuritySettingsSection({ includeMfa = false }: SecuritySettingsSectionProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSetup, setMfaSetup] = useState<TwoFactorSetup | null>(null);
  const [mfaSetupLoading, setMfaSetupLoading] = useState(false);

  const twoFactorQuery = useQuery({
    queryKey: keys.twoFactor,
    queryFn: fetchTwoFactorStatus,
    enabled: includeMfa && Boolean(userId),
    staleTime: queryStaleTimes.settings,
  });

  const handleChangePassword = async () => {
    try {
      await changePassword(currentPassword, newPassword);
      showSuccessToast(t("success.saved"));
      setCurrentPassword("");
      setNewPassword("");
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.passwordError"), t));
    }
  };

  const handleStartMfaSetup = async () => {
    setMfaSetupLoading(true);
    try {
      setMfaSetup(await setupTwoFactor());
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.setupError"), t));
    } finally {
      setMfaSetupLoading(false);
    }
  };

  const handleEnableMfa = async () => {
    if (!mfaCode.trim()) {
      Alert.alert(t("settings.codeRequiredTitle"), t("settings.codeRequiredBody"));
      return;
    }
    if (!mfaSetup) {
      Alert.alert(t("settings.setupFirstTitle"), t("settings.setupFirstBody"));
      return;
    }
    try {
      await enableTwoFactor(mfaCode);
      showSuccessToast(t("settings.twoFaEnabledBody"));
      setMfaCode("");
      setMfaSetup(null);
      void twoFactorQuery.refetch();
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.enableError"), t));
    }
  };

  const handleDisableMfa = async () => {
    try {
      await disableTwoFactor(mfaCode);
      showSuccessToast(t("settings.twoFaDisabled"));
      setMfaCode("");
      setMfaSetup(null);
      void twoFactorQuery.refetch();
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.disableError"), t));
    }
  };

  return (
    <SettingsSectionLayout
      title={t("settings.menu.security")}
      subtitle={t("settings.passwordSecuritySub")}
      keyboardAware
    >
      <Section title={t("settings.passwordSecurity")}>
        <TextField
          label={t("settings.currentPassword")}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
        />
        <TextField
          label={t("settings.newPassword")}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
        />
        <Button
          label={t("settings.changePassword")}
          variant="secondary"
          onPress={() => void handleChangePassword()}
        />
      </Section>

      {includeMfa ? (
        <Section title={t("settings.menu.twoFactor")}>
          <Text style={styles.body}>
            {t("settings.twoFactor", {
              status: twoFactorQuery.data?.enabled ? t("settings.enabled") : t("settings.disabled"),
            })}
          </Text>
          {!twoFactorQuery.data?.enabled && !mfaSetup ? (
            <Button
              label={mfaSetupLoading ? t("settings.preparing") : t("settings.setupAuthenticator")}
              variant="secondary"
              onPress={() => void handleStartMfaSetup()}
              disabled={mfaSetupLoading}
            />
          ) : null}
          {mfaSetup?.qrDataUrl ? (
            <View style={styles.mfaQr}>
              <Text style={styles.body}>{t("settings.scanQr")}</Text>
              <Image
                source={{ uri: mfaSetup.qrDataUrl }}
                style={styles.mfaQrImage}
                accessibilityLabel={t("auth.qrA11y")}
              />
            </View>
          ) : null}
          <TextField
            label={t("settings.authenticatorCode")}
            value={mfaCode}
            onChangeText={setMfaCode}
            keyboardType="number-pad"
          />
          <Button label={t("settings.enable2fa")} onPress={() => void handleEnableMfa()} />
          <Button label={t("settings.disable2fa")} variant="ghost" onPress={() => void handleDisableMfa()} />
        </Section>
      ) : null}
    </SettingsSectionLayout>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    body: { ...typography.body, color: colors.foreground },
    mfaQr: { gap: spacing.sm, alignItems: "center" },
    mfaQrImage: { width: 200, height: 200, borderRadius: radius.xl },
  });
}
