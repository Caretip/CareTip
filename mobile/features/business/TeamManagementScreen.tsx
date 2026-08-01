import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/Avatar";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { GroupedList, GroupedRow, Section } from "@/components/ui/Section";
import { Screen } from "@/components/ui/Screen";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { fetchBusinessEmployees } from "@/services/api/employeeDirectoryService";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { formatCount } from "@/utils/format";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

export function TeamManagementScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();

  const profileQuery = useQuery({
    queryKey: queryKeys.businessProfile,
    queryFn: fetchBusinessProfile,
    staleTime: queryStaleTimes.profile,
  });

  const businessId = user?.businessId ?? profileQuery.data?.id ?? "";

  const teamQuery = useQuery({
    queryKey: queryKeys.businessEmployees(businessId),
    queryFn: () => fetchBusinessEmployees(businessId),
    enabled: Boolean(businessId),
    staleTime: queryStaleTimes.roster,
  });

  const employees = teamQuery.data ?? [];
  const activeCount = useMemo(() => employees.length, [employees.length]);

  return (
    <Screen tabSafe>
      <DetailScreenHeader
        title={t("team.title")}
        subtitle={t("team.subtitle", { count: formatCount(activeCount) })}
        fallbackHref="/(app)/business/settings"
      />

      {teamQuery.isLoading || profileQuery.isLoading ? (
        <SkeletonListRows count={6} />
      ) : teamQuery.isError ? (
        <ErrorState
          message={friendlyErrorMessage(teamQuery.error, t("team.loadError"), t)}
          onRetry={() => void teamQuery.refetch()}
        />
      ) : employees.length === 0 ? (
        <EmptyState
          variant="generic"
          title={t("team.emptyTitle")}
          message={t("team.emptyMessage")}
        />
      ) : (
        <Section title={t("team.rosterTitle")}>
          <GroupedList>
            {employees.map((employee, index) => (
              <GroupedRow
                key={employee.id}
                showDivider={index < employees.length - 1}
              >
                <View style={styles.row}>
                  <Avatar label={employee.name} tone="brand" size={40} />
                  <View style={styles.body}>
                    <Text style={styles.name}>{employee.name}</Text>
                    <Text style={styles.meta}>
                      {employee.role || t("team.staffFallback")}
                      {employee.rating != null ? ` · ★ ${employee.rating.toFixed(1)}` : ""}
                    </Text>
                  </View>
                  <View style={styles.trailing}>
                    <Text style={styles.tips}>{formatCount(employee.tips)}</Text>
                    <Text style={styles.tipsLabel}>{t("team.tipsLabel")}</Text>
                  </View>
                </View>
              </GroupedRow>
            ))}
          </GroupedList>
        </Section>
      )}
    </Screen>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    body: {
      flex: 1,
      gap: spacing.xxs,
    },
    name: {
      ...typography.body,
      fontWeight: "600",
      color: colors.foreground,
    },
    meta: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
    trailing: {
      alignItems: "flex-end",
      gap: 2,
    },
    tips: {
      ...typography.body,
      fontWeight: "700",
      color: colors.primary,
    },
    tipsLabel: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontSize: 10,
    },
  });
}
