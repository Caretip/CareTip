import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { useBusinessEntitlementsContext } from "../../../contexts/BusinessEntitlementsContext";
import { useSubscriptionEntitlements } from "../../../hooks/useSubscriptionEntitlements";
import { useBusinessIntelligenceData } from "../../../hooks/useBusinessIntelligenceData";
import { BusinessExecutivePerformance } from "../../../components/business/BusinessExecutivePerformance";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";
import {
  isEntitlementsSessionPrimed,
  sessionHasFeature,
} from "../../../lib/subscriptionEntitlementFastPath";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";

/** Team → Performance: executive insights — health, trends, recommendations. Gated at layout level. */
export function BusinessTeamPerformancePage() {
  const { t } = useTranslation();
  const { user, sessionValidated } = useRequireAuth();
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
  );

  const { showInitialSkeleton } = useBusinessPageBoot(
    "team-performance",
    data.isInitialAnalyticsLoading,
  );

  return (
    <div className="space-y-4 pt-2 sm:space-y-5 sm:pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" asChild>
          <Link to="/dashboard/tips/analytics">
            <BarChart3 className="mr-2 h-4 w-4" aria-hidden />
            {t("business.team.performance.openAnalytics")}
          </Link>
        </Button>
      </div>
      <BusinessExecutivePerformance
        data={{ ...data, loading: showInitialSkeleton }}
      />
    </div>
  );
}
