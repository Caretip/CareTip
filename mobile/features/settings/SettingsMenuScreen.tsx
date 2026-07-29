import { StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SettingsMenuGroup, SettingsMenuRow } from "@/components/settings/SettingsMenuRow";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useQuery } from "@tanstack/react-query";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import { queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { colors, spacing, typography } from "@/theme";
import type { SettingsMenuConfig } from "@/features/settings/settingsMenuTypes";

type SettingsMenuScreenProps = {
  role: "business" | "employee";
  config: SettingsMenuConfig;
};

export function SettingsMenuScreen({ role, config }: SettingsMenuScreenProps) {
  const { t } = useI18n();
  const { user } = useAuth();

  const businessQuery = useQuery({
    queryKey: queryKeys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: role === "business",
    staleTime: queryStaleTimes.profile,
  });

  const employeeQuery = useQuery({
    queryKey: queryKeys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: role === "employee",
    staleTime: queryStaleTimes.profile,
  });

  const profileName =
    role === "business"
      ? (businessQuery.data?.businessName ?? businessQuery.data?.name ?? user?.name)
      : (employeeQuery.data?.name ?? user?.name);

  return (
    <Screen tabSafe>
      <View style={styles.hero}>
        <ScreenHeader
          eyebrow={t("settings.eyebrow")}
          title={role === "business" ? t("settings.titleBusiness") : t("settings.titleEmployee")}
          subtitle={profileName}
        />
        {user?.email ? <Text style={styles.email}>{user.email}</Text> : null}
      </View>

      {config.groups.map((group) => (
        <SettingsMenuGroup key={group.id} title={group.titleKey ? t(group.titleKey) : undefined}>
          {group.items.map((item, index) => (
            <SettingsMenuRow
              key={item.id}
              label={t(item.labelKey)}
              description={item.descriptionKey ? t(item.descriptionKey) : undefined}
              icon={item.icon}
              onPress={item.onPress}
              destructive={item.destructive}
              showDivider={index < group.items.length - 1}
            />
          ))}
        </SettingsMenuGroup>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.xs,
    marginBottom: spacing.xl,
  },
  email: {
    ...typography.body,
    color: colors.mutedForeground,
    marginTop: -spacing.xs,
  },
});
