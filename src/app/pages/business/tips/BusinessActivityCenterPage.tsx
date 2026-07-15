/**
 * ARCHITECTURE INVARIANT — Activity Center page
 * ---------------------------------------------
 * Route: /dashboard/tips/live (stable; do not rename without Product approval).
 *
 * Must consume ONLY:
 *   - GET /api/business/activity (via useActivityCenterFeed)
 *   - activity.created (via useActivityCenterFeed)
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

import { useRequireAuth } from "../../../hooks/useRequireAuth";
import {
  useActivityCenterFeed,
  type ActivitySourceFilter,
} from "../../../hooks/useActivityCenterFeed";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";
import { ActivityCenterFeed } from "../../../components/business/insights/ActivityCenterFeed";

/** Activity Center — operational event stream from BusinessActivityEvent SSOT. */
export function BusinessActivityCenterPage() {
  const { t } = useTranslation();
  const { user, sessionValidated } = useRequireAuth();
  const [source, setSource] = useState<ActivitySourceFilter>("all");

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
  } = useActivityCenterFeed({
    enabled,
    businessId: user?.businessId,
    source,
  });

  const { showInitialSkeleton } = useBusinessPageBoot("tips-live", isInitialLoading);

  return (
    <div className="space-y-6 pt-6">
      <p className="text-sm text-muted-foreground">{t("business.tips.liveDesc")}</p>
      <ActivityCenterFeed
        items={items}
        liveIds={liveIds}
        loading={showInitialSkeleton}
        refreshing={isRefreshing}
        source={source}
        onSourceChange={setSource}
        hasMore={hasMore}
        isLoadingOlder={isLoadingOlder}
        onLoadOlder={loadOlder}
        error={error}
      />
    </div>
  );
}
