import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DashboardViewAllLink } from "@/app/components/dashboard/DashboardViewAllLink";
import { listBusinessCustomerFeedback, type CustomerFeedbackSummary } from "@/app/lib/api";
import { BusinessDashboardAnalyticsEmpty } from "@/app/components/business/BusinessDashboardAnalyticsEmpty";
import { DashboardListSkeleton } from "@/app/components/dashboard/DashboardSectionLoading";
import { CustomerFeedbackListItem } from "@/app/components/business/CustomerFeedbackListItem";
import { CustomerFeedbackDashboardSnapshot } from "@/app/components/business/feedback/CustomerFeedbackDashboardSnapshot";
import { CUSTOMERS_BASE } from "@/app/components/business/businessDashboardNav";
import { cn } from "@/lib/utils";
import { logClientError } from "@/app/lib/clientLog";
import { isApiPendingVerificationError, isApiSubscriptionRequiredError } from "@/app/lib/apiError";
import { scheduleIdleWork } from "@/lib/publicRouteDefer";
import { useBusinessEntitlementsContext } from "@/app/contexts/BusinessEntitlementsContext";
import { useSubscriptionEntitlements } from "@/app/hooks/useSubscriptionEntitlements";
import {
  DASHBOARD_DESKTOP_TEASER_LIMIT,
  DASHBOARD_MOBILE_TEASER_LIMIT,
  DASHBOARD_MOBILE_TEASER_MEDIA_QUERY,
} from "@/app/lib/dashboardTeaserLimits";
import { useMediaQuery } from "@/hooks/use-media-query";

export const DASHBOARD_CUSTOMER_FEEDBACK_TEASER_LIMIT = DASHBOARD_DESKTOP_TEASER_LIMIT;

type RecentCustomerFeedbackPanelProps = {
  enabled?: boolean;
  className?: string;
};

export function RecentCustomerFeedbackPanel({
  enabled = true,
  className,
}: RecentCustomerFeedbackPanelProps) {
  const { t } = useTranslation();
  const businessEntitlements = useBusinessEntitlementsContext();
  const fallbackEntitlements = useSubscriptionEntitlements({
    enabled: enabled && businessEntitlements == null,
    role: enabled ? "business" : null,
  });
  const { ready, hasFeature, hasActiveEntitlements } = businessEntitlements ?? fallbackEntitlements;
  const entitled = ready && hasActiveEntitlements && hasFeature("customerFeedback");
  const isMobileTeaser = useMediaQuery(DASHBOARD_MOBILE_TEASER_MEDIA_QUERY);
  const feedbackFetchLimit = isMobileTeaser
    ? DASHBOARD_MOBILE_TEASER_LIMIT
    : DASHBOARD_CUSTOMER_FEEDBACK_TEASER_LIMIT;
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<CustomerFeedbackSummary | null>(null);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listBusinessCustomerFeedback>>["items"]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !entitled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listBusinessCustomerFeedback({
        take: feedbackFetchLimit,
        skip: 0,
      });
      setItems(res.items);
      setSummary(res.summary);
    } catch (err) {
      if (isApiPendingVerificationError(err) || isApiSubscriptionRequiredError(err)) {
        setItems([]);
        setSummary(null);
        setError(null);
        return;
      }
      logClientError("RecentCustomerFeedbackPanel.load", err);
      setError(t("business.customerFeedback.loadError"));
      setItems([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, entitled, feedbackFetchLimit, t]);

  useEffect(() => {
    if (!enabled) return;
    if (!ready) return;
    if (!entitled) {
      setLoading(false);
      setError(null);
      setItems([]);
      setSummary(null);
      return;
    }
    scheduleIdleWork(() => {
      void load();
    }, 0);
  }, [enabled, entitled, load, ready, feedbackFetchLimit]);

  const visibleFeedbackItems = useMemo(
    () => items.slice(0, feedbackFetchLimit),
    [feedbackFetchLimit, items],
  );

  const hasReviews = (summary?.feedbackCount ?? 0) > 0;

  return (
    <section
      className={cn("business-dashboard-feedback w-full caretip-feedback-dashboard-panel", className)}
      aria-labelledby="business-dashboard-feedback-heading"
    >
      <header className="caretip-feedback-dashboard-panel__head">
        <div className="min-w-0">
          <h2 id="business-dashboard-feedback-heading" className="text-base font-semibold tracking-tight">
            {t("business.customerFeedback.dashboardSummaryTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("business.customerFeedback.dashboardSummaryDesc")}
          </p>
        </div>
        <DashboardViewAllLink to={CUSTOMERS_BASE}>
          {t("business.customerFeedback.dashboardViewAll")}
        </DashboardViewAllLink>
      </header>

      {!loading && hasReviews && summary ? (
        <CustomerFeedbackDashboardSnapshot summary={summary} items={items} />
      ) : null}

      <div className="caretip-feedback-dashboard-panel__list">
        {loading ? (
          <DashboardListSkeleton minHeightClass="min-h-[200px]" />
        ) : error ? (
          <BusinessDashboardAnalyticsEmpty
            variant="panel"
            icon={<MessageSquare className="h-6 w-6 text-muted-foreground" aria-hidden />}
            title={t("business.customerFeedback.loadErrorTitle")}
            description={error}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                {t("business.customerFeedback.retry")}
              </Button>
            }
          />
        ) : visibleFeedbackItems.length === 0 ? (
          <BusinessDashboardAnalyticsEmpty
            variant="panel"
            icon={<Star className="h-6 w-6 text-muted-foreground" aria-hidden />}
            title={t("business.customerFeedback.dashboardEmptyTitle")}
            description={t("business.customerFeedback.dashboardEmptyDesc")}
          />
        ) : (
          <div className="business-dashboard-feedback-list space-y-2.5">
            {visibleFeedbackItems.map((item) => (
              <CustomerFeedbackListItem
                key={item.id}
                item={item}
                className="business-dashboard-feedback-item"
                compact
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
