/**
 * Shared presentation tokens for the employee dashboard shell.
 * Presentation only — no logic.
 */

import { dashboardSharedUi } from "../dashboard/dashboardSharedUi";
import { dashboardPeriodUi } from "../dashboard/dashboardPeriodUi";
import {
  DASHBOARD_METRIC_STAT_CARD_SHELL,
  DASHBOARD_METRIC_STAT_CHANGE,
  DASHBOARD_METRIC_STAT_LABEL,
  DASHBOARD_METRIC_STAT_VALUE,
} from "../dashboard/dashboardMetricTokens";
import { caretipBtnGhost, caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";

/** Root wrapper class on `.caretip-dashboard-shell` (see EmployeeLayout). */
export const EMPLOYEE_DASHBOARD_ROOT = "employee-dashboard";

const { page: _sharedPage, pageInner: _sharedPageInner, ...dashboardSharedRest } = dashboardSharedUi;

export const employeeUi = {
  page: "employee-page w-full min-w-0 min-h-0 pb-10 sm:pb-12",
  pageInner:
    "caretip-container employee-page__inner w-full min-w-0 px-4 pt-4 sm:px-6 sm:pt-5",
  section: "employee-section employee-dashboard-section",
  sectionTight: "employee-section space-y-3 sm:space-y-4",
  statsGrid:
    "employee-dashboard-stats-grid grid w-full min-w-0 grid-cols-2 items-stretch gap-3 gap-y-3 sm:gap-3.5 md:grid-cols-3 md:gap-4 lg:grid-cols-3 lg:gap-5",

  card:
    "employee-card overflow-hidden rounded-lg border border-border bg-card shadow-sm",
  cardStatic:
    "employee-card overflow-hidden rounded-lg border border-border bg-card shadow-sm",
  cardPad: "p-4 sm:p-5 md:p-6",
  cardHeader: "border-b border-border px-4 py-3.5 sm:px-6 sm:py-4",
  cardTitle: "text-base font-semibold tracking-tight text-foreground",

  pageHeader: "employee-page-header mb-5 border-b border-border pb-4 sm:pb-5",
  pageHeaderInner: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
  pageTitle: "text-xl font-bold tracking-tight text-foreground sm:text-2xl",
  pageDesc: "mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground",

  btnPrimary: caretipBtnPrimary,
  btnSecondary: caretipBtnSecondary,
  btnGhost: caretipBtnGhost,

  iconTile: "inline-flex rounded-lg bg-primary/10 p-2.5",
  iconTileMuted: "inline-flex rounded-lg bg-muted p-2.5 text-muted-foreground",

  periodToggle: `employee-period-toggle ${dashboardPeriodUi.periodToggle}`,
  periodBtn: dashboardPeriodUi.periodBtn,
  periodBtnActive: dashboardPeriodUi.periodBtnActive,
  periodBtnIdle: dashboardPeriodUi.periodBtnIdle,

  /** Hero CTA pair — size to the label; wrap only when the row is stacked. */
  heroCtaBtn:
    "min-w-0 !h-auto min-h-11 px-3.5 py-2 text-center !leading-snug sm:px-4",
  heroCtaLink:
    "inline-flex min-w-0 items-center justify-center gap-1.5 text-center leading-snug sm:gap-2",

  /** Quick actions grid — stacked icon + label tiles */
  quickActionTile:
    "dashboard-action-tile !h-auto min-h-[5.75rem] w-full min-w-0 flex-col gap-2 px-3 py-3.5 !whitespace-normal text-center !leading-snug",
  quickActionLabel: "block w-full min-w-0 text-center text-[0.8125rem] font-semibold leading-snug [text-wrap:balance]",

  listItem:
    "employee-list-item rounded-lg border border-border bg-card shadow-sm transition-colors max-lg:rounded-md max-lg:shadow-none",
  listItemSelected: "bg-primary/[0.04] ring-1 ring-primary/20",

  statCard: `employee-stat-card ${DASHBOARD_METRIC_STAT_CARD_SHELL}`,
  statLabel: DASHBOARD_METRIC_STAT_LABEL,
  statValue: DASHBOARD_METRIC_STAT_VALUE,
  statChange: DASHBOARD_METRIC_STAT_CHANGE,

  emptyWrap: "employee-empty flex flex-col items-center justify-center px-4 py-10 text-center sm:px-6 sm:py-14 md:py-16",
  emptyIcon: "flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground/70",
  emptyTitle: "mt-5 text-base font-semibold text-foreground",
  emptyDesc: "mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground",

  settingsSection:
    "employee-settings-section dashboard-settings-panel space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5",
  settingsHeading: "text-base font-semibold tracking-tight text-foreground",

  ...dashboardSharedRest,
} as const;
