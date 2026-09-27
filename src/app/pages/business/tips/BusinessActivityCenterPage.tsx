/**
 * ARCHITECTURE INVARIANT — Activity Center page
 * ---------------------------------------------
 * Route: /dashboard/tips/live (stable; do not rename without Product approval).
 *
 * Must consume ONLY:
 *   - GET /api/business/activity (via useActivityCenterFeed)
 *   - activity.created (via useActivityCenterFeed)
 *   - venue timezone via profile cache inside the feed hook (presentation)
 *
 * Must NEVER import or depend on:
 *   - useBusinessTipsModuleData
 *   - listBusinessTips
 *   - useBusinessAnalytics
 *   - subscribeTipReceived / tip.received / tip_received
 *   - useLiveActivityStream
 *   - Transactions data
 *   - Analytics data
 *
 * Single source of truth: BusinessActivityEvent.
 * See docs/ARCHITECTURE_ACTIVITY_CENTER.md
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";

import { useRequireAuth } from "../../../hooks/useRequireAuth";
import {
  useActivityCenterFeed,
  type ActivityCenterFilter,
} from "../../../hooks/useActivityCenterFeed";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";
import { ActivityCenterFeed } from "../../../components/business/insights/ActivityCenterFeed";
import { businessUi } from "../../../components/business/businessDashboardUi";
import { dashboardWorkspaceUi } from "../../../components/dashboard/dashboardWorkspaceUi";
import { cn } from "@/lib/utils";

/** Activity Center — operational event stream from BusinessActivityEvent SSOT. */
export function BusinessActivityCenterPage() {
  const { t } = useTranslation();
  const { user, sessionValidated } = useRequireAuth();
  const [filter, setFilter] = useState<ActivityCenterFilter>("all");

  const enabled = Boolean(sessionValidated && user?.role === "business");

  const {
    items,
    liveIds,
    hasMore,
    isInitialLoading,
    isRefreshing,
    isLoadingOlder,
    error,
    loadOlder,
    venueTimezone,
  } = useActivityCenterFeed({
    enabled,
    businessId: user?.businessId,
    filter,
  });

  const { showInitialSkeleton } = useBusinessPageBoot("tips-live", isInitialLoading);

  return (
    <div className={cn("business-activity-center-page w-full space-y-5 pt-2 sm:pt-4")}>
      <header className="space-y-1">
        <div className="flex items-start gap-3">
          <div className={businessUi.iconTileMuted} aria-hidden>
            <Activity className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className={dashboardWorkspaceUi.pageTitle}>{t("business.tips.nav.live")}</h1>
            <p className={dashboardWorkspaceUi.pageDescription}>
              {t("business.activityCenter.pageSubtitle")}
            </p>
          </div>
        </div>
      </header>

      <ActivityCenterFeed
        items={items}
        liveIds={liveIds}
        loading={showInitialSkeleton}
        refreshing={isRefreshing}
        filter={filter}
        onFilterChange={setFilter}
        venueTimezone={venueTimezone}
        hasMore={hasMore}
        isLoadingOlder={isLoadingOlder}
        onLoadOlder={loadOlder}
        error={error}
      />
    </div>
  );
}
