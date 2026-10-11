# Mobile Stripe Payout + Mobile→Web Subscription — Remediation Report

**Date:** 2026-09-22  
**Audit source:** `docs/audits/mobile-stripe-payout-and-subscription-navigation-audit.md`

---

## 1. Original audit finding

**P0 — Payout:** Global `ErrorBanner` (`errors.offline`) is set by the Axios interceptor on **any** protected transport failure, while instant-payout data can load successfully from a separate query/cache.

**P1 — Subscription handoff:** Multi-layer web bootstrap after mobile→web billing handoff can appear stuck; locale is not propagated from mobile to in-app browser.

---

## 2. Confirmed runtime root cause

### P0 (code trace — matches audit)

| Component | Role |
|-----------|------|
| `mobile/services/api/client.ts` L289–295 | `reportGlobalError(error)` when `!status` and not public |
| `mobile/components/layout/ErrorBanner.tsx` | Renders `errors.offline` from `uiStore.globalError` |
| `EmployeePaymentsConnectScreen` | `instantQuery` success is independent of global banner |
| `employee/_layout.tsx` | Background `useUnreadNotificationCount` can fail transport while payout succeeds |

**Conclusion:** Unrelated background/secondary requests (notifications, connect-status, payables) could trigger the red banner while `GET /api/me/employee-connect/instant-payout` succeeded.

### P1 (code trace — matches audit)

| Gap | Effect |
|-----|--------|
| `MobileAuthHandoffPage` did not use `authSignInHandoff` lifecycle | Dashboard cold boot + `ProtectedRoute` overlay without sign-in handoff cover coordination |
| No `lang` on handoff URL | Browser boot used web `localStorage` default, not mobile locale |
| Handoff errors left `beginAuthSignInHandoff()` active | Could contribute to stuck overlay on failure |

---

## 3. Files modified

### Mobile — P0 payout

| File | Change |
|------|--------|
| `mobile/utils/apiClientConfig.ts` | **New** — `withSuppressGlobalApiError()` request flag |
| `mobile/services/api/client.ts` | Respect `__caretipSuppressGlobalError`; refresh failure still global |
| `mobile/services/api/employeePayoutService.ts` | Suppress global error on payout/history GETs |
| `mobile/services/api/employeeService.ts` | Suppress on `fetchEmployeeProfile` |
| `mobile/services/api/notificationsService.ts` | Suppress on notification GETs |
| `mobile/features/employee/payouts/EmployeePaymentsConnectScreen.tsx` | Consolidated payout UX hierarchy |
| `mobile/i18n/locales/de.ts`, `en.ts`, `types.ts` | Hero/pending copy + DE title |
| `mobile/scripts/payout-global-error-runtime.ts` | **New** regression |
| `mobile/package.json` | `test:payout-global-error` |

### Mobile — P1 locale

| File | Change |
|------|--------|
| `mobile/utils/mobileWebHandoffLocale.ts` | **New** — append validated `lang` param |
| `mobile/utils/openBillingWeb.ts` | Pass mobile locale on handoff URL |

### Web — P1 handoff

| File | Change |
|------|--------|
| `src/app/lib/mobileWebHandoffLocale.ts` | **New** — parse/apply `?lang=` |
| `src/app/pages/MobileAuthHandoffPage.tsx` | Sign-in handoff lifecycle + i18n errors + locale |
| `public/boot-locale.js` | Read `?lang=` before localStorage; `/mobile-auth` tagline |
| `src/app/lib/appLoadingContexts.ts` | `/mobile-auth` → sessionCheck loader copy |
| `src/i18n/locales/de.json`, `en.json` | `mobileWebHandoff.*` strings |
| `scripts/mobile-web-handoff-locale-web-runtime.ts` | **New** regression |
| `package.json` | `test:mobile-web-handoff-locale-web` |

---

## 4. Exact changes made

### P0 — Error scoping

- Added opt-out flag `__caretipSuppressGlobalError` on Axios config.
- Applied to screen-scoped queries: employee profile, all employee-connect reads, notifications.
- **Not** applied to: billing handoff create, auth refresh, login — session-critical paths unchanged.
- Refresh failure path still calls `reportGlobalError` when authenticated session dies.

### P0 — Payout UX

- **Primary hero** when instant ready: **net** (`instantAvailableNetCents`) — same amount POST uses and CTA shows.
- **Threshold** mode: gross available before minimum (unchanged semantics).
- Single hierarchy: hero → terms + **existing Button** (unchanged) → payout account → fee/receive breakdown → pending (secondary).
- Removed duplicate top balance blocks when consolidated layout active.
- DE screen title: `Auszahlung` (was English “Stripe Payment”).

### P1 — Handoff

- `beginAuthSignInHandoff()` → consume → `markSignInHandoffAuthCompleted()` → `preparePostAuthDestination` → `markSignInHandoffNavigating` + `beginAuthPostLoginTransition` → navigate (mirrors `AuthPage.redirectAfterAuth`).
- `endAuthSignInHandoff()` on missing token or consume failure — **no infinite handoff cover on error**.
- Mobile appends `lang=de|en` to server handoff URL; boot-locale persists to `localStorage` on first paint.
- `MobileAuthHandoffPage` applies locale before loaders; error UI fully i18n.

---

## 5. Why each change is safe

| Change | Safety |
|--------|--------|
| Suppress global transport on scoped GETs | Screen `ErrorState` / `AccessErrorState` / toasts still show failures; `OfflineBanner` still shows device offline; auth refresh global path untouched |
| Payout UX layout only | No change to eligibility DTO, fee math, CTA component, or POST body |
| authSignInHandoff on mobile billing | **Existing** infrastructure used by web login; 20s bounded timeout already in `authSignInHandoff.ts` |
| `lang` query param | Validated `de|en` only; not used for auth; token still server-issued |
| boot-locale `?lang=` | Writes same `caretip_i18n_language` key as React i18n |

**Untouched:** JWT, refresh rotation, Web Locks, idle session, Stripe webhooks, billing activation, `externalStripeNavigationHold`, `AppLoadingManager` architecture, `ProtectedRoute` guards, IP/UA handoff validation.

---

## 6. Mobile payout error-state — before / after

| Scenario | Before | After |
|----------|--------|-------|
| Instant payout OK, notification poll transport fail | Red global offline + valid amounts | Amounts only; no misleading global banner |
| Instant payout transport fail | Global banner + `ErrorState` | `ErrorState` only (suppress on instant GET) |
| Auth refresh fail while authenticated | Global banner + session handling | **Unchanged** — still global |

---

## 7. Mobile payout UX — before / after

| Before | After |
|--------|-------|
| Duplicate hero amounts (top + card) | One primary hero (net when ready) |
| Pending same visual weight as available | Pending in secondary section below action |
| English title in DE locale | German `Auszahlung` |
| Fee buried in muted line | Fee + “Sie erhalten” breakdown section |

---

## 8. Mobile → web subscription flow — before / after

| Before | After |
|--------|-------|
| Handoff page isolated from sign-in handoff cover | Uses `authSignInHandoff` + post-login transition |
| Failure could leave handoff flag active | `endAuthSignInHandoff` on errors |
| English hard-coded error strings | i18n `mobileWebHandoff.*` |

---

## 9. Loader language — before / after

| Stage | Before | After |
|-------|--------|-------|
| HTML boot | Browser `localStorage` only | `?lang=` from mobile wins, persisted |
| `/mobile-auth` boot tagline | Generic `gettingReady` | `sessionCheck` copy in correct language |
| Handoff shell | Default | `common.loading.sessionCheck` in applied locale |
| Billing route | `syncingAccountStatus` | Unchanged (already i18n) |

---

## 10–13. Protected architectures

| Area | Status |
|------|--------|
| Authentication architecture | **Preserved** — handoff token consume unchanged |
| White-screen protections | **Preserved** — handoff uses existing cover + shell commit |
| Stripe architecture | **Preserved** — no payout/billing Stripe logic changed |
| Billing architecture | **Preserved** — only navigation/locale to billing UI |

---

## 14. Idle session timeout

**CONFIRMED UNTOUCHED** — no files under `idleSession`, no changes to idle flags, scheduler, or `isIdleLogoutInFlight` behavior.

---

## 15. Tests executed

| Test | Result |
|------|--------|
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `mobile: test:payout-global-error` | **PASS** |
| `mobile: test:mobile-web-handoff-locale` | **PASS** |
| `mobile: test:employee-payouts` | **PASS** |
| `mobile: test:billing-handoff` | **PASS** |
| `test:mobile-web-handoff-locale-web` | **PASS** |
| `test:navigation-transition-stability` | **PASS** |
| `test:stripe-stale-state` | **PASS** |

---

## 16. Browser / device validation

**Not run in this session** (requires physical device / Custom Tab). Recommended manual checks from audit §30 remain:

- Payout screen with simulated background API failure
- Android/iOS billing handoff DE + EN
- Expired handoff token → error page (not infinite loader)

---

## 17. Remaining known risks

| Risk | Mitigation |
|------|------------|
| Other non-suppressed APIs still set global banner | Expand suppress flag to additional screen-scoped services if observed |
| Handoff >90s TTL | User messaging in mobile confirm dialog (unchanged); consider TTL bump in separate security review |
| Billing boot overlay on very slow `GET /api/me/billing` | Existing 20s handoff max + billing error UI; monitor |

---

## Final success criteria checklist

- ✓ Misleading global offline banner on healthy payout data — **addressed** (scoped suppress)
- ✓ Genuine payout errors visible — **preserved** (`ErrorState`, submit errors)
- ✓ Financial calculations unchanged — **confirmed**
- ✓ Payout hierarchy improved — **done**
- ✓ Payout Button unchanged — **confirmed**
- ✓ Handoff uses secure token + existing guards — **confirmed**
- ✓ Handoff failure → error, not infinite loader — **addressed**
- ✓ Locale hint DE/EN — **addressed**
- ✓ Idle session — **untouched**
- ✓ Auth / white-screen / Stripe stale-state regressions — **tests pass**
