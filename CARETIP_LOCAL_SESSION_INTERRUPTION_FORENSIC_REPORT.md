# CareTip — Local development session interruption (forensic audit)

**Date:** 2026-10-03  
**Scope:** “Session appears to end” while Cursor edits code / dev servers restart  
**Status:** **EXPECTED LOCAL DEVELOPMENT BEHAVIOR** (with documented real-loss edge cases)  
**No authentication code changed in this pass.**

---

## Executive answer

**“Why does my locally authenticated CareTip session appear to end while Cursor is actively coding?”**

In most cases the **session is not actually lost**. The browser **reloads or re-executes the SPA**, which triggers **session bootstrap** (`authStatus === "initializing"`), the **`app-auth-bootstrap` global loader** (“Your workspace is being prepared…” / route loading copy), and/or a **transient `POST /api/auth/refresh` failure** while the **Express API is restarting**. During that window the dashboard can look like a blank/auth state even though:

- `localStorage.caretip_user` may still be present,
- the **HttpOnly refresh cookie** may still be valid,
- bootstrap is designed to **restore** via refresh once the API is back.

**True logout** (storage cleared, `caretip_session_revoked`, redirect to login after bootstrap settles) happens when refresh returns **401/403** and bootstrap classifies the session as **definitively invalid**, or when **refresh-token reuse** revokes all device sessions (see §6).

This is **separate from** customer QR / loader remediation work; do not attribute business QR or hard-refresh loader changes to auth cookies.

---

## 1. Auth lifecycle (file map)

| Stage | Primary implementation |
|--------|-------------------------|
| Login / register | `loginAPI` / `registerAPI` → `persistAuthResponse` in `useAuth.ts`; `setRefreshCookie` on backend (`refreshToken.service.ts`) |
| Access JWT | **In-memory only** — `accessTokenStore.ts` (`setMemoryAccessToken`) |
| Refresh cookie | HttpOnly `caretip_refresh` (name via `refreshCookieName()`), DB-backed rows in `refreshToken` table |
| Persisted user snapshot | `localStorage.caretip_user` (UX/bootstrap; not the security boundary) |
| Session hint | `sessionStorage` `caretip_session_hint` — `authSessionHint.ts` |
| App startup | `AuthProvider` → `useAuthInitializer.ts` |
| Single-flight bootstrap | `ensureAuthSessionBootstrap` → `runSessionBootstrapOnce` — `authBootstrap.ts`, `authSessionBootstrap.ts` |
| Refresh API | `POST /api/auth/refresh` — `bootstrapRefreshSession` / `ensureRefreshedSession` — `api.ts` |
| Flags | `authHydrated`, `sessionValidated`, `sessionConnectivityDegraded` — `authSessionBootstrap.ts` |
| Route status | `resolveAuthStatus` → `initializing` \| `authenticated` \| `unauthenticated` — `authSession.ts` |
| Protected routes | `useProtectedRouteGate` + `ProtectedRoute.tsx` — block on `initializing`, not redirect until unauthenticated |
| Global loader during bootstrap | `AuthBootstrapLoadingRegistrar.tsx` → `app-auth-bootstrap` |
| 401 recovery | `apiRequest` → `refreshAccessToken({ bypassCooldown: true })` — single-flight `refreshSingleton` |
| Logout | `logoutAPI`, `clearClientAuthStorage`, `resetAuthSessionClient`, `markClientSessionRevoked` |

**`isAuthRestorePending()`** (`authRestore.ts`): `!authHydrated || !sessionValidated` (unless session revoked).

---

## 2. What Cursor / dev edits trigger

| Event | Typical cause | Browser effect |
|--------|----------------|----------------|
| **Vite HMR** | Edit many frontend files | Partial React update; **may** reset modules that hold in-memory JWT |
| **Vite full reload** | `main.tsx`, `routes.tsx`, env, some config | **Full page reload** — all JS state reset; bootstrap runs again |
| **Express restart** | Backend file save (`npm run dev` / nodemon) | API down briefly; refresh may **fail transiently** |
| **Frontend + backend** | Both restart | Full reload + API gap — strongest “logged out” *appearance* |

Cursor does **not** call logout. **Process restarts and full reloads** do.

**Distinction:**

- **HMR** — not always a full navigation; in-memory token may drop while `bootstrapStarted` / `bootstrapPromise` may already be settled → protected APIs 401 until a refresh runs via interceptor.
- **Full reload** — same as manual Ctrl+R: one bootstrap refresh (single-flight).

---

## 3. Expected session survival by scenario

| Scenario | Access JWT in memory | Refresh cookie | `caretip_user` | Expected after settle |
|----------|----------------------|----------------|----------------|------------------------|
| React HMR only | May clear | Persists | Persists | Refresh on next 401 or if bootstrap re-runs |
| Vite full reload | Cleared | Persists (same origin) | Persists | Bootstrap refresh → authenticated |
| Ctrl+R | Cleared | Persists | Persists | Same as full reload |
| Backend restart only (no reload) | Unchanged | Persists | Unchanged | In-flight API/refresh → **transient_error**; retries; user often stays on dashboard in **degraded** mode |
| FE + BE restart | Cleared | Persists | Persists | Initializing loader → refresh when API up |
| Access JWT expired, refresh valid | Expired | Valid | Persists | Refresh succeeds |
| Refresh invalid / reuse | Any | Invalid/revoked | Cleared on definitive failure | **unauthenticated** → login |

**Loader ≠ logout:** `AuthBootstrapLoadingRegistrar` shows global overlay while `authStatus === "initializing"` on dashboard paths (`shouldBlockGlobalAuthLoader`). After **12s** stuck bootstrap it calls `markSessionBootstrapDegraded()` to unblock the shell **without** clearing the session.

---

## 4. `POST /api/auth/refresh`

| Property | Local dev behavior |
|----------|-------------------|
| **When called** | App bootstrap (`bootstrapRefreshSession`), `refreshSessionAPI`, 401 recovery in `apiRequest` |
| **Cookie** | HttpOnly; read from `Cookie` header |
| **SameSite** | `lax` when `NODE_ENV !== "production"` (`setRefreshCookie`) |
| **Secure** | `false` in dev |
| **Path** | `/` |
| **Rotation** | `rotateRefreshToken` — old token revoked, new cookie set each successful refresh |
| **Reuse** | Presenting a **revoked** rotated token with `replacedByTokenId` set → **`revokeAllRefreshTokensForUser`** — all refresh sessions for user invalidated |
| **Backend restart** | Refresh tokens in **Postgres** — survive restart; **JWT_SECRET** from stable `backend/.env` — survives restart |
| **No in-memory session store** for refresh validity |

**Frontend API origin (dev):** `resolveApiBaseUrl()` returns `""` on loopback → requests go to **same-origin `/api`** via Vite proxy (`apiOrigin.ts`) so cookies stay on **:5173**.

**Risk:** Opening the app as `http://localhost:5173` vs `http://127.0.0.1:5173` uses **different cookie jars** — looks like “session disappeared.”

---

## 5. Network evidence (how to capture)

This audit did **not** run a live Cursor-attached reproduction with HAR export. Recommended capture while reproducing:

1. Enable `localStorage.setItem("caretip_auth_debug", "1")` (see `fanny-session-loss-browser-validation-runtime.ts`).
2. Watch **Network** filtered to `refresh`, `me`, `login`, `logout`.
3. Record **Set-Cookie** on login/refresh and whether **Cookie** is sent on refresh.
4. Check **Application → Cookies** for page origin (not API port 3001 directly in browser).

**Interpretation:**

| Observation | Likely meaning |
|-------------|----------------|
| `refresh` **failed** / **503** / connection reset | Backend restarting — **transient** (toast “service unavailable”) |
| `refresh` **401** after rotation | Definitive — storage may clear |
| `caretip_user` present, on `/login`, `authStatus` was `initializing` | **Bootstrap flicker**, not proven logout |
| `caretip_session_revoked` set | **Real** client-side logout path |

---

## 6. Concurrent refresh / rotation races

**Within one tab:** `ensureRefreshedSession` uses **`refreshSingleton`** — one in-flight refresh at a time.

**Across tabs:** `coordinateCrossTabRefresh` (see `scripts/auth-refresh-coordination-runtime.ts`) reduces duplicate refresh; bootstrap also retries transient failures.

**Residual risk:** Two tabs (or a tab + mobile) both refreshing with the **same pre-rotation cookie** in a tight race can hit **reuse detection** and revoke **all** refresh tokens for the user. Uncommon during normal single-tab Cursor dev but **possible** with multiple windows.

**React StrictMode:** Not enabled on `App` root — no double bootstrap from StrictMode in current tree.

**HMR:** `api.ts` comment notes memory JWT may be empty after HMR; cooldown is bypassed when no in-memory token, but **bootstrap may not re-run** if `bootstrapStarted` remains true in a hot-updated `authBootstrap` module — APIs rely on **401 → refreshAccessToken**.

---

## 7. 401 handling (summary)

On protected `apiRequest` 401:

1. Attempt `refreshAccessToken({ bypassCooldown: true })` (may retry once).
2. Retry original request with new JWT.
3. If refresh says `shouldClearSession` **and** `mayClearClientAuthStorage()` (`authHydrated && sessionValidated`), call `clearAuthStorageForDefinitiveFailure`.

Bootstrap path on 401/403: `bootstrapRefreshSession` → `unauthenticated`; if `hadLocalSession`, **`clearStoredSession()`** + `markClientSessionRevoked()` (`useAuthInitializer.ts`).

**Backend down** during bootstrap: `transient_error` — keeps/restores user from storage, **does not** clear session; schedules retries up to 12s degraded settle.

---

## 8. Local cookie / CORS / proxy

| Setting | Dev |
|---------|-----|
| Page origin | Typically `http://localhost:5173` (Vite) |
| API | Proxied to backend (e.g. `:3001`) — browser sees `/api/*` same-origin |
| `credentials` | `"include"` on refresh and auth calls |
| Direct `VITE_API_URL=http://localhost:3001` in browser | **Discouraged** on loopback — cookies won’t attach to API host the same way (`apiOrigin.ts` warns and forces proxy) |

---

## 9. localStorage / session storage

| Key | Purpose |
|-----|---------|
| `caretip_user` | Normalized user JSON — restored into UI before refresh completes |
| `caretip_session_hint` | Skip refresh only for cold anonymous visitors |
| `caretip_session_revoked` | Client flag — forces unauthenticated |
| `caretip_token` | Legacy — migrated/cleared (`accessTokenStore.migrateLegacyAccessTokenFromStorage`) |

**HMR/full reload** does not automatically clear `caretip_user`. **Definitive refresh failure** after bootstrap does.

---

## 10. Backend restart

- **Refresh tokens:** persisted in DB — **not** wiped by process restart.
- **JWT signing:** `JWT_SECRET` from env — must be **stable** across restarts; if missing, server exits at boot (`backend/src/index.ts`).
- **No** dev-only random JWT secret per restart in production path.

Restart **does** cause short **connection failures** → transient bootstrap behavior, not DB invalidation.

---

## 11. Recent changes (loader vs auth)

Recent work on **hard-refresh loaders**, **business page boot**, and **customer HTML boot** affects **AppLoadingManager** and route-ready paint — **not** refresh cookies or rotation.

`AuthBootstrapLoadingRegistrar` timeout → `markSessionBootstrapDegraded()` can make the shell look “ready” while `sessionConnectivityDegraded` is true (APIs gated until refresh succeeds) — still **not** the same as clearing login.

No evidence in code review that customer QR or business-directory boot-handoff changes alter `useAuthInitializer` or refresh.

---

## 12. State distinction (what you’re actually seeing)

| Pattern | `authStatus` | `caretip_user` | Refresh | Verdict |
|---------|--------------|----------------|---------|---------|
| **A — Bootstrapping** | `initializing` | Often present | In flight / pending | **Not logged out** |
| **B — Logged out** | `unauthenticated` | Cleared | 401/403 definitive | **Real loss** |
| **C — Flicker** | `initializing` → `authenticated` | Present | Success after retry | Race/timing |
| **D — Degraded** | `authenticated` (degraded flag) | Present | Failed transient | **Not logged out**; APIs may fail until retry |

Protected routes use **`AppRouteGateShell`** while `gate.blocking` — not an immediate `<Navigate to="/login">` during `initializing`.

---

## 13. Reproduction matrix (expected from architecture)

| # | Trigger | Stay authenticated? | Typical UI |
|---|---------|---------------------|------------|
| 1 | Cursor edits FE (HMR) | Usually yes | Brief API errors possible until refresh |
| 2 | Cursor edits BE | Yes if no reload | Toast if refresh hits down API |
| 3 | Vite HMR only | Usually yes | Rare guard shell |
| 4 | Vite full reload | Yes after refresh | HTML boot + `app-auth-bootstrap` |
| 5 | Express restart | Yes (degraded possible) | Loader/toast, not login |
| 6 | FE + BE restart | Yes after API up | Longest bootstrap |
| 7 | Ctrl+R | Yes | Bootstrap |
| 8 | Ctrl+R during API down | Degraded then recover | Transient |
| 9 | Access token near expiry | Yes | Silent refresh |
| 10 | Access expired, refresh valid | Yes | Refresh on 401 |
| 11 | Refresh invalid | No | Login |

---

## 14. Hard-refresh loader vs auth

| Signal | Meaning |
|--------|---------|
| `app-auth-bootstrap` registration | Session validation in progress on protected/marketing paths |
| `sessionValidated === false` | Protected API hooks wait (`isProtectedApiReady`) |
| `markSessionBootstrapDegraded` | Unblock UI after timeout; **session not cleared** |

Do **not** treat global loader re-appearance after Vite reload as proof of logout.

---

## Root cause (observed symptom during Cursor dev)

**Primary:** **Normal local development reload + session bootstrap + global auth loader**, often combined with **short API unavailability** when the backend restarts. The user **appears** logged out because the dashboard is replaced by bootstrap/loader/login chrome while `POST /api/auth/refresh` and `authHydrated`/`sessionValidated` settle.

**Secondary real-loss mechanisms (if session truly ends):**

1. **Definitive refresh 401/403** after bootstrap (expired/revoked refresh cookie).
2. **Refresh-token reuse** (multi-tab / concurrent rotation) revoking all sessions.
3. **Origin mismatch** (`localhost` vs `127.0.0.1`) so the refresh cookie is not sent.

---

## Severity

| Issue | Severity |
|-------|----------|
| Loader/bootstrap during dev reload | **Low** — expected |
| Transient API during backend restart | **Low** — mitigated by retries/degraded mode |
| Multi-tab rotation reuse | **Medium** — rare in single-tab dev |
| localhost/127.0.0.1 split | **Medium** — user configuration |

---

## Is this a bug?

**Mostly no** — it matches designed **initialize → refresh → restore** behavior on every full SPA load.

**Investigate further** (status would move to **MORE INVESTIGATION REQUIRED**) if, **after** bootstrap completes (`authStatus === "authenticated"`, refresh 200), the user is still sent to login with **`caretip_user` cleared** without an explicit logout — capture HAR + `caretip_auth_last_diagnostic` from sessionStorage.

---

## Minimal remediation (only if proven real loss — not implemented)

| If proven | Minimal direction |
|-----------|-------------------|
| HMR drops JWT without re-bootstrap | On `accessTokenStore` empty + stored session, call `ensureRefreshedSession` once (dev-only or general) |
| Multi-tab rotation | Stricter cross-tab single-flight (already partially present) |
| Origin confusion | Document “always use same host”; optional dev redirect |
| Bootstrap mistaken for logout | Dev-only banner: “Restoring session…” when `initializing` + stored user |

**Preserve:** rotation, HttpOnly cookie, proxy-based dev API, `keepPageVisible`/customer auth separation, loader architecture.

---

## Regression risks (if changing auth later)

- Disabling rotation or clearing storage on transient 503 would harm security or UX.
- Bypassing bootstrap on protected routes would cause login flash.
- Calling API on `localhost:3001` directly would break cookies.

---

## Final status

**EXPECTED LOCAL DEVELOPMENT BEHAVIOR**

with documented edge cases that can cause **actual** session loss (definitive refresh failure, reuse revocation, cookie origin mismatch).

**NOT** classified as **ROOT CAUSE CONFIRMED — READY FOR MINIMAL REMEDIATION** for a single code defect without a captured failing refresh trace during Cursor edits.

---

## Quick self-check (next time it happens)

1. Open DevTools → Application → Local Storage: is `caretip_user` still there?
2. Network: did `POST /api/auth/refresh` return 401 or fail to connect?
3. Console (with `caretip_auth_debug`): `session_bootstrap` outcome in `authDebug` logs.
4. Confirm URL host is the same as when you logged in (`localhost` vs `127.0.0.1`).
