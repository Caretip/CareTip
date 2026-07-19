# POST_LOGIN_RENDER_PROFILING.md

**Project:** CareTip  
**Date:** 2026-07-18  
**Status:** Root cause runtime-proven; **shell-ready fix implemented and re-traced**  
**Artifacts:** `POST_LOGIN_RUNTIME_TRACE.json`, `e2e/post-login-runtime-trace.spec.ts`

---

## Post-fix runtime verification (latest capture)

**END_CALLER = `maybeComplete`** — **no `timeout_force_end`**

| +ms | Event |
|-----|-------|
| 0 | `click` |
| 71 | `CareTip_loader_shown` |
| 856 | `auth_completed` |
| 1631 | `navigation_triggered` |
| 1842 | `BusinessLayout_first_render` |
| 1844 / 1846 | `Sidebar_rendered` / `Header_rendered` |
| 2091 | `dashboard_shell_ready_signaled` (`via: layout_commit_without_overlay`) |
| 2092 | `signalSignInHandoffLayoutCommitted` |
| 2094 | `maybeComplete_enter` (`shellReady: true`) |
| 2096 | `endAuthSignInHandoff` (**caller: maybeComplete**) |
| 2265 | `CareTip_loader_dismissed` |

- Cover dismiss after layout first render: **~254 ms** (1842 → 2096)
- Overlay paint latch still skips (`overlayVisible: false`) — unused for Sign In; intentional
- Cold-boot overlay latch path unchanged

### Fix (smallest possible)

`useDashboardLayoutPaintReady` in `src/app/lib/globalAppLoading.ts`: when layout `enabled` and Sign In handoff **or** post-login transition is active, call `signalPostLoginDashboardShellReady()` from a `useLayoutEffect` **without** requiring `overlayVisible`. Cold boot still uses the existing overlay paint latch only.

---

## Pre-fix runtime capture (evidence of root cause)

**Capture method:** Playwright Sign In through real `AuthPage` handoff with mocked `/api/auth/signin`.

### Pre-fix executive verdict

| Question | Measured answer |
|----------|-----------------|
| Who calls `endAuthSignInHandoff()`? | **Exactly one caller: `timeout_force_end`** |
| Does `timeout_force_end` execute? | **Yes** at **~20 000 ms** |
| Does `signalSignInHandoffLayoutCommitted` execute? | **No** |
| When does BusinessLayout mount? | **~1.5 s** — long before cover ends |
| Is shell under the cover? | **Yes** — opaque cover hid it |

**Real blocker (pre-fix):** CareTip handoff waited for `shellReady`, which never became true because the paint latch required `overlayVisible` while Sign In soft-nav keeps the global overlay off.

### Pre-fix timeline (for reference)

| +ms | Event | Notes |
|-----|-------|-------|
| 0 | `click` | Handoff begins |
| ~600 | `auth_completed` | |
| ~1300 | `navigation_triggered` | |
| ~1480 | `BusinessLayout_first_render` + Sidebar/Header | Shell existed |
| ~1813 | `paint_latch_effect_skip` | `overlayVisible: false` |
| — | `signalSignInHandoffLayoutCommitted` | **NEVER** |
| ~19992 | `timeout_force_end` | Only dismiss path |
| ~19993 | `endAuthSignInHandoff` | caller: `timeout_force_end` |

---

## Blank CareTip vs shell underneath

Opaque full-viewport `SignInHandoffCover` hid an already-mounted shell. Delay was cover signaling, not layout mount.

---

## Instrumentation (DEV trace only)

| File | Purpose |
|------|---------|
| `src/app/lib/postLoginRuntimeTrace.ts` | Timeline + `window.__POST_LOGIN_TRACE__` |
| Handoff / layout / ProtectedRoute / cover | Named marks for verification |
| `e2e/post-login-runtime-trace.spec.ts` | Automated capture |

---

**Product fix location:** `useDashboardLayoutPaintReady` only. No changes to ProtectedRoute, session, onboarding, verify-email, logout, or AppLoadingManager cold-start winner logic.
