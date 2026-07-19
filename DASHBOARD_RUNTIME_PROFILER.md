# Dashboard Runtime Profiler

**Status:** Instrumentation only — no performance optimizations  
**Purpose:** Collect real timings, API spans, and React render counts for Business / Employee / Platform Admin overview dashboards.

---

## Enable

Any of:

1. Query: `?dashProfile=1` on the dashboard URL  
2. Console: `localStorage.setItem("caretip_dash_profile", "1")` then reload  
3. E2E: `window.__DASHBOARD_PROFILE_FORCE__ = true`

---

## Capture (multi-surface evidence suite)

```bash
PLAYWRIGHT_USE_SYSTEM_CHROME=true SKIP_PLAYWRIGHT_INSTALL=true npx playwright test e2e/dashboard-evidence-capture.spec.ts
```

Writes `BUSINESS_DASHBOARD_PROFILE*.json/md`, `EMPLOYEE_DASHBOARD_PROFILE.*`, `ADMIN_DASHBOARD_PROFILE.*`.

See also: `DASHBOARD_PERFORMANCE_EVIDENCE.md`, `DASHBOARD_OPTIMIZATION_PLAN.md`.

---

## Capture (manual)

1. Open an overview with `?dashProfile=1` (optional `&dashScenario=cold_large`).
2. Wait until KPIs settle.
3. Console:

```js
window.__DASHBOARD_PROFILE__.download('BUSINESS_DASHBOARD_PROFILE')
```

## What it measures

| Milestone | Meaning |
|-----------|---------|
| `navigation_start` | Profile session start on overview route |
| `layout_mounted` | Dashboard layout effect |
| `sidebar_rendered` | Sidebar present (desktop) |
| `header_rendered` | Header present |
| `first_kpi_rendered` | First usable KPI data paint |
| `chart_mounted` | Chart idle/viewport slot ready |
| `notifications_fetch_done` | First notifications API end |
| `profile_fetch_done` | First profile `/business/profile` or `/employees/me` end |
| `first_usable` | Layout + first KPI |
| `fully_loaded` | Usable + chart mount (or forced when metrics settled) |

Also records API TTFB/parse/bytes/cache, long tasks, React render stats, context updates, and websocket message counts when live.


---

## Interpreting render frequency

- High `shell:NotificationBell` while KPIs idle → notification-driven updates  
- High `business:BusinessSidebar` after websocket tips → sidebar subscribed too broadly  
- High `business:KpiSurface` without new `api_end` for stats → pure React rerenders  

Compare `api_end` timeline vs `render` events in the JSON.

---

## Roadmap (do not implement until evidence reviewed)

1. Runtime instrumentation ← **this**  
2. Optimize Business stats backend  
3. Remove eager month/year prefetch  
4. Progressive Admin loading  
5. Notification optimization  
6. Profile/entitlement deduplication  
7. React rendering audit (use these render counts)  
8. Bundle/main-thread optimization  

---

## Files

| Path | Role |
|------|------|
| `src/app/lib/dashboardRuntimeProfiler.ts` | Core marks, fetch probe, export |
| `src/app/hooks/useDashboardRuntimeProfile.tsx` | React hooks + route registrar |
| Layouts / overview pages / `NotificationBell` / sidebars | Probes |
| `DashboardChartsIdleMount` | Chart mount milestone |
| `e2e/dashboard-runtime-profile.spec.ts` | Automated capture |
