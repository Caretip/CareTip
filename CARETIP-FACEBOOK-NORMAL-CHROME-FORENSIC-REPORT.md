# CareTip — Normal Mobile Chrome Facebook OAuth Failure

Read-only investigation, 9 October 2026. No application source, configuration, OAuth state, or deployment was changed. No Facebook login was completed, and no production OAuth state row was created.

## 1. Executive verdict

The sentence the normal mobile Chrome tab shows is the start-failure page, not a Facebook callback error and not a JavaScript crash.

Production bundle `index-DgWrfY1h.js` (live on `https://caretip.de/signup` and `/login` at the time of this audit) starts a 20-second timer when the Facebook button submits a full-page `POST /api/auth/facebook/start`. The timer treats “the document never fired `pagehide`” as failure. It then navigates to `/auth/facebook/complete?error=start_failed`. That page renders:

- German: **Facebook-Anmeldung konnte nicht gestartet werden**
- English source string: **Facebook sign-in could not be started**

Playwright confirmed the timing. With the start request deliberately left hanging, so it never reached Render, both desktop Chromium and Pixel 7 emulation left `/login` for that error URL 20.0 seconds after `START_SUBMIT_INVOKED`. The visible German heading and body were present on the mobile runs. A control that answered the same POST with an immediate 302 did not show the failure.

The timer does not call the API and does not consume or invalidate the server-side OAuth state. It can still cancel a legitimate attempt: the failure navigation aborted the in-flight document POST (`net::ERR_ABORTED` at the same instant as `START_FAILURE`).

This is the most likely explanation of “stays loading, then Facebook could not start” on normal mobile Chrome. It is not proven on a physical phone. Desktop, Incognito, and Firefox can avoid it whenever their navigation commits, and `pagehide` fires, inside 20 seconds. Emulation cannot open the installed Facebook app, so app handoff remains a hypothesis for why normal Chrome sometimes never commits that navigation.

## 2. Exact source location and trigger

There is no literal English string “Facebook could not start.” The matching copy is:

| Surface | Key | Text |
| --- | --- | --- |
| Title | `auth.oauth.facebookRedirectStartErrorTitle` | Facebook sign-in could not be started |
| Body | `auth.oauth.facebookRedirectStartFailed` | Facebook sign-in couldn't be started. Please try again or use another sign-in method. |
| German title, observed in Playwright | same keys | Facebook-Anmeldung konnte nicht gestartet werden |
| German body, observed in Playwright | same keys | Die Facebook-Anmeldung konnte nicht gestartet werden. Bitte erneut versuchen oder eine andere Anmeldemethode nutzen. |

A different string, “Facebook could not open because your browser blocked the sign-in window,” belongs to the unused popup path (`facebookPopupBlocked`). Production redirect mode does not use it. The live bundle sets the redirect flag to always true (`function UM(){return!0}`).

### What displays the page

1. `submitFacebookOAuthRedirectStart` in `src/app/lib/facebookOAuthRedirectWeb.ts` calls `failStart`.
2. `failStart` stores a diagnostic in `sessionStorage` (`caretip_fb_oauth_start_last_failure`) and calls `navigateToFacebookStartFailure`.
3. That assigns `window.location` to `/auth/facebook/complete?error=start_failed`.
4. `FacebookOAuthCompletePage` reads `error=start_failed` (`FACEBOOK_OAUTH_START_FAILED_ERROR`) and renders the title and body above. It does not exchange a code and it does not call `/api/auth/facebook/complete`.

### Three ways `failStart` runs

| Trigger | Failure type | When |
| --- | --- | --- |
| `securitypolicyviolation` for `form-action` | `csp_form_action_blocked` | Immediately, if CSP blocks the form or the Facebook redirect |
| `form.submit()` throws | `form_submit_exception` | Immediately |
| Stall timer | `client_start_aborted` / `redirect_navigation_stalled` | 20 seconds after submit, and only if `pagehide` has not run |

The stall timer is `getAuthCredentialExchangeTimeoutMs()`, which returns `HANDOFF_MAX_MS` (20,000 ms) from `src/app/lib/authSignInHandoff.ts`. `shouldFailFacebookStartForStall` returns true only when `navigationLeft` is false and no earlier failure was handled. `navigationLeft` is set only in the `pagehide` listener, which also marks the attempt committed and clears the timer.

If `document.visibilityState` is `"hidden"` when the 20 seconds elapse, the timer does not fail yet. It waits for a later `visibilitychange` to `"visible"`, then fails if `pagehide` still has not fired.

A separate 5-second timer does not fail the attempt. It only marks the attempt committed if `pagehide` has already fired.

### Can the UI fail while a valid attempt is still in progress?

Yes.

- `failStart` does not create, read, consume, reuse, or delete OAuth state. The only client write is `sessionStorage`.
- The same navigation cancels the browser’s pending document POST. Playwright recorded `net::ERR_ABORTED` on `POST /api/auth/facebook/start` at the `START_FAILURE` timestamp. If that POST had already been sent to Render, aborting it in the browser would not delete a state row the server had already inserted, and it would abandon the navigation before Facebook.
- If Facebook had already received the browser, and the CareTip tab was still the signup/login document because `pagehide` never fired, the timer would still send that tab to the error page. The server state would remain unused until it expires or Facebook returns to the callback.

The timeout can therefore fire after navigation has started but before the document is unloaded, and after control has passed to another application if that handoff does not fire `pagehide`. Those two situations were not reproduced on a physical device. The code path that would do it is present and is what the emulated “navigation never commits” test hit.

## 3. End-to-end request and redirect trace

The browser path is the same on desktop and mobile. The server does not branch on user agent or Incognito.

| Step | Request | Expected result | Error branch | Cookies, storage, service worker |
| --- | --- | --- | --- | --- |
| 1. Tap Facebook | Button `onClick` → `runFacebookLogin` in `OAuthProviderRow.tsx` | Redirect mode calls `submitFacebookOAuthRedirectStart` and sets the button busy before the POST | Disabled when another provider is busy, or when business signup has not accepted merchant legal terms. SDK-not-ready toast is only on the non-redirect path | No OAuth cookie is required to start |
| 2. Form submit | `POST https://caretip.de/api/auth/facebook/start`, `Content-Type` form body, resource type `document` | Netlify `public/_redirects` proxies `/api/*` to `https://caretip.onrender.com/api/:splat` with status 200. The browser still sees the CareTip URL | A thrown `form.submit()` or a `form-action` CSP violation navigates to `start_failed` without a server round trip | Form fields seen in Playwright: `correlationId`, `isLogin`, `returnPath`, `intendedRole`. Signup adds merchant-legal and profile fields. No service-worker claim is required |
| 3. Origin check | `requireTrustedOrigin` on `POST /facebook/start` | 403 JSON if Origin, Referer, and `X-CareTip-Client` are all missing. A normal form POST from caretip.de sends Origin | 403 is JSON, not the “could not be started” page. The stall timer can still replace the tab 20 seconds later if the document never unloads | Depends on the browser sending Origin or Referer |
| 4. State creation | `createFacebookOAuthState` | Inserts one single-use row, then `302` to `https://www.facebook.com/v21.0/dialog/oauth` with `client_id`, `redirect_uri`, `state`, `scope=email,public_profile`, `response_type=code` | 400 JSON if signup has no `intendedRole`, or business signup has no merchant-legal flag. 401 JSON on the link flow without a session. 503 JSON on an exception | Creates server state. Does not read a Facebook cookie. This audit did not send this POST |
| 5. Facebook | Browser follows the 302 | Facebook’s page, or an Android handoff to the Facebook app for `www.facebook.com` | Not a CareTip page | Facebook’s own cookies and app links. Not observable from this repo |
| 6. Callback | `GET /api/auth/facebook/callback?code&state` | Server redeems the code once and 302s to `/auth/facebook/complete` | Query errors such as `state_invalid`, `already_processed`, `denied`. Those use other copy, not the start-failed title | Callback does not use `requireTrustedOrigin`. Replay of a used state does not create a second session |
| 7. Completion | SPA route `/auth/facebook/complete` | On `success=1`, refreshes the session. On `error=start_failed`, shows the heading in section 2 and does not refresh | `error` present skips the session exchange | Reads and removes the `sessionStorage` diagnostic. Does not need the service worker |

`redirect_uri` is `{public frontend origin}/api/auth/facebook/callback`, which Netlify proxies to Render. The callback then redirects the browser to the frontend complete page.

The live service worker is `caretip-pwa-v13` (`GET /sw.js` returned 200). In every Playwright context the controller was `null` at click time, including a persistent profile that had registered `https://caretip.de/sw.js` and had been reloaded. This audit therefore has no evidence that a controlling worker, or a stale cached bundle, produced the message. The current worker’s navigation fallback denylist excludes `/api`, so it is not a proven interceptor of this POST.

The button can show the title “Facebook-Anmeldung wird geladen…” while it is still enabled. That title is the SDK warm state. It is not the failure page. On `/signup`, business accounts keep the Facebook button disabled until the merchant-legal checkbox is checked. That is a gate before submit, not the failure message.

## 4. Playwright results

Harness: Playwright 1.61 headless Chromium, 9 October 2026. Mobile cases used the Pixel 7 device descriptor. That is emulation, not a physical Android device, and it cannot hand `www.facebook.com` to the Facebook app.

The start POST was intercepted in the browser and was not forwarded to Render. No production status code or Facebook `Location` was observed. The hang cases left the request pending so the stall timer could be observed without creating OAuth state. The control case answered with a synthetic `302` to `https://caretip.de/login?fbprobe=1`.

Cookie consent was pre-seeded only inside the Playwright profile (`caretip_cookie_consent`, all non-essential categories false) so the banner would not cover the button. An earlier mobile attempt without that seed could not click through the banner.

| Case | Click / submit (UTC) | Outcome | HTTP |
| --- | --- | --- | --- |
| Desktop fresh, 1280×800, `/login`, request hung | Submit `08:02:51.545Z`. `START_FAILURE` `08:03:11.546Z` (20.0 s) | URL became `/auth/facebook/complete?error=start_failed` at `08:03:11.965Z`. Script `index-DgWrfY1h.js`. Service-worker controller `null` | Intercepted POST, never sent. Browser then reported `net::ERR_ABORTED` at `08:03:11.553Z` because the failure navigation cancelled it |
| Pixel 7 fresh, `/login`, request hung | Submit `08:09:08.251Z`. `START_FAILURE` `08:09:28.250Z` (20.0 s) | Same error URL at `08:09:28.687Z`. Heading and alert were the German sentences in section 2. `COMPLETION_ERROR` logged `error: start_failed` at `08:09:29.847Z`. Controller `null` | Same: intercepted POST, then `net::ERR_ABORTED` at `08:09:28.276Z` |
| Pixel 7 fresh, `/login`, synthetic 302 | POST `08:10:11.282Z`. Navigation `08:10:12.028Z` | Landed on `/login?fbprobe=1`. No `START_FAILURE`. No start-failed heading. Controller `null` | Synthetic 302 only. Not a production response |
| Pixel 7 persistent profile, `/login`, request hung | Service worker registered `https://caretip.de/sw.js` after the first load. After reload, controller was still `null`. Submit `08:10:28.627Z`. `START_FAILURE` `08:10:48.643Z` (20.0 s) | Same German failure page at `08:10:49.008Z` | Intercepted POST, then `net::ERR_ABORTED` at `08:10:48.668Z` |
| Pixel 7 fresh, `/signup` | Button never clicked | Stayed on `/signup`. Facebook button remained `disabled`. Title was “Mit Facebook fortfahren” | No POST |

No uncaught page exceptions were recorded. Console errors on the successful runs were the expected `[CareTip:FacebookOAuth] START_FAILURE` and `NAVIGATING_TO_START_FAILURE` lines. Runs made before the cookie banner was suppressed also logged a Radix `DialogContent` accessibility warning from the cookie dialog. That warning did not accompany the failure once the banner was absent.

The document did not stay on `/login` until the message appeared. It stayed on `/login` for 20 seconds while the POST was outstanding, then the timer itself navigated to the failure URL, and the failure page rendered the message.

## 5. Confirmed findings versus unproven hypotheses

### Confirmed

- The failure copy is the `start_failed` completion page, reached by `window.location.assign` from the Facebook start helper.
- The live bundle contains that stall path (`client_start_aborted`, `redirect_navigation_stalled`, `pagehide`, and the hidden-tab deferral). Measured delay is 20.0 seconds.
- The timer does not touch OAuth state. It does abort a document POST that has not unloaded the page.
- When a navigation commits promptly, the failure page is not shown.
- The same timer fires on desktop Chromium when navigation is prevented. The code is not mobile-only. Production “desktop works” is consistent with desktop navigation committing inside 20 seconds.
- Fresh and persistent emulated profiles reproduced the message with no controlling service worker.
- Business `/signup` will not submit Facebook until merchant legal acceptance. That disablement is separate from the failure page.

### Not proven

- That a physical normal Chrome tab hits this timer, rather than a CSP violation, a 400/403/503 JSON body, or a Facebook callback error. The user’s wording matches this page, but there is no phone log tying a real tap to `redirect_navigation_stalled`.
- That the Facebook app, or a slow 302, is why `pagehide` is missing. Emulation never opened the app and never received a production 302.
- That a controlling or stale service worker is involved. None controlled these browser contexts.
- That Incognito or Firefox differ in CareTip code. They do not. Any difference is in whether the navigation commits before 20 seconds.

## 6. Most likely root cause

The 20-second start timer reports failure, and navigates away, whenever `pagehide` has not fired. On normal mobile Chrome the Facebook navigation sometimes does not unload the CareTip document within 20 seconds, so the tab sits on the loading state and then shows “Facebook-Anmeldung konnte nicht gestartet werden.”

The timer will do that even if the POST is still in flight, and even if Facebook already has a valid authorization request that did not unload the tab. Incognito, Firefox, and desktop avoid the message when their navigation does unload the tab in time. That fits the reported split. It is the best explanation supported by the code and by the emulated timing. It is not confirmed on the device that fails.

## 7. Smallest safe corrective action

Do not change this during the audit. The justified change, when one is made, is limited to the stall timer.

`pagehide` is the only signal the timer accepts as “the browser left the page.” Absence of `pagehide` is not proof the POST failed. Calling `location.assign` from that timer cancels the outstanding document navigation. That violates the rule that the timeout must never cancel a legitimate Facebook attempt.

The smallest safe change is to stop the stall timer from calling `failStart` and from assigning `/auth/facebook/complete?error=start_failed`. Leave the CSP and `form.submit()` exception paths as they are: those are failures before a navigation exists. Do not add a popup, a second Facebook host, an automatic retry, or any write to OAuth state. Clearing the button spinner without navigating is optional and is still only a display change; it must not abort the POST.

## 8. Physical-phone test

Use one normal Android Chrome tab, with USB debugging and “Preserve log” enabled. Do not complete the Facebook login. A real tap creates one unused OAuth state on the server; one attempt is enough, and that state must not be replayed.

1. Record the page script name and `navigator.serviceWorker.controller` before the tap.
2. Tap Facebook. In the console, record the timestamps of `START_SUBMIT_INVOKED` and, if it appears, `START_FAILURE` with reason `redirect_navigation_stalled`.
3. In the network log, record the POST status and `Location`, and whether the POST later shows as canceled.
4. Note whether the Facebook app opens, whether the CareTip tab remains on `/login` or `/signup`, and `document.visibilityState` if the tab is still inspectable.
5. If the German heading appears, record the seconds since the tap. About 20 seconds plus `redirect_navigation_stalled` identifies this timer.
6. Repeat once in Incognito on the same phone. Incognito should navigate to Facebook and should not log `START_FAILURE`.

### Evidence still required

A physical normal-Chrome trace that shows all of the following for one tap: POST status, `Location`, whether `pagehide` fired, whether the Facebook app opened, and the console reason at the moment the heading appears. If that heading appears with `redirect_navigation_stalled` at about 20 seconds while the POST was still pending or already redirected, the root cause above is confirmed. If the heading appears with a different `error` query, or with no `START_FAILURE` log, the cause is a different branch and this timer is not it.
