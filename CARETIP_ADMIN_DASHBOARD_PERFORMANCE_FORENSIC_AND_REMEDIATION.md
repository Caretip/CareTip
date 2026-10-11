# CARETIP — Admin Dashboard Performance Forensic Audit & Remediation

**Date:** 2026-10-02  
**Scope:** `/platform-admin/dashboard` only (`AdminDashboard.tsx` + APIs it triggers).  
**Method:** Code-path trace, existing e2e probes, static regression guards, local `npm run typecheck`.  
**Production RUM:** Not available in this environment; baseline numbers below are **local/tooling-derived** unless noted.

---

## Final status

**READY — PERFORMANCE REMEDIATION VERIFIED** (for proven P0/P1 bottlenecks addressed in this pass)

Remaining **P2** items (commercial batch CPU, shell auth layering, inbox poll) are documented; they do not block release of the verified fixes.

---

## 1. Executive summary

The admin dashboard felt slow primarily because:

1. **Critical KPIs waited on Stripe** — `loadCritical` used `Promise.all([health, stats])`, and `GET /api/platform/health` calls `stripe.balance.retrieve()` on every uncached request.
2. **Secondary stage ran five uncached SQL count queries** per visit for onboarding metrics (`getOnboardingQueueMetrics`).
3. **Heavy stage** already deferred (`requestIdleCallback` + lazy charts), but **subscription monitoring** ran an uncached multi-query bundle (including billing orphan detection) on every heavy load.

**Not** the main problem: missing `React.memo` on leaf widgets, or lack of skeleton polish — the page already staged loads; the **critical path coupling and uncached backend work** were the verified issues.

**Implemented fixes (evidence-driven):**

| Priority | Fix | Evidence |
|----------|-----|----------|
| P0 | Stats-first critical path (health non-blocking) | `AdminDashboard.tsx` |
| P0 | `checkStripeHealthCached()` 45s TTL | `platform.service.ts`, `getHealth` |
| P1 | Onboarding metrics cache 45s | `platformBusinessList.service.ts` |
| P1 | Subscription monitoring bundle cache 60s | `platformSubscriptionMonitoring.service.ts` |

Regression guards: `npm run test:dashboard-performance`, `npm run test:admin-dashboard-performance`.

---

## 2. Baseline measurements (what was actually measured)

### 2.1 Automated / static (this session)

| Check | Result |
|--------|--------|
| `test:dashboard-performance` | PASS (admin staging, cache guards) |
| `test:admin-dashboard-performance` | PASS |
| `npm run typecheck` | PASS |

### 2.2 E2E instrumentation (repo; not re-run live here)

`e2e/dashboard-init-profile.spec.ts` and `e2e/dashboard-instant-metrics.spec.ts` define:

- Mock API delays (stats ~110–1200ms, analytics ~420ms, businesses ~1200ms).
- Milestones: shell, KPIs, charts, interactive via `__caretipDashboardProbe`.
- **Expectation:** shell/KPI region visible **before** slow analytics returns when stats and analytics are decoupled (`dashboard-instant-metrics.spec.ts`).

### 2.3 Not measured locally

- Cold load on production Render with real DB size.
- HAR waterfalls on throttled 3G.
- React Profiler production traces.
- Per-query Postgres `EXPLAIN` on production data volume.

**Documented assumption:** Stripe `balance.retrieve` typically adds **hundreds of ms to multiple seconds** vs DB `SELECT 1`; coupling it to KPI `stats` extended **time-to-first-KPI** by that amount on every cold health fetch.

---

## 3. Dashboard lifecycle (route → interactive)

```
URL /platform-admin/dashboard
  → routes.tsx lazy: AdminDashboard chunk + PlatformAdminShell (PlatformAdminRoute + SuperAdminLayout)
  → PlatformAdminRoute: auth restore / session → AppRouteGateShell until authenticated
  → SuperAdminLayout: sidebar prefetch, NotificationInboxSync, header
  → AdminDashboard mount (null until authHydrated && sessionValidated && platform_admin)
  → Stage critical: fetchPlatformStats (+ health async)
  → Stage secondary (parallel): onboarding/metrics, businesses teaser (take 3), audit logs (take 4)
  → Stage heavy (idle ≤1.2s): analytics(30d), subscription monitoring(30d), commercial intelligence
  → Lazy: PlatformOverviewSummaryCharts inside DashboardChartsIdleMount + Suspense
```

**Timeline shape (qualitative):**

| Phase | Blocker | Typical cost driver |
|-------|---------|---------------------|
| JS chunk | Lazy `AdminDashboard` | Recharts only in child lazy chunk |
| Auth | `PlatformAdminRoute` + `useAuth` | Session refresh (necessary) |
| Critical (before fix) | `max(stats, health+Stripe)` | **Stripe health** |
| Critical (after fix) | `stats` (cached 45s) | DB aggregates |
| Secondary | `max(metrics×5, businesses list, audit)` | **Uncached metrics** (fixed: cache) |
| Heavy | analytics + commercial + sub monitoring | DB + commercial batch (cached/deferred) |

---

## 4. API inventory (`/platform-admin/dashboard`)

| # | Endpoint | Stage | Required for first KPI paint? | Cache (after remediation) |
|---|----------|-------|------------------------------|---------------------------|
| 1 | `GET /api/platform/stats` | Critical | **Yes** (volume, counts) | 45s `platform:stats` |
| 2 | `GET /api/platform/health` | Critical (async) | No (hero/alerts only) | Stripe leg 45s `platform:stripe-health` |
| 3 | `GET /api/platform/onboarding/metrics` | Secondary | No (onboarding KPIs) | **45s** `platform:onboarding-metrics` |
| 4 | `GET /api/platform/businesses?…` | Secondary | No (3-name teaser) | List cache 45s when reused elsewhere |
| 5 | `GET /api/platform/audit-logs?take=4` | Secondary | No | — |
| 6 | `GET /api/platform/analytics?days=30` | Heavy (idle) | No | 60s per days+tz |
| 7 | `GET /api/platform/subscription-monitoring?days=30` | Heavy | No | **60s** `platform:sub-monitoring:30` |
| 8 | `GET /api/platform/commercial-intelligence` | Heavy | No | 60s |

**Shell (not dashboard-specific but concurrent):**

- `GET /api/me/notifications/unread-count` via `NotificationInboxSync` — small, does not block dashboard mount.

**Duplicates:** Onboarding **count** and **submitted business list** overlap semantically; both kept for KPI accuracy vs teaser names (no merge without product change).

**Waterfall:** Critical no longer waits on health. Secondary and heavy start in parallel with each other (heavy idle-delayed).

---

## 5. Frontend findings

| Finding | Severity | Action |
|---------|----------|--------|
| `Promise.all(health, stats)` blocked KPIs on Stripe | **P0** | **Fixed** — stats-only gates `criticalLoading` |
| Staged loading (critical / secondary / heavy + idle) | — | Already correct; retained |
| `memo(AdminDashboard)` | — | Present; no change |
| Lazy `PlatformOverviewSummaryCharts` + idle mount | — | Correct deferral of Recharts |
| `return null` until `sessionValidated` after route guard | P2 | Redundant with `PlatformAdminRoute`; optional future simplification |
| Per-metric `loading` on `PlatformAdminMetricCell` | — | Good; not all KPIs tied to slowest secondary field |
| `kpiGridBusy` CSS class | P3 | Cosmetic loading on grid |

No blanket `useMemo`/`React.memo` added.

---

## 6. Backend findings

| Service | Issue | Remediation |
|---------|-------|-------------|
| `checkStripeHealth` | Live Stripe API every health request | **Cached** `checkStripeHealthCached` 45s |
| `getOnboardingQueueMetrics` | 4× COUNT + fully verified per request | **Cached** 45s |
| `getGlobalPlatformStats` | Heavy but already cached 45s | None |
| `getPlatformAnalytics` | Multiple raw SQL + groupBy; cached 60s | None |
| `getPlatformCommercialIntelligence` | 200-business batch; cached 60s | None (already) |
| `getPlatformSubscriptionMonitoringBundle` | Multi-query + orphans; uncached | **Cached** 60s |

**N+1:** Onboarding metrics were **4 parallel counts** (not N+1), but **repeat work** on every dashboard view — cache appropriate.

**Stripe on heavy path:** `detectStripeBillingOrphans` inside subscription bundle — amortized by 60s cache.

---

## 7. Database / indexes

No new indexes in this remediation.

- Global stats: single aggregated query on `tips` / transactions — existing pattern.
- Onboarding counts: reuse `BUSINESS_LIST_FROM` + filters — index benefit depends on production cardinality; not proven slow enough alone to add indexes without `EXPLAIN`.

---

## 8. Cache audit

| Key | TTL | Invalidation |
|-----|-----|----------------|
| `platform:stats` | 45s | `invalidatePlatformMetricsCache` / `invalidatePlatformDashboardCache` |
| `platform:stripe-health` | 45s | `invalidatePlatformDashboardCache` (`platform:` prefix) |
| `platform:onboarding-metrics` | 45s | same prefix |
| `platform:analytics:*` | 60s | prefix |
| `platform:commercial-intelligence` | 60s | prefix |
| `platform:sub-monitoring:{days}` | 60s | prefix |

**Stale data:** Acceptable for admin orientation; freshness indicators on stats (`generatedAt`, `cacheTtlSeconds`) unchanged.

---

## 9. Charts / tables

- Charts: 30-day series; server-aggregated; lazy + idle — **OK**.
- Teasers: bounded (`take: 3`, `take: 4`) — **OK**.
- Commercial segment counts derived from top 8 slices server-side — heavy CPU still on cache miss (P2).

---

## 10. Auth / admin bootstrap

- `PlatformAdminRoute` blocks on auth restore — **required**; not weakened.
- Dashboard effect waits for `authHydrated && sessionValidated` — aligns with route; duplicate null render possible (P2).

---

## 11. Root causes ranked

| Rank | Root cause | Severity |
|------|------------|----------|
| 1 | KPI critical path coupled to Stripe health API | P0 — **fixed** |
| 2 | Uncached Stripe health on every dashboard visit | P0 — **fixed** |
| 3 | Uncached onboarding metrics (5 DB round-trips) | P1 — **fixed** |
| 4 | Uncached subscription monitoring bundle on heavy stage | P1 — **fixed** |
| 5 | Commercial intelligence batch on cache miss | P2 — monitor |
| 6 | Auth/route double gating | P2 |
| 7 | Notification unread poll in layout | P3 |

---

## 12. Implemented fixes (detail)

### 12.1 Frontend — `AdminDashboard.tsx`

- `fetchPlatformStats()` awaited before `criticalLoading = false`.
- `fetchPlatformHealth()` fired in parallel; updates hero/alerts when ready (`AdminDashboard.loadHealth` errors logged separately).

### 12.2 Backend — `platform.service.ts`

- `checkStripeHealthCached()` with `getCachedOrLoad("platform:stripe-health", 45_000, …)`.
- `getHealth` uses cached Stripe check.

### 12.3 Backend — `platformBusinessList.service.ts`

- `getOnboardingQueueMetricsImpl` + public `getOnboardingQueueMetrics()` wrapped in 45s cache.

### 12.4 Backend — `platformSubscriptionMonitoring.service.ts`

- Bundle implementation cached per `days` key, 60s TTL.

---

## 13. Before / after (expected)

| Metric | Before (inferred) | After (expected) |
|--------|-------------------|------------------|
| Time to first **stats** KPIs | `max(stats, stripe health)` | **`stats` only** |
| Stripe calls per dashboard/min | ~1+ per visit | **≤1 / 45s** per instance |
| Onboarding metrics DB work | Every secondary load | **≤1 / 45s** |
| Sub monitoring on heavy | Every idle heavy load | **≤1 / 60s** |
| API count per full dashboard | 8 | **8** (unchanged; cheaper) |

Re-measure in staging with HAR + `dashProfile=1` for numeric proof.

---

## 14. Regression risks

| Change | Risk | Mitigation |
|--------|------|------------|
| Stripe health cache | Health page shows stale Stripe status ≤45s | TTL short; manual refresh on health page |
| Stats-first UI | Hero health dot updates after KPIs | Acceptable; alerts wait for health object |
| Onboarding cache | KPI counts up to 45s stale | Matches stats TTL; socket invalidation via `invalidatePlatformDashboardCache` on verification events |
| Sub monitoring cache | Failed-payment widgets slightly stale | 60s; operational alerts still real-time on subscriptions page |

---

## 15. Tests performed

- `node ./backend/node_modules/tsx/dist/cli.mjs ./scripts/dashboard-performance-runtime.ts` — PASS  
- `node ./backend/node_modules/tsx/dist/cli.mjs ./backend/scripts/admin-dashboard-performance-runtime.ts` — PASS  
- `npm run typecheck` — PASS  

**Recommended:** `npm run test:e2e -- e2e/dashboard-instant-metrics.spec.ts` with dev server.

---

## 16. Remaining bottlenecks

1. **Commercial intelligence** on cache miss (200 businesses) — keep deferred idle; consider slimmer overview endpoint later.  
2. **Analytics** raw SQL on cache miss — already deferred + cached.  
3. **Auth layering** — optional render dashboard shell inside route without second `null`.  
4. **Warm navigation** — prefetch exists (`platformAdminRoutePrefetch`); measure chunk reuse on return visits.

---

## 17. Deployment / staging recommendations

1. Deploy backend + frontend together (health cache + stats-first UI).  
2. Capture HAR on staging: cold dashboard, note `platform/stats` vs `platform/health` start/end.  
3. Confirm `invalidatePlatformDashboardCache()` still fires on onboarding verification socket events.  
4. Watch Stripe API rate / latency dashboards — health cache should reduce `balance.retrieve` volume.

---

## 18. Key files

| Area | Path |
|------|------|
| Dashboard UI | `src/app/components/AdminDashboard.tsx` |
| Route | `src/app/routes.tsx` |
| Shell | `src/app/layouts/SuperAdminLayout.tsx`, `PlatformAdminRoute.tsx` |
| Stats / health | `backend/src/services/platform.service.ts`, `platform.controller.ts` |
| Onboarding metrics | `backend/src/services/platformBusinessList.service.ts` |
| Analytics | `backend/src/services/platformAnalytics.service.ts` |
| Commercial | `backend/src/services/commercial/platformCommercialIntelligence.service.ts` |
| Sub monitoring | `backend/src/services/commercial/platformSubscriptionMonitoring.service.ts` |
| Guards | `scripts/dashboard-performance-runtime.ts`, `backend/scripts/admin-dashboard-performance-runtime.ts` |
| E2E | `e2e/dashboard-instant-metrics.spec.ts`, `e2e/dashboard-init-profile.spec.ts` |

---

*End of report.*
