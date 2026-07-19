# DASHBOARD_OPTIMIZATION_PLAN.md

**Project:** CareTip  
**Date:** 2026-07-18  
**Basis:** `DASHBOARD_PERFORMANCE_EVIDENCE.md` + profile JSON artifacts  
**Rule:** Optimize in this order. Verify with before/after profiler exports.

---

## Principles

1. No change without a cited evidence ID (E1–E10).  
2. Prefer progressive UX over waiting for full payloads.  
3. Do not re-break Sign In shell-first handoff.  
4. Success = measured milestone/API/render deltas in `?dashProfile=1` captures.

---

## Phase 0 — Keep measuring (0.5 day)

| Item | Detail |
|------|--------|
| Work | Live Business session with tipping: export `BUSINESS_DASHBOARD_PROFILE` after 2 minutes; confirm websocket + context_update events |
| Effort | S |
| Expected | Close E9 gap |
| Risk | None |
| Dependencies | Profiler already shipped |
| Verify | `socket.messageCount > 0`; map events → render spikes |

---

## Phase 1 — P0 backend & request shape (Business)

### 1.1 Summary-first / faster week stats (E1)

| | |
|--|--|
| **Effort** | L (backend SQL + API contract) |
| **Expected** | First usable **3.9 s → ~1.0–1.5 s** on large tenants |
| **Risk** | Medium (stats correctness, cache keys) |
| **Dependencies** | None |
| **Verify** | `first_kpi_rendered` & week stats `durationMs` in `BUSINESS_DASHBOARD_PROFILE`; live `dashboard.timing` summary &lt; 800 ms |

### 1.2 Stop eager month/year full/summary prefetch on overview (E2)

| | |
|--|--|
| **Effort** | S–M (frontend orchestration) |
| **Expected** | Remove duplicate in-flight month calls; less DB contention; smoother KPI settle |
| **Risk** | Low (period toggle may wait once) |
| **Dependencies** | Optional after 1.1 |
| **Verify** | Profile API table: only active TF on load; no parallel month/year until interaction |

---

## Phase 2 — P0 Admin progressive loading (E7)

| | |
|--|--|
| **Effort** | M |
| **Expected** | First KPI from health/stats only (~750 ms class); defer commercial + 30d analytics to chart/idle |
| **Risk** | Low–medium (UI loading states per section) |
| **Dependencies** | None |
| **Verify** | `ADMIN_DASHBOARD_PROFILE`: first_kpi before commercial/analytics `api_end`; shared `loading` removed |

---

## Phase 3 — P1 shell contention

### 3.1 Notification list deferral (E3)

| | |
|--|--|
| **Effort** | S |
| **Expected** | −200–400 ms network; fewer NotificationBell renders |
| **Risk** | Low |
| **Dependencies** | None |
| **Verify** | No `notifications?limit=25` until panel open; unread-count remains |

### 3.2 Employee inactive tips prefetch deferral (E6)

| | |
|--|--|
| **Effort** | S |
| **Expected** | −~1.8 s background tips traffic |
| **Risk** | Low |
| **Dependencies** | None |
| **Verify** | `EMPLOYEE_DASHBOARD_PROFILE`: only `today` (or active TF) on load |

### 3.3 Client warm cache for week summary across soft nav (E5)

| | |
|--|--|
| **Effort** | M |
| **Expected** | Warm first_kpi ≪ 500 ms when cache warm |
| **Risk** | Medium (stale data) |
| **Dependencies** | Works best with 1.1 |
| **Verify** | Compare cold vs warm profiles: warm `first_kpi_rendered` drop ≥ 70% |

---

## Phase 4 — P1 React render cost (E4, E8)

| | |
|--|--|
| **Effort** | M |
| **Expected** | BusinessDashboard max render **148 ms → &lt;60 ms**; long-task total **1094 ms → &lt;400 ms** |
| **Risk** | Medium (memo boundaries, stale UI) |
| **Dependencies** | Prefer after 3.1 (less notification-driven updates) |
| **Verify** | `renderStats` maxMs/totalMs; `mainThread.longTaskTotalMs` |

Tactics (when implementing — not now): isolate NotificationBell subscriptions; memo KPI grid; defer Motion/TracingBeam until after `first_usable`.

---

## Phase 5 — P2 cleanup

| Item | Evidence | Effort | Expected | Risk |
|------|----------|--------|----------|------|
| Profile/entitlements dedupe | E10 | S–M | −100–300 ms duplicate profile | Low |
| Live WS isolation | E9 | M | Stop sidebar/KPI on unrelated socket events | Medium |
| Bundle / hero main-thread | E8 | M | Lower long tasks on small dataset too | Low |

---

## Suggested sequence (calendar)

```
Week 1: 1.2 prefetch kill + 3.1 notifications + 3.2 employee prefetch (quick wins)
Week 2: 1.1 backend summary-first (largest KPI win)
Week 3: 2.0 admin progressive
Week 4: 3.3 warm cache + 4.0 render isolation
Week 5: P2 + live WS evidence pass
```

---

## Before/after scoreboard (fill after each phase)

| Metric | Baseline (cold large business) | Target | After |
|--------|--------------------------------:|-------:|------:|
| first_usable ms | 3907 | ≤1500 | |
| week stats durationMs | 3668 | ≤800 | |
| longTaskTotalMs | 1094 | ≤400 | |
| NotificationBell render count | 8 | ≤4 on load | |
| month/year APIs on load | present | 0 | |
| Admin first_kpi ms | 948 | ≤750 w/ only critical APIs | |

Capture command:

```bash
# Interactive
# open /dashboard?dashProfile=1 → window.__DASHBOARD_PROFILE__.download('BUSINESS_DASHBOARD_PROFILE')

# Automated evidence suite
PLAYWRIGHT_USE_SYSTEM_CHROME=true SKIP_PLAYWRIGHT_INSTALL=true npx playwright test e2e/dashboard-evidence-capture.spec.ts
```

---

## Out of scope for early phases

- Redesigning login handoff (already fixed)  
- Marketing Lighthouse scores (wrong URL)  
- React Query migration (optional later; not required for P0)

---

**Stop condition for this doc:** Implementation starts only after stakeholders accept P0 order (1.2 → 1.1 → 2.0) or an explicit reorder.
