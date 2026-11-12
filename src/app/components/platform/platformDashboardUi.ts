/** Root class on `.caretip-dashboard-shell` — platform admin shell (see SuperAdminLayout). */
export const PLATFORM_DASHBOARD_ROOT = "platform-dashboard";


/**
 * Shared rhythm for platform admin pages (presentation only).
 */
export const platformUi = {
  btnPrimary: "ac-btn ac-btn--primary",
  pageMain: "bg-background",
  /** Matches business/employee overview shells — padding lives on pageInner. */
  page: "ac platform-console-page min-w-0 w-full overflow-x-hidden",
  pageInner: "ac-page",

  pageHeader: "ac-header",
  pageTitleRow: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
  pageTitleIcon: "hidden",
  pageTitle: "platform-admin-page-title premium-workspace-header__title",
  pageSubtitle: "platform-admin-page-subtitle premium-workspace-header__purpose mt-1 max-w-prose",
  pageEyebrow: "platform-admin-page-eyebrow",
  pageHeaderActions: "platform-admin-page-header__actions",

  metricStrip: "platform-admin-metric-strip",
  filterBar: "platform-admin-filter-bar",
  emptyBlock: "platform-admin-empty-block",

  searchSection: "mb-0",
  searchWrap: "ac-search ac-search--wide relative w-full",
  searchIcon: "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
  searchInput: "ac-input w-full pl-10",
  searchHint: "mt-2 text-xs leading-relaxed text-muted-foreground",

  backLink: "ac-back",

  contentCard: "ac-card p-4 sm:p-5",

  /** Overview hub — content on the page surface (Netlify-style). */
  overviewHero: "bg-transparent",
  overviewSection: "platform-admin-overview-section",
  overviewKpiGrid:
    "platform-admin-overview-kpis grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-5",
  overviewTeaserGrid: "platform-admin-overview-teasers grid items-stretch gap-6 sm:gap-7 lg:grid-cols-2 lg:gap-8",
  overviewTeaserCard:
    "flex h-full min-h-0 flex-col border-t border-border/70 bg-transparent p-0 pt-5 shadow-none",

  dataPanel: "ac-card overflow-hidden",
  mobileList: "flex flex-col gap-2.5 p-3 lg:hidden",
  tableWrap: "ac-table-wrap hidden lg:block",
  table: "ac-table w-full",
  tableHeadRow: "",
  tableTh: "",
  tableRow: "",
  tableTd: "",
  panelFooter: "ac-card__foot",
  emptyState: "px-4 py-12 text-center text-sm text-muted-foreground",

  mobileCard: "block rounded-xl border border-border/80 bg-card p-4 transition-colors hover:bg-muted/30",

  /** Single column on phone; 2-up from sm; 3-up from lg; 5-up only on very wide viewports. */
  statGrid: "ac-kpis",

  analyticsSection: "platform-admin-analytics-section mb-0 max-lg:mb-0",
  analyticsHeader: "mb-5 flex flex-col gap-3 max-lg:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4",
  analyticsHeaderCopy: "min-w-0 space-y-1.5",
  analyticsControls: "flex w-full flex-col gap-2.5 max-lg:gap-3 sm:w-auto sm:max-w-[min(100%,16rem)] sm:items-end",
  analyticsChartsGrid: "ac-grid ac-grid--2",

  analyticsCard: "ac-card overflow-hidden",
  analyticsCardHeader: "ac-card__head flex-col !items-start gap-1",
  analyticsCardTitle: "ac-card__title",
  analyticsCardDesc: "ac-card__desc",
  analyticsCardBody: "ac-card__body",
  analyticsChartWrap: "h-[220px] w-full min-w-0 sm:h-[240px]",

  /** Overview charts sit on the page surface — other admin analytics pages keep cards. */
  overviewAnalyticsCard: "overflow-hidden rounded-none border-0 bg-transparent shadow-none",
  overviewAnalyticsCardHeader: "space-y-1.5 border-b border-border/70 bg-transparent px-0 pb-3 pt-0",
  overviewAnalyticsCardBody: "px-0 pb-0 pt-5",
  overviewAnalyticsCardTitle: "text-sm font-semibold text-foreground sm:text-base",
  overviewAnalyticsCardDesc: "text-pretty text-xs leading-relaxed text-muted-foreground sm:text-sm",

  businessesPanel: "ac-card overflow-hidden",
  businessesPanelHeader: "ac-card__head items-center",
  businessesSearchWrap: "border-b border-border/60 px-4 py-3",
  businessesMobileList: "flex flex-col gap-2.5 p-3 lg:hidden",
  businessesTableWrap: "ac-table-wrap hidden lg:block",
} as const;
