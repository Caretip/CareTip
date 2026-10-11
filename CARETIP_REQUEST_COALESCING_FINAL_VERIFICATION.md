# CARETIP — Request Coalescing Final Verification

**Date:** 2026-10-01  
**Scope:** Verification only (no architectural changes unless regression).  
**Final status:** `READY — FINAL REQUEST COALESCING VERIFICATION PASSED`

---

## 1. Production build

| Step | Result |
|------|--------|
| `npm run build` | **PASS** (exit code 0) |
| Vite production bundle | ✓ built in **2m 56s** (5996 modules) |
| PWA / workbox | ✓ generated |
| SEO prerender | ✓ 18 public HTML documents under `dist/` |

Warnings only: existing dynamic-import chunk notices (unchanged).

---

## 2. Automated tests

| Command | Result |
|---------|--------|
| `npm run typecheck` | **PASS** |
| `npm run test:request-coalescing-cache-lock` | **PASS** (11 static + 2 behavioral suites) |
| `npm run test:dashboard-performance` | **PASS** |
| `npm run test:business-dashboard-period-sync` | **PASS** |
| `npm run test:business-dashboard-hero-feedback` | **PASS** |
| `npm run test:business-analytics-integrity` | **PASS** (87 checks) |
| `npm run test:business-analytics-performance-browser` | **PASS** (10/10 scenarios) |

**Note:** Playwright Chromium was installed locally for the browser suite (`npx playwright install chromium`). First run in CI/agents without browsers may need the same step.

---

## 3. Browser verification (Playwright + live stack)

**Environment:** `http://localhost:5173` (Vite) + backend API (already running).  
**Credentials:** default forensic demo user from script env.

### Business Analytics (instrumented)

| Scenario | Observation |
|----------|-------------|
| Cold load (`/dashboard/tips/analytics`) | Overview authoritative € at ~23s; **summary.ready (~23s) before deferred.ready (~41s)** — progressive loading intact |
| Hard refresh | Overview authoritative at ~15s; same summary-before-deferred ordering |
| Dashboard → Analytics navigation | **PASS** |
| Financial parallel | Stats and financial-summary requests start within **~4ms** (client marks) |
| Ledger vs reconciliation | Ledger authoritative before reconciliation completes — **PASS** |

### Business Dashboard (via navigation scenario)

| Scenario | Observation |
|----------|-------------|
| Warm navigation from dashboard to analytics | **PASS** (no stuck loading in scenario B) |
| Hard refresh on analytics | Data repaints with authoritative € values |

### Customer Feedback (static + architecture)

| Check | Result |
|-------|--------|
| No viewport gating on overview teaser | **PASS** (`test:dashboard-performance`, hero-feedback) |
| In-flight dedupe for identical list query | **PASS** (`businessCustomerFeedbackInflight` + runtime suite) |
| Page uses separate `take` (analytics page) vs teaser `take=5` | **Independent keys** — intentional separate requests |

Manual spot-check on running dev: overview feedback section shows skeleton then content without requiring scroll (per prior remediation; not re-broken in this pass).

---

## 4. Request-count observations

### Behavioral (deterministic)

| Test | Before coalescing pattern | After (expected) | Measured |
|------|---------------------------|------------------|----------|
| 3× concurrent `getCachedOrLoad` miss (backend) | 3 loaders | 1 loader | **loads=1** |
| 2× concurrent `getOrCreateInFlightRequest` same key | 2 factories | 1 factory | **runs=1** |
| Different coalescing keys (`tenant:A` vs `tenant:B`) | — | 2 factories | **runsTenant=2** |

### Browser (analytics cold load — classified API traffic)

Playwright classifies `statsAboveFold`, `statsDeferred`, `statsSummary`, tips feed, QR, financial slices. Observed **lifecycle ordering**, not duplicate storms:

- **One** above-fold stats wave before deferred analytics completes (marks: `analytics.summary.ready` then `analytics.deferred.request` / `analytics.deferred.ready`).
- Tips feed / QR complete with deferred slice (~same timestamp as `analytics.stats.ready` in cold run) — consistent with single bundle orchestration + shared stats HTTP coalescing in `api.ts`.

No evidence in failing assertions of duplicate concurrent `statsAboveFold` for the same timeframe during a single navigation.

### Feedback

Identical concurrent calls coalesce at HTTP client layer; dashboard teaser (`take=5`) and full feedback page (`ANALYTICS_TAKE`) remain **distinct keys** by design (pagination/filter independence preserved).

---

## 5. Key independence (confirmed)

| Dimension | Mechanism | Verified by |
|-----------|-----------|-------------|
| week ≠ month | Separate `businessStatsClientCacheKey` / backend `business-stats-*:{businessId}:{timeframe}` | integrity runtime + API key shape |
| Business A ≠ B | JWT-scoped `me:` keys; backend `businessId` in all cache keys | integrity + service code |
| take/skip A ≠ B | `businessCustomerFeedbackInflightKey` includes query string | static test in coalescing runtime |
| revalidate ≠ cached | Bundle inflight key includes `revalidate`; `getBusinessStats` deletes inflight on revalidate | `businessAnalyticsService` + `api.ts` |
| Period stale overwrite | `useBusinessAnalytics` generation / `stillCurrent()` guards | integrity runtime (87 checks) |

---

## 6. Regression checklist

| Criterion | Status |
|-----------|--------|
| No duplicate identical concurrent analytics bundle orchestration | **OK** (coalescing + passing tests) |
| No duplicate identical feedback list requests | **OK** (inflight map) |
| Stale period cannot replace newer selection | **OK** (existing gen guards; integrity tests) |
| Loading not stuck | **OK** (browser scenarios) |
| No blank dashboard hero | **OK** (hero-feedback tests; browser € authoritative) |
| Hero-first / progressive analytics | **OK** (summary before deferred in browser marks) |
| Customer feedback rendering | **OK** (no viewport gate; skeleton while loading) |
| No cross-session sharing | **OK** (`clearInFlightRequest` on logout) |
| Logout clears request state | **OK** (resetAllClientSessionCaches) |

---

## 7. Regressions found

**None.** No code changes during this verification pass.

---

## 8. Fixes made during verification

**None** (verification-only pass).

---

## 9. Final status

```
READY — FINAL REQUEST COALESCING VERIFICATION PASSED
```
