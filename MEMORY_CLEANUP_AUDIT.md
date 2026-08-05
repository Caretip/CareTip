# Memory Leak / Cleanup Audit

**Date:** 2026-08-05  
**Scope:** Mobile listeners, timers, sockets across login → logout → login cycles

---

## Executive summary

Most bridges correctly pair subscribe/unsubscribe. Two accumulation risks were found and fixed: **PushNotificationBridge async listener race** and **Socket.IO Manager `io.on` without `io.off`**. Duplicate AppState resume work between AuthSession and Realtime bridges was removed (resume owned solely by `AuthSessionSyncBridge`).

---

## Listener inventory

| Component | Resources | Cleanup | Status |
| --- | --- | --- | --- |
| `RealtimeQueryBridge` | socket.on × N, debounce timeout | socket.off named + clearTimeout | **OK** (AppState removed) |
| `AuthSessionSyncBridge` | AppState | `sub.remove()` | OK |
| `DeepLinkBridge` | Linking | `sub.remove()` | OK |
| `IdleSessionBridge` / scheduler | AppState, intervals, timeouts | `dispose()` | OK |
| `useActivityCenterFeed` | socket helper, poll interval, AppState | cleaned | OK |
| `SocketProvider` | socket + `s.io` reconnect | `io.off` + `removeAllListeners` + close | **Fixed** |
| `PushNotificationBridge` | notification listeners (async) | refs + cancel | **Fixed** |
| `SessionExpiryBridge` | singleton handler | unregisters | OK |
| `ToastHost` / splash / keyboard | timeouts / keyboard | present | OK / low |

---

## Findings & fixes

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| M1 | High | Push subs assigned after await; cleanup saw undefined → leak across logins | Store subs in refs; remove on cancel; re-check `cancelled` after import |
| M2 | Medium | `s.io.on(reconnect*)` not removed | Named handlers + `s.io.off` in cleanup |
| M3 | Medium | Dual AppState resume invalidation | Resume left to AuthSessionSyncBridge only |
| M4 | Low | `AuthFooterSheet` 80ms timeout without clear | Remaining (navigation-only) |

---

## Login cycle stress checklist

- [ ] Login → logout × 20 → no growth in native notification listener count / no double inbox push  
- [ ] Token refresh / reconnect → connectionStatus updates; no orphaned reconnect handlers  
- [ ] Background/foreground × 50 → single AuthUser sync path (network not doubled for same keys)

---

## Files modified

- `mobile/components/providers/PushNotificationBridge.tsx`
- `mobile/components/providers/SocketProvider.tsx`
- `mobile/components/providers/RealtimeQueryBridge.tsx`
