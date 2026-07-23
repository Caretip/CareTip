import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Search,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getBusinessStats,
  listBusinessCustomerFeedback,
  type CustomerFeedbackRow,
  type CustomerFeedbackSummary,
} from "@/app/lib/api";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { EmployeeEmptyState } from "@/app/components/employee/EmployeeEmptyState";
import { BusinessSubPageShellSkeleton } from "@/app/components/dashboard/BusinessSubPageShellSkeleton";
import { DashboardListSkeleton } from "@/app/components/dashboard/DashboardSectionLoading";
import { useBusinessPageBoot } from "@/app/lib/useBusinessPageBoot";
import { CustomerFeedbackListItem } from "@/app/components/business/CustomerFeedbackListItem";
import { BusinessStatCard } from "@/app/components/business/BusinessStatCard";
import { CountUpMetric } from "@/app/components/dashboard/CountUpMetric";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { logClientError } from "@/app/lib/clientLog";
import { isApiSubscriptionRequiredError } from "@/app/lib/apiError";
import { useSubscriptionEntitlements } from "@/app/hooks/useSubscriptionEntitlements";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_HIGH_MS,
} from "@/app/lib/pageSessionCache";
import { cn } from "@/lib/utils";
import {
  resolveBusinessTimezone,
  venueLocalDayKey,
  venueLocalDayKeyMinusDays,
  venueLocalMonthPrefix,
  venueLocalTodayKey,
} from "@/app/lib/businessVenueTime";

const PAGE_SIZE = 20;
const ANALYTICS_TAKE = 100;

type FeedbackCache = {
  items: CustomerFeedbackRow[];
  total: number;
  summary: CustomerFeedbackSummary | null;
};

type SortKey = "newest" | "highest" | "lowest";
type RatingFilter = "all" | "5" | "4" | "3" | "2" | "1";
type DateRangeKey = "all" | "7d" | "30d" | "90d";

function isWithinDateRange(iso: string, range: DateRangeKey): boolean {
  if (range === "all") return true;
  const tz = resolveBusinessTimezone();
  const dayKey = venueLocalDayKey(iso, tz);
  if (!dayKey) return true;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const oldest = venueLocalDayKeyMinusDays(days - 1, tz);
  return dayKey >= oldest && dayKey <= venueLocalTodayKey(tz);
}

function matchesSearch(item: CustomerFeedbackRow, q: string): boolean {
  if (!q) return true;
  const hay = [
    item.customerName ?? "",
    item.employeeName,
    item.comment ?? "",
    ...item.tags,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function matchesRating(item: CustomerFeedbackRow, filter: RatingFilter): boolean {
  if (filter === "all") return true;
  if (item.rating == null) return false;
  return Math.round(item.rating) === Number(filter);
}

function sortItems(items: CustomerFeedbackRow[], sort: SortKey): CustomerFeedbackRow[] {
  const next = [...items];
  next.sort((a, b) => {
    if (sort === "newest") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    const ar = a.rating ?? -1;
    const br = b.rating ?? -1;
    return sort === "highest" ? br - ar : ar - br;
  });
  return next;
}

export function CustomerFeedbackPage() {
  const { t } = useTranslation();
  const { user, authReady, authStatus } = useRequireAuth();
  const { ready, hasFeature, hasActiveEntitlements } = useSubscriptionEntitlements({
    enabled: authReady && authStatus === "authenticated" && user?.role === "business",
    role: "business",
  });
  const entitled = ready && hasActiveEntitlements && hasFeature("customerFeedback");
  const canLoad =
    authReady && authStatus === "authenticated" && user?.role === "business" && entitled;

  const [items, setItems] = useState<CustomerFeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CustomerFeedbackSummary | null>(null);
  const [analyticsItems, setAnalyticsItems] = useState<CustomerFeedbackRow[]>([]);
  const [page, setPage] = useState(1);
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [dateRange, setDateRange] = useState<DateRangeKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [staffOptions, setStaffOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canLoad) return;
    void getBusinessStats("all", { scope: "analytics" })
      .then((stats) => {
        setStaffOptions(
          (stats.employees ?? []).map((e) => ({ id: e.id, name: e.name ?? "Staff" })),
        );
      })
      .catch((err) => logClientError("CustomerFeedbackPage.staff", err));
  }, [canLoad]);

  const loadFeedback = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!canLoad) return;
      const quiet = opts?.quiet === true;
      const cacheKey = `business:feedback:merged:${user?.id ?? ""}:${employeeId}`;
      const cached = getPageSessionCache<FeedbackCache>(cacheKey, PAGE_CACHE_TTL_HIGH_MS);
      const useCachedFirst = !quiet && cached !== null;
      if (useCachedFirst) {
        setItems(cached.items);
        setTotal(cached.total);
        setSummary(cached.summary);
        setAnalyticsItems(cached.items);
        setLoading(false);
      } else if (!quiet && items.length === 0) {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await listBusinessCustomerFeedback({
          take: ANALYTICS_TAKE,
          skip: 0,
          employeeId: employeeId === "all" ? undefined : employeeId,
        });
        setItems(res.items);
        setTotal(res.total);
        setSummary(res.summary);
        setAnalyticsItems(res.items);
        setPageSessionCache(cacheKey, {
          items: res.items,
          total: res.total,
          summary: res.summary,
        });
      } catch (err) {
        logClientError("CustomerFeedbackPage.load", err);
        if (isApiSubscriptionRequiredError(err)) {
          setError(null);
          setItems([]);
          setTotal(0);
          return;
        }
        if (!useCachedFirst) {
          setError(t("business.customerFeedback.loadError"));
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!quiet && !useCachedFirst) setLoading(false);
      }
    },
    [canLoad, employeeId, items.length, t, user?.id],
  );

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  useEffect(() => {
    setPage(1);
  }, [employeeId, searchQuery, ratingFilter, dateRange, sortKey]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = items.filter(
      (item) =>
        matchesSearch(item, q) &&
        matchesRating(item, ratingFilter) &&
        isWithinDateRange(item.createdAt, dateRange),
    );
    return sortItems(filtered, sortKey);
  }, [items, searchQuery, ratingFilter, dateRange, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, page]);

  const fiveStarCount = useMemo(
    () => analyticsItems.filter((i) => (i.rating ?? 0) >= 5).length,
    [analyticsItems],
  );

  const reviewsThisMonth = useMemo(() => {
    const tz = resolveBusinessTimezone();
    const monthPrefix = venueLocalMonthPrefix(tz);
    return analyticsItems.filter((i) => venueLocalDayKey(i.createdAt, tz).startsWith(monthPrefix))
      .length;
  }, [analyticsItems]);

  /** Guest written-feedback rate as a stand-in until reply tracking exists. */
  const responseRate = useMemo(() => {
    if (analyticsItems.length === 0) return null;
    const withComment = analyticsItems.filter((i) => Boolean(i.comment?.trim())).length;
    return Math.round((withComment / analyticsItems.length) * 100);
  }, [analyticsItems]);

  const insights = useMemo(() => {
    const compliments: Record<string, number> = {};
    const complaints: Record<string, number> = {};
    const byEmployee: Record<string, { name: string; sum: number; count: number }> = {};
    const ratingBuckets = [0, 0, 0, 0, 0];

    for (const item of analyticsItems) {
      const isPositive = (item.rating ?? 0) >= 4;
      const isNegative = item.rating != null && item.rating <= 2;
      for (const tag of item.tags) {
        const key = tag.trim();
        if (!key) continue;
        if (isPositive) compliments[key] = (compliments[key] ?? 0) + 1;
        if (isNegative) complaints[key] = (complaints[key] ?? 0) + 1;
      }
      if (item.rating != null) {
        const bucket = Math.max(1, Math.min(5, Math.round(item.rating))) - 1;
        ratingBuckets[bucket] += 1;
        const emp = byEmployee[item.employeeId] ?? {
          name: item.employeeName,
          sum: 0,
          count: 0,
        };
        emp.sum += item.rating;
        emp.count += 1;
        byEmployee[item.employeeId] = emp;
      }
    }

    const topN = (map: Record<string, number>, n: number) =>
      Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);

    const employees = Object.values(byEmployee)
      .map((e) => ({ name: e.name, avg: e.sum / e.count, count: e.count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);

    return {
      compliments: topN(compliments, 5),
      complaints: topN(complaints, 5),
      ratingBuckets,
      employees,
    };
  }, [analyticsItems]);

  const maxBucket = Math.max(1, ...insights.ratingBuckets);

  const isInitialFeedbackLoad = loading && items.length === 0;
  const { showInitialSkeleton } = useBusinessPageBoot("feedback", isInitialFeedbackLoad);

  if (!authReady) {
    return <BusinessSubPageShellSkeleton />;
  }

  return (
    <div className="space-y-6 pt-2 sm:space-y-7 sm:pt-4">
      <div className={cn(businessUi.statsGrid, "sm:grid-cols-3 lg:grid-cols-5")}>
        <BusinessStatCard
          featured
          loading={loading}
          label={t("business.customers.reviews.avgRating")}
          value={
            summary?.averageRating != null ? (
              <CountUpMetric value={summary.averageRating} kind="decimal" decimalPlaces={1} />
            ) : (
              "—"
            )
          }
          change={
            summary
              ? t("business.customers.reviews.ratingCount", { count: summary.ratingCount })
              : undefined
          }
          icon={<Star className="h-5 w-5" aria-hidden />}
        />
        <BusinessStatCard
          loading={loading}
          label={t("business.customers.reviews.totalReviews")}
          value={<CountUpMetric value={summary?.feedbackCount ?? 0} kind="integer" />}
        />
        <BusinessStatCard
          loading={loading}
          label={t("business.customers.reviews.fiveStar")}
          value={<CountUpMetric value={fiveStarCount} kind="integer" />}
        />
        <BusinessStatCard
          loading={loading}
          label={t("business.customerFeedback.responseRate")}
          value={responseRate != null ? `${responseRate}%` : "—"}
          change={t("business.customerFeedback.responseRateHint")}
        />
        <BusinessStatCard
          loading={loading}
          label={t("business.customerFeedback.reviewsThisMonth")}
          value={<CountUpMetric value={reviewsThisMonth} kind="integer" />}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("business.customerFeedback.searchPlaceholder")}
              className="pl-9"
              aria-label={t("business.customerFeedback.searchPlaceholder")}
            />
          </div>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger aria-label={t("business.customerFeedback.filterEmployee")}>
              <SelectValue placeholder={t("business.customerFeedback.filterEmployee")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("business.customerFeedback.allEmployees")}</SelectItem>
              {staffOptions.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={ratingFilter}
            onValueChange={(v) => setRatingFilter(v as RatingFilter)}
          >
            <SelectTrigger aria-label={t("business.customerFeedback.filterRating")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("business.customerFeedback.allRatings")}</SelectItem>
              <SelectItem value="5">5 ★</SelectItem>
              <SelectItem value="4">4 ★</SelectItem>
              <SelectItem value="3">3 ★</SelectItem>
              <SelectItem value="2">2 ★</SelectItem>
              <SelectItem value="1">1 ★</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangeKey)}>
            <SelectTrigger aria-label={t("business.customerFeedback.dateRange")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("business.customerFeedback.dateAll")}</SelectItem>
              <SelectItem value="7d">{t("business.customerFeedback.date7d")}</SelectItem>
              <SelectItem value="30d">{t("business.customerFeedback.date30d")}</SelectItem>
              <SelectItem value="90d">{t("business.customerFeedback.date90d")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-[220px]" aria-label={t("business.customerFeedback.sort")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{t("business.customerFeedback.sortNewest")}</SelectItem>
              <SelectItem value="highest">{t("business.customerFeedback.sortHighest")}</SelectItem>
              <SelectItem value="lowest">{t("business.customerFeedback.sortLowest")}</SelectItem>
            </SelectContent>
          </Select>
          {filteredItems.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("business.customerFeedback.showingCount", {
                shown: pageItems.length,
                total: filteredItems.length,
              })}
              {total > filteredItems.length
                ? ` · ${t("business.customerFeedback.sampleOf", { total })}`
                : null}
            </p>
          ) : null}
        </div>
      </div>

      {showInitialSkeleton ? (
        <DashboardListSkeleton minHeightClass="min-h-[280px]" />
      ) : error ? (
        <EmployeeEmptyState
          className="py-12"
          icon={<MessageSquare className="h-6 w-6 text-muted-foreground" aria-hidden />}
          title={t("business.customerFeedback.loadErrorTitle")}
          description={error}
          action={
            <Button type="button" variant="outline" onClick={() => void loadFeedback()}>
              {t("business.customerFeedback.retry")}
            </Button>
          }
        />
      ) : filteredItems.length === 0 ? (
        <EmployeeEmptyState
          className="py-12"
          icon={<Star className="h-6 w-6 text-muted-foreground" aria-hidden />}
          title={t("emptyState.ratings.title")}
          description={t("emptyState.ratings.description")}
        />
      ) : (
        <div className="business-dashboard-feedback-list space-y-3">
          {pageItems.map((item) => (
            <CustomerFeedbackListItem key={item.id} item={item} />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
            {t("business.tipsActivity.prev")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("business.tipsActivity.pageOf", { page, pages: totalPages })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t("business.tipsActivity.next")}
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        </div>
      ) : null}

      {!loading && analyticsItems.length > 0 ? (
        <section className="space-y-4" aria-labelledby="feedback-insights-heading">
          <div>
            <h2 id="feedback-insights-heading" className="text-base font-semibold text-foreground">
              {t("business.customerFeedback.insightsTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("business.customerFeedback.insightsDesc")}
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className={businessUi.cardStatic}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  {t("business.customerFeedback.commonCompliments")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {insights.compliments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("business.customerFeedback.insightsEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {insights.compliments.map(([tag, count]) => (
                      <li
                        key={tag}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate font-medium text-foreground">{tag}</span>
                        <span className="tabular-nums text-muted-foreground">{count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card className={businessUi.cardStatic}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  {t("business.customerFeedback.commonComplaints")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {insights.complaints.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("business.customerFeedback.insightsEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {insights.complaints.map(([tag, count]) => (
                      <li
                        key={tag}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate font-medium text-foreground">{tag}</span>
                        <span className="tabular-nums text-muted-foreground">{count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card className={businessUi.cardStatic}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {t("business.customerFeedback.ratingTrend")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex h-28 items-end gap-2">
                  {insights.ratingBuckets.map((count, index) => (
                    <div key={index} className="flex flex-1 flex-col items-center gap-1.5">
                      <div
                        className="w-full rounded-t-md bg-primary/80 transition-[height]"
                        style={{ height: `${Math.max(8, (count / maxBucket) * 100)}%` }}
                        title={`${count}`}
                      />
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {index + 1}★
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className={businessUi.cardStatic}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {t("business.customerFeedback.employeeComparison")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {insights.employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("business.customerFeedback.insightsEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {insights.employees.map((emp) => (
                      <li
                        key={emp.name}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 truncate font-medium text-foreground">
                          {emp.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {emp.avg.toFixed(1)} ★ · {emp.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}
    </div>
  );
}
