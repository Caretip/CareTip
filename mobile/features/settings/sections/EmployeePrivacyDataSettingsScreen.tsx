import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { deleteEmployeeAccount, downloadEmployeeDataExport } from "@/services/api/employeeService";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { typography } from "@/theme";

export function EmployeePrivacyDataSettingsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signOut } = useAuth();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const outcome = await downloadEmployeeDataExport({
        dialogTitle: t("settings.menu.exportDialogTitle"),
      });
      if (outcome === "shared") {
        showSuccessToast(t("settings.menu.exportStarted"));
      }
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.menu.exportError"), t));
    } finally {
      setExporting(false);
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
      <Button
        label={t("settings.menu.downloadData")}
        accessibilityLabel={t("settings.menu.downloadData")}
        variant="secondary"
        loading={exporting}
        disabled={exporting}
        onPress={() => void handleExport()}
      />
      <Button
        label={t("settings.menu.deleteAccount")}
        accessibilityLabel={t("settings.menu.deleteAccount")}
        variant="destructive"
        disabled={exporting}
        onPress={handleDelete}
      />
    </SettingsSectionLayout>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    body: { ...typography.body, color: colors.mutedForeground },
  });
}
