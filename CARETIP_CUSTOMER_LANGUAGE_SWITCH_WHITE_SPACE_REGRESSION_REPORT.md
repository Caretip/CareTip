# CareTip — Customer journey language-switch white space regression

**Date:** 2026-10-03  
**Scope:** Guest QR / tipping journey EN ↔ DE  
**Status:** **READY**

---

## 1. Reproduction (reported)

On customer QR pages, toggling **EN ↔ DE** can show a brief or lingering **white / empty** region while the locale updates. Observed across tip flow surfaces (landing, team pick, tip amount, checkout return paths) when the page is already interactive.

**Classification (when gap appears):**

| Type | Applies |
|------|---------|
| A. Full-page white | Sometimes (`SoftSpaRouteHold` / `bg-background` hold) if unrelated route suspend — not intended on locale-only update |
| B. White region / content hole | **Yes** — primary report |
| C. Old content unmount before new locale | **Partial** — hidden landing hero remount + locale chunk wait |
| D–G. Suspense / i18n chunk / overlay | **Possible** if alternate locale not warmed before first switch |
| H. Global branded loader | **No** for customer (`changeCustomerJourneyLanguage` → `keepPageVisible: true`) |
| I. CSS background | `SoftSpaRouteHold` uses `bg-background` (can read as white) |
| J. Customer shell remount | **No** — `LanguageChangeLoadingRegistrar` always renders outlet |

---

## 2. Previous fix (still in codebase)

**Commit:** `bea7329c` — *Fix customer QR locale, language switch flash, and cold-entry blanks.*

| Mechanism | Role |
|-----------|------|
| `changeCustomerJourneyLanguage` | `keepPageVisible: true` — no `beginAppLanguageChange` / global overlay |
| `prefetchCustomerJourneyLocaleBundles` | Load EN + DE JSON before toggle |
| `CustomerJourneyLanguageSwitcher` | `ensureLocaleBundle` → in-place switch |
| `LanguageChangeLoadingRegistrar` | Outlet **never** unmounted (removed old `app-language-change` overlay registration) |
| `RouteNavigationLoadingRegistrar` | Skips HTML boot tagline updates when `[data-caretip-route-ready]` exists |
| `AppLoadingManager` | `!languageChangeActive` suppresses overlay during marketing switches |

**Regression type:** **NEW WHITE-SPACE PATH** — prior customer wiring intact; later global UX work exposed two gaps:

1. **Locale warmup timing** — cold QR entry prefetched route chunks via `prefetchCustomerEntryGraph` but **not** both locale bundles until `CustomerJourneyLanguageSwitcher` `useEffect` (after paint) or `prefetchCustomerFlowRoutes` on some landings only.
2. **Off-home landing hero persistence** — `LandingHeroPersistenceLayer` subscribed to `useTranslation` on **all** routes after a prior `/` visit, remounting hidden `CareTipLandingHero` on every guest language change (main-thread / layout cost, perceived white gap).

---

## 3. Language switch lifecycle (customer)

```
EN/DE button
  → setPending (toggle UI only)
  → ensureLocaleBundle(target)
  → changeCustomerJourneyLanguage → changeAppLanguage({ keepPageVisible: true })
  → i18n.changeLanguage
  → React re-render (useTranslation subscribers)
```

**T0–T1:** Button pending state; page content stays previous locale until bundle ready.  
**T2–T3:** Dynamic import `locales/en.json` | `de.json` if not cached (~350KB).  
**T4:** `changeLanguage` commits.  
**T5:** Customer shell still mounted (`data-caretip-route-ready` remains).

**Gap cause:** T2–T3 when bundles not prefetched + off-home hidden hero re-render on T4.

---

## 4. Root cause (confirmed)

1. **Insufficient early locale prefetch** on direct customer URL entry.  
2. **`LandingHeroPersistenceLayer`** used `i18n.language` off-home, forcing hidden marketing hero updates during guest language switches (after user had visited `/` once).

Not caused by: SoftSpaRouteHold on locale alone, auth bootstrap, dashboard loader work, or marketing shell navigation.

---

## 5. Minimal fix implemented

| File | Change |
|------|--------|
| `src/app/lib/prefetchCustomerEntryGraph.ts` | Start `prefetchCustomerJourneyLocaleBundles()` on cold customer path (parallel with route chunks). |
| `src/app/pages/customer/CustomerJourneyLanguageSwitcher.tsx` | `useLayoutEffect` for locale prefetch (before paint). |
| `src/app/components/landing/LandingHeroPersistenceLayer.tsx` | Split home sync vs `PersistedHeroOffHome` — **no `useTranslation` on guest routes**; frozen hero copy for warm `/` return. |
| `scripts/customer-language-switch-white-flash-runtime.ts` | Assert entry-graph + layout prefetch. |
| `scripts/customer-journey-flicker-runtime.ts` | Assert entry locale warmup + off-home hero i18n isolation. |
| `e2e/customer-journey-language-switch.spec.ts` | EN ↔ DE on tip page: route stays ready, no SPA chunk hold. |

**Not added:** global loaders, timeouts, or route remount hacks.

---

## 6. Performance impact

- **Cold customer QR:** One extra parallel locale bundle fetch (alternate language) — same work as before but **earlier**, overlapping JS download.  
- **Language toggle:** Near-zero when bundles cached; no hidden hero work off-home.  
- **Marketing / dashboard:** Unchanged.

---

## 7. Verification

| Check | Result |
|-------|--------|
| `npm run test:customer-language-switch-white-flash` | ok |
| `npm run test:customer-journey-flicker` | ok |
| `npx playwright test e2e/customer-journey-language-switch.spec.ts` | pass |
| `npx tsc --noEmit` | (run in CI/local) |

**Preserved:** `SoftSpaRouteHold`, hard-refresh loader remediation, marketing shell, customer blank-render guards, `changeCustomerJourneyLanguage` semantics.

---

## 8. EN / DE / mobile / desktop

- E2E covers EN → DE → EN on tip amount (employee header).  
- Manual spot-check recommended: QR landing, `select-employee`, payment/success after switch, 320–430px widths.  
- Hard refresh after switch: locale from `localStorage` + `document.documentElement.lang` (unchanged behavior).

---

## 9. Remaining risks

| Risk | Notes |
|------|--------|
| First switch before any prefetch completes | Mitigated by entry-graph + layout prefetch; extreme slow network may still show text-only reflow without white hold |
| User path never hits customer entry graph | Rare (only non-standard entry); switcher prefetch still runs on mount |
| Marketing `LanguageSwitcher` | Still uses `changeAppLanguage` with overlay suppression — out of scope |

---

## Final status

**READY** — Targeted regression fix; architecture and prior customer language-switch design preserved; regression tests added/extended.
