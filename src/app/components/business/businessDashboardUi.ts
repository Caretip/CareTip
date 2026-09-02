/**
 * Business dashboard presentation tokens — aligned with the employee shell.
 * Presentation only — no logic.
 */

import { dashboardSharedUi } from "../dashboard/dashboardSharedUi";
import { DASHBOARD_METRIC_STAT_CARD_SHELL } from "../dashboard/dashboardMetricTokens";
import { employeeUi } from "../employee/employeeDashboardUi";
import { caretipType } from "@/lib/typography/caretipType";

/** Root wrapper class on `.caretip-dashboard-shell` (see BusinessLayout). */
export const BUSINESS_DASHBOARD_ROOT = "business-dashboard";

/** Shared rhythm with employee dashboard; class names scoped via shell root. */
const { page: _employeePage, pageInner: _employeePageInner, ...employeeUiRest } = employeeUi;
const { page: _sharedPage, pageInner: _sharedPageInner, ...dashboardSharedRest } = dashboardSharedUi;

export const businessUi = {
  ...employeeUiRest,
  iconTileMuted: "business-dash-icon-tile shrink-0",
  page: "business-page min-h-0 pb-10 sm:pb-12",
  pageInner: "caretip-container business-page__inner px-4 pt-3 max-lg:pt-3 sm:px-6 sm:pt-4",
  /** Shared shell for module routes (Billing, Team, QR Studio, etc.). */
  modulePageShell: "business-module-page bg-background px-4 pb-20 sm:px-6 lg:px-8",
  modulePageContained: "dashboard-page-contained mx-auto w-full max-w-6xl",
  /** Overview analytics stack — consistent vertical rhythm below hero. */
  section: "employee-section business-dashboard-section",
  statsGrid:
    "business-dashboard-stats-grid grid w-full min-w-0 grid-cols-2 items-stretch gap-3 gap-y-3 sm:gap-3.5 md:grid-cols-3 md:gap-4 lg:grid-cols-3 lg:gap-5",
  /** At-a-glance mini-stats — 2-up on phones, 3-up from tablet. */
  atAGlanceGrid:
    "dashboard-at-a-glance__grid grid grid-cols-2 gap-2 text-center min-[375px]:gap-2.5 sm:grid-cols-3 sm:gap-3",
  /** Mobile list/card pattern (mirrors platform admin responsive data). */
  mobileList: "business-mobile-list space-y-3 p-4 max-lg:p-4 lg:hidden",
  mobileCard:
    "business-mobile-card block rounded-lg border border-border bg-card p-4 shadow-sm transition-colors active:bg-muted/30",
  tableWrap: "hidden overflow-x-auto lg:block",
  analyticsChartsGrid:
    "business-dashboard-analytics-grid grid w-full min-w-0 items-stretch gap-5 sm:gap-6 lg:grid-cols-2 lg:gap-6",
  bottomGrid:
    "business-dashboard-bottom-grid grid items-stretch gap-5 sm:gap-6 lg:grid-cols-3 lg:gap-6",
  card:
    "business-card overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-colors",
  cardStatic:
    "business-card overflow-hidden rounded-lg border border-border bg-card shadow-sm",
  statCard: `business-stat-card ${DASHBOARD_METRIC_STAT_CARD_SHELL}`,
  periodToggle:
    "business-period-toggle flex w-full max-w-full flex-wrap gap-1.5 rounded-lg border border-border bg-card p-1 shadow-sm sm:w-fit",

  /** Business sub-routes with back link + DashboardHero (QR, staff, etc.). */
  subPageTop: "dashboard-subpage-top w-full px-4 sm:px-6",
  subPageBreadcrumb: "dashboard-subpage-breadcrumb flex items-center gap-2",
  subPageHero: "mb-4 max-lg:mb-3",
  heroBadge:
    "dashboard-hero-badge--compact normal-case tracking-[0.06em] max-lg:gap-1.5 max-lg:px-2 max-lg:py-0.5 max-lg:text-[10px] sm:px-2.5 sm:py-0.5",
  heroActionBtn: "h-11 min-h-11 w-full max-w-full px-5 text-sm font-semibold sm:w-auto sm:max-w-none",
  /** Hero dashboard CTA pair — padding sized to short destination labels. */
  heroCtaLink:
    "inline-flex min-w-0 items-center justify-center gap-1.5 px-3.5 text-center text-sm font-semibold leading-snug sm:gap-2 sm:px-4",
  atAGlanceCard:
    "business-card dashboard-at-a-glance mt-3 w-full rounded-lg border border-border bg-card shadow-sm max-lg:mt-2.5",
  atAGlanceContent: "dashboard-at-a-glance__content p-0",
  atAGlanceLabel: "dashboard-at-a-glance__label mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
  atAGlanceStatLabel: caretipType.kpiLabel,
  atAGlanceStatValue: "dashboard-at-a-glance__stat-value font-bold tabular-nums text-foreground",
  subPageMain: "dashboard-subpage-after-metrics w-full px-4 sm:px-6",

  ...dashboardSharedRest,
} as const;
