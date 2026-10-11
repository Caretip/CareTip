# CareTip Mobile Authentication Loading Hang — Forensic Audit

Read-only. No source, configuration, cookies, OAuth, CSP, service worker, or production data was changed. No production signup or login was submitted.

## Executive Summary

The screen in the report is the **mobile web** signup shell at `https://caretip.de/signup`, not the Expo app. That shell is chosen only by viewport (`max-width: 767px`). It uses the **same** submit, OAuth, and session code as desktop.

The button text “Create Business Account” is `auth.mobileWebAuth.signUp`. While the action is in progress that label is replaced by “Preparing your account…” (`auth.page.creatingAccountWait`) because `busy` is `isSubmitting || authFlowInProgress`.

That flag is set in `AuthPage.handleSubmit` and is **not** cleared when:

1. `POST /api/auth/register` (or sign-in / OAuth) never settles. `fetch` has **no timeout** and **no AbortController** on those calls. `finally` does not run until the promise settles.
2. The request **succeeds** and `postAuthRedirectRef` is set. `finally` then **deliberately leaves** `isSubmitting` true until the page unmounts. Navigation to `/verify-email` (signup) or the dashboard (login) happens only after `preparePostAuthDestination()`. If that navigation never commits, the button stays busy.

The full-screen sign-in cover is a different flag. It force-clears after **20 seconds**. The signup button does not.

This was **not reproduced** with a real mobile browser in this session. There is no Android device, no iOS device, and no Firefox. Desktop Chrome with a narrow viewport is not treated as a phone. The hang is a **code-proven** path that mobile networks and in-app browsers hit more often, because the auth POST is cross-origin to `caretip.onrender.com` and nothing aborts it.

Facebook is one of several providers with its own stuck-spinner path. It is **not** required to explain a stuck “Create Business Account” press.

## Exact Reproduction Conditions

| Item | Result |
| --- | --- |
| Page | `https://caretip.de/signup` renders the form (prior production load: HTTP 200, FCP about 1.4 s, Google and Facebook scripts present). Fields were not submitted |
| Real Android Chrome | **NOT TESTED** (no device) |
| Real Android Firefox | **NOT TESTED** |
| Real iOS Safari | **NOT TESTED** |
| Desktop Chrome 155, mobile-sized viewport | Used earlier for marketing performance only. Signup was not submitted. Not treated as a phone |
| Issue reproduced here | **No.** The permanent-loading paths below are from the current source, with file and line |

What a future reproduction must record, once, on a real phone: which control was pressed (Create Business Account, Google, Apple, or Facebook), whether `POST /api/auth/register` or `/api/auth/signin` or `/api/auth/oauth` appears, whether it stays pending, and whether the button text changes to “Preparing your account…”.

## Affected Platforms

| Surface | Same code as web signup? | Loading can stick? |
| --- | --- | --- |
| Mobile Safari / Chrome on `caretip.de` at width ≤ 767 px | Yes. `MobileWebAuthShell` | **Yes**, button `busy` |
| Desktop `caretip.de` | Same `handleSubmit` | Same code path. Less often stalled by the network |
| Installed PWA | Same web bundle, plus a service worker after install | Same button bug. Chunk fetches can also sit pending |
| Expo app (`mobile/`, React Native 0.81, Expo 54) | **No.** Native Google / Apple / Facebook SDKs and `useSocialAuth` | Social `loadingProvider` **is** cleared in `finally`. A native SDK promise that never settles still holds the spinner until then. Not the website screenshot |

## Authentication Flow Map

```
Viewport ≤ 767 px
  → AuthPage getMobileWebAuthSnapshot()
  → MobileWebAuthShell
       password submit → handleSubmit
       Google / Apple / Facebook credential → runSocialOAuth → handleSubmit's sibling
  → loginAPI | registerAPI | oauthAPI
       apiRequest → fetchWithNetworkRetry (no timeout)
       credentials: "include"
       URL = VITE_API_URL + /api/auth/...  → https://caretip.onrender.com in production
  → success
       password signup: navigate /verify-email, keep isSubmitting
       login / OAuth session: redirectAfterAuth → preparePostAuthDestination → navigate
       beginAuthSignInHandoff cover (20 s max)
  → error
       endAuthSignInHandoff + setError, finally clears isSubmitting
       unless postAuthRedirectRef was already set
```

Facebook redirect (default, not SDK) does not use `runSocialOAuth` first. It sets a Facebook circle spinner and `form.submit()`s `POST /api/auth/facebook/start` on the page origin.

## Loading-State State Machines

### 1. Signup / login button — `isSubmitting` + `authFlowInProgress`

File: `src/app/components/AuthPage.tsx`

| | |
| --- | --- |
| Starts | `handleSubmit` lines 375–377; also 333–336 if a session already exists; `runSocialOAuth` 582–584; `handleMfaSubmit` 495–497 |
| Clears on error | `finally` 454–460, 529–534, 628–633, only when `postAuthRedirectRef.current` is null |
| Clears on success | **Not cleared.** Comment at 456: keep the spinner until unmount |
| Cancellation | None. No `AbortController` |
| Timeout | None on the button. Handoff cover is separate (20 s) and does not reset `isSubmitting` |
| Unmount | Spinner disappears only if React unmounts `AuthPage` |
| `finally` guarantees cleanup | **No**, once a redirect target is stored |

`MobileWebAuthShell` line 329: `loading={busy}` with `busy={isSubmitting || authFlowInProgress}` (`AuthPage.tsx` 771).

State machine:

```
IDLE
  → LOADING          setIsSubmitting(true) before await register/login
  → ERROR            catch + finally (ref still null) → IDLE + error text
  → SUCCESS          postAuthRedirectRef set, navigate, isSubmitting stays true
  → (unmount)        spinner gone because the component is gone
  → HANG             promise never settles, OR success but this page never unmounts
```

There is a second hang that does not even enter `try/finally`:

```332:337:src/app/components/AuthPage.tsx
    if (user != null && !sessionValidated) return;
    if (user != null && sessionValidated) {
      setAuthFlowInProgress(true);
      setIsSubmitting(true);
      await redirectAfterAuth(user);
      return;
    }
```

`redirectAfterAuth` returns immediately when already on the target or when `postAuthRedirectRef` already equals that target (`AuthPage.tsx` 178–179) **without** clearing `isSubmitting`. That path is only when a user object is already in memory. It does not match an empty signup form. It does match “Continue” on a restored session.

### 2. Sign-in handoff cover — module flags in `authSignInHandoff.ts`

| | |
| --- | --- |
| Starts | `beginAuthSignInHandoff` line 119, from the same submit |
| Clears | `endAuthSignInHandoff` on error, MFA challenge, or when the destination layout commits |
| Timeout | **Yes.** `HANDOFF_MAX_MS = 20_000` (line 12), `timeout_force_end` at lines 132–138 |
| Does not clear | `isSubmitting` |

So a cover that disappears after 20 seconds while the button still says “Preparing your account…” is consistent with this code.

### 3. Facebook circle — `providerBusy === "facebook"`

`OAuthProviderRow.tsx` 281–286 sets `providerBusy` then calls `submitFacebookOAuthRedirectStart`. The only clear callback is `onSubmitFailed`.

`facebookOAuthRedirectWeb.ts` 266: after 5 seconds, `markAttemptCommitted()` runs and **does not** call `onSubmitFailed`. `onSubmitFailed` runs only from `failStart` (CSP `form-action` block or `form.submit` throw). If the document stays on `/signup`, the Facebook spinner stays up. Password signup does not set this flag.

### 4. Apple circle — `providerBusy === "apple"`

`OAuthProviderRow.tsx` 350–358: `finally` clears `providerBusy` when `requestAppleIdToken()` settles. `appleOAuthWeb.ts` 67–83 uses `usePopup: true` and `auth.signIn()` with **no timeout**. If that promise never resolves (popup blocked or sheet dismissed without a rejection), `finally` never runs.

### 5. Google

`AuthGoogleLoginCircle.tsx` uses `@react-oauth/google` `GoogleLogin` (`useOneTap={false}`). There is no timeout around the Google script or the credential callback. After a credential arrives, `runSocialOAuth` sets the **whole form** `busy`, same as password signup.

### 6. Session bootstrap

`whenSessionBootstrapSettled()` (`authSessionBootstrap.ts` 145–154) has **no timeout**. `apiRequest` waits on it for every `/api/` URL, including `/api/auth/register` (`api.ts` 412–416 and 672–677).

On an anonymous visit, bootstrap returns `{ kind: "unauthenticated" }` without calling refresh (`useAuthInitializer.ts` 235–237) and then sets `authHydrated`. The signup form is not rendered while `AuthBootstrapShell` is showing (`AuthPage.tsx` 685–687). A form that is already on screen means this wait has finished. It is **not** the cause of a spinner that starts on button press.

Refresh itself, when it does run, times out at 12 seconds (`BOOTSTRAP_REFRESH_TIMEOUT_MS` / `REFRESH_COORD_TIMEOUT_MS`).

### 7. Native app social spinner

`mobile/hooks/useSocialAuth.ts` 133 and 193–195: `setLoadingProvider` is cleared in `finally` even on MFA navigation. Native startup uses `withTimeout`. The website signup button does not.

## Network Findings

No auth POST was sent during this audit.

From code, a “Create Business Account” press sends:

| | |
| --- | --- |
| Method | POST |
| Path | `/api/auth/register` |
| Host | Production API base (`https://caretip.onrender.com` when `VITE_API_URL` is that host) |
| Credentials | `include` (`registerAPI`, `api.ts` 902–907) |
| Body | email, password, name, role, `merchantLegalAccepted` for business signup. Not logged here |
| Timeout | **None** |
| Retry | One extra attempt only after a thrown network `TypeError`, 2.5 s later, and only when the API base is cross-origin (`fetchWithNetworkRetry`, `api.ts` 639–660). A request that stays **pending** is not retried and is not aborted |

Classification if the button stays on “Preparing your account…”:

| Case | What the code does |
| --- | --- |
| A. Request never sent | Only if validation returns first (empty fields, weak password, legal box unchecked). Those returns happen **before** `setIsSubmitting(true)` |
| B. Request pending forever | **Matches the stuck button.** `await register()` never finishes, `finally` never runs |
| C. HTTP error | `catch` sets `error`, `finally` clears the button |
| D. HTTP success, UI continues | `postAuthRedirectRef = "/verify-email"`, then prefetch shell, then `navigate`. Button stays busy until unmount |
| E. HTTP success, navigation never commits | Button stays busy on `/signup`. Account may already exist |
| F. Facebook callback / refresh | Not on the password button path |

Server receipt of a hung mobile request was **NOT MEASURED**. No Render logs were pulled.

## Cookie / Session Findings

Not reconfigured. From the current cookie code and the earlier production probes:

- Refresh cookie name `caretip_refresh`, `HttpOnly`, `Path=/`, **no Domain** (host-only).
- Production `SameSite=None; Secure`. Development `SameSite=Lax`.
- Password, Google, and Apple responses `Set-Cookie` on the **API host** that handled the POST (`caretip.onrender.com` when the browser calls that host).
- Facebook’s browser-facing callback is the **page origin** (`https://www.caretip.de` or `https://caretip.de`, whichever `FRONTEND_URL` is). That session then refreshes same-origin `/api/auth/refresh` only when the page-origin flag is set.
- `www.caretip.de` redirects to `https://caretip.de`. Host-only cookies do not cross those hosts.

A missing third-party cookie on mobile Safari can make a **later** refresh fail. It does not, by itself, stop `registerAPI` from resolving if the HTTP response arrives. The stuck-button bug does not require a cookie bug. Cookie changes are out of scope and would not clear `isSubmitting` while `fetch` is still pending.

No new browser capture of `Set-Cookie` was taken for this audit (no login was performed).

## Web Mobile Findings

`isMobileWebAuth` is only `matchMedia("(max-width: 767px)")` (`AuthPage.tsx` 77–85). There is no user-agent branch on the password POST.

At that width the page mounts `MobileWebAuthShell` and keeps the desktop card in the DOM under `caretip-auth-desktop-only`. Both call the same `handleSubmit` / `runSocialOAuth`. The visible label “Create Business Account” is the mobile shell.

Mobile-specific behavior that can feed the hang, without a separate mobile function:

- Cross-origin `fetch` to `onrender.com` with `credentials: "include"` is more often left pending on mobile Safari and in-app browsers (radio handoff, tab discard). Desktop usually fails or finishes.
- Apple JS is `usePopup: true` (`appleOAuthWeb.ts` 80). Mobile Safari often blocks or never settles `signIn()`.
- Facebook start is a full-document form POST. If the browser does not navigate and does not emit a CSP violation, the circle spinner is never cleared.
- Google’s button is a cross-origin iframe (`accounts.google.com`). A tap that never calls `onSuccess` or `onError` never enters `runSocialOAuth` and does not set the form busy. Once `onSuccess` runs, the form busy flag is the same hang as password signup.

## Mobile App / WebView Findings

The app under `mobile/` is **Expo + React Native**, not a WebView of `caretip.de/signup`.

| Mechanism | Used for auth? |
| --- | --- |
| React Native / Expo | Yes |
| Capacitor / Cordova | No |
| Embedded `caretip.de` WebView for signup | No. `react-native-webview` is used for legal documents (`LegalDocumentView.tsx`), not the auth form |
| System browser / custom tabs | Billing and some web handoffs (`openBillingWeb`, `/mobile-auth`), not the native login buttons |
| Native Google / Apple / Facebook SDKs | Yes (`mobile/services/google`, `apple`, `facebook`) |

`MobileAuthHandoffPage.tsx` on the website consumes a one-time token for app→web handoff and calls `beginAuthSignInHandoff` / `endAuthSignInHandoff`. That page is not `/signup`.

Native `useSocialAuth` clears `loadingProvider` in `finally`. A native SDK call that never resolves is the remaining native hang, and it was not executed here.

## PWA / Service Worker Findings

Workbox (`vite.config.ts`): cache id `caretip-pwa-v13`, `registerType: 'autoUpdate'`, `skipWaiting` via `registerSW({ immediate: true })` in `main.tsx`, `navigateFallback: index.html`, denylist `/api`, `/uploads`, `/socket.io`.

API auth POSTs to `onrender.com` are not handled by that navigation fallback. A hung `fetch` is not an SW navigation intercept.

`import()` of `/verify-email` has no timeout (`prefetchAuthenticatedRoutes.ts` 126–150). The `.catch` only runs if the import **rejects**. A pending import keeps `preparePostAuthDestination` pending, which keeps the signup button busy after a successful register. A controlling service worker with a bad asset entry can cause that. The earlier cold Chrome test had **no** service-worker controller. A phone that has installed the PWA might. That was not re-checked on a device.

## Error Handling Findings

| Failure | What the user sees |
| --- | --- |
| Validation (password, legal checkbox, name) | Inline error. Button not busy |
| HTTP 4xx/5xx from register/login/oauth | Inline error or role-mismatch toast. Button returns to “Create Business Account” |
| `TypeError` / “failed to fetch” after the one retry | User-facing network message. Button clears |
| Request stays pending | **No message.** Button stays on “Preparing your account…” |
| Success but `/signup` stays mounted | **No message.** Button stays busy. Handoff cover, if shown, ends at 20 s anyway |
| Facebook start with no navigation and no CSP event | Facebook circle spinner stays. No toast |
| Apple `signIn()` never settles | Apple circle spinner stays. No toast |
| Empty `catch` | Not on these submit paths. Errors that reject are surfaced |

## Performance Findings

This is a **hang**, not a slow success, when the promise never settles or the page never unmounts.

| Interval | Bound in code |
| --- | --- |
| Time to send register | Immediate after validation |
| Server time | Unknown for a pending fetch. No client deadline |
| Frontend after HTTP success | Await shell `import()` for `/verify-email`, then `navigate` |
| Handoff cover | Hard stop 20 s. Does not reset the button |
| Dashboard data | Explicitly not awaited (`warmBusinessDashboardDataInBackground`) |

Do not treat the 20-second cover as the signup-button bug. They are different flags.

## Root Causes

### RC1 — Password and OAuth form busy flag has no deadline

- **Severity:** P0 for the reported button
- **Evidence:** `AuthPage.tsx` 373–461 (`register` / `login` awaited with no `AbortSignal`). `api.ts` 639–642 (`fetch` with no timeout). `MobileWebAuthShell.tsx` 328–335 (label switches to `creatingAccountWait` for the whole `busy` period). `finally` at 454–460 skips the reset when `postAuthRedirectRef` is set (409–425 for signup).
- **Affected platforms:** Any browser. More visible on mobile because cross-origin credentialed requests stall there more often.
- **Providers:** Password signup, password login, and Google/Apple/Facebook **after** an ID token is in hand (`runSocialOAuth`).
- **Confidence:** **HIGH** that this code can leave the button busy forever. **MEDIUM** that it is the specific phone incident, because that click was not captured.

### RC2 — Facebook spinner ignores “still on this page”

- **Severity:** P1 (only the Facebook control)
- **Evidence:** `OAuthProviderRow.tsx` 281–286 and `facebookOAuthRedirectWeb.ts` 236–266. The 5 s timer marks the attempt committed and does not call `onSubmitFailed`.
- **Platforms:** Any browser where `form.submit()` does not navigate. Mobile in-app browsers do this more often.
- **Providers:** Facebook redirect only.
- **Confidence:** **HIGH** for the code path. **LOW** as the explanation of a “Create Business Account” press, which does not set `providerBusy`.

### RC3 — Apple popup promise has no timeout

- **Severity:** P1
- **Evidence:** `appleOAuthWeb.ts` 76–83 (`usePopup: true`, `await auth.signIn()`). `OAuthProviderRow.tsx` 350–358 (`finally` only after settlement).
- **Platforms:** Mobile Safari and WebViews that block `window.open` / Apple’s popup.
- **Providers:** Apple on the website only. The Expo app uses the native Apple SDK.
- **Confidence:** **MEDIUM**. Common failure mode; not executed on a device here.

## Non-Root-Causes

Investigated and not the stuck “Create Business Account” button:

- Facebook OAuth redirect URI / page-origin refresh. That runs after a Facebook redirect, not on password submit.
- Cookie `Domain`, `SameSite`, or Netlify proxy. A missing cookie can fail a later refresh. It does not keep `fetch` pending, and `finally` still clears the button when the response arrives.
- CSP. A CSP block on Facebook **does** call `onSubmitFailed` and navigates to the completion error page.
- Session bootstrap wait. The form is hidden until bootstrap finishes. The spinner starts later, on submit.
- The 12-second refresh timeout and the 20-second handoff timeout. Both exist. Neither aborts `registerAPI`.
- Global loader on `/faq/` from the performance audit. `/signup` does not redirect to a trailing slash (measured final URL `https://caretip.de/signup`). That FAQ bug is a different overlay.
- Expo WebView cookie isolation. The screenshot is the website shell (`auth.mobileWebAuth.registerTitle` / `signUp`).
- Duplicate submit. `authInFlightRef` ignores a second press. It does not clear the first.
- Service worker swallowing `/api/*`. The denylist excludes `/api`, and the auth POST is cross-origin to Render anyway.

## Recommended Fixes

Do not implement these in this audit.

### P0 — must fix

**File:** `src/app/components/AuthPage.tsx` (`handleSubmit`, `runSocialOAuth`, `handleMfaSubmit`) and `src/app/lib/api.ts` (`registerAPI` / `loginAPI` / `oauthAPI`, or `fetchWithNetworkRetry` for those paths only).

**Change:** Abort the auth `fetch` after a bounded time (the refresh path already uses 12 seconds). On abort, reject into the existing `catch`. In `finally`, clear `isSubmitting` and `authFlowInProgress` when the component is still mounted, including when `postAuthRedirectRef` is set but navigation has not left `/signup` or `/login`.

**Why:** That is the flag the mobile button renders.

**Expected result:** A stalled register shows the existing network error and the button returns to “Create Business Account”. A successful register still navigates to `/verify-email`.

**Risk:** Low if the timeout is only on auth POSTs. Do not abort `/api/auth/refresh` with a new policy. Do not change cookies or OAuth redirects.

### P1 — important

**File:** `src/app/lib/facebookOAuthRedirectWeb.ts` and the `onSubmitFailed` callback in `OAuthProviderRow.tsx`.

**Change:** If `pagehide` / unload has not happened when the 5-second window ends, call `onSubmitFailed()` so `providerBusy` clears, and show the existing start-failure UI.

**Why:** Today that timer only sets `submitCommitted` and leaves the spinner.

**Risk:** Low. Do not make OAuth state reusable. Do not change the redirect URI.

**File:** `src/app/lib/appleOAuthWeb.ts`.

**Change:** Race `auth.signIn()` with a timeout so `OAuthProviderRow`’s `finally` runs.

**Risk:** Medium on desktop if a slow Apple sheet is cut off. Keep the timeout long enough for a real sheet (for example the same 20 seconds as the handoff cover).

### P2 — improvement

**File:** `src/app/lib/prefetchAuthenticatedRoutes.ts`.

**Change:** Do not block `navigate` on `prefetchAuthenticatedShell`. The function already treats import failure as best-effort; a pending import is the remaining hole. Navigate first, prefetch in the background.

**Risk:** Low. Verify-email and dashboards already render their own loading states.

## Answers

1. **What is stuck?** The mobile signup button’s `busy` state: `isSubmitting || authFlowInProgress` in `AuthPage`, rendered by `MobileWebAuthShell` as “Preparing your account…”.
2. **Which platforms?** The website at viewport ≤ 767 px. The same flag exists on desktop. Real iOS/Android were not available to confirm a live hang. The Expo app uses a different spinner that `finally` does clear.
3. **Which providers?** Password signup and login, and any OAuth provider after an ID token exists. Facebook’s own circle can stick separately. Apple’s circle can stick if `signIn()` never settles.
4. **Does the request reach the backend?** **Not measured** for a stuck attempt. If the button is busy, `registerAPI` has been called and `fetch` may still be pending, so the server may never have seen it.
5. **Does the backend complete?** **Unknown** for a hung `fetch`. If it completed, the UI would still stay busy until this page unmounts.
6. **Does the frontend receive the response?** If it did, `finally` would run. A busy button with no error means the promise has not settled, or it settled successfully and the page did not unmount.
7. **Which state fails to clear?** `isSubmitting` / `authFlowInProgress`. Not the 20-second handoff cover.
8. **Why mobile?** There is no second signup implementation. Mobile is where a cross-origin credentialed `fetch` and Apple/Google popups stay pending, and nothing on the button path times out.
9. **Smallest safe fix?** Timeout the auth `fetch` and always clear `isSubmitting` if `/signup` is still mounted.
10. **What should not change?** Cookies, `SameSite`, redirect URIs, Meta settings, CSP, the Netlify proxy, Render, the service worker, OAuth state single-use, and the Facebook page-origin session handoff.
