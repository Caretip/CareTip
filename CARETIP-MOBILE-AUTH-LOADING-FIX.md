# CareTip — Mobile Authentication Loading Fix

Authentication can be slow, fail, or be cancelled. It can no longer leave the signup or login form busy forever.

This change does not redesign OAuth, sessions, cookies, or routing. It only bounds the loading states the forensic audit proved can stick.

## Root Causes Addressed

1. **Credential exchange had no deadline.** `registerAPI`, `loginAPI`, `oauthAPI`, and the login MFA POSTs call `fetchWithNetworkRetry` with no `AbortController`. A fetch that never settles never reaches `finally`, so `isSubmitting` stays true and the mobile button stays on “Preparing your account…”.
2. **Success kept the button busy until unmount.** After a successful register or login, `postAuthRedirectRef` is set and `finally` deliberately leaves the button busy. If navigation never leaves `AuthPage`, that busy state never ends.
3. **Destination prefetch could block `navigate()`.** `preparePostAuthDestination()` awaited `prefetchAuthenticatedShell()`. A dynamic `import()` that never settles meant the route change never ran.
4. **Facebook redirect spinner.** `form.submit()` starts a full-page POST. After 5 seconds the attempt was marked committed, and `failStart()` then returned without `onSubmitFailed()`. If the document stayed on `/signup`, `providerBusy === "facebook"` never cleared.
5. **Apple popup.** `auth.signIn()` had no deadline. If that promise never settled, `OAuthProviderRow`’s `finally` never cleared `providerBusy === "apple"`.
6. **Google, after a credential exists.** The Google button itself is unchanged. Once CareTip receives an ID token, `runSocialOAuth` → `oauthAPI` uses the same bounded POST as password login.
7. **MFA.** Enable, verify, and setup POSTs use the same deadline. A timeout throws before `completeAuthLogin`, so it cannot skip the challenge or mint a session.

## Exact Files Changed

- `src/app/lib/authCredentialExchangeDeadline.ts` — shared 20s deadline, navigation-recovery scheduler, Facebook stall decision
- `src/app/lib/authCredentialExchangeDeadline.runtime.ts` — focused tests
- `src/app/lib/api.ts` — deadline on register, password sign-in, OAuth credential exchange, MFA setup / enable / verify
- `src/app/components/AuthPage.tsx` — navigate without waiting for prefetch; recover the form if it is still mounted after the handoff window
- `src/app/lib/prefetchAuthenticatedRoutes.ts` — `preparePostAuthDestination` starts prefetch and returns immediately
- `src/app/lib/facebookOAuthRedirectWeb.ts` — still-on-page recovery for the Facebook spinner
- `src/app/lib/appleOAuthWeb.ts` — deadline around `auth.signIn()`
- `src/i18n/locales/en.json`, `src/i18n/locales/de.json` — copy used only when navigation does not leave the auth page
- `package.json` — `test:auth-loading-recovery`

Backend files were not modified.

## Loading State Changes

One handoff still covers the auth action. The existing sign-in cover (`common.gettingReady`, “Just a moment…”) and the form busy flag (`isSubmitting || authFlowInProgress`, “Preparing your account…” / “Signing in…”) are the same operation. The cover already force-ends at 20 seconds. The button now ends with it when the page never unmounts.

The destination’s own route and dashboard loading stays. That is a different operation: the next page loading its shell and data. No extra “Just a moment” screen was added, and no animation was added to hide a transition.

| Situation | What the user sees |
|---|---|
| Normal success | Button busy and the existing sign-in cover, then `navigate()`, then the destination’s own loading, then content. Prefetch may finish during that and warm the next page. |
| Network / deadline | Same busy state, then the existing wakeup message, then the button returns. |
| Auth succeeded, page never left | Busy state continues for the handoff window, then the button returns and the form shows “We couldn't open the next page. Please try again.” (German equivalent in `de.json`). |
| Facebook redirect leaves the page | Unchanged. The completion page handles the result. |
| Facebook document stays on the auth page | Existing start-failure UI, spinner cleared. |
| Apple popup settles or times out | Existing toast, spinner cleared in `finally`. |

The button is not cleared at the moment auth succeeds. That would show the old form while navigation is still in progress and allow a second submit.

## Timeout Decisions

Every new deadline is **20 seconds**, from `getSignInHandoffMaxMs()` / `HANDOFF_MAX_MS`.

| Timeout | Duration | Why |
|---|---:|---|
| Register, password login, OAuth `POST /api/auth/oauth`, MFA setup / enable / verify | 20s | Same ceiling the sign-in cover already uses. Long enough for a cold mobile connection plus the existing single 2.5s network retry. Short enough that a fetch which never returns cannot pin the button. The abort is an `AbortController` on the request. The thrown error is the existing wakeup copy, because a raw `AbortError` is mapped to an empty string and would clear the button with no message. |
| Navigation recovery | 20s | Matches the cover. Immediate clear would re-enable submit during a normal navigation. If `AuthPage` unmounts, the timer is cancelled and no error is shown. |
| Facebook still-on-page recovery | 20s | A real `form.submit()` navigation fires `pagehide` well inside this window. The existing 5s timer still exists, and now marks the attempt committed only after `pagehide`. Using 5s as the failure would treat a normal redirect as a failure. |
| Apple `auth.signIn()` | 20s | Same handoff ceiling. An Apple sheet on a phone needs the user to complete it. A few seconds would fail real sign-ins. |

Unchanged on purpose:

- Refresh coordination and bootstrap refresh stay at **12 seconds**.
- Logout stays at **8 seconds**.
- No global timeout was added to `apiRequest` or `fetchWithNetworkRetry`.

## Facebook Safety Fix

The protocol is the same full-page POST to `/api/auth/facebook/start`. Redirect URI, state creation, state TTL, state consumption, callback, CSP, and cookies are untouched.

`pagehide` records that navigation left and commits the attempt, which clears the stall timer. If 20 seconds pass and the document is still visible on the same page, the existing `failStart("client_start_aborted", "redirect_navigation_stalled")` path runs. That calls `onSubmitFailed()`, which clears the Facebook spinner, and shows the existing start-failure screen. The form is not submitted again. OAuth state is not made reusable. If the tab is hidden at 20 seconds, recovery waits until it is visible again, so a redirect that has already left the page is not marked failed.

The existing Facebook OAuth state tests still pass, including “first consume succeeds” and a second consume returning `consumed`.

## Apple Safety Fix

`requestAppleIdToken()` still uses the Apple JS SDK with `usePopup: true`, the same client id, and `redirectURI: window.location.origin`. The `signIn()` promise is raced with the 20s abort. On timeout the error is the existing wakeup message. `OAuthProviderRow`’s existing `catch` shows it and `finally` sets `providerBusy` back to null.

## Navigation / Prefetch Fix

`preparePostAuthDestination()` still starts the shell prefetch, page-chunk prefetch, and dashboard stats warm. It returns immediately. Callers in `AuthPage`, Facebook completion, platform-admin login, and mobile handoff can still `await` it; that await no longer waits on `import()`.

`redirectAfterAuth` and the signup → `/verify-email` path call `navigate()` in the same turn as success. If that navigation unmounts `AuthPage`, the recovery timer is cleared. If the page is still mounted when the timer fires, the redirect ref is cleared, the button is usable again, and the navigation-recovery message is shown.

## Tests Added / Updated

Added `npm run test:auth-loading-recovery`.

It checks:

- a request that never resolves aborts its `AbortSignal`, throws the wakeup message, and does not produce a user or MFA token
- a fast success still returns
- a real auth error is not replaced by the timeout message
- navigation recovery fires only while a redirect is still pending, and cancel prevents it
- Facebook stall is true only when navigation has not left and failure is not already handled
- source still has a single `form.submit()`
- register, sign-in, OAuth, and MFA POSTs use the deadline helper
- `preparePostAuthDestination` does not await the shell import
- refresh coordination remains 12 seconds

## Test Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` (frontend) | Pass, exit 0 |
| Backend `tsc` | Not run. No backend file changed. |
| `test:auth-loading-recovery` | Pass |
| `test:facebook-oauth-web` | Pass |
| `test:facebook-oauth-redirect` | Pass |
| `test:facebook-oauth-complete-errors` | Pass |
| `test:facebook-oauth-error-handling` | Pass, 10 checks, including single-use state (`consumed` on second use) |
| `test:facebook-oauth-session-handoff` | Pass |
| `test:auth-refresh-coordination` | Pass, 31 checks |
| `test:auth-refresh-security` | Pass, 23 checks |
| `test:auth-logout-session-expired` | Pass |
| `test:auth-navigation-session-preservation` | Pass, 13/13 |

## Production Verification

The new behavior is only in this working tree. `https://caretip.de` is still serving the previous bundle, so a production login would not exercise these fixes.

The demo password was not present in the task text. Production login was not attempted. No cookies, tokens, or passwords were written down. Demo account data was not changed.

No Android or iOS device was available. Desktop emulation was not used as a substitute, and this report does not claim the phone hang is fixed in production.

Local browser exercise of `/signup` was not run in this session. The recovery behavior above is covered by the runtime tests and by reading the call sites.

## Loader / Handoff Before vs After

Durations below are the code boundaries. They were not measured on a phone in this pass.

| Flow | Loader sequence | Duration | Redundant? | Result |
|---|---|---:|---|---|
| Login → dashboard, success | Before: button “Signing in…” and the sign-in cover (“Just a moment…”), then navigation could wait on prefetch, then dashboard loading, then content. After: the same button and cover as one handoff, `navigate()` without waiting on prefetch, then the dashboard’s own loading, then content. | Cover already capped at 20s. Button now shares that cap if the page never leaves. | Button and cover are the same handoff. Dashboard loading is the next page and stays. | Local logic updated. Production not remeasured. |
| Signup → verify email, success | Before: “Preparing your account…” could wait forever on prefetch. After: same button and cover, then navigation, then the verify-email page. | Same 20s cap if navigation never commits. | Same as login. | Local logic updated. Production not remeasured. |
| Auth request never returns | Before: button stays on the preparing label. After: abort at 20s, existing wakeup message, button returns. | 20s | No new loader. | Covered by `test:auth-loading-recovery`. |
| Auth succeeds, navigation never commits | Before: button stays busy. After: recovery at 20s, button returns, navigation-recovery message, user can submit again. | 20s | No. | Covered by the recovery scheduler test. |
| Facebook redirect | Before and after, a leaving document is the completion page. If the document stays, spinner now clears at 20s through the existing start-failure UI. | 20s only when `pagehide` never fires. | No. | State single-use test still passes. Not retested on production Facebook. |
| Apple popup never settles | Before: Apple spinner forever. After: 20s, existing error toast, spinner clears. | 20s | No. | Deadline helper tested. Live Apple sign-in not run. |
| Google credential, API never returns | Before: form busy forever after the credential callback. After: same 20s abort and wakeup message. | 20s after the credential, not before it. | No. | `oauthAPI` is on the deadline. Live Google sign-in not run. |
| MFA verify | Challenge and pending token unchanged. A hung verify POST aborts at 20s and does not call `completeAuthLogin`. Success still navigates and uses the same recovery timer. | 20s | No. | Timeout test asserts the error has no `pendingMfaToken` and no `user`. |

## Security / Architecture Preserved

The following are the same code as before this change:

- Facebook OAuth architecture and the full-page POST start
- Facebook redirect URI and Meta configuration
- OAuth state creation, TTL, and single-use consumption
- Refresh-token architecture, including the 12s refresh timeout
- Cookie `Domain`, `SameSite`, `Secure`, and `HttpOnly`
- CSP
- Netlify proxy and Render configuration
- Auth middleware, authorization, and role checks
- Session architecture
- Database schema
- Service worker

No new authentication framework was added. No JWT is written to `localStorage`. The Facebook stall path does not submit the start form a second time.

## Remaining Known Issues

**Fixed in this tree**

- Auth POSTs for register, password login, OAuth credential exchange, and MFA can no longer pend forever.
- Optional destination prefetch can no longer block `navigate()`.
- A successful auth whose page never unmounts recovers after 20 seconds.
- Facebook’s provider spinner recovers if the document never leaves.
- Apple’s provider spinner recovers if `signIn()` never settles.
- A Google credential that reaches CareTip uses that same bounded POST.

**Not reproduced**

- The original phone screenshot was not reproduced here. The hang paths above are the ones the forensic audit proved in code.

**Requires a real Android device**

- Production `/signup` and `/login` after this build is deployed: button returns after a stalled request, and a normal login reaches the dashboard without a stuck “Preparing your account…”.

**Requires a real iOS device**

- The same flows, plus one Apple sign-in if it can be done without creating a new identity. `pagehide` timing on iOS Safari is the Facebook case that still needs a device.

**Requires the separate performance sprint**

- Trailing-slash public loader on paths such as `/faq/`
- CLS from the static summary
- Landing prefetch running on unrelated routes
- Three.js and Recharts in the initial public graph
- Homepage LCP
- Marketing image weight

Those were not changed here.
