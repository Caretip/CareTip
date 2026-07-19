# POST_LOGIN_DASHBOARD_RENDER_AUDIT.md

**Project:** CareTip  
**Scope:** Post–Sign In loading → first Dashboard paint  
**Date:** 2026-07-18  
**Status:** Audit only — **wait for approval before code changes**  
**Related:** `AUTH_LOADING_AUDIT.md`, `AUTH_LOADING_IMPLEMENTATION.md`

---

## Executive summary

The CareTip branded loader (`SignInHandoffCover` → `AuthBootstrapShell`) stays up until **dashboard metrics are treated as “ready”**, and navigation itself is delayed by **awaiting a full-period business stats fetch** after authentication succeeds.

That couples **login success** to **widget data**, which is the opposite of SaaS best practice: show the **shell** immediately, load **widgets progressively**.

**Root causes (ranked):**

1. **`preparePostAuthDestination` awaits `warmBusinessDashboardData()`** — including `fetchBusinessPeriodStats("week", scope: "full")` — **before** `navigate()`.
2. **`authSignInHandoff.maybeComplete()` requires `dataReady` for `/dashboard` and `/employee/dashboard`** — cover cannot dismiss on shell alone.
3. **`BusinessDashboard` / `EmployeeDashboard` call `signalSignInHandoffDashboardInteractive` only when metrics are no longer in initial load** — reinforcing the widget gate if warm did not already set `dataReady`.

Auth, session, and redirect are already complete before these waits. Widgets should not block the branded cover or navigation.

---

## 1. Current post-login lifecycle (business → `/dashboard`)

```
Sign In click
  → beginAuthSignInHandoff()  (cover can show; branded overlays blocked)
  → login() API
  → persistAuthResponse + commitAuthUser + markSessionBootstrapSettled
  → markSignInHandoffAuthCompleted()
  → await preparePostAuthDestination("/dashboard")
        • prefetch CSS + BusinessLayout + BusinessDashboard chunks
        • await fetchBusinessPeriodStats("week")   ← FULL STATS (metrics/charts payload)
        • await fetchBusinessProfile()
        • markSignInHandoffDataReady()             ← dataReady = true
  → markSignInHandoffNavigating + beginAuthPostLoginTransition
  → navigate("/dashboard")
  → BusinessLayout paints → signalSignInHandoffLayoutCommitted (shellReady)
  → maybeComplete() when shellReady && dataReady
  → endAuthSignInHandoff() → cover removed
  → BusinessDashboard widgets (may soft-revalidate in background)
```

**Perception:** “Login is slow” because the CareTip loader remains for the duration of **stats + profile + chunk load**, even though the session already exists.

Employee path is similar for chunks; metrics gate still applies via `signalSignInHandoffDashboardInteractive` when warm did not run (employee warm does not call `warmBusinessDashboardData` today).

---

## 2. What currently delays Dashboard rendering / cover dismiss

### 2.1 Blocking before navigation (unnecessary for shell)

| Operation | File | Required for auth? | Blocks navigate today? |
|-----------|------|--------------------|-------------------------|
| Login API + token + user | `useAuth.login` / `persistAuthResponse` | **Yes** | Yes (correct) |
| Redirect decision | `getPostAuthRedirect` | **Yes** | Sync (correct) |
| Prefetch dashboard CSS + `BusinessLayout` | `prefetchAuthenticatedRoutes.ts` | Shell UX only | Yes (reasonable to keep or parallelize) |
| Prefetch `BusinessDashboard` page chunk | same | Widgets page, not shell | Yes (can defer / parallel after navigate) |
| **`fetchBusinessPeriodStats("week", scope: "full")`** | `warmBusinessDashboardData` | **No** — metrics/widgets | **Yes — primary unnecessary block** |
| **`fetchBusinessProfile`** | same | Partially (entitlements/verification); often already on user | **Yes — secondary; can move post-shell** |
| `markSignInHandoffDataReady()` | after warm | Ties handoff to widget data | Sets `dataReady` early |

### 2.2 Blocking cover dismiss after navigation

| Gate | File | Condition | Necessary for shell? |
|------|------|-----------|----------------------|
| `shellReady` | `authSignInHandoff.ts` via layout paint | `useDashboardLayoutPaintReady` → `signalPostLoginDashboardShellReady` | **Yes** — shell first paint |
| `dataReady` for `/dashboard` & `/employee/dashboard` | `maybeComplete()` | Warm success **or** metrics no longer `isMetricsInitialLoad` | **No** — treats widgets as auth |
| Metrics signal | `BusinessDashboard.tsx` | `!isMetricsInitialLoad \|\| hasVisibleMetrics` | **No** for cover |
| Metrics signal | `EmployeeDashboard.tsx` | Hero metrics loaded | **No** for cover |
| Cover UI | `SignInHandoffCover.tsx` | Visible while handoff active | Correct mechanism; wrong completion criteria |

### 2.3 Components that do **not** need to block (already progressive / background)

| Component / hook | Role after shell visible |
|------------------|--------------------------|
| `useBusinessDashboardStats` | Metrics, charts, goals — already has skeletons |
| `useBusinessPageBoot` | Soft-nav skeletons when not under global overlay |
| Charts / analytics sections | Idle/deferred mounts exist in places |
| `NotificationInboxSync` / `PushNotificationSync` | Layout side effects — should not gate cover |
| `ApprovedBusinessGate` profile sync | Fire-and-forget after shell |
| Socket / realtime | Deferred connect patterns exist |

### 2.4 What auth **should** wait for (keep)

| Requirement | Current source | Notes |
|-------------|----------------|-------|
| Session / token | `persistAuthResponse` | Keep |
| User profile (role, verify, onboarding flags) | Login response user | Keep; avoid second full stats wait |
| Permissions / role | User role on session | Keep |
| Redirect decision | `getPostAuthRedirect` | Keep (`/verify-email`, `/onboarding`, `/dashboard`, …) |
| Route guard allow | `ProtectedRoute` + settled session | Keep; already soft under handoff |
| Shell chunks (optional) | Prefetch `BusinessLayout` + CSS | Prefer await layout CSS/layout only, not page widgets chunk if it slows login |

---

## 3. Unnecessary coupling: auth ↔ dashboard data

| Coupling | Why it exists (history) | Why it is wrong for SaaS UX |
|----------|-------------------------|----------------------------|
| Await full week stats before navigate | Prior flash fix: “navigate only when dashboard data ready” | Users wait on charts/KPIs before seeing chrome |
| `dataReady` required in `maybeComplete` | Same philosophy | Cover = full-app spinner until widgets |
| `signalSignInHandoffDashboardInteractive` on metrics | Safety if warm failed | Extends cover when network is slow |

**Correct split:**

- **Auth handoff complete** = session + redirect + **shell committed** (sidebar/header/nav).
- **Dashboard content ready** = progressive skeletons → fade-in (already largely built).

---

## 4. Proposed rendering strategy (for implementation after approval)

### Target flow

```
Sign In
  → Button spinner only (Login form)
  → Auth succeeds (token + user + redirect)
  → Prefetch shell (CSS + BusinessLayout) — optional short await
  → navigate(/dashboard) immediately
  → BusinessLayout paints (sidebar, header, nav, profile)
  → Dismiss SignInHandoffCover as soon as shellReady
  → BusinessDashboard mounts with skeletons
  → Parallel: metrics / charts / activity / notifications
  → Widgets fade in as data arrives
```

### Concrete changes (proposed — not implemented yet)

1. **`preparePostAuthDestination`**
   - Await: layout CSS + `BusinessLayout` (and employee/platform equivalents).
   - **Do not await** `fetchBusinessPeriodStats`.
   - Optionally: `void` background warm of stats **after** navigate, or fire-and-forget without gating handoff.
   - `fetchBusinessProfile`: prefer post-shell (`ApprovedBusinessGate` already syncs) unless redirect truly needs a field missing from login user.

2. **`authSignInHandoff.maybeComplete`**
   - For `/dashboard` and `/employee/dashboard`: complete when **`shellReady` only**.
   - Remove metrics/`dataReady` gate for cover dismiss (or set `dataReady` automatically on layout commit).

3. **Remove or no-op** `signalSignInHandoffDashboardInteractive` as a cover gate  
   - Keep metrics skeletons on the page; do not drive handoff.

4. **Preserve**
   - Button spinner during auth API.
   - Soft-nav / overlay suppression during handoff (no second CareTip flash from `AppLoadingManager`).
   - Existing skeleton / progressive UI in `BusinessDashboard`.
   - Cold start / refresh branded loader (unchanged).
   - Logout, onboarding, verify-email, guards, caching.

5. **Optional perceived polish**
   - Prefetch `BusinessDashboard` chunk in parallel after navigate (does not block shell).
   - Keep in-page skeletons for KPIs/charts (already present).

### Expected perceived performance improvement

| Phase | Today | After proposed change |
|-------|--------|------------------------|
| Time to leave Login after auth | Auth + **full stats** + profile + chunks | Auth + **shell chunks** only |
| Time to see sidebar/header | After cover waits for data + layout | Shortly after navigate (layout paint) |
| Time to see filled KPI cards | Same network | Same network, but **visible shell already** |
| User feeling | “Login stuck on CareTip” | “Logged in; dashboard loading widgets” |

Typical win: **hundreds of ms to several seconds** of CareTip cover removed from the critical path on slow APIs/networks (equal to `getBusinessStats` RTT).

---

## 5. Risks if changed carelessly

| Risk | Mitigation |
|------|------------|
| Blank white flash under cover if cover ends before layout | End cover only on `shellReady` (layout paint), still prefetch layout CSS |
| CareTip splash reappears from boot keys | Keep handoff overlay block until shellReady |
| Onboarding / verify-email regressions | Those paths already complete on layout-only; keep that |
| Entitlements wrong for one frame | User payload + existing `ApprovedBusinessGate` / entitlements providers; avoid blocking login on profile |
| Double stats fetch | Soft warm after navigate without clearing warm store; keep `consumePostLoginDashboardWarm` optional for cache hit, not as cover gate |
| Employee / platform admin | Apply same shell-first rule; employee metrics signal must not gate cover |
| Session / guards | Do not navigate before `markSessionBootstrapSettled` / user commit |
| Logout / refresh | Do not change cold-boot or logout cover rules |

---

## 6. Files to modify (when approved)

| File | Change |
|------|--------|
| `src/app/lib/prefetchAuthenticatedRoutes.ts` | Stop awaiting stats/profile for navigate; shell prefetch only; optional background warm |
| `src/app/lib/authSignInHandoff.ts` | Dismiss cover on `shellReady` for dashboard routes (drop widget `dataReady` requirement) |
| `src/app/pages/business/BusinessDashboard.tsx` | Remove handoff interactive gate (or make no-op for cover) |
| `src/app/pages/employee/EmployeeDashboard.tsx` | Same |
| `src/app/components/AuthPage.tsx` | No logic change beyond faster `preparePostAuthDestination` (verify comments) |
| `AUTH_LOADING_IMPLEMENTATION.md` | Update after implement (optional) |

**Likely untouched:** `ProtectedRoute`, `BusinessLayout` paint latch (still used for `shellReady`), skeleton components, cold-boot `AppLoadingManager` behavior outside handoff.

---

## 7. Regression matrix (post-implementation)

| Scenario | Expect |
|----------|--------|
| Business Sign In | Button → brief CareTip cover → **shell** → skeletons → widgets |
| Slow 3G | Shell appears; widgets skeleton longer; cover not stuck on stats |
| Employee Sign In | Same shell-first |
| Platform admin | Shell-first (layout) |
| `/onboarding` / `/verify-email` | Unchanged layout-gated handoff |
| Refresh `/dashboard` | Cold CareTip boot still OK |
| Logout → Login | No stuck handoff |
| Permissions / role mismatch | Errors on Login; no navigate |
| Cache warm after navigate | Soft revalidate; no empty flash if cache optional |

---

## 8. Conclusion

The loader feels slow because **dashboard widget data (`fetchBusinessPeriodStats` + metrics “interactive” gate) is on the critical path of Sign In handoff**. Authentication is already done earlier.

**Recommendation:** Shell-first SaaS pattern — navigate after session + redirect (+ layout prefetch); dismiss branded cover on **BusinessLayout paint**; load metrics/charts/notifications **in parallel with skeletons**.

---

**End of audit.**  

**Implementation status:** Approved and implemented — see `POST_LOGIN_DASHBOARD_RENDER_IMPLEMENTATION.md`.
