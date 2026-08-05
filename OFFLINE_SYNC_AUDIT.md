# Offline Synchronization Audit

**Date:** 2026-08-05  
**Scope:** CareTip mobile — AsyncStorage, SecureStore, React Query, offline QR, mutations, connectivity recovery

---

## Executive summary

Mobile offline support is **QR-centric and read-oriented**. There is **no durable mutation outbox**. Cold-start offline correctly refuses an authenticated shell (`session_recovery`) for security. Mid-session offline can still show cached tips/QR when data exists in memory or AsyncStorage.

Critical fixes in this pass: tips prefer stale cache over error walls; onboarding/profile save preflight online; billing/resume sync unchanged from prior audits.

---

## Inventory

| Layer | Behavior |
| --- | --- |
| NetInfo (`utils/network.ts`) | `isConnected !== false` → online |
| React Query | Queries `offlineFirst` + `refetchOnReconnect`; mutations `online`, retry 0 |
| SecureStore | Tokens + user snapshot only |
| AsyncStorage prefs | Language, theme, timeframes, cookie consent (survive logout) |
| Offline QR / branded PNG | User-scoped; cleared on interactive auth + logout |
| Mutation queue | **None** |
| RQ persistence | **None** |

---

## Flow matrix

| Flow | Offline behavior | Risk | Status |
| --- | --- | --- | --- |
| Signup / login | API fails → offline error copy | Auth shell has no OfflineBanner | Documented |
| Onboarding save | **Preflight** `requireOnline` → clear offline message | Was silent fail / stuck busy | **Fixed** |
| Profile edit | **Preflight** online; else toast, no spinner trap | Mutation pause looked stuck | **Fixed** |
| QR Studio / Employee QR | Disk cache mid-session; tenant isolation | Cold start blocked by session_recovery | By design |
| Branded QR | Disk fallback on fetch error | Stale branding possible | Acceptable |
| Tips list | Show cached pages if any; error only when empty | Error wall hid stale tips | **Fixed** |
| Notifications | Inbox invalidate on reconnect; mark-read optimistic | Offline mark-all still network-bound | Improved |
| Logout | Local clear always; push unregister best-effort | Server push token may linger | P2 |
| Bootstrap offline | `session_recovery` — no shell | Offline QR after kill unreachable | Intentional security |

---

## Findings & fixes

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| O1 | P1 | Tips `isError` hid in-memory cache | `TipsListScreen` — error only if `items.length === 0` |
| O2 | P1 | Profile/onboarding mutations paused with busy UI | `requireOnline()` preflight |
| O3 | P1 | No mutation outbox | Documented — not shipping full outbox; preflight instead |
| O4 | P1 | Cold-start offline blocks QR | Documented as intentional (unvalidated JWT) |
| O5 | P2 | Auth screens lack OfflineBanner | Remaining recommendation |
| O6 | P2 | Offline logout push unregister may fail | Best-effort; acceptable |

---

## Files modified

- `mobile/features/tips/TipsListScreen.tsx`
- `mobile/utils/requireOnline.ts` (**new**)
- `mobile/features/auth/BusinessOnboardingScreen.tsx`
- `mobile/features/settings/sections/BusinessProfileSettingsScreen.tsx`

---

## Recommendations

1. Optional AsyncStorage draft for onboarding fields if airplane-mode saves become a support theme.  
2. Add OfflineBanner to `AuthExperienceShell`.  
3. Consider `isInternetReachable` for captive portals.  
4. Do **not** mount authenticated shell from SecureStore snapshot alone while offline.
