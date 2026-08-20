import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, CreditCard, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/app/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { employeeUi } from "@/app/components/employee/employeeDashboardUi";
import { EmployeePageHeader } from "@/app/components/employee/EmployeePageHeader";
import {
  TipsActivityTableSkeleton,
} from "@/app/components/dashboard/DashboardSectionLoading";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { logClientError } from "@/app/lib/clientLog";
import { formatEur } from "@/app/lib/formatEur";
import { listBusinessTips, listEmployeeTips, type TipActivityRow, type TipStatus } from "@/app/lib/api";
import { useSubscriptionEntitlements } from "@/app/hooks/useSubscriptionEntitlements";
import { LockedFeatureCard } from "@/app/components/subscription/LockedFeatureCard";
import { BusinessResponsiveData } from "@/app/components/business/BusinessResponsiveData";
import { TipActivityMobileCard } from "@/app/components/business/businessDashboardMobileCards";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_HIGH_MS,
} from "@/app/lib/pageSessionCache";
import { useBusinessPageBoot } from "@/app/lib/useBusinessPageBoot";
import { withIdleSuppressSync } from "@/app/lib/idleSuppress";
import { formatVenueDateTime, resolveBusinessTimezone, setCachedBusinessVenueTimezone, venueLocalTodayKey } from "@/app/lib/businessVenueTime";

type TipsActivityCache = {
  items: TipActivityRow[];
  total: number;
  timezone: string | null;
};

function formatTipRowAt(iso: string, localeTag: string, timezone?: string | null): string {
  return formatVenueDateTime(iso, resolveBusinessTimezone(timezone), localeTag);
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type TipsActivityPageProps = {
  /** Finance-oriented employee ledger (Tip History). Default is business Tips & Activity. */
  variant?: "default" | "employee-history";
  /** When true, omit page title — parent module shell provides chrome. */
  embedded?: boolean;
};

export function TipsActivityPage({ variant = "default", embedded = false }: TipsActivityPageProps) {
  const { t, i18n } = useTranslation();
  const isEmployeeHistory = variant === "employee-history";
  const copyNs = isEmployeeHistory ? "employee.tipHistory" : "business.tipsActivity";
  const copy = useCallback((key: string, opts?: Record<string, unknown>) => t(`${copyNs}.${key}`, opts), [copyNs, t]);
  const localeTag = i18n.language || "en";
  const { user, sessionValidated } = useRequireAuth();
  const { hasFeature, tier, ready: entitlementsReady } = useSubscriptionEntitlements({
    enabled: user?.role === "business",
    role: user?.role === "business" ? "business" : null,
  });
  const canExportCsv = user?.role === "business" && entitlementsReady && hasFeature("csvExport");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<"all" | TipStatus>("all");
  const [range, setRange] = useState<"today" | "week" | "month" | "custom">("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<TipActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [dataTimezone, setDataTimezone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = 50;
  const skip = (page - 1) * take;
  const totalPages = Math.max(1, Math.ceil(total / take));

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  const statusLabel = useCallback(
    (s: TipStatus | string) => {
      if (s === "success") return copy("statusSuccess");
      if (s === "pending") return copy("statusPending");
      if (s === "failed") return copy("statusFailed");
      return String(s);
    },
    [copy],
  );

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!user) {
      if (sessionValidated) setLoading(false);
      return;
    }
    const cacheKey = `tips-activity:${variant}:${user.id}:${user.role}:${status}:${range}:${skip}:${customFrom}:${customTo}:${debouncedQ}`;
    const cached = getPageSessionCache<TipsActivityCache>(cacheKey, PAGE_CACHE_TTL_HIGH_MS);
    const useCachedFirst = !quiet && cached !== null;
    if (useCachedFirst) {
      setItems(cached.items);
      setTotal(cached.total);
      setDataTimezone(cached.timezone);
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
    }
    setError(null);
    try {
      const common = {
        take,
        skip,
        q: debouncedQ || undefined,
        status: status === "all" ? undefined : status,
        range,
        ...(range === "custom" ? { fromDate: customFrom || undefined, toDate: customTo || undefined } : {}),
      };
      const res =
        user.role === "business" && !isEmployeeHistory
          ? await listBusinessTips(common)
          : await listEmployeeTips(common);
      const nextItems = res.items ?? [];
      const nextTotal = res.total ?? 0;
      const nextTz = (res as { timezone?: string }).timezone ?? null;
      setItems(nextItems);
      setTotal(nextTotal);
      setDataTimezone(nextTz);
      if (nextTz) setCachedBusinessVenueTimezone(nextTz);
      setPageSessionCache(cacheKey, { items: nextItems, total: nextTotal, timezone: nextTz });
    } catch (e) {
      logClientError("TipsActivityPage.load", e);
      if (!useCachedFirst) {
        setItems([]);
        setTotal(0);
        setDataTimezone(null);
        setError(e instanceof Error ? e.message : copy("loadFailed"));
      }
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, [copy, customFrom, customTo, debouncedQ, isEmployeeHistory, range, sessionValidated, skip, status, user?.id, user?.role, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportDisabled = !canExportCsv || exporting || loading || items.length === 0;
  const ui = isEmployeeHistory || user?.role === "employee" ? employeeUi : businessUi;
  const showStaffColumn = !isEmployeeHistory;
  const subtitle = copy("subtitle");

  const isBusinessTipsPage = !isEmployeeHistory && user?.role === "business";
  const isInitialTipsLoad = isBusinessTipsPage && loading && items.length === 0;
  const { showInitialSkeleton } = useBusinessPageBoot(
    embedded ? "tips-transactions" : "tips-activity",
    isInitialTipsLoad,
  );
  const showTipsSkeleton = isEmployeeHistory
    ? loading
    : showInitialSkeleton || (loading && items.length > 0);

  return (
    <main className={cn(ui.page, !embedded && ui.pageShell, "overflow-x-hidden")}>
      <div className={embedded ? "w-full" : ui.pageInner}>
      {!embedded && isEmployeeHistory ? (
        <EmployeePageHeader
          title={copy("title")}
          description={subtitle.trim() || undefined}
          backAriaLabel={copy("backAria")}
          leading={
            <div className={employeeUi.iconTileMuted}>
              <CreditCard className="h-5 w-5" aria-hidden />
            </div>
          }
          className="mb-6 sm:mb-8"
        />
      ) : !embedded ? (
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{copy("title")}</h1>
          {subtitle.trim() ? <p className={cn("mt-2", ui.cardDesc)}>{subtitle}</p> : null}
        </header>
      ) : null}

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className={cn(ui.filterPanel, "mb-6 p-4 sm:p-6")}
      >
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={copy("searchPlaceholder")}
                className="w-full pl-11 pr-4 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="relative">
              <select
                value={status}
                onChange={(e) => {
                  setPage(1);
                  setStatus(e.target.value as "all" | TipStatus);
                }}
                className="appearance-none pl-4 pr-10 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all cursor-pointer text-sm"
              >
                <option value="all">{copy("statusAll")}</option>
                <option value="success">{copy("statusSuccess")}</option>
                <option value="pending">{copy("statusPending")}</option>
                <option value="failed">{copy("statusFailed")}</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>

            <div className="relative">
              <select
                value={range}
                onChange={(e) => {
                  setPage(1);
                  setRange(e.target.value as typeof range);
                }}
                className="appearance-none pl-4 pr-10 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all cursor-pointer text-sm"
              >
                <option value="today">{copy("rangeToday")}</option>
                <option value="week">{copy("rangeWeek")}</option>
                <option value="month">{copy("rangeMonth")}</option>
                <option value="custom">{copy("rangeCustom")}</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>

            {range === "custom" ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => {
                    setPage(1);
                    setCustomFrom(e.target.value);
                  }}
                  className="appearance-none px-3 py-3 bg-input-background border border-border rounded-lg text-sm"
                />
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => {
                    setPage(1);
                    setCustomTo(e.target.value);
                  }}
                  className="appearance-none px-3 py-3 bg-input-background border border-border rounded-lg text-sm"
                />
              </div>
            ) : null}

            {canExportCsv ? (
            <Button
              type="button"
              disabled={exportDisabled}
              onClick={() => {
                if (items.length === 0) return;
                setExporting(true);
                try {
                  const header = [
                    t("business.tipsActivity.csvDate"),
                    t("business.tipsActivity.csvAmount"),
                    t("business.tipsActivity.csvStaff"),
                    t("business.tipsActivity.csvLocationTable"),
                    t("business.tipsActivity.csvStatus"),
                  ];
                  const rows = items.map((tip) => [
                    formatTipRowAt(tip.createdAt, localeTag, dataTimezone),
                    formatEur(tip.amount),
                    tip.staffName ?? "",
                    tip.tableName
                      ? `${t("business.tipsActivity.csvTablePrefix")} ${tip.tableName}`
                      : tip.locationName
                        ? `${t("business.tipsActivity.csvLocationPrefix")} ${tip.locationName}`
                        : "",
                    statusLabel(tip.status),
                  ]);
                  const tzRow = dataTimezone ? [`${t("business.tipsActivity.csvTimezone")} ${dataTimezone}`] : [];
                  const csv = [tzRow, header, ...rows]
                    .filter((r) => r.length > 0)
                    .map((r) => r.map((c) => csvEscape(String(c))).join(","))
                    .join("\n");
                  const dateStr = venueLocalTodayKey(resolveBusinessTimezone(dataTimezone));
                  const tzSlug = (dataTimezone ?? "local").replace(/\//g, "_");
                  withIdleSuppressSync("tips-csv-export", () => {
                    downloadCsv(`tips_activity_${dateStr}_${tzSlug}.csv`, csv);
                  });
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">
                {exporting ? t("business.tipsActivity.exporting") : t("business.tipsActivity.export")}
              </span>
            </Button>
            ) : null}
          </div>
          {user?.role === "business" && entitlementsReady && !hasFeature("csvExport") ? (
            <LockedFeatureCard featureKey="csvExport" tier={tier} compact className="mt-4" />
          ) : null}
        </div>
      </motion.div>

      {error ? (
        <div className={cn(ui.filterPanel, "mb-6 p-4 text-sm text-destructive")}>{error}</div>
      ) : null}

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        {showTipsSkeleton ? (
          <div className={cn(ui.tablePanel, "overflow-hidden")}>
            <TipsActivityTableSkeleton />
          </div>
        ) : items.length === 0 ? (
          <div className={cn(ui.tablePanel, "overflow-hidden")}>
            <EmptyState
              icon={<CreditCard className="h-6 w-6" aria-hidden />}
              title={
                isEmployeeHistory
                  ? t("emptyState.tips.title")
                  : t("business.tipsActivity.empty")
              }
              description={
                isEmployeeHistory ? t("emptyState.tips.description") : undefined
              }
              compact
            />
          </div>
        ) : (
          <BusinessResponsiveData
            mobile={
              <>
                {items.map((tip) => (
                  <TipActivityMobileCard
                    key={tip.id}
                    tip={tip}
                    showStaffColumn={showStaffColumn}
                    statusLabel={statusLabel}
                    dateLocale={localeTag}
                    dataTimezone={dataTimezone}
                    unknownStaffLabel={copy("unknownStaff")}
                    youLabel={copy("you")}
                    userRole={user?.role}
                  />
                ))}
              </>
            }
            desktop={
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">{copy("thAmount")}</th>
                    {isEmployeeHistory ? (
                      <th className="px-4 py-3 font-medium text-muted-foreground">{copy("thDateTime")}</th>
                    ) : null}
                    {showStaffColumn ? (
                      <th className="px-4 py-3 font-medium text-muted-foreground">{copy("thStaff")}</th>
                    ) : null}
                    <th className="px-4 py-3 font-medium text-muted-foreground">{copy("thLocationTable")}</th>
                    {!isEmployeeHistory ? (
                      <th className="px-4 py-3 font-medium text-muted-foreground">{copy("thDateTime")}</th>
                    ) : null}
                    <th className="px-4 py-3 font-medium text-muted-foreground">{copy("thStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((tip) => (
                    <tr key={tip.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-4 py-3 tabular-nums font-medium">{formatEur(tip.amount)}</td>
                      {isEmployeeHistory ? (
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatTipRowAt(tip.createdAt, localeTag, dataTimezone)}
                        </td>
                      ) : null}
                      {showStaffColumn ? (
                        <td className="px-4 py-3">
                          {tip.staffName ?? (user?.role === "employee" ? copy("you") : copy("unknownStaff"))}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-muted-foreground">
                        {tip.tableName
                          ? `${copy("csvTablePrefix")} ${tip.tableName}`
                          : tip.locationName
                            ? `${copy("csvLocationPrefix")} ${tip.locationName}`
                            : copy("noLocationDetail")}
                      </td>
                      {!isEmployeeHistory ? (
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatTipRowAt(tip.createdAt, localeTag, dataTimezone)}
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold">
                          {statusLabel(tip.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
        )}
      </motion.div>

      {totalPages > 1 ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {copy("pagination", {
              from: skip + 1,
              to: Math.min(skip + take, total),
              total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              {copy("prev")}
            </Button>
            <span className="px-2 text-sm text-foreground">
              {copy("pageOf", { page, pages: totalPages })}
            </span>
            <Button type="button" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              {copy("next")}
            </Button>
          </div>
        </div>
      ) : null}
      </div>
    </main>
  );
}
