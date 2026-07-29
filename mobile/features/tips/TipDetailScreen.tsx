import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/ui/Screen";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { Section, Divider } from "@/components/ui/Section";
import { StatusPill } from "@/components/ui/StatusPill";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { findTipById } from "@/services/api/tipsService";
import { queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { formatEur } from "@/utils/format";
import { formatTipStatus, uiLocaleTag } from "@/utils/labels";
import type { TipActivityRow } from "@/types/tips";
import { colors, spacing, typography } from "@/theme";

function parseTipPayload(raw: string | string[] | undefined): TipActivityRow | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as TipActivityRow;
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "success") return "success";
  if (status === "pending") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

export function TipDetailScreen({
  audience = "employee",
}: {
  audience?: "business" | "employee";
}) {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ id?: string; payload?: string }>();
  const tipFromPayload = parseTipPayload(params.payload);
  const tipId =
    tipFromPayload?.id ?? (typeof params.id === "string" ? params.id : "");

  const tipQuery = useQuery({
    queryKey: queryKeys.tipDetail(audience, tipId),
    queryFn: () => findTipById(audience, tipId),
    enabled: !tipFromPayload && Boolean(tipId),
    staleTime: queryStaleTimes.tipDetail,
  });

  const tip = tipFromPayload ?? tipQuery.data ?? null;

  if (!tipId) {
    return (
      <Screen tabSafe={false}>
        <DetailScreenHeader title={t("tips.detailTitle")} />
        <EmptyState title={t("tips.notFound")} message={t("tips.notFoundBody")} />
      </Screen>
    );
  }

  if (!tipFromPayload && tipQuery.isLoading) {
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

  if (!tipFromPayload && tipQuery.isError) {
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

  if (!tip) {
    return (
      <Screen tabSafe={false}>
        <DetailScreenHeader title={t("tips.detailTitle")} />
        <EmptyState title={t("tips.notFound")} message={t("tips.notFoundRecent")} />
      </Screen>
    );
  }

  return (
    <Screen tabSafe={false}>
      <DetailScreenHeader title={t("tips.detailTitle")} />
      <View style={styles.hero}>
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
              <Text style={styles.value}>{tip.staffName}</Text>
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

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  hero: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    marginBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  amount: {
    ...typography.metric,
    fontSize: 36,
    lineHeight: 40,
    color: colors.foreground,
  },
  body: {
    ...typography.body,
    color: colors.mutedForeground,
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
