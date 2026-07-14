import { useState } from "react";
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

  const data = useBusinessIntelligenceData(
    Boolean(sessionValidated && user?.role === "business" && analyticsAllowed),
    true,
    revenueTimeframe,
  );

  const { showInitialSkeleton } = useBusinessPageBoot(
    "tips-analytics",
    data.isInitialAnalyticsLoading,
  );

  const handleRevenueTimeframeChange = (timeframe: AnalyticsTimeframe) => {
    setRevenueTimeframe(timeframe);
    setQrTimeframe(timeframe);
  };

  return (
    <div className="space-y-6 pt-6">
      <BusinessAnalyticsReporting
        data={{
          ...data,
          isInitialAnalyticsLoading: showInitialSkeleton,
        }}
        revenueTimeframe={revenueTimeframe}
        onRevenueTimeframeChange={handleRevenueTimeframeChange}
        qrTimeframe={qrTimeframe}
        onQrTimeframeChange={setQrTimeframe}
      />
    </div>
  );
}
