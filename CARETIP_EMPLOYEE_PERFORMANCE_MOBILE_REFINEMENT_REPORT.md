# CareTip — Employee Performance Mobile Header + Teaser Density

**Status: READY — MOBILE PERFORMANCE PAGE REFINEMENT COMPLETE**

**Date:** 2026-10-02

---

## 1. Root cause

On narrow viewports the **period performance hero** used a horizontal header: title/description shared a row with **“Gerade aktualisiert • Aktiv”** (`DashboardRefreshIndicator` + `DashboardRealtimeStatusStrip`). That narrowed the title column and forced the German description into many short lines.

**Surfaces:**

| Role | Component | Section |
|------|-----------|---------|
| Employee | `EmployeeDashboard.tsx` | `employee-dashboard-analytics-intro` |
| Business (team period block) | `BusinessDashboardOverviewSection` via `BusinessDashboard.tsx` | `business-overview-period` |

Employee Goals + Customer Feedback teasers live on the **business** dashboard (`BusinessDashboard.tsx`); limits apply there.

---

## 2. Live indicator repositioning

- Status controls moved into a **`__meta`** row **below** the eyebrow, title, and description (full-width copy first).
- Same green dot / refresh / “Aktiv” semantics via existing `DashboardRefreshIndicator` + `DashboardRealtimeStatusStrip`.
- CSS: `text-wrap: pretty`, `max-width: 42rem` on description; meta uses flex-wrap with modest top margin.

---

## 3. Before / after (mobile hierarchy)

**Before:** Title + refresh beside status strip → cramped copy column.

**After:**

```
LEISTUNG (eyebrow)
Zeitraumleistung (title)
Trinkgeldvolumen, Teamaktivität und Diagramme für diese Woche. (description, ~2–3 lines)

Gerade aktualisiert • Aktiv (meta row)

[period tabs]
```

---

## 4. Employee Goals teasers (business dashboard)

- Mobile (`max-width: 639px`): **max 2** goals (`DASHBOARD_MOBILE_TEASER_LIMIT`).
- Desktop: **5** (`DASHBOARD_EMPLOYEE_TEASER_LIMIT`).
- Sorting unchanged (by progress %). **View all** link unchanged.

---

## 5. Customer Feedback teasers (business dashboard)

- Mobile fetch/display: **2** items.
- Desktop: **5** items (`listBusinessCustomerFeedback` `take` bounded).
- Full feedback page unchanged.

---

## 6. Responsive breakpoints

Layout validated against design intent at **320–430px** widths (column hero, no side-by-side status). Desktop/tablet period hero unchanged aside from meta consistently under description (cleaner at all sizes).

---

## 7. German / English

- Employee DE: added `analyticsSectionEyebrow`, aligned title/description with business period copy pattern.
- EN employee keys already included eyebrow + description with `{{period}}`.
- No hardcoded UI strings.

---

## 8. Tests / build

| Command | Result |
|---------|--------|
| `npm run test:employee-performance-mobile-refinement` | run locally |
| `npm run test:dashboard-mobile-ui` | run locally |
| `npm run typecheck` | run locally |

---

## 9. Remaining issues

None identified. Analytics APIs, KPI math, charts, and routing unchanged.

---

**READY — MOBILE PERFORMANCE PAGE REFINEMENT COMPLETE**
