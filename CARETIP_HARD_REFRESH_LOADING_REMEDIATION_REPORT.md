# CareTip — Hard Refresh Infinite Loading Remediation Report

**Date:** 2026-10-03  
**Forensic source:** `CARETIP_HARD_REFRESH_LOADING_FORENSIC_REPORT.md`  
**Severity addressed:** P0 — optional page data could hold the fullscreen branded loader indefinitely

---

## 1. Root cause confirmed

On authenticated dashboard **cold load** (hard refresh / new tab), `useBusinessPageBoot` registered a global overlay key via `useExtendGlobalLoaderUntilReady` (e.g. `business-billing-subscription-boot`) while `isInitialLoad` was true. Billing set `isInitialLoad` from `useBillingStatus` (`loading && !data`), which fired `GET /api/me/billing` on mount **without** gating on protected API readiness and **without** a request bound.

If that request hung or never settled, the global CareTip overlay (“Ihr Arbeitsbereich wird vorbereitet…”) could remain the winning registration until the fetch completed — **incorrect**: optional billing data is not application readiness.

Marketing navigation, `SoftSpaRouteHold`, and landing performance work were **not** modified and were **not** the cause (per forensic audit).

---

## 2. Files changed

| File | Change |
|------|--------|
| `src/app/lib/useBusinessPageBoot.ts` | Removed `useExtendGlobalLoaderUntilReady`; retained `useRegisterPagePaintReady` only. `coveredByGlobalLoader` deprecated (always `false`). |
| `src/app/hooks/useBillingStatus.ts` | Gate initial fetch on `isProtectedApiReady()` via `subscribeAuthSessionFlags`; `AbortController` + `BILLING_STATUS_REQUEST_TIMEOUT_MS` (30s); cleanup on unmount. |
| `src/app/lib/api.ts` | `fetchBillingStatus(opts?: { signal?: AbortSignal })`. |
| `src/app/components/business/settings/BusinessSettingsBillingPanel.tsx` | Page-level spinner for initial load; removed `GlobalAppLoadingHold` / global boot coupling. |
| `src/app/pages/business/BusinessProfilePage.tsx` | Inline profile loading UI; no global hold for profile boot. |
| `scripts/hard-refresh-loader-runtime.ts` | Static regression assertions for the above. |
| `package.json` | `test:hard-refresh-loader` script. |

**Preserved (unchanged in this pass):** `AppLoadingManager`, `AuthBootstrapLoadingRegistrar`, `SoftSpaRouteHold`, `useExtendGlobalLoaderUntilReady.ts` (still used by employee dashboard with `blocking: false`), Stripe/payouts, auth security model, LoaderDiag.

---

## 3. Global loader ownership (before / after)

**BEFORE:** Optional first-paint page APIs (billing, profile, tips, etc.) could register `business-*-boot` at `APP_LOADING_PRIORITY.ROUTE_GUARD` and **extend** the fullscreen branded overlay until those requests finished.

**AFTER:** Global overlay release is driven by **application readiness** (boot, auth bootstrap, route/shell paint latches, dashboard layout readiness) — not optional page fetches. Business pages use:

- `useRegisterPagePaintReady(\`business-${pageKey}-paint\`)` for cold handoff coordination only.
- `showInitialSkeleton` → existing skeletons / inline spinners / `BusinessSubPageShellSkeleton` patterns.

**Invariant:** Optional billing data **cannot** permanently block the application shell.

---

## 4. Billing loading behavior

Sequence on hard refresh to `/dashboard/billing/subscription`:

1. Auth/session restoration (`app-auth-bootstrap` — bounded per existing design).
2. Dashboard shell paints (`BusinessLayout`, `data-caretip-dashboard-ready`).
3. Global branded loader releases when winning registrations clear (no `business-billing-subscription-boot`).
4. `BusinessSettingsBillingPanel` shows inline `Loader2` spinner while `isInitialBillingLoad && showInitialSkeleton`.
5. When `/api/me/billing` resolves → billing content; on error → alert + retry; on timeout/abort → `loading: false` + error state.

No second fullscreen branded loader for billing. No blank unusable billing chrome (shell + skeleton visible during fetch).

---

## 5. Protected API readiness

`useBillingStatus` subscribes to auth session flags and only calls `reload()` when `apiReady === true` (`isProtectedApiReady()`). While API is not ready, hook keeps `loading: true` **locally** without issuing `/api/me/billing` (avoids early 401/retry storms during session restore). `reload()` also guards with `isProtectedApiReady()` for manual/checkout-sync paths.

No deadlock: billing does not participate in auth bootstrap completion.

---

## 6. Request timeout / error behavior

- **Mechanism:** `AbortController` + `window.setTimeout` at `BILLING_STATUS_REQUEST_TIMEOUT_MS` (30_000), passed to `fetchBillingStatus({ signal })` → `apiRequest` fetch `signal`.
- **Finally:** Clears timeout; sets `loading: false` when the active controller completes (success, HTTP error, network failure, timeout abort).
- **Unmount:** Aborts in-flight request.
- **Not used:** Global `setTimeout(() => hideLoader(), N)` — architectural decoupling is the primary fix.

---

## 7. `useBusinessPageBoot` callers audited

All callers now get skeleton-only boot (no global `business-*-boot`):

| Caller | Page key | Notes |
|--------|----------|--------|
| `BusinessSettingsBillingPanel` | `billing-subscription` | P0 path; inline loading |
| `BusinessBillingSubPages` | `billing-history` | Skeleton |
| `BusinessDashboard` | `overview` (`false`) | `coveredByGlobalLoader` always false → goals skeleton logic unchanged |
| `BusinessProfilePage` | `profile` | Inline loading |
| `StaffManagementPage` | `staff` | Skeleton |
| `TablesPage` | `tables` | Skeleton |
| `QRCodeManagementPage` | `qr` | Skeleton |
| `LocationsPage` | `locations` | Skeleton |
| `CustomerFeedbackPage` | `feedback` | Skeleton |
| `BusinessStripePages` | `stripe-connect`, `stripe-payouts` (`false`) | Skeleton flags only |
| `BusinessActivityCenterPage` | `tips-live` | Skeleton |
| `BusinessTipsAnalyticsPage` | (tips analytics key) | Skeleton |
| `TipsActivityPage` | (shared tips) | Skeleton |
| `BusinessTeamPerformancePage` | team performance | Skeleton |
| `BusinessCustomersReviewsPage` | `customers-reviews` | Skeleton |
| `BusinessSupportPage` | `support` | Skeleton |

**`useExtendGlobalLoaderUntilReady`:** Only `EmployeeDashboard` — `blocking: false` (does not register hold). Documented in `ux-stability-remediation-runtime.ts`.

---

## 8. Regression tests

| Test | Result |
|------|--------|
| `npm run test:hard-refresh-loader` | **ok** |
| `npm run test:app-performance-architecture` | **ok** |
| `npm run test:ux-stability-remediation` | **ok** |
| `npx tsc --noEmit` | **exit 0** |

`scripts/hard-refresh-loader-runtime.ts` asserts:

- `useBusinessPageBoot` does not import/use `useExtendGlobalLoaderUntilReady`
- `useBillingStatus` gates on protected API + timeout constant
- `fetchBillingStatus` accepts `AbortSignal`
- Billing panel does not use `GlobalAppLoadingHold`

**Recommended manual / Playwright follow-up:** Mock delayed or hanging `GET /api/me/billing` in preview and confirm LoaderDiag shows overlay released while billing skeleton remains (no dedicated Playwright spec added in this pass).

---

## 9. Hard-refresh matrix (validation)

Automated static tests cover architecture; **manual production-equivalent** verification is recommended:

| Route | Ctrl/Cmd+R, deep link, new tab |
|-------|--------------------------------|
| `/dashboard` | Shell visible; no infinite branded loader |
| `/dashboard/billing/subscription` | Shell → billing skeleton → content/error |
| `/dashboard/billing/*` (payouts, history) | Same class |
| `/dashboard/settings` | Shell + page skeleton |
| `/dashboard/employees`, `/dashboard/team/performance`, `/dashboard/analytics` | Same |

**Failure mode test:** Throttle or stall `/api/me/billing` — expect global overlay gone within auth/shell bounds; billing stays in loading then error/timeout state.

---

## 10. SPA navigation results

Soft navigation after `markAppShellInteractive()` was already suppressed for extend-loader latching (`isAppShellInteractive()` in `useExtendGlobalLoaderUntilReady`). Removing business boot registration does not reintroduce fullscreen loader on in-app billing navigation; billing uses panel-level spinner only on first load without data.

---

## 11. Performance comparison

| Metric | Before | After (expected) |
|--------|--------|------------------|
| Time until fullscreen loader dismisses on billing cold refresh | Could track billing API (unbounded) | Tracks auth + shell paint only |
| Billing API slow | Fullscreen blocker | Dashboard shell + inline skeleton |
| Billing API hung | Potential **infinite** global loader | Global loader releases; billing `loading` → false at 30s max |

No intentional regression to marketing cold paths or auth bootstrap (~12s degraded bound unchanged).

---

## 12. Remaining risks

| Risk | Severity | Notes |
|------|----------|--------|
| `app-auth-bootstrap` long transient refresh | Low | Bounded; separate from P0 billing boot |
| `onboarding_status_unconfirmed` route guard | Medium | Not redesigned; if guard pending forever, document as separate issue |
| Other hooks firing protected APIs without readiness gate | Low | Out of scope; billing was the reported hang |
| No browser e2e for hung billing | Low | Static runtime test + manual matrix recommended |

---

## Summary statement

**BEFORE:** Optional billing (and other `business-*-boot` page data) could hold the fullscreen global loader until `/api/me/billing` (and similar) completed, including indefinitely if the request hung.

**AFTER:** Optional billing data uses page-level loading/error UI and **cannot** register a global overlay winner; billing fetch is gated on protected API readiness and bounded to 30 seconds.

---

## Final status

**READY** — P0 architectural fix implemented; `test:hard-refresh-loader`, app-performance, ux-stability, `tsc`, and `vite build` pass. Full `npm run build` (includes SEO prerender) should be run before release; spot-check hard refresh on preview (`vite preview`) for `/dashboard/billing/subscription`.
