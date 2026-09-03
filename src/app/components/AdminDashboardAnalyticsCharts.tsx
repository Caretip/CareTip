import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { PlatformAnalytics } from "../lib/api";
import { cn } from "@/lib/utils";
import { platformUi } from "./platform/platformDashboardUi";
import { CHART_ANIMATION_OFF } from "../lib/lightweightChartProps";
import {
  DashboardChartSkeleton,
  DashboardRefreshIndicator,
} from "./dashboard/DashboardAnalyticsLoader";
import { DashboardStableChartSlot } from "./dashboard/DashboardSectionLoading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/app/components/ui/chart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

const ADMIN_CHART_COLORS = {
  primary: "#e9781c",
  cyan: "#22d3ee",
  purple: "#a78bfa",
  emerald: "#34d399",
  amber: "#f59e0b",
  red: "#fb7185",
  slate: "#94a3b8",
} as const;

export const ADMIN_ANALYTICS_TZ_OPTIONS = [
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

function formatCompact(n: number): string {
  try {
    return new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);
  } catch {
    return String(n);
  }
}

function AnalyticsCard({
  title,
  description,
  children,
  descriptionClassName,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  descriptionClassName?: string;
}) {
  return (
    <Card className={platformUi.analyticsCard}>
      <CardHeader className={platformUi.analyticsCardHeader}>
        <CardTitle className={platformUi.analyticsCardTitle}>{title}</CardTitle>
        <CardDescription className={cn(platformUi.analyticsCardDesc, descriptionClassName)}>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className={platformUi.analyticsCardBody}>
        <div className={platformUi.analyticsChartWrap}>{children}</div>
      </CardContent>
    </Card>
  );
}

function HorizontalCountBarChart({
  rows,
  config,
  emptyLabel,
}: {
  rows: Array<{ name: string; key: string; value: number }>;
  config: ChartConfig;
  emptyLabel: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const chartRows =
    total > 0
      ? rows.map((row) => ({
          ...row,
          fill: `var(--color-${row.key})`,
        }))
      : [{ name: emptyLabel, key: "empty", value: 1, fill: "var(--color-empty)" }];

  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full min-h-0">
      <BarChart
        data={chartRows}
        layout="vertical"
        margin={{ left: 4, right: 12, top: 8, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis
          dataKey="name"
          type="category"
          width={88}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20} {...CHART_ANIMATION_OFF}>
          {chartRows.map((row) => (
            <Cell key={row.key} fill={row.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function UserDistributionChart({
  data,
}: {
  data: Array<{ role: "business" | "employee" | "platform_admin"; count: number }>;
}) {
  const { t } = useTranslation();
  const config: ChartConfig = {
    business: { label: t("admin.legendBusinesses"), color: ADMIN_CHART_COLORS.primary },
    employee: { label: t("admin.legendEmployees"), color: ADMIN_CHART_COLORS.cyan },
    platform_admin: { label: t("admin.legendPlatformAdmins"), color: ADMIN_CHART_COLORS.purple },
    empty: { label: t("admin.legendNoData"), color: ADMIN_CHART_COLORS.slate },
  };

  const rows = data.map((d) => ({
    name: String(config[d.role]?.label ?? d.role),
    key: d.role,
    value: Number.isFinite(d.count) ? d.count : 0,
  }));

  return (
    <HorizontalCountBarChart rows={rows} config={config} emptyLabel={t("admin.legendNoData")} />
  );
}

function GrowthChart({
  data,
  mode = "full",
}: {
  data: Array<{ date: string; newUsers: number; newBusinesses: number; newTips: number }>;
  mode?: "full" | "users" | "business";
}) {
  const { t } = useTranslation();
  const config: ChartConfig = {
    newUsers: { label: t("admin.legendNewUsers"), color: ADMIN_CHART_COLORS.primary },
    newBusinesses: { label: t("admin.legendNewVenues"), color: ADMIN_CHART_COLORS.purple },
    newTips: { label: t("admin.legendNewTips"), color: ADMIN_CHART_COLORS.cyan },
  };

  const showUsers = mode === "full" || mode === "users";
  const showBusinesses = mode === "full" || mode === "business";
  const showTips = mode === "full" || mode === "business";

  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full min-h-0">
      <LineChart data={data} margin={{ left: 6, right: 6, top: 12, bottom: 6 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tickMargin={8} minTickGap={18} />
        <YAxis tickFormatter={formatCompact} width={34} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(v) => t("admin.growthDateLabel", { date: String(v ?? "") })}
            />
          }
        />
        <Legend verticalAlign="bottom" height={24} />
        {showUsers ? (
          <Line type="monotone" dataKey="newUsers" stroke="var(--color-newUsers)" strokeWidth={2} dot={false} {...CHART_ANIMATION_OFF} />
        ) : null}
        {showBusinesses ? (
          <Line type="monotone" dataKey="newBusinesses" stroke="var(--color-newBusinesses)" strokeWidth={2} dot={false} {...CHART_ANIMATION_OFF} />
        ) : null}
        {showTips ? (
          <Line type="monotone" dataKey="newTips" stroke="var(--color-newTips)" strokeWidth={2} dot={false} {...CHART_ANIMATION_OFF} />
        ) : null}
      </LineChart>
    </ChartContainer>
  );
}

function TipVolumeChart({
  data,
  top,
  preferTopBusinesses = true,
}: {
  data: Array<{ date: string; tipsEur: number; tipCount: number }>;
  top: Array<{ businessId: string; businessName: string; tipsEur: number }>;
  preferTopBusinesses?: boolean;
}) {
  const { t } = useTranslation();
  const config: ChartConfig = {
    tipsEur: { label: t("admin.legendTipsEur"), color: ADMIN_CHART_COLORS.emerald },
    top: { label: t("admin.legendTopVenues"), color: ADMIN_CHART_COLORS.slate },
  };

  const topBars = (top ?? []).map((b) => ({ name: b.businessName, tipsEur: b.tipsEur }));
  const showTop = preferTopBusinesses && topBars.length > 0;

  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full min-h-0">
      {showTop ? (
        <BarChart data={topBars} margin={{ left: 6, right: 6, top: 12, bottom: 26 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            tickMargin={10}
            interval="preserveStartEnd"
            tick={{ fontSize: 11 }}
            angle={-35}
            height={58}
            textAnchor="end"
            tickFormatter={(v) => String(v).slice(0, 12)}
          />
          <YAxis tickFormatter={formatCompact} width={40} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <Bar dataKey="tipsEur" fill="var(--color-tipsEur)" radius={[6, 6, 0, 0]} maxBarSize={40} {...CHART_ANIMATION_OFF} />
        </BarChart>
      ) : (
        <AreaChart data={data} margin={{ left: 6, right: 6, top: 12, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tickMargin={8} minTickGap={18} />
          <YAxis tickFormatter={formatCompact} width={40} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <Area
            type="monotone"
            dataKey="tipsEur"
            stroke="var(--color-tipsEur)"
            fill="var(--color-tipsEur)"
            fillOpacity={0.12}
            strokeWidth={2}
            dot={false}
            {...CHART_ANIMATION_OFF}
          />
        </AreaChart>
      )}
    </ChartContainer>
  );
}

export type AdminAnalyticsChartVariant = "business" | "usage";

export type AdminDashboardAnalyticsChartsProps = {
  showChartSkeletons: boolean;
  chartAnalytics: PlatformAnalytics | null;
  chartTipStatus: PlatformAnalytics["tipStatus"];
  chartsLookEmpty: boolean;
  analyticsError: string | null;
  analyticsMeta: { rangeDays: number; timezone?: string | null };
  analyticsTimezone: string;
  analyticsSyncing: boolean;
  analyticsUpdatedAt: number | null;
  onTimezoneChange: (tz: string) => void;
  onRetryAnalytics: () => void;
  /** When true, omit section title (parent collapsible provides header). */
  hideHeader?: boolean;
  /** Controls which charts render — business vs usage reporting. */
  variant?: AdminAnalyticsChartVariant;
};

export const AdminDashboardAnalyticsCharts = memo(function AdminDashboardAnalyticsCharts({
  showChartSkeletons,
  chartAnalytics,
  chartTipStatus,
  chartsLookEmpty,
  analyticsError,
  analyticsMeta,
  analyticsTimezone,
  analyticsSyncing,
  analyticsUpdatedAt,
  onTimezoneChange,
  onRetryAnalytics,
  hideHeader = false,
  variant = "usage",
}: AdminDashboardAnalyticsChartsProps) {
  const { t } = useTranslation();

  const titleKey =
    variant === "business"
      ? "admin.businessAnalyticsPage.chartsTitle"
      : "admin.usageReportsPage.chartsTitle";
  const subtitleKey =
    variant === "business"
      ? "admin.businessAnalyticsPage.chartsSubtitle"
      : "admin.usageReportsPage.chartsSubtitle";

  const showUserDist = variant === "usage";
  const showGrowth = true;
  const showTipVolume = true;
  const growthMode = variant === "usage" ? "users" : "business";
  const preferTopBusinesses = variant === "business";

  const userDistTitle =
    variant === "usage" ? t("admin.usageReportsPage.chartUserRoles") : t("admin.chartUserDist");
  const userDistDesc =
    variant === "usage" ? t("admin.usageReportsPage.chartUserRolesDesc") : t("admin.chartUserDistDesc");
  const growthTitle =
    variant === "usage"
      ? t("admin.usageReportsPage.chartSignups")
      : variant === "business"
        ? t("admin.businessAnalyticsPage.chartGrowth")
        : t("admin.chartGrowth");
  const growthDesc =
    variant === "usage"
      ? t("admin.usageReportsPage.chartSignupsDesc")
      : variant === "business"
        ? t("admin.businessAnalyticsPage.chartGrowthDesc")
        : t("admin.chartGrowthDesc");
  const tipVolTitle =
    variant === "usage"
      ? t("admin.usageReportsPage.chartTipVolume")
      : variant === "business"
        ? t("admin.businessAnalyticsPage.chartTopBusinesses")
        : t("admin.chartTipVol");
  const tipVolDesc =
    variant === "usage"
      ? t("admin.usageReportsPage.chartTipVolumeDesc")
      : variant === "business"
        ? t("admin.businessAnalyticsPage.chartTopBusinessesDesc")
        : t("admin.chartTipVolDesc");

  return (
    <section
      className={cn(platformUi.analyticsSection, hideHeader && "mb-0")}
      aria-busy={showChartSkeletons || undefined}
    >
      {hideHeader ? null : (
      <div className={platformUi.analyticsHeader}>
        <div className={platformUi.analyticsHeaderCopy}>
          <h3 className="text-lg font-semibold text-foreground sm:text-xl">{t(titleKey)}</h3>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground max-lg:line-clamp-3 lg:line-clamp-none">
            {t(subtitleKey, {
              days: analyticsMeta.rangeDays,
              tz: analyticsMeta.timezone ?? analyticsTimezone,
            })}
          </p>
        </div>
        <div className={platformUi.analyticsControls}>
          <div className="flex w-full min-w-0 flex-col gap-1.5 sm:items-end">
            <Select value={analyticsTimezone} onValueChange={onTimezoneChange} disabled={analyticsSyncing}>
              <SelectTrigger size="sm" className="w-full sm:min-w-[14rem]" aria-label={t("admin.timezoneAria")}>
                <SelectValue placeholder={t("admin.timezonePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_ANALYTICS_TZ_OPTIONS.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DashboardRefreshIndicator
              isRefreshing={analyticsSyncing}
              lastUpdatedAt={analyticsUpdatedAt}
              className="shrink-0 text-right"
            />
          </div>
          <span className="text-xs font-medium leading-snug text-muted-foreground max-lg:line-clamp-2">
            {t("admin.tipStatusNote")}
          </span>
        </div>
      </div>
      )}

      {hideHeader ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
          <div className={platformUi.analyticsControls}>
            <div className="flex w-full min-w-0 flex-col gap-1.5 sm:items-end">
              <Select value={analyticsTimezone} onValueChange={onTimezoneChange} disabled={analyticsSyncing}>
                <SelectTrigger size="sm" className="w-full sm:min-w-[14rem]" aria-label={t("admin.timezoneAria")}>
                  <SelectValue placeholder={t("admin.timezonePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_ANALYTICS_TZ_OPTIONS.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DashboardRefreshIndicator
                isRefreshing={analyticsSyncing}
                lastUpdatedAt={analyticsUpdatedAt}
                className="shrink-0 text-right"
              />
            </div>
            <span className="text-xs font-medium leading-snug text-muted-foreground max-lg:line-clamp-2">
              {t("admin.tipStatusNote")}
            </span>
          </div>
        </div>
      ) : null}

      {analyticsError && !chartAnalytics ? (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {analyticsError}{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={onRetryAnalytics}>
            {t("admin.retry")}
          </button>
        </p>
      ) : null}
      {chartsLookEmpty ? (
        <p className="mb-3 text-sm text-muted-foreground">
          {t("admin.analyticsPeriodEmpty", {
            defaultValue: "No tips in this chart period yet. Stat cards show all-time platform totals.",
          })}
        </p>
      ) : null}
      <div className={platformUi.analyticsChartsGrid}>
        {showUserDist ? (
        <AnalyticsCard title={userDistTitle} description={userDistDesc}>
          <DashboardStableChartSlot loading={showChartSkeletons} skeleton={<DashboardChartSkeleton />}>
            {chartAnalytics ? (
              <UserDistributionChart data={chartAnalytics.userDistribution} />
            ) : (
              <span className="block min-h-[220px] sm:min-h-[260px]" aria-hidden />
            )}
          </DashboardStableChartSlot>
        </AnalyticsCard>
        ) : null}

        {showGrowth ? (
        <AnalyticsCard title={growthTitle} description={growthDesc}>
          <DashboardStableChartSlot
            loading={showChartSkeletons}
            skeleton={<DashboardChartSkeleton barHeights={[38, 62, 44, 78, 52, 66, 40, 84, 58, 46]} />}
          >
            {chartAnalytics ? (
              <GrowthChart data={chartAnalytics.growth} mode={growthMode} />
            ) : (
              <span className="block min-h-[220px] sm:min-h-[260px]" aria-hidden />
            )}
          </DashboardStableChartSlot>
        </AnalyticsCard>
        ) : null}

        {showTipVolume ? (
        <AnalyticsCard title={tipVolTitle} description={tipVolDesc}>
          <DashboardStableChartSlot
            loading={showChartSkeletons}
            skeleton={<DashboardChartSkeleton barHeights={[55, 72, 48, 88, 60, 76, 42, 80, 64, 50]} />}
          >
            {chartAnalytics ? (
              <TipVolumeChart
                data={chartAnalytics.tipVolume}
                top={chartAnalytics.topBusinessesByTips}
                preferTopBusinesses={preferTopBusinesses}
              />
            ) : (
              <span className="block min-h-[220px] sm:min-h-[260px]" aria-hidden />
            )}
          </DashboardStableChartSlot>
        </AnalyticsCard>
        ) : null}
      </div>
    </section>
  );
});
