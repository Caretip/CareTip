# CareTip Business Live Activity + Analytics UI Redesign Report

Presentation-layer redesign only (March 2026). No backend, API, analytics calculation, or Activity Center data-path changes.

## Before → After (summary)

| Area | Before | After |
|------|--------|--------|
| Business Live Activity | Full-width “Activity Center” workspace card wrapping filters + feed | Page title + subtitle, employee-style pill filters, borderless timeline feed (no outer card) |
| Business Analytics | Large summary card + many descriptive stat cards and tables | Compact KPI strip, tip volume area chart, period insights + employee bar ranking, operational strip, donut for QR device mix, horizontal bar location/table charts, compact top-QR list |

---

## 1. Existing Business Live Activity audit

- **Route:** `/dashboard/tips/live` → `BusinessActivityCenterPage` (`src/app/pages/business/tips/BusinessActivityCenterPage.tsx`).
- **Layout shell:** `BusinessTipsLayout` (module header only; unchanged).
- **Data:** `useActivityCenterFeed` → `GET /api/business/activity` + `activity.created` (unchanged).
- **UI:** `ActivityCenterFeed` rendered inside `DashboardWorkspacePanel` (“Activity Center” card) with rounded filter chips and padded list rows.

## 2. Employee Live Activity reference

- **Route:** Employee tip activity page → `EmployeeTipActivityPage` (`src/app/pages/employee/EmployeeTipActivityPage.tsx`).
- **Note:** Employee “live activity” in product terms is payable activity history (`listEmployeePayableActivity`), not the business Activity Center SSOT. Visual reference: `employee-tip-activity.css` (pill filters, timeline list, skeleton, typography).
- **Shared pattern adopted:** `employee-tip-activity-filters`, `employee-tip-activity-filter`, `employee-tip-activity-timeline`, skeleton row styling.

## 3. Differences (business vs employee)

| Aspect | Business (before) | Employee reference |
|--------|-------------------|-------------------|
| Container | `DashboardWorkspacePanel` card | No outer card |
| Filters | Rounded chips in card header | Horizontal scroll pill tabs |
| Data source | Business activity events API | Employee payable activity API |
| Row content | Icons + i18n event keys + deep links | Dot tone + tip amounts + detail dialog |

## 4. Existing Business Analytics audit

- **Route:** `/dashboard/tips/analytics` → `BusinessTipsAnalyticsPage` → `BusinessAnalyticsReporting`.
- **Data:** `useBusinessIntelligenceData` / `useBusinessAnalytics` (unchanged).
- **UI (before):** `DashboardWorkspaceSummaryCard`, `RevenueAnalyticsCards` (detail), `OperationalMetricsCards`, `QrAnalyticsSection`, dual `ComparisonTable` cards, card-wrapped top-QR list, long helper copy.

## 5. Reusable visualization components (existing)

- `BusinessDashboardAnalyticsCharts` — area + bar charts (home dashboard).
- `businessDashboardChartData` — `buildTipPerformanceChartData`, `resolveTipPerformanceChartRows`, `buildEmployeePerformanceChartRows`.
- `dashboardChartTheme` / `businessDashboardChartTheme`, `lightweightChartProps` (`CHART_ANIMATION_OFF`).
- `QrAnalyticsLivePanel` — QR metrics (still used beside new donut).

## 6. Chart library

- **recharts@2.15.2** (root `package.json`) — reused; no new dependency.

## 7. Performance risks (mitigations)

- Animations disabled via `LIGHTWEIGHT_*` / `CHART_ANIMATION_OFF`.
- Chart data derived with `useMemo` from existing DTO fields; no extra fetches.
- QR donut uses bundle `qrAnalytics` when timeframe matches revenue toggle (same as prior `QrAnalyticsSection` prop path).
- Location/employee charts cap bar count (default 8 / 6).

## 8. Proposed / implemented structure

**Live Activity:** Page header → filters + live badge → timeline list → load older.

**Analytics:** Toolbar → KPI strip → tip volume trend → period insights + employee bars → operational strip → financial section (unchanged logic) → QR donut + existing QR panel → location/table horizontal bars → top QR list.

---

## UI problems identified

1. Activity Center felt like a card inside the tips module, not a native feed.
2. Analytics read as a wall of explanatory cards vs. trends and distributions.
3. Location/table comparisons were table-heavy on mobile.
4. Redundant large summary banner duplicated KPIs.

## Components reused

- `ActivityCenterFeed` (presentation refactor only)
- `QrAnalyticsSection` / `QrAnalyticsLivePanel`
- `BusinessFinancialAnalyticsSection`
- `DashboardAnalyticsPeriodToggle`, `DashboardRefreshIndicator`, `DashboardStatusStrip`
- `CountUpMetric`, `DashboardStableChartSlot`, `BusinessDashboardAnalyticsEmpty`
- Employee activity CSS classes (filters/timeline)

## Components created

| Component | Role |
|-----------|------|
| `AnalyticsKpiStrip` | Compact 4-up KPI row |
| `TipVolumeTrendChart` | Area chart from `dailyTipDistribution` |
| `PeriodInsightMetrics` | Growth, avg tip, optional week context |
| `EmployeePerformanceRanking` | Horizontal bar top earners |
| `OperationalMetricsStrip` | Compact ops metrics |
| `AnalyticsDonutChart` | Generic donut + QR device slices |
| `LocationComparisonChart` | Horizontal bar comparison |
| `TopQrPerformanceList` | Ranked top tip sources |

## Cards converted to charts (why)

| Former presentation | New | Why |
|---------------------|-----|-----|
| Summary + revenue card grids for trend | `TipVolumeTrendChart` | Trend/spikes/dips at a glance |
| QR scan tiles only | + device donut | Categorical mix clearer than extra tiles |
| Location/table tables | `LocationComparisonChart` | Faster scan of relative volume |
| Operational stat cards | `OperationalMetricsStrip` + employee bar chart | Density without duplicate large cards |

## Why Recharts is lightweight here

Already bundled; animations off; small series counts; shared theme tokens with dashboard charts.

## Performance impact

- No new API calls or hooks.
- Slightly more SVG on analytics page when data present; bounded row counts.
- Activity page: less DOM (no panel chrome).

## Responsive behavior

- KPI strip: 2×2 mobile → 4 columns desktop.
- Charts: `ResponsiveContainer`, vertical bar charts with fixed height from row count.
- Activity: max-width ~42rem, scrollable filter row (employee pattern).
- Existing `caretip-mobile-analytics-report` rules still apply to report root.

## Accessibility

- Chart sections use `role="img"` + `sr-only` summaries where helpful.
- Donut legends listed in text beside chart.
- Filter tabs retain `role="tab"` / `aria-selected`.
- Financial section retains full accounting labels (unchanged).

## Confirmation: no business/data logic changed

- No edits to backend, Prisma, hooks’ fetch logic, filters, calculations, or Activity Center architecture invariants.
- Chart series are direct mappings of existing DTO fields (`dailyTipDistribution`, `bi.locations`, `employees`, `qrAnalytics.scansByDevice`, etc.).

## Files changed

- `src/app/pages/business/tips/BusinessActivityCenterPage.tsx`
- `src/app/components/business/insights/ActivityCenterFeed.tsx`
- `src/app/components/business/BusinessAnalyticsReporting.tsx`
- `src/app/components/business/analytics/reporting/*` (new)
- `src/styles/business-activity-center.css`
- `src/styles/bundles/dashboard.css`
- `src/i18n/locales/en.json`, `de.json`

## Tests / build verification

- `npx vite build` — **passed** (production bundle).
- Full `npm run build` (prebuild image pipeline + SEO prerender) — run in CI/local as usual.

## Remaining UI limitations

- Business Tips module header still shows global “Tips” chrome above Live Activity (layout unchanged).
- QR donut shows device mix only when `scansByDevice` is populated; other QR breakdowns remain in `QrAnalyticsLivePanel`.
- Tip routing donut not added to financial section (financial cards unchanged to preserve accounting copy); can be a follow-up presentation tweak using existing `periodMetrics` EUR fields.
- Employee Live Activity data model still differs from business events; visual alignment only.
