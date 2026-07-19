# Phase 2 Results — Business stats summary-first

**Date:** 2026-07-18  
**Scope:** Backend `GET /api/business/me/stats` only (Business)  
**Before:** Live `dashboard.timing` + `BUSINESS_DASHBOARD_PROFILE_AFTER.json` (Phase 1 shape)  
**After:** Live service probe + `BUSINESS_DASHBOARD_PROFILE_PHASE2.json`  
**Profiler:** left enabled; frontend contract / caches / response shapes unchanged

---

## Root cause (confirmed)

`scope=summary` still called `queryBusinessDashboardSqlBundle`, which ran **sequentially**:

1. `summarySql` (~870 ms)  
2. `tipsByEmployee`  
3. `dailyTipBuckets` (charts)

so `sqlBundle` totaled **~2570 ms** and `business.myStats.summary` **~2600 ms** — even though the summary response never uses employee/chart aggregates.

The pulse CTE also scanned **all** successful tips for the business (unbounded).

---

## What shipped

| Change | Detail |
|--------|--------|
| Summary path | KPI-only: one combined SQL (`metaSummarySql`) on cold context; `summarySqlOnly` when context warm |
| Full scope | Single sql-bundle load (no summary→analytics double tips scan) |
| Summary SQL | Bounded tips window (`period ∪ pulse`); no full-history pulse scan |
| Meta load | Business row + roster **parallel** (`connection_limit=5`) |
| Analytics extras | Employees + goals **parallel** |
| sqlBundle logging | Per-phase `tipsByEmployeeMs` / `dailyBucketsMs` |

Inactive timeframes, notifications, employee/admin, React, and charts were not touched.

---

## Live SQL probe (`backend/scripts/probeBusinessStatsPhase2.ts`)

Business `cmpy3xoc90003u7o0eqdf55c6` (same as prior DEV session).

| Scenario | Before (Phase 1 / audit) | After (Phase 2) | Delta |
|----------|-------------------------:|----------------:|------:|
| Week `scope=summary` handler (warm meta, tip cold) | **~2600 ms** (`sqlBundle`) | **874 ms** (`summarySqlOnly`) | **−66%** |
| Week summary fully cold | ~3.5 s (3 sequential meta+tips) | **~1890 ms** (1× `metaSummarySql`) | **−46%** |
| Response cache hit | — | **0 ms** | — |

### Phase breakdown (after)

| Phase | Queries | Mode | Duration |
|-------|--------:|------|--------:|
| `metaSummarySql` (cold KPI) | **1** | combined business+roster+tips | **~1.8–2.2 s** |
| `summarySqlOnly` (context warm) | **1** | tips KPI only | **~860 ms** |
| `metaBusinessRow` + `metaRosterSql` | 2 | **parallel** (analytics/context rebuild) | ~max(RTT) |
| sqlBundle `tipsByEmployee` + `dailyBuckets` | 2–3 | sequential (analytics/full only) | not on summary path |

**Sequential queries on summary cold path:** 1 (was 3+ tip scans).  
**Parallel queries:** meta business∥roster; employees∥goals on analytics path.

**Slowest SQL on KPI path:** `metaSummarySql` / `summarySql` — dominated by **Supabase pooler RTT** (~0.8–2 s per round trip from this environment), not tip-row volume (this tenant has tipCount=3 for the week).

---

## Profiler (Business overview)

Calibrated week delay: Phase 1 mock **3600 ms** → Phase 2 mock **1900 ms** (live cold combined).

| Metric | Before (Phase 1 after) | After (Phase 2) | Delta |
|--------|-----------------------:|----------------:|------:|
| Week stats duration | ~3629 ms | ~1900 ms | **−48%** |
| First KPI | 3843 ms | ~2100 ms class | **~−45%** |
| First usable | 3843 ms | ~2100 ms class | **~−45%** |

Exact Phase 2 export: `BUSINESS_DASHBOARD_PROFILE_PHASE2.json` / `.md`.

---

## Success target

| Target | Result |
|--------|--------|
| Week stats **3.6 s → under 1 s** | **Met for context-warm tip reload (874 ms).** Cold first paint **~1.9 s** (one RTT combined SQL). |
| Frontend unchanged | Yes — still `scope=summary` / same JSON fields |

### Why cold is not always &lt;1 s

Any tips aggregate to EU Supabase from this host costs **~0.8–2 s per round trip**. Cold KPI needs at least one DB round trip → floor ≈ RTT. Further gains need infrastructure, not more request-shape cuts:

1. **Tip rollup / materialized daily totals** per `business_id` (avoid live `SUM` on `tips`)  
2. **Region-local read replica** or lower-latency pooler path  
3. **Redis** for `biz-dash-context` + summary metrics across API instances  
4. Confirm index use: `tips_business_id_status_created_at_idx` (`EXPLAIN ANALYZE` on `metaSummarySql`)

---

## Files touched

- `backend/src/utils/tipChartBuckets.ts` — bounded summary SQL; combined meta+summary; sqlBundle phase logs  
- `backend/src/services/business.service.ts` — summary-first loaders; full-scope single bundle; parallel meta/extras  
- `backend/src/utils/shortLivedCache.ts` — `getCachedIfFresh`  
- `backend/scripts/probeBusinessStatsPhase2.ts` — measurement harness  
- `e2e/dashboard-phase2-after.spec.ts` — profiler export  

---

## Next (out of scope)

Plan “Admin progressive loading”, React memo, charts, employee tips — later phases. Optional follow-up: cache onboarding/auth session checks to shrink HTTP overhead outside `myStats` timing.
