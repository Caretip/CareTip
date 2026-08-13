import { useMemo } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GroupedList, GroupedRow, Section } from "@/components/ui/Section";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import { fetchAccountSettings, patchAccountSettings, patchEmployeeProfile } from "@/services/api/settingsService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

export function BusinessNotificationsSettingsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const queryClient = useQueryClient();
  const accountQuery = useQuery({
    queryKey: keys.accountSettings,
    queryFn: fetchAccountSettings,
    enabled: Boolean(userId),
    staleTime: queryStaleTimes.settings,
  });
  const patchAccount = useMutation({
    mutationFn: patchAccountSettings,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.accountSettings }),
  });

  const toggles = [
    ["tipReceivedNotifications", "settings.tipReceived"],
    ["summaryEmails", "settings.summaryEmails"],
    ["systemAlerts", "settings.systemAlerts"],
    ["notifyNewLogin", "settings.newLogin"],
  ] as const;
  const account = accountQuery.data;

  return (
    <SettingsSectionLayout
      title={t("settings.menu.notifications")}
      subtitle={t("settings.notificationsBusinessSub")}
    >
      <Section title={t("settings.notificationsBusiness")}>
        {accountQuery.isLoading && !account ? (
          <SkeletonListRows count={4} />
        ) : account ? (
          <GroupedList>
            {toggles.map(([key, labelKey], index) => (
              <GroupedRow key={key} showDivider={index < toggles.length - 1}>
                <View style={styles.row}>
                  <Text style={styles.body}>{t(labelKey)}</Text>
                  <Switch
                    value={account[key]}
                    onValueChange={(value) => void patchAccount.mutateAsync({ [key]: value })}
                  />
                </View>
              </GroupedRow>
            ))}
          </GroupedList>
        ) : null}
      </Section>
    </SettingsSectionLayout>
  );
}

export function EmployeeNotificationsSettingsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const queryClient = useQueryClient();
  const employeeQuery = useQuery({
    queryKey: keys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });
  const patchEmployee = useMutation({
    mutationFn: patchEmployeeProfile,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.employeeMe }),
  });

  const employee = employeeQuery.data;

  return (
    <SettingsSectionLayout
      title={t("settings.menu.notifications")}
      subtitle={t("settings.notificationsEmployeeSub")}
    >
      <Section title={t("settings.notificationsEmployee")}>
        {employeeQuery.isLoading && !employee ? (
          <SkeletonListRows count={2} />
        ) : employee ? (
          <GroupedList>
            <GroupedRow>
              <View style={styles.row}>
                <Text style={styles.body}>{t("settings.emailNotifications")}</Text>
                <Switch
                  value={employee.emailNotifications}
                  onValueChange={(v) => void patchEmployee.mutateAsync({ emailNotifications: v })}
                />
              </View>
            </GroupedRow>
            <GroupedRow showDivider={false}>
              <View style={styles.row}>
                <Text style={styles.body}>{t("settings.pushNotifications")}</Text>
                <Switch
                  value={employee.pushNotifications}
                  onValueChange={(v) => void patchEmployee.mutateAsync({ pushNotifications: v })}
                />
              </View>
            </GroupedRow>
          </GroupedList>
        ) : null}
      </Section>
    </SettingsSectionLayout>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
      minHeight: 52,
    },
    body: { ...typography.body, color: colors.foreground, flex: 1 },
  });
}
