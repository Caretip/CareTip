import { useEffect, useState } from "react";
import { markAnalyticsPerformance } from "../../../lib/businessAnalytics/analyticsPerformanceMarks";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { useBusinessEntitlementsContext } from "../../../contexts/BusinessEntitlementsContext";
import { useSubscriptionEntitlements } from "../../../hooks/useSubscriptionEntitlements";
import { useBusinessIntelligenceData } from "../../../hooks/useBusinessIntelligenceData";
import type { AnalyticsTimeframe } from "../../../hooks/useBusinessDashboardStats";
import { BusinessAnalyticsReporting } from "../../../components/business/BusinessAnalyticsReporting";
import {
  isEntitlementsSessionPrimed,
  sessionHasFeature,
} from "../../../lib/subscriptionEntitlementFastPath";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";

/** Tips → Analytics: sole owner of reporting, exports, and drill-downs. Gated at layout level. */
export function BusinessTipsAnalyticsPage() {
  const { user, sessionValidated } = useRequireAuth();
  const [revenueTimeframe, setRevenueTimeframe] = useState<AnalyticsTimeframe>("month");
  const [qrTimeframe, setQrTimeframe] = useState<AnalyticsTimeframe>("month");
  const businessContext = useBusinessEntitlementsContext();
  const fallbackEntitlements = useSubscriptionEntitlements({
    enabled: user?.role === "business" && sessionValidated && businessContext == null,
    role: user?.role === "business" ? "business" : null,
  });
  const { ready, hasFeature } = businessContext ?? fallbackEntitlements;
  const analyticsAllowed =
    (ready && hasFeature("advancedAnalytics")) ||
    (isEntitlementsSessionPrimed() && sessionHasFeature("advancedAnalytics"));

  const analyticsEnabled = Boolean(sessionValidated && user?.role === "business" && analyticsAllowed);

  const data = useBusinessIntelligenceData(analyticsEnabled, true, revenueTimeframe);

  const financialSummaryEnabled = analyticsEnabled;

  const { showInitialSkeleton } = useBusinessPageBoot(
    "tips-analytics",
    data.isPeriodStatsLoading ?? data.isInitialAnalyticsLoading,
  );

  const handleRevenueTimeframeChange = (timeframe: AnalyticsTimeframe) => {
    setRevenueTimeframe(timeframe);
    setQrTimeframe(timeframe);
  };

  useEffect(() => {
    if (analyticsEnabled) markAnalyticsPerformance("analytics.route.mount");
  }, [analyticsEnabled]);

  return (
    <div className="space-y-6 pt-6">
      <BusinessAnalyticsReporting
        data={{
          ...data,
          isInitialAnalyticsLoading: showInitialSkeleton,
          isPeriodStatsLoading: showInitialSkeleton || (data.isPeriodStatsLoading ?? false),
        }}
        financialSummaryEnabled={financialSummaryEnabled}
        revenueTimeframe={revenueTimeframe}
        onRevenueTimeframeChange={handleRevenueTimeframeChange}
        qrTimeframe={qrTimeframe}
        onQrTimeframeChange={setQrTimeframe}
      />
    </div>
  );
}
