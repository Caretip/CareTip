import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Bell, QrCode, Wallet } from "@/icons/lucide";
import { HeroBalanceCard } from "@/components/ui/HeroBalanceCard";
import { CompactKpiRow } from "@/components/ui/CompactKpiRow";
import { DashboardShortcutGrid } from "@/components/ui/DashboardShortcutGrid";
import { TipCard } from "@/components/ui/ListCards";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { LayeredScreen } from "@/components/ui/LayeredScreen";
import { GroupedList, Section } from "@/components/ui/Section";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonMetricGrid } from "@/components/ui/Skeleton";
import { FadeIn } from "@/components/ui/motion";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useEmployeeDashboard } from "@/features/employee/useEmployeeDashboard";
import { formatCount, formatEur, formatRating } from "@/utils/format";
import { formatTipStatus, uiLocaleTag } from "@/utils/labels";
import { friendlyErrorMessage, isPermissionError } from "@/utils/friendlyError";
import { layered } from "@/theme/layered";
import { spacing } from "@/theme";
import type { EmployeeTimeframe } from "@/types/employee";

export function EmployeeDashboardScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const {
    timeframe,
    setTimeframe,
    profile,
    tips,
    isLoading,
    isTipsLoading,
    isRefreshing,
    error,
    tipsError,
    refresh,
  } = useEmployeeDashboard();

  const timeframeOptions: Array<{ value: EmployeeTimeframe; label: string }> = [
    { value: "today", label: t("period.today") },
    { value: "week", label: t("period.week") },
    { value: "month", label: t("period.month") },
  ];

  const recentTips = tips?.tips?.slice(0, 3) ?? [];
  const displayName =
    (profile?.name ?? user?.name)?.split(" ")[0] ?? profile?.name ?? user?.name ?? "there";

  const shortcuts = useMemo(
    () => [
      {
        id: "qr",
        label: t("tabs.myQr"),
        icon: QrCode,
        onPress: () => router.push("/(app)/employee/qr"),
      },
      {
        id: "tips",
        label: t("tabs.tipHistory"),
        icon: Wallet,
        onPress: () => router.push("/(app)/employee/tips"),
      },
      {
        id: "inbox",
        label: t("tabs.inbox"),
        icon: Bell,
        onPress: () => router.push("/(app)/employee/notifications"),
      },
    ],
    [router, t],
  );

  return (
    <LayeredScreen
      eyebrow={t("employeeDashboard.eyebrow")}
      title={t("employeeDashboard.welcome", { name: displayName })}
      subtitle={`${profile?.jobTitle ? `${profile.jobTitle} · ` : ""}${profile?.businessName ?? t("businessDashboard.venueFallback")}`}
      notificationsHref="/(app)/employee/notifications"
      refreshing={isRefreshing}
      onRefresh={() => void refresh()}
      headerExtra={
        <PeriodToggle
          value={timeframe}
          options={timeframeOptions}
          onChange={setTimeframe}
          variant="hero"
        />
      }
    >
      {isLoading ? (
        <SkeletonMetricGrid />
      ) : error && !profile ? (
        isPermissionError(error) ? (
          <EmptyState
            title={t("errors.permissionTitle")}
            message={friendlyErrorMessage(error, t("errors.permissionBody"), t)}
          />
        ) : (
          <ErrorState
            message={friendlyErrorMessage(error, t("employeeDashboard.loadError"), t)}
            onRetry={() => void refresh()}
          />
        )
      ) : isTipsLoading && !tips ? (
        <SkeletonMetricGrid />
      ) : tipsError && !tips ? (
        isPermissionError(tipsError) ? (
          <EmptyState
            title={t("errors.permissionTitle")}
            message={friendlyErrorMessage(tipsError, t("errors.permissionBody"), t)}
          />
        ) : (
          <ErrorState
            message={friendlyErrorMessage(tipsError, t("employeeDashboard.tipsLoadError"), t)}
            onRetry={() => void refresh()}
          />
        )
      ) : (
        <View style={styles.stack}>
          <FadeIn index={0}>
            <View style={styles.heroBlock}>
              <HeroBalanceCard
                label={t("employeeDashboard.periodEarnings")}
                value={formatEur(tips?.periodAmountEur)}
                hint={t("businessDashboard.tipsThisPeriod", {
                  count: formatCount(tips?.periodTipCount),
                })}
                icon="wallet"
              />
              <CompactKpiRow
                items={[
                  {
                    label: t("employeeDashboard.avgRating"),
                    value: formatRating(tips?.averageRating),
                    hint: t("employeeDashboard.ratingsHint", {
                      count: formatCount(tips?.ratingCount),
                    }),
                  },
                  {
                    label: t("employeeDashboard.paidOut"),
                    value: formatEur(tips?.paidOutEur),
                    hint: t("employeeDashboard.successfulPayouts"),
                  },
                ]}
              />
              <DashboardShortcutGrid shortcuts={shortcuts} />
            </View>
          </FadeIn>

          <FadeIn index={1}>
            <Section title={t("employeeDashboard.recentTips")}>
              {recentTips.length === 0 ? (
                <EmptyState
                  variant="tips"
                  title={t("employeeDashboard.emptyTipsTitle")}
                  message={t("employeeDashboard.emptyTips")}
                />
              ) : (
                <GroupedList>
                  {recentTips.map((tip) => (
                    <TipCard
                      key={tip.id}
                      inset
                      amount={formatEur(tip.amount)}
                      statusLabel={formatTipStatus("success", "employee")}
                      statusTone="success"
                      meta={new Date(tip.createdAt).toLocaleString(uiLocaleTag())}
                      onPress={() =>
                        router.push({
                          pathname: "/(app)/employee/tips/[id]" as never,
                          params: {
                            id: tip.id,
                            payload: encodeURIComponent(JSON.stringify(tip)),
                          },
                        })
                      }
                    />
                  ))}
                </GroupedList>
              )}
            </Section>
          </FadeIn>
        </View>
      )}
    </LayeredScreen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: layered.sectionGap,
  },
  heroBlock: {
    gap: spacing.xl,
  },
});
