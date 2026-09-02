/** Root class on `.caretip-dashboard-shell` — platform admin shell (see SuperAdminLayout). */
export const PLATFORM_DASHBOARD_ROOT = "platform-dashboard";

import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";

/**
 * Shared rhythm for platform admin pages (presentation only).
 */
export const platformUi = {
  btnPrimary: caretipBtnPrimary,
  pageMain: "bg-background",
  /** Matches business/employee overview shells — padding lives on pageInner. */
  page: "platform-page min-h-0 w-full min-w-0 pb-10 sm:pb-12",
  pageInner:
    "caretip-container platform-page__inner w-full min-w-0 px-4 pt-3 max-lg:pt-3 sm:px-6 sm:pt-4",

  pageHeader: "platform-admin-page-header mb-5 max-lg:mb-6",
  pageTitleRow: "flex items-start gap-3",
  pageTitleIcon: "mt-0.5 h-6 w-6 shrink-0 text-primary sm:h-7 sm:w-7",
  pageTitle:
    "platform-admin-page-title text-xl font-semibold tracking-tight text-foreground sm:text-[1.375rem] lg:text-[1.5rem]",
  pageSubtitle:
    "platform-admin-page-subtitle mt-1.5 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground",

  searchSection: "mb-5 max-lg:mb-6",
  searchWrap: "relative w-full max-w-xl",
  searchIcon: "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
  searchInput:
    "w-full min-h-[2.5rem] rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm shadow-sm transition-[border-color,box-shadow] focus:border-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/12",
  searchHint: "mt-2 text-xs leading-relaxed text-muted-foreground",

  backLink:
    "mb-5 inline-flex min-h-[44px] touch-manipulation items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-foreground",

  contentCard: "dashboard-panel-card rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5",

  /** Overview hub — content on the page surface (Netlify-style). */
  overviewHero: "bg-transparent",
  overviewSection: "platform-admin-overview-section",
  overviewKpiGrid:
    "platform-admin-overview-kpis grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-5",
  overviewTeaserGrid: "platform-admin-overview-teasers grid items-stretch gap-6 sm:gap-7 lg:grid-cols-2 lg:gap-8",
  overviewTeaserCard:
    "flex h-full min-h-0 flex-col border-t border-border/70 bg-transparent p-0 pt-5 shadow-none",

  dataPanel: "overflow-hidden rounded-lg border border-border bg-card shadow-sm",
  mobileList: "space-y-2.5 p-3 max-lg:p-3 lg:hidden",
  tableWrap: "hidden overflow-x-auto lg:block",
  table: "w-full text-sm",
  tableHeadRow: "border-b border-border bg-muted/30 text-left",
  tableTh:
    "px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:normal-case lg:tracking-normal",
  tableRow: "border-b border-border/60 transition-colors hover:bg-muted/25",
  tableTd: "px-4 py-2.5",
  panelFooter: "border-t border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground",
  emptyState: "px-4 py-10 text-center text-sm text-muted-foreground",

  mobileCard:
    "block rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/20 active:bg-muted/30",

  /** Single column on phone; 2-up from sm; 3-up from lg; 5-up only on very wide viewports. */
  statGrid:
    "platform-admin-stat-grid relative mb-0 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3 lg:gap-4 min-[1536px]:grid-cols-5 min-[1536px]:gap-4",

  analyticsSection: "platform-admin-analytics-section mb-0 max-lg:mb-0",
  analyticsHeader: "mb-5 flex flex-col gap-3 max-lg:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4",
  analyticsHeaderCopy: "min-w-0 space-y-1.5",
  analyticsControls: "flex w-full flex-col gap-2.5 max-lg:gap-3 sm:w-auto sm:max-w-[min(100%,16rem)] sm:items-end",
  analyticsChartsGrid: "platform-admin-charts-grid grid grid-cols-1 gap-4 max-lg:gap-5 lg:grid-cols-2 lg:gap-5",

  analyticsCard: "overflow-hidden rounded-lg border border-border bg-card shadow-sm",
  analyticsCardHeader: "space-y-1.5 border-b border-border bg-muted/25 px-4 pb-3 pt-4 sm:px-5",
  analyticsCardTitle: "text-sm font-semibold text-foreground sm:text-base",
  analyticsCardDesc: "text-pretty text-xs leading-relaxed text-muted-foreground sm:text-sm",
  analyticsCardBody: "p-4 pt-5 sm:p-5 sm:pt-6",
  analyticsChartWrap: "h-[220px] w-full min-w-0 sm:h-[240px]",

  /** Overview charts sit on the page surface — other admin analytics pages keep cards. */
  overviewAnalyticsCard: "overflow-hidden rounded-none border-0 bg-transparent shadow-none",
  overviewAnalyticsCardHeader: "space-y-1.5 border-b border-border/70 bg-transparent px-0 pb-3 pt-0",
  overviewAnalyticsCardBody: "px-0 pb-0 pt-5",
  overviewAnalyticsCardTitle: "text-sm font-semibold text-foreground sm:text-base",
  overviewAnalyticsCardDesc: "text-pretty text-xs leading-relaxed text-muted-foreground sm:text-sm",

  businessesPanel: "overflow-hidden rounded-lg border border-border bg-card shadow-sm",
  businessesPanelHeader:
    "flex items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-3 max-lg:px-4",
  businessesSearchWrap: "border-b border-border px-4 py-3",
  businessesMobileList: "space-y-2.5 p-3 max-lg:p-3 lg:hidden",
  businessesTableWrap: "hidden overflow-x-auto lg:block",
} as const;
