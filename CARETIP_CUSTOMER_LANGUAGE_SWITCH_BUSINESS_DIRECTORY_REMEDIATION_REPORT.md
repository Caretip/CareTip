# CareTip — Business QR language-switch white screen (P0 remediation)

**Date:** 2026-10-03  
**Forensic reference:** `CARETIP_CUSTOMER_LANGUAGE_SWITCH_BLANK_SCREEN_FORENSIC_REPORT.md`  
**Status:** **READY**

---

## 1. Forensically identified root cause

On `/:businessSlug` (`BusinessStaffDirectoryPage`), the directory `useEffect` depended on `t` from `useTranslation`. Each EN ↔ DE toggle changed `t`’s identity → effect re-ran → `setLoading(true)` → team UI unmounted → `CareTipPageLoader` full-viewport `bg-background` → white/empty screen until `GET /api/staff/directory/business/:slug` completed again.

**Optional future hardening (not in this change):** overlay-not-replace behavior in `CustomerFlowShell` / `CareTipPageLoader` on soft nav (P1 in forensic report).

---

## 2. File changed

| File | Change |
|------|--------|
| `src/app/pages/customer/BusinessStaffDirectoryPage.tsx` | Remove `t` from fetch effect deps; `invalidLink` flag for empty slug |
| `e2e/customer-business-directory-language-switch.spec.ts` | **New** — business QR continuous visibility + fetch count |

**Untouched:** `AppLoadingManager`, `SoftSpaRouteHold`, i18n switcher, prefetch, loaders, marketing, dashboard, auth, Stripe.

---

## 3. Dependency / lifecycle correction

**Before:** `[businessSlug, setBusinessId, t]`

**After:** `[businessSlug, setBusinessId]`

Directory load is keyed only on business slug (and stable setters). Locale changes no longer trigger fetch or `loading`.

---

## 4. Dynamic translated errors

- **Invalid / missing slug:** `invalidLink` boolean set in the effect; message rendered as `t("tipFlow.errors.invalidLink")` so it updates on language change **without** refetch.
- **API failures:** still stored via `toUserFriendlyMessage(e)` at fetch time (unchanged). Only refetched when slug changes or realtime/socket reload runs.

---

## 5. Directory API request count (E2E)

| Event | `GET .../directory/business/:slug` |
|--------|-------------------------------------|
| Initial load | 1 |
| EN → DE → EN | **0 additional** (total stays 1) |
| DE → EN → DE (slow directory mock, delayed locale routes) | **0 additional** after initial load |

---

## 6–8. Language directions & continuous visibility

Production-equivalent **`http://localhost:4173`** (fresh `npm run build`), mocked directory API:

| Scenario | Result |
|----------|--------|
| EN → DE → EN | `.customer-flow` + `[data-customer-team]` present on all 16 ms samples; no `.app-branded-loader`; `textLen ≥ 40`; `lang` de then en |
| DE → EN → DE | Same continuous visibility; fetch count unchanged after initial load |

No white intermediate state in automation (contrast: pre-fix probe showed `textLen → 0` and `.customer-flow` lost).

---

## 9. E2E results

```
E2E_BASE_URL=http://localhost:4173 npx playwright test \
  e2e/customer-business-directory-language-switch.spec.ts \
  e2e/customer-journey-language-switch.spec.ts \
  e2e/customer-journey-language-switch-forensic.spec.ts
```

**5/5 passed** (includes new business-directory spec + existing tip-path specs).

---

## 10. Typecheck / build

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass (exit 0) |
| `npm run build` | Pass (exit 0, ~2m 53s vite build + prerender) |

---

## 11. Production-preview verification

- Build output served on port **4173** (preview).
- Business QR path `/${SLUG}` with mocked directory: language switches pass continuous visibility assertions (see §6–8).
- Trace/screenshots: Playwright default `test-results/` on failure; this run had no failures.

---

## 12. Other `t`-dependent customer effects (review only — not modified)

| File | Deps include `t` | Risk on locale switch |
|------|------------------|------------------------|
| `PaymentPage.tsx` | yes — effect calls `navigate('/tip-amount')` | Possible extra navigation on `/payment` only; **not** reproduced on business QR; **not changed** |
| `TipAmountPage.tsx` | `searchParams, t` | Toast for `canceled=1` only — no loading blank |
| `QRLandingPage.tsx` | `document.title` effect | No refetch / loading |
| `CustomerJourneyLegalDialog.tsx` | legal content load when open | Modal only |

---

## 13. Global architecture

Confirmed unchanged: `changeCustomerJourneyLanguage`, `keepPageVisible`, locale prefetch, `LanguageChangeLoadingRegistrar`, `SoftSpaRouteHold`, marketing shell, dashboard/hard-refresh loader work, customer lazy routes, SEO.

---

## 14. Static regression scripts

| Script | Result |
|--------|--------|
| `npm run test:customer-language-switch-white-flash` | ok |
| `npm run test:customer-journey-flicker` | ok |

---

## Ready gate

| Criterion | Met |
|-----------|-----|
| Business QR no white screen on language switch | Yes (E2E + pre/post fetch count) |
| Directory stays mounted; translations in place | Yes |
| No spurious directory refetch on locale | Yes |
| Tip-path language tests still pass | Yes |
| Typecheck + production build | Yes |

**STATUS: READY**
