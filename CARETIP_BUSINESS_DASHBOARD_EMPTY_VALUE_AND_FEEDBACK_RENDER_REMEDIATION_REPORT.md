# Business Dashboard — Empty “To distribute” & Customer Feedback Render Remediation

**Status: READY — DASHBOARD EMPTY VALUE AND FEEDBACK RENDER FIXED**

**Date:** 2026-09-30

---

## 1. Executive summary

Two targeted UX fixes on the Business Overview:

1. **To distribute** — Zero obligation was rendered as `format.metricZeroTips` (“0 tips”) or the column was omitted when not in distribution mode, leaving a confusing or empty-looking hero cell.
2. **Customer Feedback** — API fetch was gated on `useInViewActive` (`panelVisible`), so the section only loaded after scroll despite the shell/header rendering immediately.

Financial calculations and API contracts were not changed.

---

## 2. To distribute — root cause

| Layer | Finding |
|-------|---------|
| Source | `GET /api/me/connect/financial-summary` → `lifetime.employeeDistributionObligationEur` + `routing.mode` |
| Rendering | `BusinessHeroFinancialMetrics.tsx` |
| Bug A | `ledgerCurrencyValue` used `format.metricZeroTips` for amounts &lt; €0.005 → **“0 tips”** in a EUR column |
| Bug B | Column omitted unless `business_distribution` mode **or** amount &gt; 0 → missing fourth cell for many venues |

---

## 3. Data source (unchanged)

`employeeDistributionObligationEur` from ledger slice of financial summary — no backend change.

---

## 4. Zero-value behavior (before)

- Hidden column when direct-to-employee and €0.
- When shown, displayed **“0 tips”** instead of **€0,00**.

---

## 5. Customer Feedback — render lifecycle (before)

- Section **mounted** on initial dashboard render (header + panel chrome).
- **Fetch** started only when `useInViewActive` reported visible (`rootMargin: 160px`).
- **Intentional** deferral for performance, but caused “pop-in on scroll” and empty list area until scroll.

---

## 6. Viewport gating

**Was intentional** (idle + in-view). **Removed** for API start; fetch still deferred via `scheduleIdleWork(0)` so hero/stats are not blocked.

---

## 7–8. Performance (before / after)

| Aspect | Before | After |
|--------|--------|-------|
| Feedback API start | After scroll into view | After entitlements ready + idle tick |
| Hero blocked on feedback | No | No |
| Extra requests | None | None (single `take: 5` call) |
| Hero fourth metric | Sometimes missing / wrong copy | Always € formatted when ledger settled |

*No browser RUM captured; behavior verified by source + regression scripts.*

---

## 9. Changes made

- **BusinessHeroFinancialMetrics** — Always add “To distribute” when ledger settled; `formatEur` for value; hints: `distributionZeroHint`, `distributionDirectModeHint`, `distributionHint`.
- **RecentCustomerFeedbackPanel** — Removed `useInViewActive` gate on fetch.
- **i18n** — EN/DE keys for new hints.
- **Tests** — `test:business-dashboard-hero-feedback`, `test:dashboard-performance` assertion.

---

## 10. Loading / empty / error (feedback)

Unchanged patterns: skeleton while `loading`, dashboard empty copy, retry on error.

---

## 11–12. Responsive & i18n

Layout uses existing payout grid; EUR formatting via `de-DE`. New strings in EN + DE.

---

## 13. Tests

- `npm run test:business-dashboard-hero-feedback`
- `npm run test:dashboard-performance`
- `npm run typecheck` (run locally)

---

## 14. Build

No build-only changes; run `npm run build` as usual.

---

## 15. Files changed

- `src/app/components/business/BusinessHeroFinancialMetrics.tsx`
- `src/app/components/business/RecentCustomerFeedbackPanel.tsx`
- `src/i18n/locales/en.json`, `de.json`
- `scripts/business-dashboard-hero-feedback-runtime.ts`
- `scripts/dashboard-performance-runtime.ts`
- `package.json`

---

## 16. Remaining risks

- Direct-to-employee venues always see **€0,00** “To distribute” with explanatory hint — correct semantically; monitor for product copy tweaks.

---

**READY — DASHBOARD EMPTY VALUE AND FEEDBACK RENDER FIXED**
