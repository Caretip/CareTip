# CareTip Mobile Responsiveness + Text Cleanup Audit Report

**Date:** 2026-09-27  
**Scope:** Recently redesigned business/employee dashboard surfaces (presentation only).  
**Out of scope:** Backend, APIs, Stripe/financial logic, analytics calculations, auth.

---

## 1. Pages audited

| # | Page / surface | Primary implementation |
|---|----------------|-------------------------|
| 1 | Business Dashboard Hero | `BusinessDashboard.tsx`, `BusinessDashboardMobileHero.tsx`, `dashboard-hero-financial.css`, `caretip-redesign-mobile.css` |
| 2 | Business Payout History | `ConnectPayoutsPanel.tsx`, `BusinessStripePages.tsx`, `payout-workspace.css` |
| 3 | Employee Stripe Connect | `EmployeePaymentsConnectPage.tsx`, employee payout components, shared payout workspace |
| 4 | Business Live Activity | `BusinessActivityCenterPage.tsx`, `ActivityCenterFeed.tsx`, `business-activity-center.css`, `employee-tip-activity.css` |
| 5 | Business Tip Distribution | `TipDistributionPage.tsx`, `tip-distribution.css` |
| 6 | Business Performance | `BusinessTeamPerformancePage.tsx`, `BusinessExecutivePerformance.tsx`, `business-performance-dashboard.css` |
| 7 | Business Analytics & Reports | `BusinessTipsLayout.tsx`, `BusinessDashboardAnalyticsCharts.tsx`, `BusinessFinancialAnalyticsSection.tsx` |

Shared: mobile shell (`caretip-dashboard-mobile.css`), legal consent (`MerchantLegalAcceptanceCheckbox`, `InstantPayoutTermsCheckbox`), chart primitives (`ResponsiveContainer` + `minWidth={0}`).

---

## 2. Viewports tested

**Method:** Structural responsive audit (layout/CSS/component review) aligned to target widths, plus automated static checks. Full authenticated Playwright sweeps at each width were not run (login/DB dependency).

**Target widths reviewed in CSS and markup:** 320, 360, 375, 390, 412, 430 px; tablet 768 / 1024; desktop 1280 / 1440+.

---

## 3. Problems found

| Area | Issue | Severity |
|------|--------|----------|
| Payout workspace | Rail layout only grid at 1280px; mobile needed explicit `min-width: 0` and column stack | Medium |
| Payout destination | Wide `letter-spacing` on masked account at 320px risked overflow | Medium |
| Payout mobile ledger | Business rows prioritized ID over amount; less scannable on narrow screens | Low |
| Instant payout consent | Long legal label could wrap poorly without `min-w-0` | Medium |
| Stripe payout tabs | Tab list could crowd on 320px | Low |
| Live Activity | Titles/subtitles used `truncate`, clipping German/QR copy | Medium |
| Activity filters | 36px touch height | Low |
| Hero (mobile) | Primary financial type could be large on 320px without clamp | Medium |
| Tip Distribution KPI | Large primary value on very narrow phones | Low |
| Text (i18n) | Decorative em dashes in helper copy (EN/DE) | Low |

**Not observed in code (already mitigated):** Business payout history desktop table hidden below `lg` with dedicated mobile records; tip distribution employee table hidden below `lg` with mobile cards; activity filter row uses contained horizontal scroll (`employee-tip-activity-filters`).

---

## 4. Fixes made

- Added `src/styles/caretip-redesign-mobile.css` (imported via `dashboard.css`): payout workspace containment, payout rail stack &lt;1280px, 44px toolbar controls, hero financial clamps, chart panel `min-width: 0`, tip distribution KPI scaling at 320px.
- **ConnectPayoutsPanel:** Richer mobile payout records (amount, status, date, method, reference, arrival).
- **BusinessStripePages:** Payout tabs wrap on small screens (`flex-wrap`, `min-h-10`).
- **ActivityCenterFeed:** `line-clamp-2` instead of `truncate` for title/subtitle.
- **employee-tip-activity.css:** Filter chips `min-height: 2.75rem`.
- **MerchantLegalAcceptanceCheckbox / InstantPayoutTermsCheckbox:** Wrapping and line-height for consent on narrow viewports.

---

## 5. Text / dash cleanup performed

See table in section **TEXT CLEANUP SUMMARY** below.

---

## 6. German localization

- Mirrored EN punctuation changes in `de.json` for the same keys.
- No wholesale translation rewrites; only clarity/punctuation aligned with layout-friendly copy.
- Long German labels (e.g. tip distribution actions) already use mobile card layout and full-width buttons at `lg` breakpoint.

---

## 7. Horizontal overflow findings

- **Page-level:** Existing `caretip-dashboard-mobile.css` uses `overflow-x: clip` on `main` only as shell containment; redesign fixes address **source** elements (`min-width: 0`, clamps, stacked layouts) rather than hiding overflow on content cards.
- **Tables:** Wide tables remain inside `hidden lg:block` + `overflow-x-auto` wrappers where desktop tables are shown; mobile uses list/card patterns on payout, tip distribution, and employee bank payouts.
- **Charts:** Analytics/performance charts use `ResponsiveContainer` with `width="100%"` and `minWidth={0}` on chart frames.

---

## 8. Navigation findings

- Mobile drawer and header rules in `caretip-dashboard-mobile.css` unchanged (mark-only brand ≤359px, touch icon buttons).
- No navigation redesign required for this pass.

---

## 9. Chart responsiveness findings

- Business dashboard analytics and executive health trend charts already use fluid containers and `preserveStartEnd` / `minTickGap` on axes.
- `caretip-redesign-mobile.css` reinforces `min-width: 0` on chart panels in performance and analytics grids.

---

## 10. Accessibility / touch targets

- Payout ledger toolbar inputs/selects: **44px** min height on mobile pass.
- Activity filter chips: **44px** min height.
- Mobile hero CTAs: **44px** min height in mobile CSS pass.
- Checkbox + legal label association preserved (`label`/`htmlFor`, hint `id`).

---

## 11. Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npx tsx scripts/mobile-redesign-audit-runtime.ts` | Pass |
| `npx tsx scripts/payout-ux-i18n.unit.ts` | Pass |

Production `npm run build` not re-run in this pass (prior payout redesign build succeeded). Recommend one local build before release.

---

## 12. Build result

Not re-executed in this audit pass. Typecheck and runtime audit scripts passed.

---

## 13. Remaining known limitations

- **Authenticated visual QA** at 320–430px should be repeated in a real browser once Supabase/login works (P1001 in prior sessions).
- **CareTip payout tab** (`BusinessPayoutsCareTipView`) still uses a wide table inside scroll on small breakpoints when that tab is selected; consider a future mobile card pattern (out of scope unless product requests).
- **Playwright viewport matrix** across all seven pages with auth cookies is not automated yet; `scripts/mobile-redesign-audit-runtime.ts` covers static hooks and i18n only.

---

## Issue / fix matrix

| Page | Mobile issue | Severity | Fix | Verified widths |
|------|----------------|----------|-----|-----------------|
| Business Dashboard Hero | Large headline/amount on 320px | Medium | `clamp()` + `overflow-wrap` in `caretip-redesign-mobile.css` | 320–430 (CSS) |
| Business Dashboard Hero | CTA touch size | Low | `min-height: 2.75rem` on mobile hero buttons | 320–430 (CSS) |
| Payout History | Metric/destination overflow | Medium | Payout workspace mobile CSS + masked account spacing | 320–390 (CSS) |
| Payout History | Mobile ledger scanability | Low | Restructured `PayoutMobileRow` | Markup |
| Payout History | Tab crowding | Low | Wrap-friendly `TabsList` | 320–375 (markup) |
| Employee Connect | Shared payout rail | Medium | Same payout mobile CSS + existing mobile bank list | 320–430 (CSS) |
| Instant payout | Consent text wrap | Medium | Legal checkbox `min-w-0`, hint `leading-snug` | 320–430 (markup) |
| Live Activity | Clipped titles | Medium | `line-clamp-2` on title/subtitle | 360–430 (markup) |
| Live Activity | Filter touch targets | Low | 2.75rem filter height | 320+ (CSS) |
| Tip Distribution | KPI size on 320px | Low | KPI value clamp in mobile CSS | 320–359 (CSS) |
| Performance | Chart container width | Low | `min-width: 0` on chart panels | All mobile (CSS) |
| Analytics | Chart grid overflow | Low | `min-width: 0` on analytics grid | All mobile (CSS) |

---

## TEXT CLEANUP SUMMARY

| Original UI text (EN) | Updated text (EN) | Reason |
|------------------------|-------------------|--------|
| Transfers, holds, and venue-managed shares — not bank payouts. | …shares. Not bank payouts. | Remove decorative em dash |
| Composite index … tip activity — not a single KPI. | …tip activity. Not a single KPI. | Remove decorative em dash |
| Connected — not required for current routing | Connected. Not required for current routing. | Clearer sentence; mobile wrap |
| Older than 30 days — still awaiting… | Older than 30 days and still awaiting… | Remove decorative em dash |
| DE equivalents for the above | Period-separated sentences | DE parity |

**Unchanged (intentional):** Numeric ranges (`1–10`), date ranges (`{{from}}–{{to}}`), en/em dashes in legal/SEO titles, compound terms (e.g. `Off-Platform` in DE modal).

---

## Final note

This pass prioritizes **production-shaped mobile behavior**: stacking, touch targets, readable financial copy, and contained tabs/filters—not breakpoint-only desktop shrink. Repeat browser verification on real devices once the app is reachable with a logged-in business and employee account.
