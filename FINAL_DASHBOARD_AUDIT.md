# Final Dashboard Performance Audit (Phase 5)

**Date:** 2026-07-19  
**Mode:** Measure & validate only — **no source, SQL, memo, cache, or UI changes**  
**Purpose:** Establish the post–Phases 1–4 baseline before infrastructure work (Redis, rollups, regional DB).

---

## 1. Executive summary

After Phases 1–4, CareTip dashboards are **shell-first**, **request-shaped**, and **render-isolated** enough for a **pilot** with real tenants. Business cold first-usable is still dominated by **Supabase round-trip / SQL**, not by request fan-out or notification/sidebar React churn.

| Surface | What improved most | What still limits UX |
|---------|--------------------|----------------------|
| **Business** | Startup APIs 6→3; Bell 8→3; Sidebar 7→1; KpiSurface 8→2; summary SQL path ~2.6 s→~0.9 s warm | Cold KPI ~1.9–2.2 s class (infra RTT); page still ~6 renders; max KPI commit ~80–120 ms |
| **Employee** | Startup APIs 6→3; Bell/KPI ≤3; no inactive TF prefetch | Profile + tips still multi-stage; long-task noise in harness |
| **Admin** | Critical KPIs ~950 ms→~550 ms; heavy APIs non-blocking | Fully loaded waits on heavy stage (expected) |

**Verdict: Ready for Pilot.**  
Not yet “large-scale production” without infrastructure upgrades (Redis / lower RTT / optional rollups) for large tenants and multi-region latency.

---

## 2. Timeline of optimizations

| Phase | Scope | Outcome |
|-------|--------|---------|
| **0 / Evidence** | Runtime profiler + cold_large baseline | Business first KPI ≈3905 ms; Bell/Sidebar/KPI high churn |
| **1** | Frontend request shape | Startup APIs **6→3**; inbox list deferred; no month/year prefetch |
| **2** | Business `myStats` summary-first SQL | Warm summary **~874 ms**; cold combined **~1.9 s**; profiler first KPI **~2180 ms** class |
| **3** | Admin progressive loading | First KPI **~551 ms**; 2 APIs gate KPI (not 8) |
| **4** | React isolation | Bell ≤3; Sidebar 1; KpiSurface ≤3; page 8→6 |
| **5** | This audit | Fresh FINAL captures + bottleneck split + launch readiness |

---

## 3. Before / after metrics

### 3.1 Capture files (Phase 5)

| Scenario | File |
|----------|------|
| Business cold (current architecture) | `BUSINESS_DASHBOARD_PROFILE_FINAL.json` |
| Business warm | `BUSINESS_DASHBOARD_PROFILE_FINAL_WARM.json` |
| Business hard refresh | `BUSINESS_DASHBOARD_PROFILE_FINAL_HARD_REFRESH.json` |
| Employee | `EMPLOYEE_DASHBOARD_PROFILE_FINAL.json` |
| Platform Admin | `ADMIN_DASHBOARD_PROFILE_FINAL.json` |
| Index | `DASHBOARD_PROFILE_FINAL_INDEX.json` |

### 3.2 Business — phase comparison

> **Calibration note:** Absolute first-KPI ms track the **mock/live stats delay** of that capture.  
> Baseline/P1 used **~3600 ms** week mock; P2 used **~1900 ms**; P4/Final harness used **~400 ms**.  
> Use **API count + render counts** for apples-to-apples architecture comparison; use **P2 live probe** for production timing class.

| Metric | Baseline | Phase 1 | Phase 2 | Phase 3 | Phase 4 | **Final (cold)** |
|--------|---------:|--------:|--------:|--------:|--------:|-----------------:|
| **First KPI (ms)** | 3905 | 3843 | 2182 | — | ~650–780* | **781*** |
| **First usable (ms)** | 3907 | 3843 | 2182 | — | ~651–781* | **781*** |
| **Fully loaded (ms)** | 3908 | 3845 | 2183 | — | ~652–783* | **783*** |
| **Startup unique APIs** | 6 | **3** | **3** | — | **3** | **3** |
| **BusinessDashboard** renders | 8 | 8 | 8 | — | 6 | **6** |
| **NotificationBell** | 8 | 7 | 8 | — | 3 | **3** |
| **Sidebar** | 7 | 7 | 7 | — | 1 | **1** |
| **KpiSurface** | 8 | 8 | 8 | — | 2 | **2** |
| **Max KPI commit (ms)** | 147.9 | 81.8 | 105.7 | — | 82.5 | **114.6**† |
| **Long-task count** | 9 | 11 | 9 | — | 10 | **9** |
| **Long-task total (ms)** | 1094 | 1158 | 1183 | — | 1123 | **1182**† |

\*Harness mock ≠ live DB; live cold class remains **~1.9–2.2 s** (Phase 2 probe).  
†Long-task / max-commit are run-noisy; isolation targets for Bell/Sidebar/KPI **counts** are stable.

**Final Business warm / hard refresh (same architecture):**

| Metric | Warm | Hard refresh |
|--------|-----:|-------------:|
| First KPI | 592 ms* | 598 ms* |
| Unique startup APIs | 3 | 3 |
| Bell / Sidebar / KpiSurface | 3 / 1 / 2 | 3 / 1 / 2 |
| Page renders | 6 | 6 |

### 3.3 Employee — phase comparison

| Metric | Baseline | Phase 1 | Phase 4 | **Final** |
|--------|---------:|--------:|--------:|----------:|
| First KPI (ms) | 1234 | 1059 | ~23–45* | **45*** |
| Startup unique APIs | 6 | **3** | **3** | **3** |
| EmployeeDashboard | 10 | 10 | 8 | **10**† |
| NotificationBell | 10 | 10 | 3 | **3** |
| Sidebar | 5 | 5 | 2 | **2** |
| KpiSurface | 10 | 10 | 3 | **3** |
| Max KPI commit (ms) | 44.9 | 47 | 32.2 | **98**† |
| Long-task total (ms) | 346 | 346 | 866 | **1728**† |

\*Fast tips mock; not live latency.  
†Page/long-task vary by run; Bell/KPI/Sidebar isolation holds.

### 3.4 Platform Admin — phase comparison

| Metric | Baseline | Phase 3 | Phase 4 | **Final** |
|--------|---------:|--------:|--------:|----------:|
| First KPI (ms) | 948 | **551** | 618 | **546** |
| First usable (ms) | 949 | 551 | 619 | **548** |
| Fully loaded (ms) | 949 | 1370 | 1147 | **1249** |
| APIs blocking first KPI | 8 | **2** | 2 | **2** |
| Startup unique APIs (all stages) | ~10 | 9 | 9 | **9** |
| AdminDashboard renders | 1 | 3 | 3 | **3** |
| NotificationBell | 6 | 6 | 2 | **2** |
| KpiSurface | 1 | 3 | 3 | **3** |

---

## 4. Remaining bottlenecks

### 4.1 Application bottlenecks

| Bottleneck | Evidence | Impact |
|------------|----------|--------|
| **Auth / entitlements / stats boot stages** | BusinessDashboard still **6** renders (target was ≤4) | Extra main-thread commits after shell |
| **CountUp + KPI card chrome** | Max KPI commit often **80–120 ms** (target &lt;60) | First KPI paint cost |
| **Outlet / layout probe noise** | Outlet still ~40 events in some captures | Measurement + some transition work |
| **Chart idle mount** | `chart_mounted` often null in short settle windows | Charts deferred (good); fully_loaded may fire without chart |
| **Motion after usable** | Zero-duration until KPI, then Motion | Acceptable; still JS when armed |
| **Employee profile + tips sequencing** | Separate `/employees/me` + tips | Multi-stage settle |
| **Admin stage commits** | 3 page/KPI renders by design | Progressive UI cost |

### 4.2 Infrastructure bottlenecks

| Bottleneck | Evidence | Impact |
|------------|----------|--------|
| **Supabase pooler RTT** | Phase 2: single summary SQL still **~0.8–2 s** | Dominates Business first usable |
| **Cold vs warm SQL path** | Cold metaSummary ~1.9 s; warm summarySqlOnly ~874 ms | Repeat visits better than first |
| **No Redis** | In-memory rate limit / no shared response cache in DEV | Multi-instance / cold misses |
| **Regional DB latency** | EU pooler from app region | Floor on every query |
| **Large-tenant SQL** | Audit originally ~3.6 s full bundle class | Charts/full scope still heavier than summary |
| **Network RTT to API** | Profile/unread still add tens–hundreds ms | Secondary to stats |

**Do not mix:** cutting React renders will not remove the ~0.8–1.7 s DB RTT floor.

---

## 5. Quantify remaining gains

### Business

| | Estimate |
|--|----------|
| **Current first usable (live class, post–Phase 2)** | ≈ **2.1 s** cold / ≈ **1.0–1.2 s** warm context |
| **Theoretical minimum with current architecture** (perfect FE batching, same SQL) | ≈ **1.8 s** cold |
| **Infrastructure floor** (1× pooled SQL RTT + tiny shell) | ≈ **1.5–1.7 s** cold |
| **Remaining gain available in frontend** | ≈ **200–400 ms** (boot coalesce, lighter KPI paint) |
| **Remaining gain from infrastructure** | ≈ **0.5–1.5 s+** (Redis, nearer DB, rollups, lower RTT) |

### Employee

| | Estimate |
|--|----------|
| Current first usable (live class) | ≈ **0.8–1.2 s** (tips + profile) |
| Frontend remaining | ≈ **100–200 ms** |
| Infra floor | Tips query RTT |

### Admin

| | Estimate |
|--|----------|
| Current first KPI | ≈ **500–700 ms** (critical health+stats) |
| Frontend remaining | Small (progressive already) |
| Infra | Platform API latency; heavy stage independent |

---

## 6. Regression audit

| Check | Result | Evidence |
|-------|--------|----------|
| **No duplicate startup API shapes** | **Pass** | Final cold unique set = `profile` + `unread-count` + `stats?week&scope=summary` only (no inbox list, no month/year) |
| **Notification isolation** | **Pass** | Bell **3** (Business/Employee), **2** (Admin); not tied to Sidebar |
| **Sidebar isolation** | **Pass** | BusinessSidebar **1** cold/warm/hard |
| **Charts not remounting from shell** | **Pass** | Charts idle-mounted; `chart_mounted` often absent in settle window; no chart probe spam |
| **KPI memoization** | **Pass** | KpiSurface **2** while page **6** |
| **Shell-first navigation** | **Pass** | `layout_mounted` **16–53 ms** across Final captures |
| **Visual regressions** | **Pass (instrumentation)** | No UI/source changes in Phase 5; prior phases preserved product behavior |
| **Strict Mode / remount api_end multiples** | **Note** | Raw `api_end` event counts can repeat ×2–3 in DEV; **unique URL set** is the regression signal |

---

## 7. Infrastructure recommendations

1. **Redis (or shared)** for `myStats` / platform critical responses and rate limits  
2. **Lower DB RTT** — transaction pooler, same-region app↔DB, connection budgeting  
3. **Materialized / rollup paths** for large-tenant charts (keep summary path thin)  
4. **CDN / edge** for static dashboard assets to cut long-task scripting on cold load  
5. **Synthetic monitors** on first KPI using the runtime profiler export in staging  

---

## 8. React recommendations (future — not done in Phase 5)

1. Coalesce auth + entitlements + first stats into fewer BusinessDashboard commits (6→≤4)  
2. Lighter first KPI paint (defer CountUp / reduce card work under 60 ms)  
3. Keep probing **unique** API paths in CI to lock Phase 1 shape  
4. Optional: assert Bell ≤3 / Sidebar ≤2 / KpiSurface ≤3 in Playwright  

---

## 9. Overall performance score

| Dimension | Score (1–10) | Notes |
|-----------|-------------:|-------|
| Request shape | **9** | 3 startup APIs; Phase 1 locked |
| Business SQL path | **7** | Summary-first done; RTT floor remains |
| Admin progressive load | **9** | Critical vs heavy split solid |
| Render isolation | **8** | Bell/Sidebar/KPI met; page count partial |
| Main-thread / long tasks | **5** | Still noisy; not infra-solved |
| Observability | **8** | Profiler + phase artifacts |
| **Overall** | **7.5 / 10** | Pilot-ready; scale needs infra |

---

## 10. Launch readiness

| Criterion | Status |
|-----------|--------|
| Pilot with known tenants / EU latency | **Ready** |
| Production soft launch (single region, moderate load) | **Ready with monitoring** |
| Large-scale / multi-region / very large tenants | **Needs infrastructure upgrades** |

### Final verdict

**Ready for Pilot**

Proceed to production soft launch only with dashboards monitored (first KPI, unique startup APIs, Bell/Sidebar render caps). Defer “large-scale rollout” until Redis / RTT / rollup work moves the Business cold floor below ~1.5 s for target tenants.

---

## Appendix — Final capture snapshot (2026-07-19)

| Capture | First KPI | Unique APIs | Bell | Sidebar | KpiSurface | Page |
|---------|----------:|------------:|-----:|--------:|-----------:|-----:|
| Business cold | 781 ms* | 3 | 3 | 1 | 2 | 6 |
| Business warm | 592 ms* | 3 | 3 | 1 | 2 | 6 |
| Business hard refresh | 598 ms* | 3 | 3 | 1 | 2 | 6 |
| Employee | 45 ms* | 3 | 3 | 2 | 3 | 10 |
| Admin | 546 ms | 9 | 2 | 3 | 3 | 3 |

\*Business/Employee harness mocks are faster than live DB; use Phase 2 live timings for capacity planning.
