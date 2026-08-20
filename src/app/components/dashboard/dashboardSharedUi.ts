/**
 * Cross-shell dashboard presentation hooks (business + employee).
 * Scoped via `.caretip-dashboard-shell` in dashboard-ecosystem-polish.css.
 */
export const dashboardSharedUi = {
  /** Full-width dashboard page shell (uses .caretip-container + desktop layout CSS). */
  page: "dashboard-page w-full min-w-0",
  pageInner: "dashboard-page-inner caretip-container w-full min-w-0",
  /** Legacy narrow pages — constrained below xl, full width on desktop. */
  pageNarrow:
    "dashboard-page-narrow mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8",
  pageContained:
    "dashboard-page-contained mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8",
  inboxPage: "dashboard-inbox-page caretip-container w-full min-w-0 max-w-2xl px-4 py-6 sm:px-6 sm:py-8 xl:max-w-none",
  inboxMasterDetail:
    "dashboard-inbox-master-detail flex min-h-0 flex-col xl:grid xl:min-h-[calc(100dvh-11rem)] xl:grid-cols-[minmax(280px,24rem)_minmax(0,1fr)] xl:overflow-hidden xl:rounded-lg xl:border xl:border-border xl:bg-card xl:shadow-sm",
  inboxListPane:
    "dashboard-inbox-list flex min-h-0 flex-col xl:w-[min(100%,24rem)] xl:shrink-0 xl:border-r xl:border-border",
  inboxDetailPane:
    "dashboard-inbox-detail hidden min-h-0 min-w-0 flex-1 flex-col xl:flex",
  cardDesc: "dashboard-card-desc",
  chartCard: "dashboard-chart-card",
  chartFrame: "dashboard-chart-frame",
  chartEmpty: "dashboard-chart-empty",
  chartInsight: "dashboard-chart-insight",
  listRow: "dashboard-list-row",
  surfacePanel: "dashboard-surface-panel",
  settingsPanel: "dashboard-settings-panel",
  pageShell: "dashboard-page-shell",
  filterPanel:
    "dashboard-filter-panel rounded-lg border border-border bg-card shadow-sm",
  tablePanel:
    "dashboard-table-panel max-w-full overflow-x-auto overflow-y-visible rounded-lg border border-border bg-card pb-1 shadow-sm",
  notificationCard:
    "dashboard-notification-card rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5",
  notificationCardUnread:
    "dashboard-notification-card rounded-lg border border-primary/20 bg-primary/[0.04] p-4 shadow-sm sm:p-5",
  /** Flatten decorative card chrome on mobile — desktop unchanged. */
  mobileFlatSurface:
    "max-lg:!border-0 max-lg:!bg-transparent max-lg:!shadow-none max-lg:!rounded-none",
  /** Hide redundant subtitles/descriptions on mobile. */
  mobileHideDesc: "max-lg:hidden",
  /** Compact section spacing without card wrapper. */
  mobileFlatSection: "min-w-0 space-y-3 max-lg:py-0",
  mobileSectionTitle: "text-base font-semibold tracking-tight text-foreground",
  mobileSectionDivider: "max-lg:border-t max-lg:border-border/80 max-lg:pt-4",
} as const;
