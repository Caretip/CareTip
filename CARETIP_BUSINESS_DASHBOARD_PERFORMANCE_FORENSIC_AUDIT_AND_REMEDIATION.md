# CareTip Business Dashboard — Performance Forensic Audit & Remediation

**Date:** 2026-09-30  
**Final status:** **READY WITH MONITORING — OPTIMIZATIONS COMPLETE, PRODUCTION TIMING SHOULD BE MONITORED**

---

## 1. Executive summary

Forensic review of the business shell and **Business Overview** (`/dashboard`) identified a **confirmed P0 frontend/API waterfall**: Pro tenants loaded **`GET /api/business/me/stats?scope=full`** as a single blocking request before period KPIs could settle, even though the backend already supports **`aboveFold`** and **`analytics`** scopes (same progressive model as Analytics & Reports).

**Remediation:** `useBusinessDashboardStats` now fetches **`aboveFold` (or `summary` on Basic)** first, **commits KPIs to the UI**, then fetches **`scope=analytics`** for charts and employee goals. Hero financial metrics were already progressive (`ledger` + `connect` in parallel via `useBusinessFinancialSummary`).

No auth, Stripe calculation, or financial semantics were changed.

---

## 2. Pages audited (architecture map)

| Route | Page | Primary data hooks / APIs |
|-------|------|---------------------------|
| `/dashboard` | `BusinessDashboard.tsx` | `useBusinessDashboardStats`, `useBusinessFinancialSummary`, `RecentCustomerFeedbackPanel` |
| Analytics | `BusinessTipsAnalyticsPage` / reporting | `fetchBusinessAnalyticsBundle` (already progressive) |
| Tip history | Activity / transactions pages | Paginated tip APIs |
| Tip distribution | Distribution workspace | Distribution integrity APIs |
| Team | `BusinessTeamEmployeesPage` | Roster APIs |
| Customer feedback | `CustomerFeedbackPage` | `listBusinessCustomerFeedback` + analytics slice |
| Locations | `LocationsPage` | Location/table APIs |
| QR Studio | Lazy sub-routes | QR-specific chunks |
| Payout / Connect | Connect + payout history | `financial-summary` sections, payout list |
| Billing | `useBillingStatus` | Billing status (not on overview) |

**Shell:** `BusinessLayout` → `BusinessEntitlementsProvider` (single entitlement fetch) → outlet. Global loader via `useBusinessPageBoot` / `globalAppLoading` on cold entry only.

---

## 3. Baseline measurements (source-level / architecture)

*Exact browser RUM timings were not captured in this environment (no automated Lighthouse run against a live tenant). Measurements below are from code-path analysis and backend scope design.*

| Stage | What waits | Typical blocker |
|-------|------------|-----------------|
| HTML + JS | Auth shell, dashboard bundle | Vite chunks (Recharts lazy on charts route) |
| Auth | `useRequireAuth`, session validation | `/me` bootstrap (deduped client-side) |
| Overview hero | Financial KPIs | `financial-summary?section=ledger` + `section=connect` **in parallel** (already) |
| Overview period block | KPI row + charts | **Before fix:** one `scope=full` stats call |
| Feedback teaser | Summary + 5 items | Idle + in-view; `take: 5` |
| Stripe in hero | Connect slice | Stripe `balance.retrieve` inside connect section only |

**Backend scope intent** (`business.service.ts`):

- `aboveFold` — summary KPIs, prior period, employee tip rollups (skips chart buckets, rankings, goals).
- `analytics` — charts, goals, rankings, shift metrics.
- `full` — both (serialized heavy path).

With `DASHBOARD_TIMING=1`, server logs `[dashboard.timing] business.myStats.{tf}.aboveFold` vs full/analytics phases.

---

## 4. Critical-path analysis (Overview)

```
Auth ready
  ├─ useBusinessFinancialSummary (parallel ledger + connect)     → hero money
  └─ useBusinessDashboardStats
        BEFORE: await stats(scope=full) → KPIs + charts together
        AFTER:  await stats(scope=aboveFold) → commit KPIs
                  await stats(scope=analytics) → charts/goals
        RecentCustomerFeedbackPanel (idle, in-view, take=5)
```

**Independent and already parallel:** hero financial summary vs period stats (separate hooks).

**Not duplicated:** entitlements via `BusinessEntitlementsProvider`; feedback panel reuses context (`test:dashboard-performance`).

---

## 5. Frontend findings

| ID | Severity | Finding |
|----|----------|---------|
| F1 | **P0** | Overview used `scope=full` for Pro users — KPIs blocked on deferred analytics SQL |
| F2 | P2 | `overflow-x-hidden` removed on overview in UI pass (layout, not perf) |
| F3 | P3 | Chart bundle still lazy via `BusinessDashboardAnalyticsCharts` + `DashboardChartsIdleMount` (appropriate) |

---

## 6. React rendering

- Overview uses `memo` on dashboard root; period toggle preserves scroll via `runWithViewportScrollPreserved`.
- No change required: context updates are scoped; split stats reduce time spent in “full skeleton” state (fewer perceived full-page waits).

---

## 7. API waterfall findings

**Before (Pro, cold period):**

1. `GET /api/business/me/stats?timeframe=week&scope=full` — **blocks KPIs and charts**
2. `GET /api/me/connect/financial-summary` (ledger + connect) — parallel to stats
3. Feedback list when panel visible — deferred

**After (Pro):**

1. `GET ...&scope=aboveFold` — **KPIs commit after this**
2. `GET ...&scope=analytics` — charts/goals
3. Financial summary unchanged (parallel ledger/connect)
4. Feedback unchanged

**Basic tier:** still `scope=summary` (single lighter call).

Client dedup: `businessStatsInflight` + result TTL in `getBusinessStats`.

---

## 8. Backend findings

- Scoped stats endpoints are implemented and cached per `(businessId, timeframe, scope)`.
- `loadBusinessFinancialSummaryForBusiness` already parallelizes ledger vs connect; Stripe balance only on connect slice.
- No backend code changes in this remediation (frontend was not using scopes correctly).

---

## 9. Database findings

- No new indexes added (no slow-query evidence in this pass).
- Existing index checks remain in `test:dashboard-performance` (e.g. `venue_tables.location_id`).

---

## 10. Stripe findings

- Hero does **not** block on full financial-summary monolith; connect slice includes balance retrieve.
- Caching TTL on financial data unchanged; progressive loading preserved.

---

## 11. Asset / image findings

- Hero Bizzy image: `priority`, `loading="eager"`, AVIF/WebP — appropriate for LCP.
- No change in this pass.

---

## 12. Route / chunk findings

- `BusinessDashboardAnalyticsCharts` lazy-loaded; Recharts not on initial dashboard JS parse path for chart module.
- No chunk split changes in this pass.

---

## 13. Authentication findings

- No changes. Sequential gating on `sessionValidated` + `enabled` retained for tenant safety.

---

## 14. Caching findings

- SWR store + `getBusinessAnalyticsBundle` + `businessStatsResultCache` remain authoritative.
- Split fetch updates `upsertBusinessAnalyticsStatsBundle` after each phase.

---

## 15. Root causes

1. **Primary:** Dashboard hook consolidated on `scope=full` (Sprint 8.1 comment) despite backend and Analytics page supporting split scopes — **unnecessary coupling of KPIs to chart/goals query cost**.

---

## 16. P0 / P1 / P2 summary

| Priority | Item | Action |
|----------|------|--------|
| **P0** | Full stats blocking KPIs | **Fixed** — aboveFold → commit → analytics |
| P1 | — | No additional P1 code changes identified with evidence |
| P2 | Monitor full-scope callers elsewhere | Grep shows Analytics bundle already split |

---

## 17. Changes implemented

| File | Change |
|------|--------|
| `src/app/hooks/useBusinessDashboardStats.ts` | Two-phase stats fetch; early `commitUiStats` after aboveFold; month hero prefetch uses `aboveFold` |
| `scripts/business-dashboard-period-sync-runtime.ts` | Regression asserts split scopes |
| `scripts/dashboard-performance-runtime.ts` | Regression asserts no `scope=full` on overview hook |

---

## 18. Before / after (critical path)

| Operation | BEFORE | AFTER |
|-----------|--------|-------|
| Period KPI network | Waits for `scope=full` (aboveFold + analytics SQL) | Waits for `aboveFold` only |
| Period KPI UI commit | After full response | **Immediately after aboveFold** |
| Charts / goals | Same response as KPIs | Second request `scope=analytics` |
| Basic plan | `scope=summary` | Unchanged |
| Hero financial | Progressive ledger + connect | Unchanged |

*Duration improvement is tenant/data dependent; expect largest win on businesses with heavy chart/goals SQL. Enable `DASHBOARD_TIMING=1` on staging to compare `aboveFold` vs `analytics` ms logs.*

---

## 19. Tests

- `npm run typecheck` — pass  
- `npm run test:business-dashboard-period-sync` — pass  
- `npm run test:dashboard-performance` — pass  

---

## 20. Build result

`npm run build` completed successfully in verification (~10m wall time including prebuild/SEO prerender; exit code 0).

---

## 21. Remaining limitations

- No browser RUM before/after numbers in CI.
- Other business routes not re-profiled end-to-end in browser automation this pass.
- If `scope=analytics` is still slow, next step is SQL/explain on staging with `DASHBOARD_TIMING=1`, not further frontend guessing.

---

## 22. Final status

**READY WITH MONITORING — OPTIMIZATIONS COMPLETE, PRODUCTION TIMING SHOULD BE MONITORED**

Monitor staging/production:

- Time from navigation to period KPI visible (should drop vs full-scope baseline).
- Two stats requests per cold period (aboveFold + analytics) — expected and correct.
- No increase in 401/auth or stats errors.
