# Phase 1 Results — Dashboard request shape

**Date:** 2026-07-18  
**Scope:** Frontend quick wins only (no backend SQL, no React/chart/admin work)  
**Before:** `BUSINESS_DASHBOARD_PROFILE.json`, `EMPLOYEE_DASHBOARD_PROFILE.json`  
**After:** `BUSINESS_DASHBOARD_PROFILE_AFTER.json`, `EMPLOYEE_DASHBOARD_PROFILE_AFTER.json`  
**Capture:** Playwright `e2e/dashboard-phase1-after.spec.ts` (`?dashProfile=1`, cold large business + employee)

---

## What shipped

| # | Change | Result in after profile |
|---|--------|-------------------------|
| 1 | Business: no eager month/year / hero-month prefetch | Only `timeframe=week` stats on load |
| 2 | Notifications: unread-count only until dropdown open | No `/api/me/notifications?limit=25` on startup |
| 3 | Employee: no inactive TF prefetch | Only `timeframe=today` tips on load |
| 4 | Profile: drop obvious duplicate force/warm fetches | Still **1** profile request per surface (unchanged count; removed extra paths) |

Profiler instrumentation left intact and compatible.

---

## Business — Before vs After

| Metric | Before (`cold_large`) | After (`phase1_after_cold_large`) | Delta |
|--------|----------------------:|----------------------------------:|------:|
| First KPI | 3905 ms | 3843 ms | −62 ms |
| First usable | 3907 ms | 3843 ms | −64 ms |
| API requests (startup window) | **6** | **3** | **−3** |
| Long tasks (count / total) | 9 / **1094 ms** | 11 / **1158 ms** | +2 / +64 ms (noise) |
| Layout mounted | 34 ms | 34 ms | 0 (shell-first preserved) |

### Startup API list

**Before**

1. `/api/business/profile`
2. `/api/me/notifications/unread-count`
3. `/api/me/notifications?limit=25&locale=de`
4. `/api/business/me/stats?timeframe=week&scope=summary`
5. `/api/business/me/stats?timeframe=month&scope=summary` (started, in-flight)
6. `/api/business/me/stats?timeframe=month&scope=summary` (**duplicate**)

**After**

1. `/api/business/profile`
2. `/api/me/notifications/unread-count`
3. `/api/business/me/stats?timeframe=week&scope=summary`

### Duplicate / unnecessary requests removed

| Removed | Notes |
|---------|--------|
| Inbox list (`notifications?limit=25`) | Deferred until dropdown open |
| Month stats ×2 | Eager prefetch + duplicate month call gone |
| Year / hero-month | Not issued on overview load |

Week stats duration remains ~3.6 s (unchanged class) — expected; Phase 1 did not touch backend SQL / summary contract. First usable still gated by active-week stats.

---

## Employee — Before vs After

| Metric | Before (`cold`) | After (`phase1_after`) | Delta |
|--------|----------------:|-----------------------:|------:|
| First KPI | 1234 ms | 1059 ms | **−175 ms** |
| First usable | 1235 ms | 1059 ms | −176 ms |
| Startup request count | **6** | **3** | **−3** |
| Background API count (after first KPI) | **2** (week + month tips) | **0** | **−2** |
| Long tasks (count / total) | 3 / 346 ms | 3 / 346 ms | 0 |

### Startup API list

**Before:** `employees/me` + unread-count + inbox list + today + **week** + **month** tips  

**After:** `employees/me` + unread-count + **today** tips only  

---

## Interpretation

- Phase 1 **cut startup fan-out in half** on both surfaces (6 → 3 requests).
- Business first-KPI barely moved because the active week `myStats` call still dominates (~3.6 s). Gains are contention / duplicate removal, not cold SQL speed.
- Employee first-KPI improved modestly; larger win is **no post-load week/month background traffic**.
- Shell milestones (~14–35 ms layout) unchanged — post-login shell-first path not regressed.
- Long-task totals are within run-to-run noise; not a Phase 1 target.

---

## Next (out of scope here)

Per plan: Phase 1.1 / later phases — backend summary SQL, admin progressive load, React memo, charts. Do not conflate with this frontend request-shape pass.
