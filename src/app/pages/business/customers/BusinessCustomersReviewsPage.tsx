import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { listBusinessCustomerFeedback, type CustomerFeedbackRow } from "../../../lib/api";
import { logClientError } from "../../../lib/clientLog";
import { formatTimeAgo } from "../../../lib/formatTimeAgo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { businessUi } from "../../../components/business/businessDashboardUi";
import { BusinessStatCard } from "../../../components/business/BusinessStatCard";
import { CountUpMetric } from "../../../components/dashboard/CountUpMetric";
import { cn } from "@/lib/utils";
import { FeatureGate } from "@/app/components/subscription/FeatureGate";
import { useSubscriptionEntitlements } from "@/app/hooks/useSubscriptionEntitlements";
import { isApiSubscriptionRequiredError } from "@/app/lib/apiError";
import { useBusinessPageBoot } from "@/app/lib/useBusinessPageBoot";

function BusinessCustomersReviewsPageContent() {
  const { t } = useTranslation();
  const { user, sessionValidated } = useRequireAuth();
  const { ready, hasFeature, hasActiveEntitlements } = useSubscriptionEntitlements({
    enabled: sessionValidated && user?.role === "business",
    role: "business",
  });
  const entitled = ready && hasActiveEntitlements && hasFeature("customerFeedback");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CustomerFeedbackRow[]>([]);
  const [summary, setSummary] = useState({ averageRating: null as number | null, ratingCount: 0, feedbackCount: 0 });

  const load = useCallback(async () => {
    if (!sessionValidated || user?.role !== "business" || !entitled) return;
    setLoading(true);
    try {
      const res = await listBusinessCustomerFeedback({ take: 30, skip: 0 });
      setItems(res.items);
      setSummary(res.summary);
    } catch (err) {
      if (!isApiSubscriptionRequiredError(err)) {
        logClientError("BusinessCustomersReviewsPage", err);
      }
    } finally {
      setLoading(false);
    }
  }, [entitled, sessionValidated, user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  const isInitialReviewsLoad = loading && items.length === 0;
  const { showInitialSkeleton } = useBusinessPageBoot("customers-reviews", isInitialReviewsLoad);

  return (
    <div className="space-y-6 pt-6">
      <p className="text-sm text-muted-foreground">{t("business.customers.reviewsDesc")}</p>
      <div className={cn(businessUi.statsGrid, "sm:grid-cols-3")}>
        <BusinessStatCard
          featured
          loading={loading}
          label={t("business.customers.reviews.avgRating")}
          value={
            summary.averageRating != null ? (
              <CountUpMetric value={summary.averageRating} kind="decimal" decimalPlaces={1} />
            ) : (
              "—"
            )
          }
          change={t("business.customers.reviews.ratingCount", { count: summary.ratingCount })}
          icon={<Star className="h-5 w-5" aria-hidden />}
        />
        <BusinessStatCard
          loading={loading}
          label={t("business.customers.reviews.totalReviews")}
          value={<CountUpMetric value={summary.feedbackCount} kind="integer" />}
        />
        <BusinessStatCard
          loading={loading}
          label={t("business.customers.reviews.fiveStar")}
          value={
            <CountUpMetric
              value={items.filter((i) => (i.rating ?? 0) >= 5).length}
              kind="integer"
            />
          }
        />
      </div>

      <Card className={businessUi.cardStatic}>
        <CardHeader className="border-b border-neutral-100/90">
          <CardTitle className="text-base">{t("business.customers.reviews.recentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 p-0">
          {showInitialSkeleton ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("business.branding.loading")}</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("business.customers.reviews.empty")}</p>
          ) : (
            items.map((row) => (
              <article key={row.id} className="px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{row.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.customerName ?? t("business.customers.reviews.guest")}
                      <span className="mx-1.5">·</span>
                      {formatTimeAgo(row.createdAt)}
                    </p>
                  </div>
                  {row.rating != null ? (
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      ★ {row.rating.toFixed(1)}
                    </span>
                  ) : null}
                </div>
                {row.comment ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">&ldquo;{row.comment}&rdquo;</p>
                ) : null}
                {row.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function BusinessCustomersReviewsPage() {
  return (
    <FeatureGate featureKey="customerFeedback" role="business">
      <BusinessCustomersReviewsPageContent />
    </FeatureGate>
  );
}
