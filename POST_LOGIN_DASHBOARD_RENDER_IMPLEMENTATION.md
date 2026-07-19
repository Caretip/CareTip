# POST_LOGIN_DASHBOARD_RENDER_IMPLEMENTATION.md

**Date:** 2026-07-18  
**Status:** Implemented (Phases 1–4)  
**Audit:** `POST_LOGIN_DASHBOARD_RENDER_AUDIT.md`

---

## What changed

### Phase 1 — Auth readiness ≠ dashboard readiness

`preparePostAuthDestination` no longer awaits:

- `fetchBusinessPeriodStats`
- `fetchBusinessProfile`
- dashboard **page** widget chunks

It only awaits **shell** chunks (dashboard CSS + layout). Page chunks and stats warm start as fire-and-forget.

### Phase 2 — Shell-first CareTip cover dismiss

`authSignInHandoff.maybeComplete()` completes when **`shellReady` only** (layout paint via `signalSignInHandoffLayoutCommitted`). Widget `dataReady` no longer gates the cover.

### Phase 3 — Progressive widgets

Removed `signalSignInHandoffDashboardInteractive` effects from:

- `BusinessDashboard.tsx`
- `EmployeeDashboard.tsx`

Existing `useBusinessPageBoot` / skeletons remain for KPI/charts. Soft-nav rules already prevent re-latching the branded CareTip overlay after post-login.

### Phase 4 — Request classification (login path)

| Request / work | Classification | Action taken |
|----------------|----------------|--------------|
| Login API + token persist | **Authentication-critical** | Unchanged — still awaited before navigate |
| User profile on login response | **Authentication-critical** | Unchanged |
| Role / permissions on user | **Authentication-critical** | Unchanged |
| `getPostAuthRedirect` | **Authentication-critical** | Unchanged |
| Prefetch layout CSS + `BusinessLayout` / `EmployeeLayout` / `SuperAdminLayout` | **Authentication-critical** (shell UX) | Still awaited in `preparePostAuthDestination` via `prefetchAuthenticatedShell` |
| Prefetch `BusinessDashboard` / employee / admin page chunk | **Dashboard-critical** | Fire-and-forget after shell prefetch |
| `fetchBusinessPeriodStats("week")` | **Dashboard-critical** | Background warm only — never awaited on auth path |
| `fetchBusinessProfile` (post-login warm) | **Background** | Same background warm; layout/`ApprovedBusinessGate` may sync later |
| Charts / analytics / tips / notifications | **Background** | Mount-driven fetches + skeletons — never on auth path |
| Handoff cover dismiss | Tied to **shell paint** | Not tied to widgets |

---

## Files modified

| File | Change |
|------|--------|
| `src/app/lib/prefetchAuthenticatedRoutes.ts` | Shell vs full prefetch; remove await on stats/profile |
| `src/app/lib/authSignInHandoff.ts` | Complete on `shellReady` only |
| `src/app/pages/business/BusinessDashboard.tsx` | Remove metrics→handoff gate |
| `src/app/pages/employee/EmployeeDashboard.tsx` | Remove metrics→handoff gate |
| `src/app/components/AuthPage.tsx` | Comment only |
| `src/app/lib/authPostLoginTransition.ts` | Comment only |

**Not modified (by design):** auth login/session persistence, token refresh, role guards, business switching, onboarding/verify routing, logout, cold-start loader, refresh boot.

---

## Expected flow (success criteria)

```
Login → Sign In → button spinner
  → auth succeeds (session + user + role + redirect)
  → shell chunks (brief)
  → navigate
  → Dashboard shell (sidebar / header / nav / profile)
  → CareTip handoff cover dismisses
  → KPI skeletons → charts → analytics → notifications
  → fully interactive
```

---

## Regression audit checklist

Manual / QA verification (no auth or routing logic was intentionally changed):

| Scenario | Expected |
|----------|----------|
| **Business login** | Shell appears quickly; widgets skeleton then fill; no multi-second CareTip wait on stats |
| **Employee login** | Same shell-first; hero metrics skeleton in-page |
| **Platform admin login** | Shell-first via admin layout prefetch |
| **Slow network (3G)** | Longer widget skeletons; CareTip cover still ends on layout paint (20s handoff max safety) |
| **Logout → Login** | Handoff resets; no stuck cover |
| **Refresh on Dashboard** | Cold CareTip boot unchanged |
| **Onboarding users** | Redirect to `/onboarding`; cover ends on shell |
| **Email verification** | Redirect to `/verify-email`; cover ends on shell |
| **Business switching** | Unchanged (not on Sign In path) |
| **Session restoration** | Unchanged (cold/restore path separate from Sign In handoff) |

### DEV timing

Console `[AuthHandoff]` should show `layout_committed` ≈ `first_meaningful_paint` / `fully_interactive`, without waiting for a late `dashboard_data_ready` before cover end.

---

## Incremental test notes

1. **Phase 1 alone:** Navigate should fire without waiting for stats network (Network tab: navigate before or parallel to stats).
2. **Phase 2 alone:** Cover removes when layout paints even if stats pending.
3. **Phase 3 alone:** No handoff dependency on metrics effects.
4. **Phase 4:** Classification above is the source of truth for future changes — do not re-add widget awaits to `preparePostAuthDestination`.
