# CARETIP — Locations / Tables + Customer Feedback UI Redesign Report

**Date:** 2026-09-30  
**Scope:** Presentation and UX only (no business-logic changes)

---

## 1. Existing UI audit (pre-change)

| Surface | Entry | Data |
|--------|--------|------|
| **Locations / Tables** | `LocationsPage.tsx`, route `/dashboard/locations` | `fetchVenueCatalog`, location/table CRUD APIs, session cache |
| **Customer Feedback** | `CustomerFeedbackPage.tsx` via `BusinessCustomersLayout` | `listBusinessCustomerFeedback`, `getBusinessStats` (staff filter), client-side filter/sort |
| **Dashboard rating** | `RecentCustomerFeedbackPanel.tsx` on `BusinessDashboard.tsx` | Same feedback list API (teaser limit) |

Prior pain points: flat location rows with prominent edit/delete icons, disconnected KPI cards on feedback, generic review cards with side-by-side metadata, dashboard panel duplicated title/stats without a clear rating focal point.

---

## 2. Design references reused

- `businessUi` / `BusinessModuleWorkspaceHeader` (module pages)
- `PayoutFinancialMetric` strip pattern → `CustomerFeedbackMetricsStrip`
- `Badge` for integration status
- `DropdownMenu` for secondary location actions (aligned with restrained admin patterns)
- Dashboard tokens: `business-card`, border/radius from `payout-workspace` / `business-web-design`
- Existing `CustomerFeedbackListItem` + `business-dashboard-hierarchy.css` typography

---

## 3. Locations / Tables changes

- New **`BusinessLocationVenueCard`**: compact card per location (icon, name, Google/TripAdvisor badges, overflow menu for edit/delete).
- Tables: header with count + **Create table**, dashed empty state with guidance, compact table rows + QR link.
- List wrapper **`business-venue-list`** with spacing between locations (replaces border-only `business-location-row` stack).
- Page subtitle copy updated (EN/DE); all CRUD dialogs and API flows unchanged.

---

## 4. Customer Feedback changes

- **Unified metrics strip** (`CustomerFeedbackMetricsStrip`) replacing five separate `BusinessStatCard`s.
- Featured average rating via **`CustomerFeedbackRatingDisplay`** (score, stars, review count).
- **Filter toolbar** (`caretip-feedback-filter-toolbar`) — same controls, single bordered panel.
- **Review cards** — guest → rating → comment → tags → served-by/date footer; reduced hover motion/shadow.
- **Insights** — `FeedbackTagRankList` with rank bars; horizontal **rating distribution**; employee ranking list; dashed empty states.

---

## 5. Dashboard rating card changes

- **`RecentCustomerFeedbackPanel`** wrapped in `caretip-feedback-dashboard-panel`.
- Header: title, short description, **View customer feedback** link.
- When reviews exist: large **`CustomerFeedbackRatingDisplay`** summary band above teaser list.
- Teaser reviews use `compact` list items.

---

## 6. Components created / reused

| Created | Reused |
|---------|--------|
| `BusinessLocationVenueCard.tsx` | `BusinessModuleWorkspaceHeader`, `Badge`, `Button`, `DropdownMenu` |
| `CustomerFeedbackRatingDisplay.tsx` | `CountUpMetric`, `DashboardListSkeleton` |
| `CustomerFeedbackMetricsStrip.tsx` | `EmployeeEmptyState`, filter `Select`/`Input` |
| `FeedbackTagRankList.tsx` | `CustomerFeedbackListItem` |
| `business-venue-workspace.css` | `business-dashboard-hierarchy.css` (feedback type) |
| `customer-feedback-workspace.css` | |

---

## 7. Responsive changes

- Metrics strip: 2 → 3 → 5 columns (mobile / tablet / desktop).
- Location cards: flex-wrap on integrations and table rows; long names `word-break` / `truncate` where appropriate.
- Filter grid unchanged at breakpoints (`sm:grid-cols-2`, `lg:grid-cols-5`).
- No `overflow-x: hidden` hacks added.

---

## 8. i18n changes (EN + DE)

**Locations:** `tablesEmptyTitle`, `tablesEmptyDesc`, `tableCountLabel`, `createTableShort`, `integrationGoogle`, `integrationTripadvisor`, `locationActionsAria`, `editLocation`, updated `subtitle`.

**Customers layout:** `feedbackPageDesc`.

**Feedback:** `basedOnReviews`, `dashboardSummaryTitle`, `dashboardSummaryDesc`, `dashboardViewAll`.

---

## 9. Accessibility

- Location actions in **menu** with visible trigger + `aria-label`.
- Rating stars retain `aria-label` on row; review structure uses semantic `article` / `footer` / `time`.
- Keyboard-accessible dropdown and existing filter `aria-label`s preserved.

---

## 10. Performance

- No new API calls or duplicate fetches.
- Dashboard panel still idle-loads in-view.
- No chart libraries added.

---

## 11. Data / business logic preserved

Unchanged: location/table CRUD, Google/TripAdvisor validation, venue catalog caching, feedback list API, summary fields, client filters, insight aggregations, entitlements, QR Studio links, table edit/delete absence.

---

## 12. Tests run

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npm run test:locations-tables-management` | Pass (19 checks; expects `BusinessLocationVenueCard` + catalog grouping) |

---

## 13. Build

`npm run build` not run in this pass (typecheck green). Recommend CI build before release.

---

## 14. Screens / routes verified (code-level)

- `/dashboard/locations` — `LocationsPage`
- `/dashboard/customers/feedback` — `BusinessCustomersLayout` + `CustomerFeedbackPage`
- `/dashboard` — `RecentCustomerFeedbackPanel`

---

## Final status

**READY — LOCATIONS & CUSTOMER FEEDBACK REDESIGN COMPLETE**

_Manual responsive spot-check on 320–1440px and `npm run build` recommended before production deploy._
