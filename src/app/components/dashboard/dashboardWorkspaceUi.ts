/**
 * Canonical B2B workspace presentation tokens for authenticated dashboards.
 * Scoped via `.caretip-dashboard-shell` — no gradients, no hero containers.
 */

import { caretipType } from "@/lib/typography/caretipType";
import { caretipBtnGhost, caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";

/** Applied on dashboard shell roots when workspace refresh is active. */
export const DASHBOARD_WORKSPACE_FLAG = "dashboard-workspace";

export const dashboardWorkspaceUi = {
  eyebrow: `${caretipType.overline} text-muted-foreground`,
  pageTitle: caretipType.appTitle,
  sectionTitle: caretipType.appSubtitle,
  subsectionTitle: caretipType.h4,
  pageDescription: `mt-1 max-w-prose ${caretipType.smallBody}`,
  helperText: caretipType.helper,
  formLabel: caretipType.label,
  kpiLabel: caretipType.kpiLabel,
  kpiValue: caretipType.kpiValue,
  emptyTitle: caretipType.cardTitle,
  emptyDesc: caretipType.smallBody,

  pageHeader: "dashboard-workspace-page-header mb-6",
  moduleHeader: "dashboard-workspace-module-header mb-6 border-b border-border pb-5",
  moduleHeaderRow: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",

  section: "space-y-6",
  sectionGap: "gap-6",

  card: "rounded-lg border border-border bg-card shadow-sm",
  cardStatic: "rounded-lg border border-border bg-card shadow-sm",
  cardPad: "p-4 sm:p-5",
  cardHeader: "border-b border-border px-4 py-3 sm:px-5",
  cardTitle: caretipType.cardTitle,

  btnPrimary: `${caretipBtnPrimary} dashboard-workspace-btn`,
  btnSecondary: `${caretipBtnSecondary} dashboard-workspace-btn`,
  btnGhost: `${caretipBtnGhost} dashboard-workspace-btn`,

  inlineMeta: "text-sm text-muted-foreground",
  inlineMetaSep: "mx-1.5 text-border",
} as const;