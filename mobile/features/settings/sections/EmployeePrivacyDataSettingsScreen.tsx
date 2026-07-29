import { Alert, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { deleteEmployeeAccount, downloadEmployeeDataExport } from "@/services/api/employeeService";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { colors, typography } from "@/theme";

export function EmployeePrivacyDataSettingsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { signOut } = useAuth();

  const handleExport = async () => {
    try {
      await downloadEmployeeDataExport();
      showSuccessToast(t("settings.menu.exportStarted"));
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.menu.exportError"), t));
    }
  };

  const handleDelete = () => {
    Alert.alert(t("settings.menu.deleteAccountTitle"), t("settings.menu.deleteAccountBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.menu.deleteAccountConfirm"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await deleteEmployeeAccount();
              await signOut();
              router.replace("/(auth)/login");
            } catch (e) {
              showErrorToast(friendlyErrorMessage(e, t("settings.menu.deleteAccountError"), t));
            }
          })();
        },
      },
    ]);
  };

  return (
    <SettingsSectionLayout
      title={t("settings.menu.privacyData")}
      subtitle={t("settings.menu.privacyDataDesc")}
    >
      <Section>
        <Text style={styles.body}>{t("settings.menu.privacyDataHint")}</Text>
      </Section>
      <Button label={t("settings.menu.downloadData")} variant="secondary" onPress={() => void handleExport()} />
      <Button label={t("settings.menu.deleteAccount")} variant="destructive" onPress={handleDelete} />
    </SettingsSectionLayout>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.mutedForeground },
});
