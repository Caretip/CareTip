# Mobile State Synchronization Audit

**Date:** 2026-08-05  
**Scope:** CareTip mobile (`mobile/`) — every event that changes business / account state and how React Query, Zustand, SecureStore, AsyncStorage, and navigation stay consistent.

---

## Executive summary

Mobile state is split across five layers:

| Layer | Role |
| --- | --- |
| **Zustand** | Auth status, AuthUser, UI/theme/toasts/startup |
| **React Query** | All private API data (user-scoped keys `["u", userId, …]`) |
| **SecureStore** | Access token, refresh token, user snapshot |
| **AsyncStorage** | Preferences, offline QR, branded PNG caches |
| **Navigation** | Driven by AuthUser flags (`emailVerified`, `hasCompletedOnboarding`, role) |

**Architectural rule:** interactive account changes must `queryClient.clear()` before mounting private UI (`authCacheBoundary`). External changes (admin approval, billing, other devices) must refresh **AuthUser** via `POST /api/auth/refresh` and invalidate the affected query families — not rely on logout.

This audit found several missing invalidations (billing/employee/goal sockets, verification AuthUser refresh, branded QR after profile edit, push inbox, language settings, narrow resume sync). Those gaps are closed in this pass; remaining residual risks are documented below.

---

## State inventory

### Zustand (`mobile/store/`)

| Store | Contents | Cleared / set |
| --- | --- | --- |
| `authStore` | status, accessToken, hydrated | login / logout / recovery / bootstrap |
| `userStore` | AuthUser | establish session / foreground sync / language |
| `businessStore` | profile (unused write path) | cleared on logout only — **dead** |
| `employeeStore` | profile (unused write path) | cleared on logout only — **dead** |
| `startupStore` / `splashStore` | bootstrap / first paint | StartupBridge |
| `uiStore` / `toastStore` / `themeStore` | online, errors, toasts, theme | local |

### React Query keys (`queryKeys.ts`)

Private namespace: `["u", userId, …]` — `businessProfile`, `businessStats`, `businessQr*`, `businessFeedback`, `businessActivity`, `businessTips`, `businessEmployees`, `employeeMe` / tips, `notifications*`, `accountSettings`, `twoFactor`, `brandedQr`, `tipDetail`.

### SecureStore (`tokenStorage` / `storageKeys`)

`caretip_access_token`, `caretip_refresh_token`, `caretip_user_snapshot` — written on persistSession / MFA / language; cleared on logout / rejected bootstrap.

### AsyncStorage

Preferences (`language`, `theme`, timeframes, cookie consent) survive logout.  
Offline QR + branded PNG are user-scoped and cleared on interactive auth boundaries + logout.

---

## Synchronization path matrix

| Event | Zustand | React Query | SecureStore | AsyncStorage | Navigation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **Password / Google login** | user + auth | **clear** | tokens + snapshot | offline/branded QR **clear** | `navigateAfterAuth` | OK |
| **MFA complete** | user + auth | **clear** + offline QR | tokens + snapshot | offline/branded clear | dashboard | OK |
| **Logout / idle / session expiry** | clear user/business/employee; unauthenticated | **clear** | clear secrets | offline/branded clear; push unregister | login | OK |
| **Email verification** | establish if session exists; else login with flag | clear on establish | refresh if session | clear on establish | verify → login → onboarding | OK (re-login path intentional) |
| **Onboarding complete** | establish `"onboarding-complete"` | **clear** | new session | offline QR clear | business dashboard | OK |
| **Cold start / session restore** | establish `"session-restore"` | **clear** (keep offline QR) | refresh rotates | QR retained | post-auth href | OK |
| **App resume (foreground)** | AuthUser via `syncAuthUserFromServer` | **full workspace invalidate** | may rotate | — | re-eval guards | **Fixed** (was partial) |
| **Socket reconnect** | AuthUser refresh | profile, stats, qr, tips, unread | may rotate | — | — | **Fixed** (was narrow) |
| **Admin approval (`verification_updated`)** | AuthUser refresh | profile, stats, qr | may rotate | — | flags update | **Fixed** |
| **Subscription / billing (`billing.updated`)** | AuthUser refresh | profile, stats, feedback, qr, settings | may rotate | — | entitlements | **Fixed** (was unlistened) |
| **Business data (`business_data_updated`)** | — | broad business + tips + branded disk | — | branded clear | — | **Fixed** (broader) |
| **Tip / QR scan / activity / notif sockets** | — | targeted families | — | — | — | OK |
| **Goal / employee sockets** | — | stats, employees, tips, qr | — | — | — | **Fixed** (were unlistened) |
| **Business profile edit** | — | profile, stats, branded RQ | — | branded PNG clear | name on UI | **Fixed** |
| **Business general (phone)** | — | profile | — | — | — | OK |
| **Employee profile / goal edit** | — | employeeMe + employeeTips | — | — | — | **Fixed** |
| **Notification settings** | — | accountSettings / employeeMe | — | — | — | OK |
| **Language change** | user.preferredLocale | accountSettings invalidate | snapshot | language pref | LocaleBridge | **Fixed** |
| **QR inventory fetch / regenerate** | — | businessQr via studio | — | offline QR rewrite | — | OK (tenant-scoped) |
| **Employee CRUD (remote)** | — | via `employee.updated` now | — | — | Team is read-only | **Fixed** (socket) |
| **Branding (web / other client)** | — | business_data / resume / branding disk | — | branded clear on those paths | — | Improved |
| **Push received / tapped** | — | inbox invalidate | — | — | inbox on tap | **Fixed** |
| **Deep link (verify/reset)** | none | none | none | none | auth routes | OK (routing only) |

---

## Stale-cache risks (before → after)

| Risk | Before | After |
| --- | --- | --- |
| Admin approves while app backgrounded | Profile may refresh; AuthUser flags stale | Resume + `verification_updated` refresh AuthUser + workspace |
| Plan upgraded on web | No `billing.updated` listener | Listener + AuthUser + entitlement queries |
| Employee added on web | `businessEmployees` never invalidated | `employee.updated` + resume workspace |
| Business name/logo change | Profile OK; branded PNG disk stale | `invalidateBrandingArtifacts` on profile save; socket clears disk |
| Push opens inbox | Navigates to stale list | Invalidate notifications on receive/tap |
| Language patch | userStore OK; `accountSettings` RQ stale | Invalidate accountSettings |
| Resume after long background | Partial invalidation | `invalidateWorkspaceQueries` |

---

## Missing invalidations found & fixed

| Gap | Fix |
| --- | --- |
| `billing.updated` / `goal.updated` / `employee.updated` not subscribed | Wired in `RealtimeQueryBridge` |
| `verification_updated` did not refresh AuthUser | Schedules `authUser` → `syncAuthUserFromServer` |
| Resume invalidated only a subset of keys | `AuthSessionSyncBridge` → `invalidateWorkspaceQueries` |
| Reconnect catch-up too narrow | Profile + QR + AuthUser added |
| Profile edit left branded QR caches | `invalidateBrandingArtifacts` |
| Language skipped `accountSettings` | Invalidate after patch |
| Employee goal/name skipped tips dashboard | Invalidate `employeeTips` |
| Push ignored inbox RQ | Invalidate on receive + response |
| Contracts omitted verification / business_data | Added to `realtimeContracts.ts` |

**Helper module:** `mobile/services/api/invalidateUserQueries.ts`  
(`syncAuthUserFromServer`, `invalidateWorkspaceQueries`, `invalidateBrandingArtifacts`)

---

## Files modified

| File | Change |
| --- | --- |
| `mobile/services/api/invalidateUserQueries.ts` | **New** shared sync helpers |
| `mobile/components/providers/AuthSessionSyncBridge.tsx` | Full workspace + AuthUser on resume |
| `mobile/components/providers/RealtimeQueryBridge.tsx` | All contract events + AuthUser + branding disk |
| `mobile/components/providers/PushNotificationBridge.tsx` | Inbox invalidate |
| `mobile/lib/realtime/realtimeContracts.ts` | verification + business_data |
| `mobile/features/settings/sections/BusinessProfileSettingsScreen.tsx` | Branding + stats invalidate |
| `mobile/features/settings/sections/LanguageSettingsSection.tsx` | accountSettings invalidate |
| `mobile/features/settings/sections/EmployeeProfileSettingsScreen.tsx` | employeeTips invalidate |
| `STATE_SYNCHRONIZATION_AUDIT.md` | This document |

---

## Navigation synchronization

`resolvePostAuthAction` / `(app)/_layout` / `(auth)/_layout` read **only** Zustand AuthUser:

1. `emailVerified === false` → verify-email  
2. Manager + `!hasCompletedOnboarding` → onboarding  
3. else role dashboard  

Therefore any remote change to those flags **must** call `syncAuthUserFromServer` (resume, verification, billing, reconnect). Profile-only invalidation is insufficient for navigation.

---

## Residual recommendations

1. **Remove or hydrate** dead `businessStore` / `employeeStore` to avoid dual sources of truth.  
2. **Emit** `billing.updated` / `verification_updated` from backend on every admin/plan mutation (confirm production coverage).  
3. **QR regeneration** from web should emit `business_data_updated` (mobile now listens broadly).  
4. After returning from billing web handoff, optionally force `syncAuthUserFromServer` in `openBillingWeb` on browser dismiss (resume already covers most cases).  
5. Consider `refetchOnMount: "always"` for `businessProfile` on dashboard as defense in depth.  
6. Add a small regression that asserts RealtimeQueryBridge listens to every `REALTIME_EVENTS` key.

---

## Validation checklist

- [ ] Sign up → verify → onboard → dashboard loads with correct business name  
- [ ] Admin approves while app backgrounded → foreground → verification badge / QR capability updates without logout  
- [ ] Admin approves while app open (socket) → same  
- [ ] Kill / reopen → session restore → correct tenant QR + name  
- [ ] Logout / login → no cross-tenant offline QR  
- [ ] Change business name in settings → dashboard + QR labels update; branded PNG refreshes  
- [ ] Upgrade plan on web → mobile resume or `billing.updated` → Premium sections unlock  
- [ ] Push tap → inbox shows latest notifications  
- [ ] Language change → settings query matches new locale  

```bash
cd mobile && npm run typecheck
```
