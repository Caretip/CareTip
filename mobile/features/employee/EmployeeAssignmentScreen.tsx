import { StyleSheet, View, Text } from "react-native";
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MapPin, UtensilsCrossed } from "@/icons/lucide";
import { LayeredScreen } from "@/components/ui/LayeredScreen";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonMetricGrid } from "@/components/ui/Skeleton";
import { AccessErrorState } from "@/components/ui/AccessErrorState";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import { queryClient, queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { layered } from "@/theme/layered";
import { spacing } from "@/theme";

export function EmployeeAssignmentScreen() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const scoped = Boolean(isAuthenticated && userId);

  const profileQuery = useQuery({
    queryKey: keys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: scoped,
    staleTime: queryStaleTimes.profile,
    placeholderData: keepPreviousData,
  });

  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: keys.employeeMe });
    }, [keys.employeeMe]),
  );

  const assignment = profileQuery.data?.assignment;
  const isLoading = profileQuery.isLoading && !profileQuery.data;

  return (
    <LayeredScreen
      eyebrow={t("employeeAssignment.eyebrow")}
      title={t("employeeAssignment.title")}
      subtitle={t("employeeAssignment.subtitle").trim() || undefined}
      refreshing={profileQuery.isRefetching}
      onRefresh={() => void profileQuery.refetch()}
    >
      {isLoading ? (
        <SkeletonMetricGrid />
      ) : profileQuery.error && !profileQuery.data ? (
        <AccessErrorState
          error={profileQuery.error}
          fallbackMessage={t("employeeAssignment.loadError")}
          onRetry={() => void profileQuery.refetch()}
        />
      ) : (
        <View style={styles.stack}>
          <Section title={t("employeeAssignment.locationLabel")}>
            {assignment?.location ? (
              <View style={styles.assignmentBlock}>
                <MapPin size={16} color="#e9781c" />
                <View style={styles.assignmentTextWrap}>
                  <Text style={styles.assignmentPrimary}>{assignment.location.name}</Text>
                  {assignment.location.description ? (
                    <Text style={styles.assignmentSecondary}>{assignment.location.description}</Text>
                  ) : null}
                </View>
              </View>
            ) : (
              <EmptyState
                variant="generic"
                surface="flat"
                title={t("employeeAssignment.noLocationTitle")}
                message={t("employeeAssignment.noLocationDesc")}
              />
            )}
          </Section>

          <Section title={t("employeeAssignment.tablesLabel")}>
            {assignment?.tables?.length ? (
              <View style={styles.tableList}>
                {assignment.tables.map((table, index) => (
                  <View
                    key={table.id}
                    style={[styles.tableRow, index > 0 ? styles.tableRowBorder : null]}
                  >
                    <UtensilsCrossed size={16} color="#e9781c" />
                    <View style={styles.assignmentTextWrap}>
                      <Text style={styles.assignmentPrimary}>{table.name}</Text>
                      <Text style={styles.assignmentSecondary}>
                        {t("employeeAssignment.tableAtLocation", {
                          location: table.location.name,
                        })}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState
                variant="generic"
                surface="flat"
                title={t("employeeAssignment.noTablesTitle")}
                message={t("employeeAssignment.noTablesDesc")}
              />
            )}
          </Section>
        </View>
      )}
    </LayeredScreen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: layered.sectionGap,
  },
  assignmentBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tableList: {
    gap: 0,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tableRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e8f0",
  },
  assignmentTextWrap: {
    flex: 1,
    gap: 2,
  },
  assignmentPrimary: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  assignmentSecondary: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748b",
  },
});
