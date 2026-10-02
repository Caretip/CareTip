import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import {
  PlatformPage,
  PlatformPageHeader,
  PlatformAdminFreshnessIndicator,
} from "../../components/platform/PlatformPageChrome";
import {
  fetchPlatformAnalytics,
  fetchPlatformCommercialIntelligence,
  type PlatformAnalytics,
  type PlatformCommercialIntelligence,
} from "../../lib/api";
import { AdminDashboardAnalyticsChartsFallback } from "../../components/AdminDashboardAnalyticsChartsFallback";
import { PlatformPayoutAnalyticsSummary } from "../../components/platform/PlatformPayoutAnalyticsSummary";
import { DashboardChartsIdleMount } from "../../components/dashboard/DashboardChartsIdleMount";

const AdminDashboardAnalyticsCharts = lazy(() =>
  import("../../components/AdminDashboardAnalyticsCharts").then((mod) => ({
    default: mod.AdminDashboardAnalyticsCharts,
  })),
);

const PlatformBusinessSubscriptionTierChart = lazy(() =>
  import("../../components/platform/PlatformBusinessSubscriptionTierChart").then((mod) => ({
    default: mod.PlatformBusinessSubscriptionTierChart,
  })),
);

const ADMIN_ANALYTICS_TZ_DEFAULT = "Europe/Berlin";

export function PlatformBusinessAnalyticsPage() {
  const { t } = useTranslation();
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [commercial, setCommercial] = useState<PlatformCommercialIntelligence | null>(null);
  const [timezone, setTimezone] = useState(ADMIN_ANALYTICS_TZ_DEFAULT);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        fetchPlatformAnalytics(30, timezone),
        fetchPlatformCommercialIntelligence().catch(() => null),
      ]);
      setAnalytics(a);
      setCommercial(c);
    } finally {
      setLoading(false);
    }
  }, [timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  const emptyAnalytics = useMemo<PlatformAnalytics>(
    () => ({
      rangeDays: 30,
      userDistribution: [],
      tipStatus: [],
      growth: [],
      tipVolume: [],
      topBusinessesByTips: [],
      payoutAnalytics: {
        summary: {
          businessPayoutCount: 0,
          employeePayoutCount: 0,
          businessVolumeEur: 0,
          employeeVolumeEur: 0,
          paidCount: 0,
          pendingCount: 0,
          failedCount: 0,
        },
        volumeByDay: [],
        statusBreakdown: [],
      },
    }),
    [],
  );

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={BarChart3}
        title={t("admin.businessAnalyticsPage.title")}
        subtitle={t("admin.businessAnalyticsPage.subtitle")}
      >
        <PlatformAdminFreshnessIndicator
          generatedAt={analytics?.generatedAt}
          cacheTtlSeconds={analytics?.cacheTtlSeconds}
        />
      </PlatformPageHeader>
      {loading ? (
        <AdminDashboardAnalyticsChartsFallback chartCount={2} />
      ) : (
        <DashboardChartsIdleMount whenVisible fallback={<AdminDashboardAnalyticsChartsFallback chartCount={2} />}>
          <Suspense fallback={<AdminDashboardAnalyticsChartsFallback chartCount={2} />}>
            <AdminDashboardAnalyticsCharts
              variant="business"
              showChartSkeletons={false}
              chartAnalytics={analytics ?? emptyAnalytics}
              chartTipStatus={analytics?.tipStatus ?? []}
              chartsLookEmpty={false}
              analyticsError={null}
              analyticsMeta={{ rangeDays: 30, timezone }}
              analyticsTimezone={timezone}
              analyticsSyncing={false}
              analyticsUpdatedAt={Date.now()}
              onTimezoneChange={setTimezone}
              onRetryAnalytics={() => void load()}
            />
            <PlatformPayoutAnalyticsSummary
              payout={analytics?.payoutAnalytics}
              rangeDays={analytics?.rangeDays ?? 30}
              timezone={timezone}
              generatedAt={analytics?.generatedAt}
              cacheTtlSeconds={analytics?.cacheTtlSeconds}
            />
            {commercial?.subscription.byTier ? (
              <PlatformBusinessSubscriptionTierChart byTier={commercial.subscription.byTier} />
            ) : null}
          </Suspense>
        </DashboardChartsIdleMount>
      )}
    </PlatformPage>
  );
}

