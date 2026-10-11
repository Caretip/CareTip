# CARETIP — Request Coalescing + Cache Lock Performance Report

## 1. Executive summary

CareTip already had **substantial** request coalescing and cache-stampede protection on the business dashboard and analytics stack. This audit traced those paths end-to-end and added **two narrow frontend gaps**: concurrent **business analytics bundle** orchestration and identical **customer feedback list** queries. No backend financial logic, TTL policy, or API contracts were changed.

**Status:** `READY — REQUEST COALESCING/CACHE LOCK OPTIMIZATION COMPLETE`

## 2. Existing request architecture

| Layer | Mechanism | Scope |
|-------|-----------|--------|
| Frontend `getBusinessStats` | `businessStatsInflight` + 45s result cache | `me:{scope}:{timeframe}` (JWT-scoped endpoint) |
| Frontend `getBusinessFinancialSummary` | `businessFinancialSummaryInflight` | period + section |
| Frontend employee/platform APIs | per-endpoint inflight maps | session-scoped keys |
| `useBusinessDashboardStats` | `statsLoadInflightByTfRef` per timeframe | joins duplicate hook loads |
| `businessAnalyticsService` | in-memory bundle store | per timeframe |
| Backend `shortLivedCache.getCachedOrLoad` | TTL + **in-flight map** | per cache key |
| Backend `runSerializedByKey` | FIFO single-flight queue | e.g. `biz-stats-aboveFold:{businessId}:{timeframe}` |
| Backend `business.service.getBusinessStats` | **Both** serialized key + `getCachedOrLoad` | tenant = `businessId` in every key |

Progressive loading (aboveFold → analytics) and hero-first dashboard behavior are unchanged.

## 3. Duplicate request findings

| Flow | Duplicate risk | Verdict |
|------|----------------|---------|
| Dashboard + Analytics both need `GET /me/stats` same scope/tf | Concurrent mounts | **Already coalesced** in `api.ts` |
| Analytics bundle (tips feed + QR + stats orchestration) | StrictMode / double effect | **Was duplicated** for tips/QR; stats already shared |
| Customer feedback teaser | StrictMode / remount same `take/skip` | **Was duplicated** (no inflight) |
| Overview dashboard stats hook | Period switch / remount | **Already joined** via `statsLoadInflightByTfRef` |
| Stripe financial summary (split ledger/connect) | Parallel sections | **Already coalesced** per section key |
| `listBusinessTips` | Bundle coalescing | Low frequency; left unchanged (no proven duplicate storm) |
| Period week vs month | Different query params | **Must not** coalesce (by design) |

Customer feedback **no longer** uses viewport gating (`useInViewActive` removed in prior remediation); fetch starts on idle after entitlements — not a duplicate-request issue.

## 4. Existing caching architecture

- **Business stats:** `BUSINESS_STATS_CACHE_TTL_MS` via `getCachedOrLoad`, keys include `businessId` and timeframe/scope.
- **Platform admin:** 45s TTL on stats/businesses lists.
- **Employee dashboard:** period caches + `runSerializedByKey` on full stats path.
- **Invalidation:** `invalidateBusinessStatsCache(businessId)` clears prefix keys on tip mutations.
- **Financial summary:** live-first on client (inflight only, no long TTL on hero balances).

## 5. Cache-stampede findings

On TTL expiry, concurrent requests to `getCachedOrLoad` **share one loader** (`inflight` map in `shortLivedCache.ts`). Business stats add `runSerializedByKey` so even cache-miss paths do not fan out unbounded SQL on one process.

**Multi-instance:** locks are **per Node process** (documented). No Redis lock added — no measured cross-instance stampede on stats TTL (short TTL + invalidation on writes).

## 6. Request-coalescing candidates (implemented)

1. **`fetchBusinessAnalyticsBundle`** — `getOrCreateInFlightRequest` + `businessAnalyticsBundleInflightKey` (timeframe + slice flags + revalidate).
2. **`listBusinessCustomerFeedback`** — `businessCustomerFeedbackInflight` keyed by query string (`me:feedback:…`).

## 7. Cache-lock candidates (not added)

Backend cache lock already exists. **Not implemented:** Redis distributed lock, global GET coalescing, feedback backend TTL cache, `listBusinessTips` coalescing.

## 8. What was implemented

- `src/app/lib/getOrCreateInFlightRequest.ts` — reusable coalescing helper.
- `loadBusinessAnalyticsBundleNetwork` wrapped by coalescing in `businessAnalyticsService.ts`.
- `listBusinessCustomerFeedback` inflight dedupe in `api.ts`.
- `clearInFlightRequest()` on logout via `resetAllClientSessionCaches.ts`.
- Tests: `getOrCreateInFlightRequest.runtime.ts`, `short-lived-cache-coalescing-runtime.ts`, `request-coalescing-cache-lock-runtime.ts`.

## 9. What was deliberately NOT implemented

- Global fetch interceptor / coalesce-all-GETs
- Redis or new dependencies
- Backend caching for feedback lists
- Coalescing across different `take`/`skip` or periods
- Changes to Stripe balance freshness or stats SQL
- Coalescing `getMyConnectPayoutSummary` (single caller, live reads)

## 10. Before/after measurements

| Scenario | Before | After |
|----------|--------|-------|
| 3× concurrent `getCachedOrLoad` miss (backend test) | 1 loader run | 1 loader run (verified) |
| 2× concurrent `getOrCreateInFlightRequest` same key | 1 factory run | 1 factory run (verified) |
| 2× concurrent analytics bundle fetch (same opts) | 2× tips/QR orchestration | 1 shared bundle load |
| 2× concurrent feedback list (same params) | 2 HTTP requests | 1 HTTP request |
| Dashboard `getBusinessStats` same scope/tf | Already 1 HTTP | Unchanged |

No regression to hero paint order or analytics progressive slices.

## 11. Tenant/security verification

- Client keys use `me:` prefix — endpoint resolves business from JWT, not client-supplied business id.
- Backend keys always include `businessId` from authenticated context.
- Coalescing keys include timeframe/scope/options — **no cross-period sharing**.
- Logout clears in-flight map to avoid cross-session promise joins.

## 12. Financial-data freshness verification

- No new TTL on financial summary or Stripe reads.
- Business stats TTL and invalidation unchanged.
- Revalidate flag bypasses client stats cache and uses distinct bundle inflight key (`revalidate=1`).

## 13. Tests

```bash
npm run test:request-coalescing-cache-lock
npm run test:dashboard-performance
npm run test:business-dashboard-period-sync
npm run typecheck
```

## 14. Build/typecheck results

Run locally after pull; suite added in this change.

## 15. Files changed

- `src/app/lib/getOrCreateInFlightRequest.ts` (new)
- `src/app/lib/getOrCreateInFlightRequest.runtime.ts` (new)
- `src/app/lib/businessAnalytics/businessAnalyticsService.ts`
- `src/app/lib/api.ts`
- `src/app/lib/resetAllClientSessionCaches.ts`
- `backend/scripts/short-lived-cache-coalescing-runtime.ts` (new)
- `scripts/request-coalescing-cache-lock-runtime.ts` (new)
- `package.json`

## 16. Remaining performance opportunities

- Optional inflight dedupe for `listBusinessTips` if analytics feed duplication is observed in production traces.
- Cross-instance cache stampede only if multiple API replicas show synchronized TTL expiry on hot businesses (would need shared store, not in-process lock).
- DASHBOARD_TIMING=1 field timings for before/after in staging.
