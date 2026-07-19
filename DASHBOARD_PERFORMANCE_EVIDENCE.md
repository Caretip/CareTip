# DASHBOARD_PERFORMANCE_EVIDENCE.md

**Project:** CareTip  
**Date:** 2026-07-18  
**Status:** Evidence only — no optimizations applied  
**Profiler:** Extended `dashboardRuntimeProfiler` (API TTFB/parse/cache, long tasks, React render stats, context/socket hooks)

---

## Methodology (no assumptions without sources)

| Evidence class | Source | Notes |
|----------------|--------|-------|
| Shell / KPI / render / long-task / notification timings | Playwright capture with **instrumented app** (`e2e/dashboard-evidence-capture.spec.ts`) | React & main-thread metrics are real |
| Business stats wall times | API delays **calibrated** from live `dashboard.timing` in DEV backend logs (this session) | e.g. week/month `sqlBundle` / `myStats.full` 3.6–12 s |
| Live SQL phase breakdown | Backend terminal (`dashboard.timing`) | Corroborates calibration |
| WebSocket rerenders | Profiler hooks ready; **0 messages** in e2e (no live socket) | Capture live session with `?dashProfile=1` for WS evidence |

**Artifacts**

| File | Scenario |
|------|----------|
| `BUSINESS_DASHBOARD_PROFILE.json` / `.md` | Cold, large-dataset calibrated |
| `BUSINESS_DASHBOARD_PROFILE_WARM.json` / `.md` | Soft re-nav, same large delays |
| `BUSINESS_DASHBOARD_PROFILE_HARD_REFRESH.json` / `.md` | Reload |
| `BUSINESS_DASHBOARD_PROFILE_SMALL.json` / `.md` | Cold, small-dataset calibrated |
| `EMPLOYEE_DASHBOARD_PROFILE.json` / `.md` | Cold employee |
| `ADMIN_DASHBOARD_PROFILE.json` / `.md` | Cold platform admin |
| `DASHBOARD_PROFILE_CAPTURE_INDEX.json` | Index + calibration constants |

---

## Snapshot matrix (measured milestones, ms)

| Scenario | Layout | Header | Notifs | Profile | First KPI | First usable | Long tasks (count / total ms) |
|----------|-------:|-------:|-------:|--------:|----------:|-------------:|-------------------------------|
| Business cold large | 34 | 35 | 310 | 321 | **3905** | **3907** | 9 / 1094 |
| Business warm large | 16 | 18 | 357 | 383 | **3782** | **3783** | 8 / 762 |
| Business hard refresh | 14 | 15 | 271 | 286 | **3767** | **3768** | 8 / 587 |
| Business cold small | 27 | 29 | 361 | 406 | **811** | **812** | 8 / 734 |
| Employee cold | 22 | 25 | 223 | 229 | **1234** | **1235** | 3 / 346 |
| Admin cold | 50 | 52 | 307 | — | **948** | **949** | 5 / 575 |

**Finding:** Shell chrome is fast (~15–50 ms). **Time-to-usable tracks primary stats/tips/platform API latency**, not layout.

---

## Evidence items (prioritized)

### E1 — Business week stats dominate first usable (P0)

| Field | Value |
|-------|--------|
| **Evidence** | `BUSINESS_DASHBOARD_PROFILE.json` API: `GET /api/business/me/stats?timeframe=week&scope=summary` **duration 3668 ms**, TTFB **3667 ms**; `first_kpi_rendered` **3905 ms** |
| **Frequency** | Every cold/warm/hard refresh with large calibration; small dataset drops week stats to **631 ms** and first KPI to **811 ms** (`BUSINESS_DASHBOARD_PROFILE_SMALL`) |
| **User impact** | KPI skeletons for ~3.5–4 s after shell is already visible |
| **Est. improvement** | If week summary ≤800 ms: first usable ≈ **1.0–1.2 s** (shell + notifs) — ~**2.5–3 s** saved |
| **Priority** | **P0** |
| **Live corroboration** | Backend logs: `week.sqlBundle` ~2570 ms; `myStats.full` month ~12 s; analytics `goalsSql` ~2–3 s |

### E2 — Eager month/year (and duplicate) stats after paint (P0)

| Field | Value |
|-------|--------|
| **Evidence** | Large capture starts month stats while week still finishing (`duration: null` in-flight duplicates). Small capture completes month **449 ms** + year **459 ms** after week |
| **Frequency** | Every business overview load (prefetch path) |
| **User impact** | Extra main-thread/network contention; can delay interactive feel; duplicates visible in large profile |
| **Est. improvement** | Remove/defer prefetch: fewer competing requests; clearer week KPI path; estimated **0.5–2 s** less contention on large tenants |
| **Priority** | **P0** |

### E3 — Notification inbox list on every shell (P1)

| Field | Value |
|-------|--------|
| **Evidence** | All profiles: `GET /api/me/notifications?limit=25` ~**210–480 ms** parallel with profile; `shell:NotificationBell` **6–10 renders**, avg **17–27 ms**, max up to **64 ms** |
| **Frequency** | Every authenticated dashboard shell |
| **User impact** | Bandwidth + render cost before/during KPI wait; contributes to long tasks |
| **Est. improvement** | Unread-only first: save **~200–400 ms** network + fewer bell updates |
| **Priority** | **P1** |

### E4 — BusinessDashboard / KPI max render spikes (P1)

| Field | Value |
|-------|--------|
| **Evidence** | Cold large: `business:BusinessDashboard` / `KpiSurface` **8 renders**, **max 147.9 ms**; Layout/Sidebar **max ~130 ms**; Outlet **41 updates**, max **75.8 ms** |
| **Frequency** | During stats arrival + shell churn |
| **User impact** | Jank while skeletons resolve; long-task total **1094 ms** (9 tasks) on cold large |
| **Est. improvement** | Memoize KPI grid / isolate notification updates: cut max render **~50%**, reduce long-task total **~200–400 ms** |
| **Priority** | **P1** |

### E5 — Warm navigation does not help KPI wait when stats uncached (P1)

| Field | Value |
|-------|--------|
| **Evidence** | Warm large first KPI **3782 ms** vs cold **3905 ms** (~3% better). Shell faster (16 ms vs 34 ms) |
| **Frequency** | Soft nav without warm memory cache hit |
| **User impact** | Users still wait ~full stats RTT after login handoff is fixed |
| **Est. improvement** | Persist/warm week summary across soft nav: first usable could approach shell+cache (**&lt;200 ms** on hit) |
| **Priority** | **P1** |

### E6 — Employee tips + inactive prefetch (P1)

| Field | Value |
|-------|--------|
| **Evidence** | `EMPLOYEE_DASHBOARD_PROFILE`: tips today **1082 ms** → first KPI **1234 ms**; then week **923 ms** + month **924 ms** prefetch |
| **Frequency** | Every employee overview |
| **User impact** | ~1.2 s to usable; extra ~1.8 s background tips traffic |
| **Est. improvement** | Defer inactive TF: save ~**1.8 s** background; entitlements decoupling may shave gate time further (not isolated in this capture) |
| **Priority** | **P1** |

### E7 — Admin eight-way fan-out gates KPIs (P0)

| Field | Value |
|-------|--------|
| **Evidence** | `ADMIN_DASHBOARD_PROFILE`: parallel platform calls **716–854 ms**; first KPI **948 ms** (≈ slowest + shell). Chart mount **151 ms** (before KPIs — slot ready while data pending) |
| **Frequency** | Every admin overview |
| **User impact** | All KPI cards wait on slowest of 8; heavy endpoints (analytics, commercial) paid up front |
| **Est. improvement** | Progressive sections + defer commercial/analytics: first KPI from health/stats only ≈ **~750 ms**; defer others off critical path |
| **Priority** | **P0** |

### E8 — Long tasks on business overview (P2)

| Field | Value |
|-------|--------|
| **Evidence** | Cold large: **9** long tasks, **1094 ms** total; still **8 / 734 ms** on small dataset (not only network) |
| **Frequency** | Business overview loads |
| **User impact** | Input delay / animation jank during load |
| **Est. improvement** | Defer motion/TracingBeam + notification list: target long-task total **&lt;400 ms** |
| **Priority** | **P2** |

### E9 — WebSocket-driven rerenders (P2 — pending live WS capture)

| Field | Value |
|-------|--------|
| **Evidence** | Profiler records `socket_message` + counts; e2e sessions **messageCount: 0** |
| **Frequency** | Live tipping hours (unknown until live profile) |
| **User impact** | Suspected sidebar/KPI churn (audit hypothesis) — **not proven in e2e** |
| **Est. improvement** | TBD after `?dashProfile=1` live session with tips |
| **Priority** | **P2** (measure first) |

### E10 — Profile fetch overlap (P2)

| Field | Value |
|-------|--------|
| **Evidence** | Business profile **~280–400 ms** alongside notifications; employee `/employees/me` **219 ms** |
| **Frequency** | Every load |
| **User impact** | Moderate; smaller than stats |
| **Est. improvement** | Dedupe/TTL: **~100–300 ms** less duplicate work |
| **Priority** | **P2** |

---

## Render-frequency answers (from captures)

| Question | Measured answer |
|----------|-----------------|
| Which components render most? | `*:Outlet` (41–54), then NotificationBell / Dashboard / KpiSurface (6–10) |
| Do KPI cards rerender a lot? | **Yes** — 8–10 times per load; max commit **~148 ms** (business cold large) |
| Does NotificationBell churn? | **Yes** — 6–10 renders; avg 7–27 ms |
| Does sidebar match layout renders? | **Yes** — Layout/Sidebar/Header typically **tied at 7** (business) / **3** (admin) |
| Charts vs notifications? | Chart mount often **null** in business e2e (viewport/idle); admin chart slot **151 ms**. Cannot yet prove chart rerender-on-notification without live WS |

---

## Live backend corroboration (not Playwright)

From DEV server `dashboard.timing` during real tenant use:

- `week.sqlBundle` ~**2570 ms**
- `month.sqlBundle` ~**4455 ms**; `myStats.full` month ~**12216 ms**
- `analytics.employeesSql` ~**1170–1760 ms**; `goalsSql` ~**1975–2768 ms**

These justify the large-dataset calibration and P0 backend work.

---

## What was not fully proven yet

1. Live WebSocket message → component rerender causal chain (needs live tipping + profiler).  
2. Exact context name for each Outlet update (Auth vs Socket vs Entitlements) — watchers exist; e2e showed limited context_update volume.  
3. Authenticated Lighthouse CWV on dashboard URLs.  
4. Production CDN cache hit rates (`cacheSource` mostly `network` under Playwright mocks).

---

**Next:** `DASHBOARD_OPTIMIZATION_PLAN.md` (prioritized from this matrix).
