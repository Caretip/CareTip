# Notification Lifecycle Audit

**Date:** 2026-08-05  
**Scope:** Mobile push + Socket.IO inbox + OS badge + deep links

---

## Executive summary

Inbox data is user-scoped React Query (`notifications`, `notificationUnread`), refreshed by socket events, push receive/tap, and reconnect. Warm push taps open the role inbox. Cold-start push taps remain intentionally skipped (Android stale response bug). OS badge is now synced to API unread and cleared on logout.

---

## Lifecycle matrix

| Stage | Behavior | Status |
| --- | --- | --- |
| **Foreground receive** | Invalidate inbox; OS alert/banner **off** (bell-first) | **Fixed** (was duplicate banner) |
| **Background** | OS shows push; tap → invalidate + `router.push(inbox)` | OK |
| **Terminated** | No `getLastNotificationResponseAsync` after login | Intentional — document risk |
| **Push tap (warm)** | Inbox by role | OK |
| **Deep link to inbox** | Not routed in `DeepLinkBridge` | Product gap (P2) |
| **Socket `notification.created`** | Invalidate inbox (+ unread count events) | OK |
| **Dedupe** | Socket `eventId` 60s TTL; push has no local id dedupe | Extra refetch only |
| **Unread stale** | Optimistic mark-read / mark-all | **Fixed** |
| **OS badge** | `setBadgeCountAsync` from unread query; clear on logout | **Fixed** |

---

## Findings & fixes

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| N1 | P1 | OS badge never synced | `notificationBadge.ts` + `useUnreadNotificationCount` effect; clear on logout |
| N2 | P1 | Mark-read no optimistic update | `useNotifications` `onMutate` patch |
| N3 | P1 | Push listener race on logout/login | Ref-held subs + cancel-before-register (`PushNotificationBridge`) |
| N4 | P2 | Foreground OS alert + in-app badge | `shouldShowAlert/Banner: false` when foreground |
| N5 | P1 | Cold-start tap ignored | Kept intentional; remaining product decision |
| N6 | P2 | No inbox universal link | Remaining recommendation |

---

## Files modified

- `mobile/utils/notificationBadge.ts` (**new**)
- `mobile/hooks/useNotifications.ts`
- `mobile/components/providers/PushNotificationBridge.tsx`
- `mobile/services/auth/sessionManager.ts` (badge clear)

---

## Validation

- [ ] Receive push in foreground → bell increments, no OS banner spam  
- [ ] Tap push (app backgrounded) → inbox opens with fresh list  
- [ ] Mark all read → badge goes to 0  
- [ ] Logout → OS badge 0  
- [ ] Login → logout → login rapidly → no duplicate push listeners (no double navigation)
