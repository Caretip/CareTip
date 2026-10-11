# CareTip Authentication & Session Lifecycle Audit

**Audit date:** 2026-09-22  
**Mode:** Read-only forensic audit — no product code changes  
**Scope:** Web SPA (`src/app`) + backend auth (`backend/src`) + related scripts/tests

---

## 1. Executive Summary

CareTip uses a **dual-token web session**: a **15-minute access JWT** held only in memory, and a **7-day HttpOnly refresh cookie** (`caretip_refresh`) rotated on each `POST /api/auth/refresh`. Silent refresh, 401 recovery, and cross-tab refresh coordination are implemented in `src/app/lib/api.ts` with Web Locks (`caretip-auth-refresh-v1`) and bootstrap logic in `useAuthInitializer.ts`.

The toast users report — close to **"Your session expired. Please sign in again."** — is **not shown by the explicit logout handler**. Intentional logout (`useAuth().logout` → `performClientLogoutCleanup`) clears client state **without** calling `markSessionExpiredNotice()`. The message is shown when `AuthPage` / `PlatformAdminLoginPage` consume a one-shot flag in `sessionStorage` that was set by `clearAuthStorageForDefinitiveFailure(401|403)`.

**Root cause of session-expired toast on intentional logout:** After logout, `sessionValidated` remains `true` and `mayClearClientAuthStorage()` returns true. In-flight or trailing protected API requests (or refresh singleton completions) can still hit the **401 → refresh → definitive failure** path, which calls `clearAuthStorageForDefinitiveFailure(401)` and **marks the session-expired notice** even though the user deliberately signed out. The logout path and the session-expiration path share cleanup machinery but **do not share UX intent**.

**Inactivity timeout:** CareTip **does implement** a 15-minute idle timeout (`IDLE_TIMEOUT_MS = 900_000`), with a 120-second warning, unsaved-form grace, and cross-tab sync — but it is **feature-flagged off by default** (`VITE_IDLE_SESSION_TIMEOUT_ENABLED`, unset/false in `.env.example`).

**Network/API resilience:** Transient failures (503, network errors, bootstrap timeout) are generally handled in **degraded mode without forced logout**. Definitive 401/403 after refresh failure, refresh-token reuse detection, explicit logout, and (when enabled) idle timeout are the primary legitimate termination paths.

**Highest-severity finding (remediated in §27):** Definitive-failure clearing did not check `isClientSessionRevoked()` or `isLogoutPending()`, causing **false session-expiration UX on explicit logout**. Fixed via `shouldMarkSessionExpiredNotice()`.

---

## 2. Audit Scope

| Area | Included |
|------|----------|
| Login (email/password, OAuth, MFA) | Yes |
| Logout (client + server) | Yes |
| Access token lifecycle | Yes |
| Refresh token lifecycle + rotation/reuse | Yes |
| Session bootstrap / restoration | Yes |
| 401/403 interceptors | Yes |
| Route guards | Yes |
| Idle/inactivity timeout | Yes |
| Cross-tab auth (Web Locks, idle channel) | Yes |
| Account deactivation (`isActive`, `accountStatus`) | Yes |
| Network/API failure handling | Yes |
| Hidden timers | Yes |
| Test coverage (existing) | Yes |
| Mobile app auth | Referenced only where parallel patterns exist |

**Out of scope:** Implementing fixes, changing security parameters, modifying messages or logout behavior.

---

## 3. Current Authentication Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Browser (CareTip SPA)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  Access JWT     → in-memory only (`accessTokenStore.ts`)                │
│  User snapshot  → localStorage `caretip_user` (UX/bootstrap aid)        │
│  Session hint   → sessionStorage `caretip_session_hint`                 │
│  Revoked latch  → localStorage `caretip_session_revoked` (logout)       │
│  Expired notice → sessionStorage `caretip_session_expired_notice`       │
│  Refresh token  → HttpOnly cookie `caretip_refresh` (Secure/SameSite)   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    POST /api/auth/refresh (credentials: include)
                    Bearer on protected /api/* and /uploads/*
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend (Express)                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Access JWT: default 15m (`JWT_EXPIRES_IN`, auth.service.ts)            │
│  Refresh: DB row, default 7d (`REFRESH_TOKEN_EXPIRES_DAYS`)             │
│  Rotation: `rotateRefreshToken()` — reuse revokes all user sessions     │
│  Middleware: JWT verify + sid/tv bind + isActive/accountStatus          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key modules**

| Module | Role |
|--------|------|
| `useAuth.ts` | Login, logout, proactive JWT renewal timer, `refreshSession` |
| `useAuthInitializer.ts` | One-shot bootstrap refresh with 12s timeout + transient degraded mode |
| `api.ts` | `apiRequest` 401 recovery, `ensureRefreshedSession`, logout API |
| `authRefreshCoordination.ts` | Web Locks + localStorage fallback for refresh mutex |
| `sessionExpiredNotice.ts` | One-shot sessionStorage flag for login toast |
| `clientLogout.ts` | Synchronous cleanup on intentional logout |
| `IdleSessionController.tsx` | Optional 15m idle timeout (flag-gated) |
| `auth.middleware.ts` | Bearer validation, SESSION_STALE, account status |

---

## 4. Login Lifecycle

### 4.1 Email / password

1. `useAuth().login` → `loginAPI` → `apiRequest POST /api/auth/login`
2. On success: `persistAuthResponse` → memory JWT, `localStorage.caretip_user`, `markClientSessionHint`, `clearClientSessionRevoked`, `commitAuthUser`, `markSessionBootstrapSettled`
3. MFA branch returns `MfaLoginChallenge` without persisting session until verify completes

### 4.2 OAuth

`loginWithOAuth` → `oauthAPI` → same `persistAuthResponse` path on success.

### 4.3 Email verification / password reset

- Register returns `requiresEmailVerification` and **clears** stored session (`clearStoredSession`, `commitAuthUser(null)`)
- Unverified users are routed by guards to `/verify-email` based on `emailVerified`

### 4.4 Remember-session

No separate “remember me” toggle for web. Persistence is via **HttpOnly refresh cookie** (7-day default) plus optional `caretip_session_hint` in sessionStorage.

### 4.5 Login while another tab is authenticated

- Access token is per-tab (memory); refresh cookie is shared
- Cross-tab refresh coordinated via Web Locks
- No automatic cross-tab login broadcast; each tab hydrates from storage + refresh

### 4.6 Stale “session expired” on login

`AuthPage` runs `consumeSessionExpiredNotice()` once on mount (`useEffect` deps `[t]`). If a prior definitive 401 set the flag (including logout race), the toast appears **before** the user submits credentials. Successful login does not re-show it (one-shot consume).

---

## 5. Logout Lifecycle

### 5.1 Call chain (intentional logout)

```
Sidebar / UI "Sign out"
  → useAuth().logout()                          [useAuth.ts ~518]
  → flushSync(beginAuthLogoutTransition)        [authLogoutTransition.ts]
  → markLogoutPending()                         [api.ts — sessionStorage]
  → performClientLogoutCleanup(snapshot)        [clientLogout.ts]
       → bumpSessionEpoch()
       → markClientSessionRevoked()              [localStorage latch]
       → commitAuthUser(null)
       → clearClientAuthStorage()               [NO markSessionExpiredNotice]
       → markSessionBootstrapSettled()          [sessionValidated = true]
  → flushSync(navigate(loginPath), signalLogoutAuthPageReady, endAuthLogoutTransition)
  → void logoutAPIWithTimeout(capturedToken)    [background POST /api/auth/logout]
       → finally: clearClientAuthStorage()      [NO sessionExpired flag]
```

### 5.2 Server logout

`POST /api/auth/logout` (`auth.controller.ts` ~1265): revokes refresh row from cookie, clears cookie, disconnects sockets, removes push tokens. Failures/timeouts (8s) are logged; **local session is already cleared**.

### 5.3 Does explicit logout show session-expired toast?

**Not by design.** `performClientLogoutCleanup` and `logoutAPIWithTimeout` never call `markSessionExpiredNotice()`.

**Observed failure mode:** Trailing `apiRequest` 401 handling or `ensureRefreshedSession` completion can still invoke `clearAuthStorageForDefinitiveFailure(401)` after logout because:
- `mayClearClientAuthStorage()` is true (`sessionValidated === true` after `markSessionBootstrapSettled`)
- No guard for `isClientSessionRevoked()`, `isLogoutPending()`, or `isIntentionalUserLogout()`

See §6 and §20.

### 5.4 Cross-tab logout

- `markClientSessionRevoked` writes to **localStorage** (visible cross-tab)
- `notifyAuthStorageSync()` is a **same-tab CustomEvent** only
- Other tabs are **not** immediately cleared; they discover revocation on next refresh/API 401 or idle channel (idle logout broadcasts via `caretip-idle-session` channel)

### 5.5 Idle / automatic logout

Uses the **same** `logout()` function — same race risk for session-expired toast unless trailing requests are suppressed.

---

## 6. Exact Source of "Your Session Has Expired"

### 6.1 Message variants

| Surface | Exact copy (EN) | Source |
|---------|-----------------|--------|
| Login toast (primary UX) | "Your session expired. Please sign in again." | `en.json` → `business.onboarding.toastSessionExpired` |
| API error mapping | "Your session has expired. Please sign in again." | `errorMessages.ts` ERROR_MAP for `"Invalid or expired token"` |
| `refreshSessionAPI` throw fallback | "Your session has expired. Please sign in again." | `api.ts` ~1224, ~1230 |
| User query wording | "Your session has expired. Please login" | **Not exact** — product uses "sign in again" |

German: `de.json` → `"Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an."`

### 6.2 Flag mechanism

```typescript
// sessionExpiredNotice.ts
markSessionExpiredNotice()   → sessionStorage "caretip_session_expired_notice"
consumeSessionExpiredNotice() → read + delete (one-shot)
```

### 6.3 Who sets the flag?

**Only** `clearAuthStorage({ sessionExpired: true })`, called exclusively from:

```typescript
// api.ts
function clearAuthStorageForDefinitiveFailure(status: number): void {
  if (status === 401 || status === 403) {
    clearAuthStorage({ sessionExpired: true });  // ← markSessionExpiredNotice()
  } else {
    clearAuthStorage();
  }
}
```

**Call sites of `clearAuthStorageForDefinitiveFailure`:** `api.ts` lines ~270, ~678, ~690, ~707, ~748, ~755 (401 recovery in `apiRequest`, `ensureRefreshedSession`, `fetchAuthedObjectUrl`).

### 6.4 Who displays it?

| File | Trigger |
|------|---------|
| `AuthPage.tsx` ~123–126 | `useEffect`: `consumeSessionExpiredNotice()` → `toast.message(t("business.onboarding.toastSessionExpired"))` |
| `PlatformAdminLoginPage.tsx` ~57–58 | Same pattern |
| `BusinessOnboardingPage.tsx` ~310–312 | **Separate:** `handleAuthFailure()` calls `logout()` then **explicitly** `toast.error(toastSessionExpired)` |

### 6.5 Condition matrix

| Condition | Sets flag? | Shows toast? |
|-----------|------------|--------------|
| User clicks Logout | No (direct) | **Yes (race)** via trailing 401 path |
| Navigate to /login alone | No | Only if flag already set |
| Auth bootstrap unauthenticated | No | No |
| API 401 + refresh fails definitively | **Yes** | Yes on next login mount |
| Refresh POST 401/403 | **Yes** (via ensureRefreshedSession) | Yes |
| Token JWT exp (proactive refresh succeeds) | No | No |
| Account deactivated (401 SESSION_STALE) | **Yes** | Yes |
| Network failure | No | No (degraded / error toast) |
| Backend 500 on refresh (after retry) | No | Service unavailable message |
| Explicit onboarding auth failure | No flag | **Direct toast** in onboarding page |

### 6.6 Exact call chain — genuine session expiration

```
Protected API returns 401
  → apiRequest 401 handler [api.ts ~658]
  → refreshAccessToken() → ensureRefreshedSession()
  → runRefreshAuthWithRetries() → POST /api/auth/refresh
  → 401/403 OR refresh deemed invalid
  → ensureRefreshedSession: clearAuthStorageForDefinitiveFailure(401)
  → markSessionExpiredNotice()
  → user null / redirect to login
  → AuthPage mount/effect: consumeSessionExpiredNotice() → toast
```

### 6.7 Exact call chain — intentional logout (false session-expired)

```
User clicks Logout
  → performClientLogoutCleanup (no markSessionExpiredNotice)
  → navigate /login → AuthPage mounts
  [Concurrently]
  In-flight GET /api/... returns 401 (cleared Bearer / revoked refresh)
  → refreshAccessToken fails (shouldClearSession: true)
  → clearAuthStorageForDefinitiveFailure(401)
  → markSessionExpiredNotice()                    ← FALSE POSITIVE
  → AuthPage useEffect: consumeSessionExpiredNotice() → toast
```

Additional amplifier: when `isClientSessionRevoked()` is true, `runRefreshAuthWithRetries` calls `clearAuthStorage()` without flag, but **`ensureRefreshedSession` still calls `clearAuthStorageForDefinitiveFailure(401)`** when `shouldClearSession` is true — **adding the flag on top of explicit logout**.

---

## 7. Is the Session-Expired Message Necessary?

### 7.1 Semantic correctness by scenario

| Scenario | Semantically correct? | Current behavior |
|----------|----------------------|------------------|
| A. Explicit user logout | **No** | Often shows toast (race) — **incorrect UX** |
| B. Access token expires, refresh succeeds | No message needed | No flag; user stays authenticated |
| C. Refresh token genuinely expired | **Yes** | Flag + toast |
| D. Refresh token revoked (logout elsewhere) | **Yes** (with nuance) | Flag + toast; could say "signed out elsewhere" |
| E. Refresh reuse detected | **Yes** | All sessions revoked server-side; flag + toast |
| F. Invalid session / SESSION_STALE | **Yes** | Flag + toast |
| G. Network failure | **No** | Degraded mode; no flag |
| H. Backend 500 | **No** | Transient handling; no definitive flag |
| I. Database unavailable | **No** | Refresh returns 503 transient; no logout |
| J. Browser/tab bfcache restore | N/A alone | No automatic flag; idle scheduler re-evaluates |
| K. App bootstrap timeout | **No** | `transient_error` degraded; no flag |

### 7.2 Conflation finding

The application **conflates definitive auth invalidation with intentional logout cleanup** because both funnel into shared 401/refresh failure handling that unconditionally sets `sessionExpired: true` for HTTP 401/403 when `mayClearClientAuthStorage()` is true — **without checking logout intent**.

**What the message SHOULD mean (per architecture):**  
*"Your refresh session can no longer be restored; you must authenticate again."*  
It should **not** appear for voluntary sign-out.

---

## 8. Complete Automatic Logout Inventory

| # | Trigger | Location | Clears tokens | Navigates login | Sets expired notice | Server revoke |
|---|---------|----------|---------------|-----------------|---------------------|---------------|
| 1 | User logout | `useAuth.logout` → `clientLogout` | Yes | Yes | No (direct) | Async POST logout |
| 2 | Idle timeout (flag on) | `useIdleSessionGuard` → `logout()` | Yes | Yes | Race only | Async POST logout |
| 3 | Idle manual from warning | Same | Yes | Yes | Race only | Async |
| 4 | Cross-tab idle logout msg | `idleSessionSync` → `runLogout` | Yes | Yes | Race only | Async |
| 5 | API 401 + failed refresh | `apiRequest` / `ensureRefreshedSession` | Yes | Indirect (user null → guard) | **Yes** | No |
| 6 | Refresh POST 401/403 | `ensureRefreshedSession` | Yes | Indirect | **Yes** | N/A |
| 7 | `fetchAuthedObjectUrl` 401 | `api.ts` ~742–755 | Yes | Indirect | **Yes** | No |
| 8 | Bootstrap definitive failure | `useAuthInitializer` `forceDefinitiveLogout` | Yes | Indirect | No | No |
| 9 | `useAuth.refreshSession` catch | `useAuth.ts` ~651–654 | Yes | No auto-nav | No | No |
| 10 | Onboarding auth failure | `BusinessOnboardingPage.handleAuthFailure` | Yes | Via logout | Direct toast | Async |
| 11 | Email verification success sign-out | `EmailVerificationSuccessScreen` | Yes | Yes | Race only | Async |
| 12 | Check email / settings logout | Various pages | Yes | Yes | Race only | Async |
| 13 | Exit impersonation failure | `exitImpersonation` | Yes | `/platform-admin/login` | No (different state) | N/A |
| 14 | Refresh token reuse (server) | `rotateRefreshToken` revokes all | Next refresh fails → #5 | Yes | **Yes** | Server-side |
| 15 | Account deactivated | Middleware 401 | Via #5 | Yes | **Yes** | N/A |
| 16 | Password reset / token version bump | Server invalidates sessions | Via #5 on next API | Yes | **Yes** | Server-side |

**Functions that clear auth storage**

- `clearClientAuthStorage()` — memory JWT, `caretip_user`, session hint; preserves revoked latch
- `clearAuthStorage({ sessionExpired? })` — above + optional notice
- `clearAuthStorageForDefinitiveFailure(401|403)` — always marks notice
- `performClientLogoutCleanup()` — full client teardown + revoked latch
- `markClientSessionRevoked()` — blocks refresh attempts

**Navigation to login**

- `useAuth.logout` → `navigate(loginPath)`
- Route guards → `<Navigate to={loginPath} />` when `!user` and not stored-session sync

---

## 9. Inactivity / Idle Timeout Audit

### 9.1 Exists?

**Yes — implemented but disabled by default.**

| Constant | Value | File |
|----------|-------|------|
| `IDLE_TIMEOUT_MS` | **900,000 ms (15 min)** | `idleSessionConfig.ts` |
| `IDLE_WARNING_BEFORE_MS` | 120,000 ms (warning at **13 min** idle) | same |
| `UNSAVED_GRACE_MS` | 60,000 ms extra if forms dirty | same |
| `ACTIVITY_THROTTLE_MS` | 30,000 ms broadcast throttle | same |
| Feature flag | `VITE_IDLE_SESSION_TIMEOUT_ENABLED` — **default off** | `.env.example` commented `false` |

### 9.2 Implementation

- `IdleSessionController.tsx` — gates on flag + authenticated + `sessionValidated` + not logout transition
- `useIdleSessionGuard.ts` — activity listeners, scheduler, warning modal, calls `logout()`
- `idleSessionActivity.ts` — trusted events: **`pointerdown`, `keydown`, `touchstart` only** (not scroll/mousemove)
- `idleSessionScheduler.ts` — `setTimeout` deadlines + 45s watchdog + `visibilitychange` / `pageshow` wake
- Cross-tab: `BroadcastChannel` `caretip-idle-session` + localStorage bus fallback

### 9.3 Behavior when idle expires

1. Warning modal at T−120s with countdown (document title sync)
2. If unsaved dirty forms: +60s unsaved grace phase
3. Hard expiry → `runLogout("timeout")` → same `useAuth().logout()`
4. Analytics: `idle_logout` / `idle_logout_manual`

### 9.4 Distinction from JWT expiration

JWT access expiry (**15m**) is **not** inactivity timeout. Proactive refresh in `useAuth` (`useEffect` ~392–429) renews ~90s before JWT `exp` while user object exists. Refresh cookie lifetime (**7d**) is absolute, not activity-based.

**When flag is off (default):** No idle logout occurs in production unless env enables it.

---

## 10. Access Token Lifecycle

| Property | Value |
|----------|-------|
| Lifetime | **15 minutes** default (`JWT_EXPIRES_IN` in `auth.service.ts`) |
| Storage | **Memory only** (`accessTokenStore.ts`); legacy `caretip_token` migrated then removed |
| Attached | `attachLatestBearer()` on protected fetches |
| Proactive renewal | Timer in `useAuth` fires ~90s before JWT exp; calls `refreshSessionAPI()` |
| Expiry without refresh | API 401 → silent refresh attempt |
| Impersonation JWT | Separate 12h default (`JWT_IMPERSONATION_EXPIRES_IN`) |

**Healthy path when access token expires:**  
401 (or missing memory token with hint) → `refreshAccessToken` → new JWT in memory → request retried → user remains authenticated.

---

## 11. Refresh Token Lifecycle

| Property | Value |
|----------|-------|
| Lifetime | **7 days** default (`REFRESH_TOKEN_EXPIRES_DAYS`) |
| Storage | HttpOnly cookie `caretip_refresh`; `Secure` + `SameSite=none` (prod) / `lax` (dev) |
| Header mirror | `X-CareTip-Refresh` for native clients |
| Rotation | Every successful refresh (`rotateRefreshToken`) |
| Reuse detection | Revoked token with `replacedByTokenId` → revoke **all** user refresh rows |
| Explicit logout revoke | `replacedByTokenId == null` → **does not** mass-revoke other devices |
| DB binding | Access JWT carries `sid` + `tv` matched on each request |

---

## 12. Refresh Failure Handling

### 12.1 Classification (`runRefreshAuthWithRetries`)

| Failure class | HTTP / status | `shouldClearSession` | Marks expired notice |
|---------------|---------------|----------------------|----------------------|
| A. Refresh genuinely expired | 401 | true | **Yes** |
| B. Refresh revoked (logout) | 401 | true | **Yes** (via ensureRefreshedSession) |
| C. Reuse detected | 401 (null rotate) | true | **Yes** |
| D. Malformed response | non-OK parse fail | true | **Yes** |
| E. Network timeout / fetch error | status 0 after retry | **false** | No |
| F. Backend 500+ (transient) | 502/503/504/429/5xx | **false** (after 2 attempts + cooldown) | No |
| G. Database unavailable | Typically 503 | **false** | No |
| H. Proxy/CDN failure | 502/504 | **false** | No |
| I. Coordination timeout | `RefreshCoordinationTimeoutError` → 504 | **false** | No |
| Client session revoked latch | internal | true (double clear) | **Yes** (second clear) |

### 12.2 Cooldown

`REFRESH_FAILURE_COOLDOWN_MS = 15_000` — avoids hammering after transient 503 when token still present.

---

## 13. Network/API Failure Handling

| Failure | Logout? | Mechanism |
|---------|---------|-----------|
| Airplane mode / offline fetch | **No** | `runRefreshAuthWithRetries` status 0 → `shouldClearSession: false`; bootstrap `transient_error` |
| Wi-Fi blip | **No** | `fetchWithNetworkRetry` (2.5s delay, cross-origin `/api` only) |
| DNS failure | **No** | Treated as connectivity; `API_WAKEUP_NETWORK_MESSAGE` |
| API timeout (logout POST) | **No** | 8s abort; local already cleared |
| HTTP 500 on refresh | **No** | Transient after retry + cooldown |
| HTTP 502/503/504 | **No** | Transient; `SERVICE_UNAVAILABLE_CLIENT_MESSAGE` toast on bootstrap |
| Database timeout | **No** | Mapped to 503 on refresh controller catch |
| Cold Render wake-up | **No** | Network retry + bootstrap degraded settle (12s) |
| HTTP 401 on protected API after refresh exhausted | **Yes** | Definitive |

**Critical distinction:** CareTip **does** distinguish network/availability from auth invalidation in refresh and bootstrap paths. **Exception:** persistent 401 after refresh retries is always treated as auth failure (correct for security, problematic when 401 caused by logout race).

---

## 14. Auth Bootstrap

### 14.1 Flow

```
App mount → useAuthInitializer (once)
  → ensureAuthSessionBootstrap
  → if isClientSessionRevoked → unauthenticated (clear storage)
  → if shouldAttemptBootstrapRefresh (stored user OR session hint)
       → bootstrapRefreshWithTimeout (12s race)
       → bootstrapRefreshSession → ensureRefreshedSession
  → applyBootstrapResult
```

### 14.2 Timeout behavior (`BOOTSTRAP_REFRESH_TIMEOUT_MS = 12_000`)

- **Had local session:** resolves `transient_error` — **no logout**, shows service unavailable toast, enters degraded mode (`markSessionBootstrapDegraded`)
- **Anonymous:** resolves `unauthenticated`
- **Never** calls `markSessionExpiredNotice` on timeout

### 14.3 Transient recovery

- `TRANSIENT_DEGRADED_SETTLE_MS = 12_000` — unblocks shell with cached user
- Retries up to **8** times every **4s** via `refreshSessionAPI`
- Definitive failure on retry → `forceDefinitiveLogout` (clears session, **no** expired notice flag)

### 14.4 Post-logout bootstrap suppress

`isIntentionalUserLogout()` (`authTransitionIntent.ts`) suppresses bootstrap overlay for ~600ms after logout transition. **Does not** suppress trailing API 401 handlers.

### 14.5 Slow backend false logout?

**Bootstrap timeout alone:** No — degrades gracefully.  
**Slow refresh beyond 12s during active use:** Refresh coordination timeout returns non-clearing 504.

---

## 15. Route Guard Behavior

### 15.1 ProtectedRoute / useProtectedRouteGate

Waits while:
- `authStatus === "initializing"`
- `isAuthRestorePending()`
- `storedSessionSync` (stored user but null in memory, not revoked)
- Onboarding guard `decision.kind === "wait"`

**Does not redirect** during:
- Logout transition (keeps children mounted under cover)
- Sign-in handoff
- Auth loading / refresh in progress (initializing)

**Redirects to login when:** `!user` and not stored-session sync and not logout transition.

### 15.2 PlatformAdminRoute

Same auth blocking pattern; redirects to `/platform-admin/login` if unauthenticated.

### 15.3 Violations / risks

| Risk | Severity | Notes |
|------|----------|-------|
| Redirect while token refresh in progress | Low | Guards wait on `initializing` |
| Lazy chunk load failure | Low | Separate from auth; chunk hold shell |
| Network offline + cached user in degraded mode | Low | User may see stale data; not logged out |
| `storedSessionSync` indefinite wait | Low | Cleared when user null + revoked or storage empty |

---

## 16. Cross-Tab Authentication

### 16.1 Refresh coordination

- **Web Lock:** `caretip-auth-refresh-v1`
- Fallback: localStorage lock + `storage` events + BroadcastChannel
- Peer success window: 4s (`hasRecentPeerRefreshSuccess`) — loser retries once before definitive failure

### 16.2 Scenarios

| Scenario | Behavior |
|----------|----------|
| **A. Tab A logs out** | Tab A cleared immediately. Tab B retains memory JWT until next API/refresh; revoked cookie → 401 chain → cleared. **No** instant Tab B logout via storage listener for auth. Idle channel propagates idle logout only. |
| **B. Tab A refreshes session** | Rotated cookie; Tab B's next refresh may hit reuse if it holds old cookie — **reuse detection revokes all** → both logged out (security feature). |
| **C. Simultaneous refresh** | Web Lock serializes; one rotates, other retries after peer success signal. |
| **D. Background tab after minutes** | Access JWT may expire; next request refreshes. Idle timer fires on visibility/pageshow if flag enabled. |
| **E. Return from Stripe** | External Stripe hold uses `pagehide`; stale state cleared on bfcache restore (`staleExternalStripeState.ts`). Auth uses refresh cookie — generally OK unless session revoked while away. |

### 16.3 bfcache

- Idle scheduler listens to `pageshow` → re-evaluates deadlines (can trigger idle warning/logout if flag on and time elapsed)
- No dedicated auth bfcache invalidation — relies on next API/refresh

---

## 17. Account Deactivation / isActive

### 17.1 Backend enforcement

`assertAccessJwtStillValid` (`auth.middleware.ts` ~108):

```typescript
if (!row || row.isActive !== true || row.accountStatus !== "active") {
  return "Authentication required";
}
```

Returns **401** with optional `SESSION_STALE` code → client definitive failure path → session-expired notice.

### 17.2 Intentional?

**Yes** — deactivated accounts cannot use protected APIs. Existing refresh rows may still exist until next refresh attempt fails validation.

### 17.3 Related flows

- Staff roster `isActive` is separate from user account status (employee row flag)
- Platform admin requires `isActive`, `isPlatformAdmin`, role SUPER_ADMIN

---

## 18. Hidden Timers / Timeouts

| Timer | Duration | File | On fire | Can logout? |
|-------|----------|------|---------|-------------|
| Proactive JWT refresh | ~4s min, exp−90s | `useAuth.ts` | `refreshSessionAPI` | No (catch silent) |
| Refresh failure cooldown | 15s | `api.ts` | Blocks refresh retry | No |
| Refresh retry backoff | 500ms / 2s | `api.ts` | Retry fetch | No |
| 401 delayed retry | 250ms | `api.ts` | Re-fetch | Only if still 401 |
| Network retry delay | 2.5s | `api.ts` | Second fetch | No |
| Bootstrap refresh timeout | **12s** | `useAuthInitializer.ts` | transient_error | **No** |
| Transient degraded settle | **12s** | `useAuthInitializer.ts` | degraded unlock | **No** |
| Transient bootstrap retry | 4s × 8 | `useAuthInitializer.ts` | refresh retry | Only if definitive |
| Logout API timeout | **8s** | `api.ts` | Abort logout POST | No (local cleared) |
| Logout transition max | 15s | `authLogoutTransition.ts` | End transition | No |
| Post-logout bootstrap suppress | 600ms | `authLogoutTransition.ts` | UI suppress | No |
| Refresh coord timeout | **12s** | `authRefreshCoordination.ts` | 504 non-clearing | **No** |
| Idle warning/logout | 13m / 15m | `idleSessionConfig.ts` | Warning / logout | **Yes** (if flag on) |
| Idle watchdog | 45s | `idleSessionScheduler.ts` | Re-eval idle | Only if idle armed |
| Idle tick | 1s | idle config | UI countdown | No |
| Stale Web Lock | 120s | `authRefreshCoordination.ts` | Lock recovery | No |

---

## 19. Legitimate Session Termination

1. User clicks Sign out (any surface)
2. Idle timeout hard logout (**when `VITE_IDLE_SESSION_TIMEOUT_ENABLED=true`**)
3. Idle warning "Log out now"
4. Refresh token absolute expiry (~7 days without refresh)
5. Refresh token revoked (server logout, admin action, rotation + old token)
6. Refresh token **reuse detection** (security — all sessions revoked)
7. Access/refresh bind failure (`SESSION_STALE`, `tv` mismatch, invalid `sid`)
8. Account `isActive !== true` or `accountStatus !== "active"`
9. Email-not-verified 403 on refresh (clears cookie; treated as auth failure)
10. MFA / verification session expiry (separate copy, related flows)
11. `forceDefinitiveLogout` after bootstrap retry classifies definitive refresh error
12. Manual onboarding `handleAuthFailure` (explicit logout + toast)

---

## 20. Potential Unexpected Logout Paths

| # | Path | Likelihood | Mechanism |
|---|------|------------|-----------|
| 1 | **Session-expired toast on intentional logout** | **High** | Trailing 401 → `clearAuthStorageForDefinitiveFailure` after `markClientSessionRevoked` |
| 2 | Cross-tab refresh rotation race | Medium | Old tab uses stale refresh → reuse → all sessions revoked |
| 3 | `useAuth.refreshSession` user-triggered definitive error | Low | Clears session without navigation; guard may redirect |
| 4 | Bootstrap retry mis-classifies transient as definitive | Low | `isDefinitiveRefreshFailure` regex false positive |
| 5 | bfcache + idle flag enabled + long background | Low | Idle deadlines fire on pageshow |
| 6 | Tab B stale after Tab A logout | Medium | Unexpected 401 on next action (correct security; poor sync UX) |
| 7 | Proactive refresh during idle logout | Mitigated | `isIdleLogoutInFlight()` check |
| 8 | Access 401 logged out despite valid refresh during cooldown | Low | If token present and within 15s cooldown, refresh skipped — 401 may persist until retry |
| 9 | Onboarding conflates any auth error with session expired | Medium | `handleAuthFailure` always shows expired toast |

**Not observed as logout triggers:** pure network offline, bootstrap 12s timeout, refresh 503, logout API timeout, chunk load failure.

---

## 21. Security vs Availability Findings

| Mechanism | Security purpose | Availability risk |
|-----------|------------------|-------------------|
| Refresh reuse → revoke all | Stolen refresh detection | Legitimate multi-tab race can force re-login |
| 401 → refresh → clear on failure | Prevent stale credential use | Trailing requests after logout mark false expired |
| `markClientSessionRevoked` | Block refresh resurrection after logout | ensureRefreshedSession still marks expired notice |
| Web Lock refresh mutex | Prevent rotation races | 12s timeout → degraded non-logout |
| Bootstrap degraded mode | Avoid false logout on cold start | User may briefly use stale cached identity |
| `mayClearClientAuthStorage` gate | Avoid clear during bootstrap | Stays true after logout — enables false positive |
| Account deactivation 401 | Block inactive users | Correct — intentional |
| Idle timeout (flag) | Unattended terminal protection | False logout if flag on and user reads without pointer events |

**Do not weaken:** reuse detection, refresh rotation, SESSION_STALE binding, revoked latch on logout, bootstrap transient degraded mode.

**Conflation to fix (UX layer only):** distinguish `sessionExpired` notice from `intentionalLogout` in definitive-failure handler.

---

## 22. Existing Test Coverage

| Area | Coverage | Script / file |
|------|----------|---------------|
| Cross-tab refresh coordination | **Good** | `test:auth-refresh-coordination`, `test:auth-refresh-multitab-browser` |
| Refresh security / reuse | **Good** | `test:auth-refresh-security`, `backend/scripts/auth-refresh-reuse-detection-runtime.ts` |
| UX stability (session expired one-shot) | **Partial** | `test:ux-stability-remediation` — flag consume only |
| Idle session infra/activity/warning/multitab | **Good** (flag off default) | `test:idle-session-*` (6 scripts) |
| Bootstrap transient degraded | **Architecture asserts** | `ux-stability-remediation-runtime.ts` |
| E2E login/guards | **Partial** | `e2e/auth-flows.spec.ts` — routing, mocked refresh; **no logout toast test** |
| Explicit logout vs session-expired toast | **None** | — |
| Network failure → no logout | **Partial** | Classification unit in ux-stability |
| bfcache auth | **None** | — |
| Account deactivation session kill | **Backend middleware** | No frontend E2E |

**Recommended tests (report only — not implemented):**

1. Logout with in-flight protected fetch → login must **not** show session-expired toast  
2. Genuine refresh 401 → toast **must** show once  
3. Bootstrap 503 → user remains on dashboard degraded  
4. Two-tab refresh rotation — assert no spurious logout when lock works  
5. Idle timeout (flag on) — warning then logout without false expired message on manual logout path  

---

## 23. Findings by Severity

### CRITICAL

None identified for security compromise. No finding that leaves sessions authenticated after refresh revocation.

### HIGH

| ID | Finding |
|----|---------|
| H-1 | **Session-expired toast on intentional logout** — `clearAuthStorageForDefinitiveFailure` runs after logout due to trailing 401/refresh without checking logout intent (`api.ts`, `useAuth.logout`). |

### MEDIUM

| ID | Finding |
|----|---------|
| M-1 | **Cross-tab explicit logout not synchronized** — Tab B keeps memory session until next API failure; confusing UX, not instant sign-out. |
| M-2 | **Refresh rotation reuse can logout all tabs** — correct security, availability cost when tabs race. |
| M-3 | **`BusinessOnboardingPage.handleAuthFailure`** always shows session-expired toast even for non-expiry errors. |
| M-4 | **Bootstrap definitive failure does not set expired notice** — inconsistent UX vs API 401 path (reload after expiry may omit toast). |
| M-5 | **`useAuth.refreshSession` clears without notice or navigation** — caller-dependent UX. |

### LOW

| ID | Finding |
|----|---------|
| L-1 | Copy inconsistency: "sign in" vs "login" vs "session expired" vs "session has expired". |
| L-2 | Idle timeout ignores scroll/mousemove — reading long pages counts as idle (if flag enabled). |
| L-3 | `mayClearClientAuthStorage` remains true indefinitely after logout until next login. |

### INFORMATIONAL

| ID | Finding |
|----|---------|
| I-1 | Idle timeout **enabled on Render production**; `.env.example` defaults off for local dev only. |
| I-2 | Access JWT 15m ≠ inactivity timeout; proactive refresh keeps active users signed in. |
| I-3 | Logout POST is best-effort (8s timeout); security relies on refresh revocation when request succeeds. |
| I-4 | `scripts/ux-stability-remediation-runtime.ts` documents intended transient vs definitive split. |

---

## 24. Recommended Remediation

### P0 — Must address

1. **Suppress `markSessionExpiredNotice` during intentional logout**  
   In `clearAuthStorageForDefinitiveFailure` and/or `apiRequest` 401 handler, skip `{ sessionExpired: true }` when `isClientSessionRevoked()`, `isLogoutPending()`, or `isIntentionalUserLogout()`.

2. **Cancel or ignore in-flight protected requests on logout**  
   Optional: AbortController registry aborted in `performClientLogoutCleanup` to prevent trailing 401 handlers.

3. **Add regression test** for logout → login without session-expired toast (`test:ux-stability-remediation` or E2E).

### P1 — Should address

4. **Cross-tab logout sync** — listen for `storage` event on `caretip_session_revoked` and clear Tab B memory user + navigate to login without expired notice.

5. **Unify bootstrap expired UX** — when bootstrap clears expired local session, optionally set a distinct notice vs API-driven expiry.

6. **Onboarding `handleAuthFailure`** — classify error; do not always use session-expired copy.

7. **Document idle flag** — ops runbook for `VITE_IDLE_SESSION_TIMEOUT_ENABLED`.

### P2 — Optional improvement

8. Copy harmonization across EN/DE and ERROR_MAP vs toast key.  
9. Distinct message for "signed out on another device" vs "session timed out".  
10. bfcache auth probe on `pageshow` (refresh if cookie hint present).  
11. E2E coverage for refresh failure, network degraded, idle (flag on staging).

---

## 25. Regression Risks

| Change | Risk |
|--------|------|
| Suppressing expired notice on logout | Must not suppress on **genuine** expiry that happens to occur near logout click |
| Cross-tab logout listener | Could double-navigate or fight with active logout transition |
| Weakening 401 clear guard | Could leave stale authenticated UI with invalid credentials |
| Enabling idle timeout globally | Support burden; users may report "random logout" if unaware |
| Touching refresh reuse logic | Security regression if rotation/revoke rules change |

---

## 26. Evidence / Code References

### Session expired notice

- `src/app/lib/sessionExpiredNotice.ts` — `markSessionExpiredNotice`, `consumeSessionExpiredNotice`
- `src/app/lib/api.ts` — `clearAuthStorage` (~334), `clearAuthStorageForDefinitiveFailure` (~341), `apiRequest` 401 block (~658–708), `ensureRefreshedSession` (~252–287)
- `src/app/components/AuthPage.tsx` — ~123–126
- `src/i18n/locales/en.json` — `business.onboarding.toastSessionExpired`

### Logout

- `src/app/hooks/useAuth.ts` — `logout` ~518–552
- `src/app/lib/clientLogout.ts` — `performClientLogoutCleanup`
- `src/app/lib/api.ts` — `logoutAPIWithTimeout` ~931–1006, `markClientSessionRevoked` ~82
- `src/app/lib/authLogoutTransition.ts` — transition + `isIntentionalUserLogout` helpers
- `backend/src/controllers/auth.controller.ts` — `logout` ~1265

### Refresh & tokens

- `backend/src/services/auth.service.ts` — `jwtExpiresIn` ~99–101
- `backend/src/services/refreshToken.service.ts` — TTL, rotation, reuse ~177–238
- `src/app/lib/authRefreshCoordination.ts` — Web Locks, timeouts
- `src/app/lib/accessTokenStore.ts` — memory-only JWT

### Bootstrap

- `src/app/hooks/useAuthInitializer.ts` — full bootstrap + timeouts
- `src/app/lib/authSessionBootstrap.ts` — flags, degraded mode

### Idle timeout

- `src/app/lib/idleSessionConfig.ts` — 15m / 13m warning
- `src/app/components/IdleSessionController.tsx`
- `src/app/hooks/useIdleSessionGuard.ts`

### Guards & account status

- `src/app/components/ProtectedRoute.tsx`
- `src/app/hooks/useProtectedRouteGate.ts`
- `backend/src/middleware/auth.middleware.ts` — `assertAccessJwtStillValid` ~98–132

### Classification

- `src/app/lib/authRefreshFailureClassification.ts` — `isDefinitiveRefreshFailure`

---

## Mandatory Findings — Direct Answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Why does session-expired appear during logout? | Trailing in-flight API 401/refresh failure calls `clearAuthStorageForDefinitiveFailure(401)` which sets `markSessionExpiredNotice()` **after** explicit logout cleanup; `AuthPage` consumes it. |
| 2 | Is that behavior correct? | **No** for UX semantics — intentional logout should not present as session expiration. |
| 3 | Is there an inactivity/no-activity timeout? | **Yes, 15 minutes** — **enabled on Render production** (`VITE_IDLE_SESSION_TIMEOUT_ENABLED=true`); local `.env.example` defaults off for dev. |
| 4 | Other automatic logout mechanisms? | 401+failed refresh, refresh reuse revocation, account deactivation, bootstrap definitive retry failure, idle timeout (when enabled). |
| 5 | Can temporary network/API failure log a user out? | **Generally no** for refresh/bootstrap (transient path). **Yes** if a transient appears as persistent 401 after retries (unusual). |
| 6 | Can access-token expiration log out when refresh should succeed? | **Not in normal operation** — 401 triggers refresh first. Failure only if refresh blocked/cooldown/revoked/fails. |
| 7 | Can auth bootstrap timeout cause logout? | **No** — yields degraded mode with cached user for up to 12s+ retries. |
| 8 | Can cross-tab behavior cause unexpected logout? | **Yes** — refresh rotation reuse revokes all sessions; Tab B lag after Tab A logout until next API call. |
| 9 | Can bfcache/restoration cause unexpected logout? | **Unlikely** unless idle flag enabled and idle deadline passed while frozen; otherwise next API refresh restores or fails legitimately. |
| 10 | ALL legitimate logout reasons? | See §19. |
| 11 | ALL potential false/unexpected logout paths? | See §20. |
| 12 | Mechanisms that must remain untouched for security? | Refresh rotation + reuse revocation, SESSION_STALE/`sid`/`tv` binding, `markClientSessionRevoked` refresh block, Web Lock mutex, bootstrap transient degraded (no clear on 503), account status enforcement. |

---

## Appendix A — Event vs Message Classification Table

| Event | Should show "session expired"? | Current behavior |
|-------|-------------------------------|------------------|
| User clicks Logout | **No** | **Fixed** — guarded by `shouldMarkSessionExpiredNotice()` (see §27) |
| Access token expires, refresh succeeds | No | Correct |
| Refresh token genuinely expires | Yes | Correct (flag + toast) |
| Refresh token revoked | Yes (or "signed out") | Correct (flag + toast) |
| Refresh token reuse detected | Yes | Correct |
| Network temporarily unavailable | No | Correct |
| API 500 | No | Correct |
| API 503 | No | Correct (degraded) |
| Backend cold start | No | Correct (retry/degraded) |
| Account deactivated | Yes | Correct |
| Browser restored from bfcache | Only if session actually invalid | Generally correct |
| User returns after long inactivity | Yes if refresh expired; idle if flag on | Depends on refresh cookie + flag |

---

## Appendix B — Copy Reference

| Key / source | English |
|--------------|---------|
| `business.onboarding.toastSessionExpired` | Your session expired. Please sign in again. |
| ERROR_MAP `"Invalid or expired token"` | Your session has expired. Please sign in again. |
| `fallbackMessageForHttpStatus(401)` | Please sign in to continue. |

---

## 27. Remediation (2026-09-22) — Priority 1 & 2

### 27.1 Executive summary (post-remediation)

Priority 1 is **fixed** with a minimal lifecycle guard: `shouldMarkSessionExpiredNotice()` in `api.ts` prevents `markSessionExpiredNotice()` when the client session is intentionally torn down (`isClientSessionRevoked()` or `isLogoutPending()`). Trailing 401/403 handlers after explicit logout (including idle-timeout logout, which uses the same `logout()` path) no longer produce the false “session expired” toast.

Genuine session invalidation is **unchanged**: when the session is not revoked and logout is not pending, definitive 401/403 still sets the one-shot notice consumed by `AuthPage` / `PlatformAdminLoginPage`.

Priority 2 re-confirms the original audit: transient network/503/bootstrap paths do not force logout; security invalidation (reuse detection, SESSION_STALE, account deactivation) remains intact. **Idle session timeout was not modified** — it is **enabled on Render production** and left completely untouched.

### 27.2 Exact root cause (confirmed)

```
User clicks Logout (or idle timeout → logout())
  → markLogoutPending()
  → performClientLogoutCleanup()
       → markClientSessionRevoked()   // localStorage latch
       → clearClientAuthStorage()     // no session-expired flag
  → navigate(loginPath)
  [Concurrent]
  In-flight apiRequest / ensureRefreshedSession completes
  → clearAuthStorageForDefinitiveFailure(401|403)
  → markSessionExpiredNotice()         // FALSE POSITIVE (before fix)
  → AuthPage consumeSessionExpiredNotice() → toast
```

**Why it happened:** `clearAuthStorageForDefinitiveFailure` treated all definitive 401/403 alike. It did not distinguish intentional logout (revoked latch already set) from genuine server-side invalidation. `ensureRefreshedSession` could call `clearAuthStorageForDefinitiveFailure` even after `runRefreshAuthWithRetries` detected `isClientSessionRevoked()`.

### 27.3 Files / functions involved

| File | Function / symbol | Role |
|------|-------------------|------|
| `src/app/lib/api.ts` | `shouldMarkSessionExpiredNotice()` | **New guard** |
| `src/app/lib/api.ts` | `clearAuthStorage()` | Calls `markSessionExpiredNotice()` only when guard passes |
| `src/app/lib/api.ts` | `clearAuthStorageForDefinitiveFailure()` | All definitive 401/403 clearing paths |
| `src/app/lib/api.ts` | `ensureRefreshedSession()`, `apiRequest`, `fetchAuthedObjectUrl` | Call sites |
| `src/app/lib/clientLogout.ts` | `performClientLogoutCleanup()` | Sets revoked latch before trailing work |
| `src/app/hooks/useAuth.ts` | `logout()` | `markLogoutPending()` before cleanup |
| `src/app/lib/sessionExpiredNotice.ts` | `markSessionExpiredNotice` / `consumeSessionExpiredNotice` | One-shot toast flag |
| `src/app/components/AuthPage.tsx` | `useEffect` consume | Displays toast |
| `scripts/auth-logout-session-expired-runtime.ts` | Regression test | Proves guard behavior |

**Intentionally untouched:** idle session modules (`idleSessionConfig.ts`, `IdleSessionController`, `useIdleSessionGuard`, scheduler, channel), JWT/refresh security, Web Locks, backend auth.

### 27.4 Before / after logout lifecycle

**Before:** Trailing auth failure after logout could set `caretip_session_expired_notice` in sessionStorage → login toast.

**After:**

1. Logout begins → `markLogoutPending()` (sessionStorage).
2. `performClientLogoutCleanup()` → `markClientSessionRevoked()` (localStorage) + clear tokens.
3. Navigate to login; logout transition unchanged.
4. Trailing 401/403 → `clearAuthStorageForDefinitiveFailure` may still clear idempotent state but **`shouldMarkSessionExpiredNotice()` returns false`** → no notice.
5. Login page: no session-expired toast from intentional logout.
6. On next successful login → `clearClientSessionRevoked()` restores ability to show future genuine expiry notices.

### 27.5 Exact remediation implemented

```typescript
// src/app/lib/api.ts
export function shouldMarkSessionExpiredNotice(): boolean {
  return !isClientSessionRevoked() && !isLogoutPending();
}

function clearAuthStorage(options?: { sessionExpired?: boolean }): void {
  if (options?.sessionExpired && shouldMarkSessionExpiredNotice()) {
    markSessionExpiredNotice();
  }
  clearClientAuthStorage();
}
```

No `setTimeout`, no CSS hiding, no global removal of the toast, no auth architecture refactor.

### 27.6 Proof — intentional logout

- `markClientSessionRevoked()` → `shouldMarkSessionExpiredNotice()` is **false**.
- `markLogoutPending()` → **false** during logout handoff.
- Trailing 401 after revoked + cleared pending → **false**.
- Regression: `npm run test:auth-logout-session-expired` **PASS**.

### 27.7 Proof — genuine session expiration preserved

- With no revoked latch and no logout pending → `shouldMarkSessionExpiredNotice()` is **true**.
- `clearAuthStorage({ sessionExpired: true })` still sets notice.
- `consumeSessionExpiredNotice()` one-shot behavior unchanged (`ux-stability-remediation` **PASS**).

### 27.8 Automatic logout inventory (unchanged from §8)

See §8. Remediation only affects **classification of the session-expired toast**, not which paths clear auth.

### 27.9 Unexpected logout risks (Priority 2)

| Risk | Class | Still present? | Notes |
|------|-------|----------------|-------|
| Trailing 401 false “session expired” toast on logout | UX misclassification | **Fixed** | Guard |
| Cross-tab refresh rotation race → reuse revoke | Security-required | Yes | By design |
| Tab B stale after Tab A logout until next API | Expected lag | Yes | Not toast-related |
| Bootstrap transient 503 | Transient/recoverable | No logout | Degraded mode |
| Refresh 503/network | Transient/recoverable | No logout | Cooldown + retries |
| `BusinessOnboardingPage.handleAuthFailure` explicit toast | UX (separate) | Yes | Direct `toast.error`, not notice flag |
| Idle 15m timeout | Intentional (prod) | Yes | **Unchanged** |

### 27.10 Active-user / session-stability findings

Confirmed unchanged and working as designed:

- Temporary network failure → no definitive logout (refresh status 0 / 503).
- Backend 5xx on refresh → transient, 15s cooldown.
- Bootstrap 12s timeout → degraded, not logout.
- Access token expiry → proactive refresh + 401 silent refresh.
- Route guards wait on `initializing` / stored-session sync.
- Stripe return / bfcache → no auth clear (Stripe UI state only).

### 27.11 Cross-tab findings

- Web Locks refresh coordination: **unchanged**; `test:auth-refresh-coordination` **PASS**.
- Tab A logout → Tab B: revoked latch in localStorage; trailing work in Tab B also suppressed from expired notice if revoked.
- Tab A refresh rotation: reuse detection still revokes all sessions (security).

### 27.12 Network / API failure behavior

Unchanged. `runRefreshAuthWithRetries` returns `shouldClearSession: false` for status 0 and transient 5xx. Guard does not affect transient paths.

### 27.13–27.16 Token, route guard, account deactivation

No changes in this remediation. See §10–11, §15, §17 of original audit.

### 27.17 Idle timeout status

**Idle session timeout is enabled in the Render production environment and was intentionally left unchanged.**

- `IDLE_TIMEOUT_MS = 900_000` (15 minutes), warning at 13 minutes, unsaved grace 60s.
- Feature flag: `VITE_IDLE_SESSION_TIMEOUT_ENABLED=true` on Render production.
- Local `.env.example` may show `false` for developer convenience — that does **not** reflect production.
- Idle logout calls the same `useAuth().logout()`; with Priority 1 fix, idle logout no longer produces false session-expired toast from trailing requests.

### 27.18 Tests executed

| Command | Result |
|---------|--------|
| `npm run test:auth-logout-session-expired` | **PASS** |
| `npm run test:ux-stability-remediation` | **PASS** |
| `npm run test:auth-refresh-coordination` | **PASS** (31 checks) |
| `npm run test:auth-refresh-security` | **PASS** (23 checks) |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** (see build log) |

### 27.19 Files modified (remediation)

- `src/app/lib/api.ts` — `shouldMarkSessionExpiredNotice()`, guarded `clearAuthStorage`
- `scripts/auth-logout-session-expired-runtime.ts` — new regression test
- `scripts/ux-stability-remediation-runtime.ts` — architecture assert
- `package.json` — `test:auth-logout-session-expired` script
- `docs/audits/authentication-session-lifecycle-audit.md` — this section

### 27.20 Files intentionally left untouched

All idle-session files, `authRefreshCoordination.ts`, backend auth/refresh services, route guards, `AuthPage` toast logic (consume only), JWT/cookie config, Stripe auth, MFA, OAuth, `BusinessOnboardingPage.handleAuthFailure` (separate explicit toast).

### 27.21 Remaining risks

- **Cross-tab logout sync lag** — Tab B may briefly show authenticated UI until next API call (unchanged).
- **Onboarding `handleAuthFailure`** — still shows session-expired copy for any auth error (separate from notice flag).
- **Refresh reuse multi-tab race** — security-required full revoke (unchanged).

### 27.22 Recommended future work (optional)

- P1: Cross-tab `storage` listener on `caretip_session_revoked` for immediate Tab B sign-out UX.
- P2: Distinguish onboarding auth errors from session expiry in `handleAuthFailure`.
- P2: E2E Playwright — logout with in-flight mocked 401 → assert no toast.

---

*Audit originally read-only (2026-09-22). §27 documents surgical Priority 1 remediation + Priority 2 re-audit. Idle session timeout unchanged.*
