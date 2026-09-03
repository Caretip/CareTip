/**
 * Business / manager presentation tokens — CareTip Operations Workspace.
 * Independent of employeeUi. Presentation only — no logic.
 */

import { dashboardSharedUi } from "../dashboard/dashboardSharedUi";
import { dashboardPeriodUi } from "../dashboard/dashboardPeriodUi";
import { DASHBOARD_METRIC_STAT_CARD_SHELL } from "../dashboard/dashboardMetricTokens";
import { caretipBtnGhost, caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";
import { caretipType } from "@/lib/typography/caretipType";

/** Root wrapper class on `.caretip-dashboard-shell` (see BusinessLayout). */
export const BUSINESS_DASHBOARD_ROOT = "business-dashboard";

const { page: _sharedPage, pageInner: _sharedPageInner, ...dashboardSharedRest } = dashboardSharedUi;

export const businessUi = {
  page: "business-page min-h-0 pb-10 sm:pb-12",
  pageInner: "caretip-container business-page__inner px-4 pt-3 max-lg:pt-3 sm:px-6 sm:pt-4",
  modulePageShell: "business-module-page bg-background px-4 pb-12 sm:px-6 lg:px-8",
  modulePageContained: "dashboard-page-contained mx-auto w-full max-w-6xl",
  section: "business-section business-dashboard-section",
  statsGrid: "business-dashboard-stats-grid grid w-full min-w-0 grid-cols-2 items-stretch gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-3",
  atAGlanceGrid:
    "dashboard-at-a-glance__grid grid grid-cols-2 gap-2 text-center min-[375px]:gap-2.5 sm:grid-cols-3 sm:gap-3",
  mobileList: "business-mobile-list space-y-0 p-0 max-lg:p-0 lg:hidden",
  mobileCard:
    "business-mobile-card block border-b border-border/70 py-3.5 transition-colors active:bg-muted/20",
  tableWrap: "hidden overflow-x-auto lg:block",
  analyticsChartsGrid:
    "business-dashboard-analytics-grid grid w-full min-w-0 items-stretch gap-8 sm:gap-8 lg:grid-cols-2 lg:gap-10",
  bottomGrid:
    "business-dashboard-bottom-grid grid items-stretch gap-8 sm:gap-8 lg:grid-cols-3 lg:gap-8",
  card: "business-card overflow-hidden",
  cardStatic: "business-card business-card--tool overflow-hidden",
  cardPad: "p-0 sm:p-0",
  cardHeader: "px-0 py-3",
  cardTitle: "text-[0.9375rem] font-semibold tracking-tight text-foreground",
  statCard: `business-stat-card ${DASHBOARD_METRIC_STAT_CARD_SHELL}`,
  periodToggle: `business-period-toggle ${dashboardPeriodUi.periodToggle}`,
  periodBtn: dashboardPeriodUi.periodBtn,
  periodBtnActive: dashboardPeriodUi.periodBtnActive,
  periodBtnIdle: dashboardPeriodUi.periodBtnIdle,
  subPageTop: "dashboard-subpage-top w-full px-4 sm:px-6",
  subPageBreadcrumb: "dashboard-subpage-breadcrumb flex items-center gap-2",
  subPageHero: "mb-4 max-lg:mb-3",
  heroBadge:
    "dashboard-hero-badge--compact normal-case tracking-normal max-lg:gap-1.5 max-lg:px-0 max-lg:py-0 max-lg:text-[12px] sm:px-0 sm:py-0",
  heroActionBtn: "h-11 min-h-11 w-full max-w-full px-5 text-sm font-semibold sm:w-auto sm:max-w-none",
  heroCtaLink:
    "inline-flex min-w-0 items-center justify-center gap-1.5 px-3.5 text-center text-sm font-semibold leading-snug sm:gap-2 sm:px-4",
  atAGlanceCard: "business-card dashboard-at-a-glance mt-3 w-full max-lg:mt-2.5",
  atAGlanceContent: "dashboard-at-a-glance__content p-0",
  atAGlanceLabel: "dashboard-at-a-glance__label mb-2 text-xs font-medium text-muted-foreground",
  atAGlanceStatLabel: `${caretipType.helper} normal-case tracking-normal`,
  atAGlanceStatValue: "dashboard-at-a-glance__stat-value font-bold tabular-nums text-foreground",
  subPageMain: "dashboard-subpage-after-metrics w-full px-4 sm:px-6",
  btnPrimary: caretipBtnPrimary,
  btnSecondary: caretipBtnSecondary,
  btnGhost: caretipBtnGhost,
  iconTileMuted:
    "business-dash-icon-tile inline-flex shrink-0 rounded-md bg-muted/50 p-2 text-muted-foreground",
  listItem: "business-list-item border-b border-border/70 py-3 transition-colors",
  listItemSelected: "bg-muted/40",
  emptyWrap:
    "business-empty flex flex-col items-center justify-center px-4 py-10 text-center sm:px-6 sm:py-14",
  emptyIcon: "flex h-14 w-14 items-center justify-center rounded-md bg-muted text-muted-foreground/70",
  emptyTitle: "mt-5 text-base font-semibold text-foreground",
  emptyDesc: "mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground",
  settingsSection: "business-settings-section space-y-4 py-5",
  settingsHeading: "text-[0.9375rem] font-semibold tracking-tight text-foreground",
  ...dashboardSharedRest,
} as const;
