import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BusinessLogo } from "@/components/ui/BusinessLogo";
import { RemoteAvatar } from "@/components/ui/RemoteAvatar";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SettingsMenuGroup, SettingsMenuRow } from "@/components/settings/SettingsMenuRow";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useQuery } from "@tanstack/react-query";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";
import type { SettingsMenuConfig } from "@/features/settings/settingsMenuTypes";

type SettingsMenuScreenProps = {
  role: "business" | "employee";
  config: SettingsMenuConfig;
};

export function SettingsMenuScreen({ role, config }: SettingsMenuScreenProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();

  const businessQuery = useQuery({
    queryKey: keys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: role === "business" && Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });

  const employeeQuery = useQuery({
    queryKey: keys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: role === "employee" && Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });

  const profileName =
    role === "business"
      ? (businessQuery.data?.businessName ?? businessQuery.data?.name ?? user?.name)
      : (employeeQuery.data?.name ?? user?.name);

  return (
    <Screen tabSafe>
      <View style={styles.hero}>
        <View style={styles.identity}>
          {role === "business" ? (
            <BusinessLogo
              businessName={profileName ?? t("businessDashboard.venueFallback")}
              uri={businessQuery.data?.logo}
              size={56}
              fit="contain"
              cacheBust={businessQuery.dataUpdatedAt}
            />
          ) : (
            <RemoteAvatar
              displayName={profileName ?? user?.name ?? "?"}
              uri={employeeQuery.data?.avatar ?? user?.avatar}
              size={56}
              tone="brand"
              cacheBust={employeeQuery.dataUpdatedAt}
            />
          )}
          <View style={styles.identityText}>
            <ScreenHeader
              eyebrow={t("settings.eyebrow")}
              title={role === "business" ? t("settings.titleBusiness") : t("settings.titleEmployee")}
              subtitle={profileName}
            />
            {user?.email ? <Text style={styles.email}>{user.email}</Text> : null}
          </View>
        </View>
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

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    hero: {
      gap: spacing.xs,
      marginBottom: spacing.xl,
    },
    identity: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.lg,
    },
    identityText: {
      flex: 1,
      minWidth: 0,
      gap: spacing.xs,
    },
    email: {
      ...typography.body,
      color: colors.mutedForeground,
      marginTop: -spacing.xs,
    },
  });
}
