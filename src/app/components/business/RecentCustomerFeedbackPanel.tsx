import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DashboardViewAllLink } from "@/app/components/dashboard/DashboardViewAllLink";
import { listBusinessCustomerFeedback, type CustomerFeedbackSummary } from "@/app/lib/api";
import { BusinessDashboardAnalyticsEmpty } from "@/app/components/business/BusinessDashboardAnalyticsEmpty";
import { DashboardListSkeleton } from "@/app/components/dashboard/DashboardSectionLoading";
import { CustomerFeedbackListItem } from "@/app/components/business/CustomerFeedbackListItem";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { CUSTOMERS_BASE } from "@/app/components/business/businessDashboardNav";
import { cn } from "@/lib/utils";
import { logClientError } from "@/app/lib/clientLog";
import { isApiPendingVerificationError, isApiSubscriptionRequiredError } from "@/app/lib/apiError";
import { scheduleIdleWork } from "@/lib/publicRouteDefer";
import { useInViewActive } from "@/lib/motionPerf";
import { useBusinessEntitlementsContext } from "@/app/contexts/BusinessEntitlementsContext";
import { useSubscriptionEntitlements } from "@/app/hooks/useSubscriptionEntitlements";

export const DASHBOARD_CUSTOMER_FEEDBACK_TEASER_LIMIT = 3;

type RecentCustomerFeedbackPanelProps = {
  enabled?: boolean;
  className?: string;
};

export function RecentCustomerFeedbackPanel({
  enabled = true,
  className,
}: RecentCustomerFeedbackPanelProps) {
  const { t } = useTranslation();
  const { ref: panelRef, active: panelVisible } = useInViewActive<HTMLElement>({
    rootMargin: "160px 0px",
  });
  const businessEntitlements = useBusinessEntitlementsContext();
  const fallbackEntitlements = useSubscriptionEntitlements({
    enabled: enabled && businessEntitlements == null,
    role: enabled ? "business" : null,
  });
  const { ready, hasFeature, hasActiveEntitlements } = businessEntitlements ?? fallbackEntitlements;
  const entitled = ready && hasActiveEntitlements && hasFeature("customerFeedback");
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
        take: DASHBOARD_CUSTOMER_FEEDBACK_TEASER_LIMIT,
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
  }, [enabled, entitled, t]);

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
    if (!panelVisible) return;
    scheduleIdleWork(() => {
      void load();
    }, 0);
  }, [enabled, entitled, load, panelVisible, ready]);

  return (
    <section
      ref={panelRef}
      className={cn("business-dashboard-feedback w-full", className)}
      aria-labelledby="business-dashboard-feedback-heading"
    >
      <header className="flex flex-row items-start justify-between gap-4 py-3">
        <div className="min-w-0 space-y-1">
          <h2 id="business-dashboard-feedback-heading" className="text-base font-semibold tracking-tight">
            {t("business.customerFeedback.recentTitle")}
          </h2>
          <p className={businessUi.cardDesc}>
            {summary && summary.feedbackCount > 0
              ? t("business.customerFeedback.recentDescWithStats", {
                  count: summary.feedbackCount,
                  average:
                    summary.averageRating != null ? summary.averageRating.toFixed(1) : "—",
                })
              : t("business.customerFeedback.recentDesc")}
          </p>
        </div>
        <DashboardViewAllLink to={CUSTOMERS_BASE}>{t("dashboard.viewAll")}</DashboardViewAllLink>
      </header>
      <div>
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
        ) : items.length === 0 ? (
          <BusinessDashboardAnalyticsEmpty
            variant="panel"
            icon={<Star className="h-6 w-6 text-muted-foreground" aria-hidden />}
            title={t("emptyState.ratings.title")}
            description={t("emptyState.ratings.description")}
          />
        ) : (
          <div className="business-dashboard-feedback-list">
            {items.map((item) => (
              <CustomerFeedbackListItem key={item.id} item={item} className="business-dashboard-feedback-item" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
