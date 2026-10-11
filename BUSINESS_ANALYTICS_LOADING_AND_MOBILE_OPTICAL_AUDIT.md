# Business Analytics Loading + Mobile Optical + Hero Button Alignment — Audit Report

**Date:** 2026-09-24  
**Scope:** Business Analytics “Updating…” lifecycle, mobile analytics layout, Business Dashboard mobile hero buttons

---

## 1. Root cause — stuck “Updating…”

**Symptom:** Primary analytics (overview, tip volume, tips count, active employees) rendered while `DashboardRefreshIndicator` continued showing **“Updating…”**.

**Source chain:**

```
BusinessTipsAnalyticsPage
  → useBusinessIntelligenceData / useBusinessAnalytics
  → isAnalyticsRefreshing
  → BusinessAnalyticsReporting (cardsRefreshing)
  → DashboardRefreshIndicator
```

**Bug:** `deriveAnalyticsLoadingLifecycle()` treated **any** in-flight bundle fetch (`loading || timeframeLoading`) as a global refresh while visible data existed. Progressive hydration keeps `timeframeLoading === true` until **deferred** slices finish (QR analytics, tips feed, rankings, deferred stats) — even after above-fold period stats are committed and painted.

So deferred/optional modules kept the global status active after primary analytics were usable.

---

## 2. Component / hook responsible

| Layer | File |
|-------|------|
| Visible text | `src/app/components/dashboard/DashboardRefreshIndicator.tsx` |
| `isRefreshing` prop | `src/app/components/business/BusinessAnalyticsReporting.tsx` (`cardsRefreshing = data.isAnalyticsRefreshing`) |
| State derivation | `src/app/hooks/useBusinessAnalytics.ts` |
| Lifecycle logic | `src/app/lib/analyticsLoadingLifecycle.ts` |

---

## 3. Why the state failed to clear

Old logic (simplified):

```ts
isAnalyticsRefreshing =
  hasVisible && (isColdLoading || isTimeframeLoading || periodSwitchInFlight);
```

`timeframeLoading` remained `true` until `fetchBusinessAnalyticsBundle()` awaited **all** parallel tasks (`Promise.all`), including deferred QR/tips/rankings — not just above-fold stats.

---

## 4. Exact fix

Updated `deriveAnalyticsLoadingLifecycle()` to require **primary period stats** readiness via existing `derivePeriodScopedSectionLoading()`:

```ts
isAnalyticsRefreshing =
  hasVisible &&
  derivePeriodScopedSectionLoading({
    valuesMatchPeriod,
    sliceReady: periodStatsReady,
    fetchInFlight: bundleFetchInFlight,
  });
```

`useBusinessAnalytics` now passes `periodStatsReady` into the lifecycle helper.

**Result:** Global “Updating…” clears when above-fold stats for the selected period are committed. Deferred sections keep their own skeletons (`isDeferredAnalyticsLoading`, `isQrLoading`, `isTipsFeedLoading`).

**No timeout hacks.** `DashboardRefreshIndicator` still uses its existing 400ms minimum visible duration only when `isRefreshing` transitions false → that is anti-flicker, not fake completion.

---

## 5. No timeout-based fake completion

Confirmed: no `setTimeout` was added to force-clear updating state. Only the existing `DashboardRefreshIndicator` debounce remains (unchanged).

---

## 6. Mobile analytics layout issues identified

| Issue | Detail |
|-------|--------|
| Toolbar hierarchy | Refresh indicator competed with period toggle + export on one row |
| Live status prominence | Status strip on its own row below controls |
| Overview metrics | Single-column stack on mobile made three KPIs feel disconnected |
| Page top spacing | `pt-6` on analytics page felt heavy on narrow viewports |
| Section rhythm | Uniform `space-y-6` without mobile-specific grouping |

---

## 7. Optical-balance changes made

**`BusinessAnalyticsReporting.tsx`**

- Added `business-analytics-report` wrapper classes
- Toolbar: status row (refresh + Live strip), then full-width period toggle + export
- Overview card: `business-analytics-report__overview`

**`caretip-dashboard-mobile.css` (≤767px)**

- Full-width period toggle
- Overview metrics: 3-column grid with aligned value sizing
- Compact metric label/value typography
- Section `min-width: 0` guards

**`BusinessTipsAnalyticsPage.tsx`**

- Mobile-friendly top spacing: `pt-4 sm:pt-6`

---

## 8. Business hero button alignment issue

**Symptom:** Analytics & Reports / Tips History appeared left-shifted on mobile hero.

**Cause:** Conflicting mobile rules in `globals.css` (≤768px) set business hero CTA children to `flex: 0 1 auto` and `justify-content: flex-start`, while `business-dashboard-hierarchy.css` intended equal 50/50 columns via `flex: 1 1 calc(50% - 0.25rem)`.

Employee hero used `flex: 1 1 0%` + full row width; business did not.

---

## 9. Business hero button alignment fix

**`globals.css` (≤768px):** Unified business + employee mobile hero CTA rows:

- `width: 100%`, `flex-wrap: nowrap`, `justify-content: stretch`
- Children: `flex: 1 1 0%` for balanced equal columns

Primary/secondary button variants preserved via existing `businessUi.btnPrimary` / `btnSecondary`.

---

## 10. Financial / API logic untouched

No changes to:

- Stripe, payout, transfer, or distribution calculations
- Analytics formulas or period boundaries
- Backend services or API contracts
- Progressive fetch architecture (above-fold → deferred)

---

## 11. Responsive validation

Manual review targets: 320–430px (mobile), 768–1024px (tablet), 1280px+ (desktop).

Structural checks:

- Mobile toolbar stacks without horizontal overflow
- Overview 3-up grid on mobile analytics
- Hero CTA row spans full content width with equal columns
- Desktop hero/analytics layouts unchanged in structure

---

## 12. Tests / typecheck / build

| Check | Result |
|-------|--------|
| `src/app/lib/analyticsLoadingLifecycle.runtime.ts` | **PASS** |
| `npm run test:business-analytics-integrity` | **PASS** (87 checks) |
| `npm run typecheck` | **PASS** |
| `npm run build` | Not run (typecheck + integrity sufficient for this scope) |

---

## Files changed

| File | Change |
|------|--------|
| `src/app/lib/analyticsLoadingLifecycle.ts` | Primary-stats-only refresh semantics |
| `src/app/hooks/useBusinessAnalytics.ts` | Pass `periodStatsReady` |
| `src/app/lib/analyticsLoadingLifecycle.runtime.ts` | **New** lifecycle tests |
| `src/app/components/business/BusinessAnalyticsReporting.tsx` | Mobile toolbar + overview class |
| `src/app/pages/business/tips/BusinessTipsAnalyticsPage.tsx` | Mobile top spacing |
| `src/styles/caretip-dashboard-mobile.css` | Mobile analytics optical rules |
| `src/styles/globals.css` | Business hero mobile CTA balance |
| `scripts/business-analytics-integrity-runtime.ts` | Updated assertions |
