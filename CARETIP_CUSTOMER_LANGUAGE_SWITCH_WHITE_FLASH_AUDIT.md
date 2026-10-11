# CARETIP Customer Language Switch White-Flash Audit

## 1. Issue Summary

On the guest QR tipping journey, toggling **EN ↔ DE** briefly showed a blank/white full-page state before translated content returned. Language and checkout email locale were correct; the failure was **presentation** during the switch.

## 2. Reproduction Steps

1. Open a QR landing (e.g. business/table team picker) in DE.
2. Tap **EN** in the header language control.
3. Observe: page chrome disappears → light blank background → English UI.

Same in reverse (EN → DE) on tip amount and other customer steps with the header switcher.

## 3. Affected QR Journeys

All routes using `CustomerJourneyHeader` / `CustomerFlowShell` language control: business QR, table/location QR, staff paths, `/tip-amount`, rating/success (where header is shown).

## 4. Current Language Switch Architecture

- UI: `CustomerJourneyLanguageSwitcher` → `changeAppLanguage` (shared i18n).
- Locales: single active bundle at cold start; alternate ~350KB JSON loaded on first switch via dynamic `import()`.
- Persistence: `caretip_i18n_language` + `document.documentElement.lang`.
- Checkout email locale: unchanged (`getGuestTipPresentationLocale` on session create).

## 5. Exact Root Cause

**Primary (K):** Combination of:

1. **Lazy alternate locale load** — `changeAppLanguage` awaited `ensureLocaleBundle` while the alternate JSON chunk was still downloading; switcher also fired prefetch in parallel (race).
2. **`beginAppLanguageChange`** — global language-change signal (intended for marketing/settings) could engage overlay / outlet guard patterns; registrar must never hide the outlet (now enforced).
3. **HTML boot tagline refresh** — `RouteNavigationLoadingRegistrar` updated `#caretip-html-boot-tagline` whenever `t` changed; if the boot node still existed, this could flash boot chrome during locale-only updates on committed customer routes.

**Not the cause:** Full route navigation, `window.location` reload, or tip/journey state reset on language change (QR data effects do not depend on `t` / `i18n.language`).

## 6. Whether Full Route Navigation Occurs

**No.** Language switch does not call `navigate` or change URL.

## 7. Whether Components Remount

**No intentional remount.** No `key={i18n.language}` on customer pages. Lazy QR pages could theoretically re-suspend if unmounted; outlet is no longer hidden during language change.

## 8. i18n Resource Loading Analysis

- Before fix: only active locale at first paint; first toggle waited on network chunk.
- After fix: `prefetchCustomerJourneyLocaleBundles()` on switcher mount + QR `prefetchCustomerFlowRoutes()`; switcher `await ensureLocaleBundle(lng)` before `changeCustomerJourneyLanguage`.

## 9. Suspense/Loading Analysis

- Root `RouteChunkBoundary` (`minimal`) uses `MinimalRouteFallback` → `PublicRouteChunkHold` on lazy suspend (cream/branded, often reported as “white”).
- Avoided by keeping outlet mounted and prefetching locale so switch does not coincide with chunk wait.
- `react-i18next` uses `useSuspense: false`.

## 10. API/Data Refetch Analysis

**No refetch** on language change for business/employee/QR APIs (customer `useEffect` deps exclude `t` / `i18n.language`).

## 11. Customer State Preservation Analysis

Employee selection, search query, tip amount, email field, and URL context are React/local state — **not reset** by locale switch.

## 12. Image/Media Analysis

No image `key` tied to language; logos/avatars unchanged.

## 13. Fix Implemented

| Change | Purpose |
|--------|---------|
| `changeCustomerJourneyLanguage` / `keepPageVisible` | Skip `beginAppLanguageChange` for guest journey |
| `prefetchCustomerJourneyLocaleBundles` | Load EN+DE early on QR entry |
| Switcher awaits `ensureLocaleBundle` before switch | No gap without translations |
| `LanguageChangeLoadingRegistrar` | Subscribe but **always** render children |
| `RouteNavigationLoadingRegistrar` | Skip boot tagline updates when route-ready |
| `AppLoadingManager` | Suppress global overlay during marketing `beginAppLanguageChange` |
| `prefetchCustomerFlowRoutes` | Warm locale bundles with tip chunks |

## 14. Performance Before/After

- **Before:** First toggle often blocked on ~350KB locale chunk; possible blank/overlay frame.
- **After:** Bundles prefetched on QR entry; toggle should be in-place string updates (devtools: `caretip:lang-switch-start` → `caretip:lang-switch-complete` with no navigation). Not benchmarked in CI.

## 15. Tests Executed

| Command | Result |
|---------|--------|
| `npm run test:customer-language-switch-white-flash` | **Pass** (7 checks) |
| `npm run test:qr-guest-tip-locale` | **Pass** (8 checks) |
| `npm run typecheck` | **Pass** |

## 16. Test Results

All listed commands passed in the implementation run. Manual visual confirmation on device still recommended.

## 17. Files Changed

- `src/i18n/i18n.ts`
- `src/app/pages/customer/CustomerJourneyLanguageSwitcher.tsx`
- `src/app/components/LanguageChangeLoadingRegistrar.tsx`
- `src/app/components/RouteNavigationLoadingRegistrar.tsx`
- `src/app/lib/prefetchCustomerRoutes.ts`
- `src/app/context/AppLoadingManager.tsx`
- `scripts/customer-language-switch-white-flash-runtime.ts`
- `package.json`

## 18. Files Not Changed

Stripe, tip amounts, QR routing, email locale API, payout logic.

## 19. Remaining Limitations

- First QR visit on very slow networks may still prefetch locales after paint (toggle after prefetch completes is smooth).
- Manual mobile visual pass (320–430px) recommended.
- Lazy QR route chunk suspend on **navigation** unchanged; only language toggle hardening.

---

### Direct answers

| Question | Answer |
|----------|--------|
| Why white page? | Locale chunk wait + global/HTML boot reactions during `t` / language-change signals; outlet must stay mounted. |
| Whole page remounting? | Not by design; outlet unmount was the risk — fixed. |
| Locale bundle loading during switch? | Yes before prefetch; now prefetched + awaited before `changeLanguage`. |
| Suspense responsible? | Only if lazy route re-suspended; mitigated by prefetch + no outlet hide. |
| Route navigation? | No. |
| Unnecessary API calls? | No. |
| Journey state preserved? | Yes. |
| Fix eliminates blank transition? | **Intended yes** — verify on device. |

## FINAL STATUS

**FIXED — READY FOR REVIEW**
