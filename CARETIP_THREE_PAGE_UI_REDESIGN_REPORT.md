# CareTip Three-Page UI Redesign Report

Presentation-only redesign: **Tip Distribution**, **Business Live Activity**, and **Team → Performance (Overview)**. No API, backend, calculation, or behavior changes.

## Before → After

| Page | Before | After |
|------|--------|--------|
| **Tip Distribution** | Three large stat cards, bordered “since last” card, plain tables | Borderless KPI strip (emphasis on “To distribute”), compact since-last columns, finance-style tables with right-aligned amounts, primary “Record distribution” |
| **Live Activity** | Centered narrow column (~42rem) | Full-width **left-aligned** feed; desktop amount column; subtle ● LIVE pill |
| **Performance** | Stacked large cards (summary, health summary card, chart card, bordered insight cards) | Metric strips, health progress bar, taller participation chart (no card chrome), compact insight rows |

---

## 1. Audit findings

| Page | Route | Data (unchanged) | Prior UI |
|------|-------|------------------|----------|
| Tip Distribution | `/dashboard/tips/tip-distribution` | `getTipDistributionSummary`, `getTipDistributionEmployees`, `getTipDistributionHistory`, modals | `businessUi.statCard` grid + bordered sections |
| Live Activity | `/dashboard/tips/live` | `useActivityCenterFeed` | Feed without panel card; page was `max-width: 42rem` centered |
| Performance Overview | `/dashboard/team/performance` | `useBusinessIntelligenceData` → `BusinessExecutivePerformance` | `DashboardWorkspaceSummaryCard`, `Card` wrappers, paragraph executive summary |
| Reference | Employee tip activity | `listEmployeePayableActivity` | `employee-tip-activity.css` pills + timeline |
| Analytics language | `/dashboard/tips/analytics` | (prior sprint) | KPI strip + charts — visual reference for distribution/performance |

**Chart library:** `recharts@2.15.2` (existing), `LIGHTWEIGHT_AREA` / animation off.

---

## 2. Tip Distribution redesign

- KPI strip: `tip-distribution-kpi-strip` (primary styling on “To distribute”).
- Since last: four-column compact grid + `sr-only` full sentence for screen readers.
- Ready table: `tip-distribution-table` (desktop `lg+`), mobile list unchanged data with button hierarchy swapped.
- History: ledger rows (mobile) + matching table (desktop).
- Module header (`BusinessModuleWorkspaceHeader`) retained; no page-wide enclosing card.

---

## 3. Live Activity redesign

- Removed centered max-width constraint on `.business-activity-center-page`.
- Feed row grid: icon | content | amount (≥640px); amount inline on mobile.
- Live indicator: `business-activity-live-pill` with dot.
- Empty state left-aligned.

---

## 4. Performance redesign

- `ExecutiveSummaryStrip`: growth, participation, goal completion, tip count + one-line clause from first existing summary clause.
- `BusinessHealthStrip`: score /100, CSS progress bar (presentation), growth, status grade.
- `ExecutiveHealthTrends`: card removed; chart height 220–260px; shared dashboard chart tokens.
- Risks / opportunities / recommendations: `business-performance-insight-list` rows (no large bordered cards).
- `KeyInsightsStrip`: growth %, participation %, peak period from existing `bi.insights` / `bi.snapshot`.

Tabs, leaderboard tab, analytics link, and hooks unchanged.

---

## 5. Components reused

- `ActivityCenterFeed`, `BusinessModuleWorkspaceHeader`, `CountUpMetric`, `ExecutiveHealthTrends` (presentation refactor), `BusinessTeamLeaderboardPanel`, employee activity CSS classes, Recharts + `lightweightChartProps`, `BusinessDashboardAnalyticsEmpty`.

---

## 6. New UI surfaces (CSS + structure)

- `src/styles/tip-distribution.css`
- `src/styles/business-performance-dashboard.css`
- Updates to `src/styles/business-activity-center.css`

No new data hooks or API modules.

---

## 7–9. Charts

- **Performance:** participation area chart only (`ExecutiveHealthTrends`).
- **Library:** Recharts (already in bundle).
- **Lightweight:** animations disabled, single series, responsive container, no extra fetches.

---

## 10. Responsive

- Distribution: KPI 1→3 columns; table scroll on desktop; mobile cards `lg:hidden`.
- Live Activity: 2-column mobile row, 3-column desktop with right amount.
- Performance: metric grids 2×2 → 4 columns; chart full width.

---

## 11. Accessibility

- Since-last full text in `sr-only`.
- Health score `role="progressbar"`.
- Section headings with `aria-labelledby`.
- Table semantics preserved on distribution/history.
- Chart `role="img"` + labels.

---

## 12. Performance impact

- CSS-only additions; no new dependencies or API calls.
- Same lazy-loaded chart chunk as before.

---

## 13. Files changed

- `src/app/pages/business/TipDistributionPage.tsx`
- `src/app/pages/business/tips/BusinessActivityCenterPage.tsx`
- `src/app/components/business/insights/ActivityCenterFeed.tsx`
- `src/app/components/business/BusinessExecutivePerformance.tsx`
- `src/app/components/business/insights/ExecutiveHealthTrends.tsx`
- `src/styles/tip-distribution.css`, `business-performance-dashboard.css`, `business-activity-center.css`, `bundles/dashboard.css`
- `src/i18n/locales/en.json`, `de.json` (tip distribution since-last column labels)

---

## 14. Tests / build

`npm run typecheck` — passed. Run `npx vite build` or full `npm run build` before deploy.

---

## 15. No logic changes

Confirmed: same endpoints, handlers, filters, modals, tab routing, BI computations, and activity feed hook.

---

## 16. Remaining visual limitations

- Tip Distribution still uses module shell header (not duplicated page title).
- Performance peak label uses `bi.peakPeriod` string (existing computation).
- Leaderboard tab not restyled in this pass (overview only).
- Financial tip-routing donut on distribution page not added (no categorical distribution in current distribution API UI).
