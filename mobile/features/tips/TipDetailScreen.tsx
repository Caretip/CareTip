import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { BusinessLogo } from "@/components/ui/BusinessLogo";
import { Screen } from "@/components/ui/Screen";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { RemoteAvatar } from "@/components/ui/RemoteAvatar";
import { Section, Divider } from "@/components/ui/Section";
import { StatusPill } from "@/components/ui/StatusPill";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useEmployeeAvatarLookup } from "@/hooks/useEmployeeAvatarLookup";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { findTipById } from "@/services/api/tipsService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { formatEur } from "@/utils/format";
import { formatTipStatus, uiLocaleTag } from "@/utils/labels";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "success") return "success";
  if (status === "pending") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function resolveTipId(raw: string | string[] | undefined): string {
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0].trim();
  return "";
}

/**
 * Tip detail trusts only `tipId` + server fetch.
 * Route params must never carry tip body / amounts / status.
 */
export function TipDetailScreen({
  audience = "employee",
}: {
  audience?: "business" | "employee";
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const params = useLocalSearchParams<{ id?: string }>();
  const tipId = resolveTipId(params.id);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const avatarLookup = useEmployeeAvatarLookup(audience === "business");

  const tipQuery = useQuery({
    queryKey: keys.tipDetail(audience, tipId),
    queryFn: () => findTipById(audience, tipId),
    enabled: Boolean(userId && tipId),
    staleTime: queryStaleTimes.tipDetail,
  });

  const profileQuery = useQuery({
    queryKey: keys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: audience === "business" && Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });

  if (!tipId) {
    return (
      <Screen tabSafe={false}>
        <DetailScreenHeader title={t("tips.detailTitle")} />
        <EmptyState title={t("tips.notFound")} message={t("tips.notFoundBody")} />
      </Screen>
    );
  }

  if (!tipQuery.data && (tipQuery.isLoading || tipQuery.isFetching)) {
    return (
      <Screen tabSafe={false}>
        <DetailScreenHeader title={t("tips.detailTitle")} />
        <View style={styles.loading}>
          <Skeleton height={48} width="60%" rounded="lg" />
          <Skeleton height={24} width="40%" rounded="md" />
          <Skeleton height={160} width="100%" rounded="2xl" style={styles.detailSkeleton} />
        </View>
      </Screen>
    );
  }

  if (tipQuery.isError) {
    return (
      <Screen tabSafe={false}>
        <DetailScreenHeader title={t("tips.detailTitle")} />
        <ErrorState
          message={t("tips.loadDetailError")}
          onRetry={() => void tipQuery.refetch()}
        />
      </Screen>
    );
  }

  const tip = tipQuery.data ?? null;

  if (!tip) {
    return (
      <Screen tabSafe={false}>
        <DetailScreenHeader title={t("tips.detailTitle")} />
        <EmptyState title={t("tips.notFound")} message={t("tips.notFoundRecent")} />
      </Screen>
    );
  }

  const staffName = tip.staffName?.trim() || t("tips.staff");
  const avatarUri =
    audience === "employee"
      ? user?.avatar
      : avatarLookup.resolve({
          employeeId: tip.employeeId,
          name: tip.staffName,
        });
  const businessName =
    profileQuery.data?.businessName ??
    profileQuery.data?.name ??
    t("businessDashboard.venueFallback");

  return (
    <Screen tabSafe={false}>
      <DetailScreenHeader title={t("tips.detailTitle")} />
      <View style={styles.hero}>
        <View style={styles.identityRow}>
          <RemoteAvatar displayName={staffName} uri={avatarUri} size={56} tone="brand" />
          <View style={styles.identityMeta}>
            <Text style={styles.staffName}>{staffName}</Text>
            {audience === "business" ? (
              <View style={styles.logoRow}>
                <BusinessLogo
                  businessName={businessName}
                  uri={profileQuery.data?.logo}
                  size={28}
                  fit="contain"
                  cacheBust={profileQuery.dataUpdatedAt}
                />
                <Text style={styles.businessName} numberOfLines={1}>
                  {businessName}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Text style={styles.amount}>{formatEur(tip.amount)}</Text>
        <StatusPill label={formatTipStatus(tip.status, audience)} tone={statusTone(tip.status)} />
      </View>

      <Section title={t("tips.details")}>
        <View style={styles.detailRow}>
          <Text style={styles.label}>{t("tips.dateTime")}</Text>
          <Text style={styles.value}>{new Date(tip.createdAt).toLocaleString(uiLocaleTag())}</Text>
        </View>
        <Divider />
        {tip.staffName ? (
          <>
            <View style={styles.detailRow}>
              <Text style={styles.label}>{t("tips.staff")}</Text>
              <View style={styles.staffValueRow}>
                <RemoteAvatar
                  displayName={tip.staffName}
                  uri={avatarUri}
                  size={28}
                  tone="brand"
                />
                <Text style={styles.value}>{tip.staffName}</Text>
              </View>
            </View>
            <Divider />
          </>
        ) : null}
        {tip.locationName ? (
          <>
            <View style={styles.detailRow}>
              <Text style={styles.label}>{t("tips.location")}</Text>
              <Text style={styles.value}>{tip.locationName}</Text>
            </View>
            <Divider />
          </>
        ) : null}
        {tip.tableName ? (
          <View style={styles.detailRow}>
            <Text style={styles.label}>{t("tips.table")}</Text>
            <Text style={styles.value}>{tip.tableName}</Text>
          </View>
        ) : null}
      </Section>
    </Screen>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    hero: {
      gap: spacing.md,
      paddingBottom: spacing.xl,
      marginBottom: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    identityRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
    },
    identityMeta: {
      flex: 1,
      minWidth: 0,
      gap: spacing.xs,
    },
    staffName: {
      ...typography.h2,
      color: colors.foreground,
      fontWeight: "700",
    },
    logoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    businessName: {
      ...typography.caption,
      color: colors.mutedForeground,
      flex: 1,
    },
    amount: {
      ...typography.metric,
      fontSize: 36,
      lineHeight: 40,
      color: colors.foreground,
    },
    loading: {
      gap: spacing.lg,
      paddingVertical: spacing.xl,
    },
    detailSkeleton: {
      marginTop: spacing.md,
    },
    detailRow: {
      gap: spacing.xxs,
      paddingVertical: spacing.md,
    },
    staffValueRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    label: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
    value: {
      ...typography.body,
      color: colors.foreground,
      fontWeight: "600",
    },
  });
}
