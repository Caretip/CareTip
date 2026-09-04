import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { useBusinessEntitlementsContext } from "../../../contexts/BusinessEntitlementsContext";
import { useSubscriptionEntitlements } from "../../../hooks/useSubscriptionEntitlements";
import { useBusinessIntelligenceData } from "../../../hooks/useBusinessIntelligenceData";
import { useBusinessTipsModuleData } from "../../../hooks/useBusinessTipsModuleData";
import { BusinessExecutivePerformance } from "../../../components/business/BusinessExecutivePerformance";
import { BusinessTeamLeaderboardPanel } from "../../../components/business/insights/BusinessTeamLeaderboardPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { BarChart3 } from "lucide-react";
import {
  isEntitlementsSessionPrimed,
  sessionHasFeature,
} from "../../../lib/subscriptionEntitlementFastPath";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";

const tabTriggerClass =
  "rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none";

/** Team → Performance: executive insights + leaderboard workspace. Gated at layout level. */
export function BusinessTeamPerformancePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "leaderboard" ? "leaderboard" : "overview";
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

  const insightsEnabled = Boolean(sessionValidated && user?.role === "business" && analyticsAllowed);
  const insightsData = useBusinessIntelligenceData(insightsEnabled && tab === "overview", true);
  const leaderboardData = useBusinessTipsModuleData(insightsEnabled && tab === "leaderboard", true);

  const { showInitialSkeleton } = useBusinessPageBoot(
    tab === "leaderboard" ? "team-top-performers" : "team-performance",
    tab === "leaderboard" ? leaderboardData.isInitialAnalyticsLoading : insightsData.isInitialAnalyticsLoading,
  );

  return (
    <div className="space-y-4 pt-2 sm:space-y-5 sm:pt-4">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "leaderboard") next.set("tab", "leaderboard");
          else next.delete("tab");
          setSearchParams(next, { replace: true });
        }}
      >
        <div className="flex flex-col gap-3 border-b border-border/80 sm:flex-row sm:items-end sm:justify-between">
          <TabsList
            className="h-auto w-full justify-start gap-1 rounded-none bg-transparent p-0 sm:w-auto"
            aria-label={t("business.team.performance.tabsAria")}
          >
            <TabsTrigger value="overview" className={tabTriggerClass}>
              {t("business.team.performance.tabOverview")}
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className={tabTriggerClass}>
              {t("business.team.performance.tabLeaderboard")}
            </TabsTrigger>
          </TabsList>
          {tab === "overview" ? (
            <Button type="button" variant="outline" size="sm" className="mb-2 w-full sm:w-auto" asChild>
              <Link to="/dashboard/tips/analytics">
                <BarChart3 className="mr-2 h-4 w-4" aria-hidden />
                {t("business.team.performance.openAnalytics")}
              </Link>
            </Button>
          ) : null}
        </div>
        <TabsContent value="overview" className="mt-4">
          <BusinessExecutivePerformance data={{ ...insightsData, loading: showInitialSkeleton && tab === "overview" }} />
        </TabsContent>
        <TabsContent value="leaderboard" className="mt-4">
          <BusinessTeamLeaderboardPanel
            data={leaderboardData}
            showInitialSkeleton={showInitialSkeleton && tab === "leaderboard"}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
