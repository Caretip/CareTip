# CareTip — Mobile Facebook OAuth Redirect Forensic Audit

Date: 8 October 2026. Read-only. No code, configuration, cookies, CSP, service worker, or Meta settings were changed. Desktop Facebook OAuth was not exercised and was not modified.

Classification: **probable mobile browser / installed-app handoff, not proven on a physical phone.** This session had no Android or iOS device, so the failing tap was not reproduced. The conclusion is the first divergence the current production code and Facebook’s published app-link claims can support. It is not a second CareTip code path for Incognito.

## 1. Executive Summary

Normal mobile and Incognito do not run different Facebook OAuth code.

Production `https://caretip.de` serves `index-DtR_onsJ.js`. In that file, redirect mode is unconditionally on. A Facebook tap builds a hidden `POST` form to `/api/auth/facebook/start`, calls `submit()`, then removes the form. There is no branch on Incognito, private mode, or “normal tab.”

The server always redirects a successful start to:

`https://www.facebook.com/v21.0/dialog/oauth`

Desktop works because that navigation stays in the browser. A normal mobile browser with the Facebook app installed can hand `www.facebook.com` to the app. Incognito usually will not. The verification page then appears only in the private tab, while the normal tab stays on `/signup` with the button spinner.

That handoff was **not captured** on a phone in this investigation. What was checked:

- production HTML, CSP, service worker, and the live JS bundle
- the start controller and the URL it builds
- Facebook’s Android `assetlinks.json` for both `www.facebook.com` and `m.facebook.com` (fetched 8 October 2026)

Both hosts currently authorize `com.facebook.katana` (the Facebook Android app). Switching the dialog host from `www` to `m` is therefore **not** an evidence-backed fix.

The loading spinner is a symptom. Production does not contain the 20-second stall recovery that exists only in the local working tree. That local recovery does not consume OAuth state. It must not run if the browser has already left `/signup`.

No Facebook OAuth architecture change is justified from this evidence. Desktop must stay as it is.

## 2. Current Working Desktop Baseline

Documented from production code and the confirmed desktop result. Not re-tested and not changed.

1. Signup or login renders `AuthOAuthButtons` → `OAuthProviderRow`.
2. The click calls `submitFacebookOAuthRedirectStart` because `isFacebookOAuthRedirectEnabled()` is true in production (`function DM(){return!0}` in `index-DtR_onsJ.js`).
3. The browser performs a full-page `POST` to `https://caretip.de/api/auth/facebook/start` (same-origin path; Netlify proxies `/api/*` to Render with a 200 rewrite).
4. `startFacebookOAuthRedirect` creates a single-use OAuth state row and responds `302` to `https://www.facebook.com/v21.0/dialog/oauth`.
5. The desktop browser follows that `Location` and shows Facebook.
6. Facebook returns to `GET /api/auth/facebook/callback`.
7. The API redirects to `/auth/facebook/complete`.
8. That page refreshes the session and continues to the dashboard.

The same function is what mobile web calls, through `SocialLoginRow` instead of `AuthOAuthButtons`. Viewport width only chooses the shell (`max-width: 767px`). It does not choose a different OAuth transport.

## 3. Normal Mobile Findings

Not physically verified.

If the normal tab is executing the current production bundle, the tap does all of the following in one turn:

1. `runFacebookLogin` runs, unless the button is disabled.
2. `setProviderBusy("facebook")` shows the circle spinner.
3. `form.method = "POST"`, `form.action = "/api/auth/facebook/start"`.
4. Hidden fields include `isLogin`, `returnPath`, `intendedRole`, and `merchantLegalAccepted` when the box is checked.
5. `form.submit()` then `form.remove()`.
6. JavaScript cannot see the HTTP status or `Location`. The code comment says to use the network panel.
7. `pagehide` marks the attempt committed so a later CSP event cannot fail it.

The button does not submit when:

- business signup has not accepted the merchant legal terms (`pointer-events: none`)
- another provider is already `providerBusy`
- there is no Facebook app id

An existing CareTip session does not change the start URL. On the mobile shell it replaces the whole screen with the session card (`MobileWebAuthShell` returns before `SocialLoginRow`). A visible Facebook button means that card is not showing.

Production bundle strings (`index-DtR_onsJ.js`, 719,053 bytes):

| String | Count |
| --- | --- |
| `/api/auth/facebook/start` | 1 |
| `data-caretip-fb-oauth-start` | 1 |
| `FB.login` | 0 |
| `client_start_aborted` / `redirect_navigation_stalled` | 0 |
| `dialog/oauth` | 0 (the dialog URL is built on the server) |

So the live button is the redirect form, not the JS SDK popup.

## 4. Incognito Mobile Findings

Not physically verified.

Incognito loads the same `https://caretip.de/signup` document (cache `max-age=0, must-revalidate`) and the same module URL `/assets/index-DtR_onsJ.js`. The click handler is the same function.

What Incognito does not have at the start of the session:

- a previously controlling service worker (one is registered only after idle, 4.5 s on mobile, 2 s on desktop)
- CareTip localStorage, sessionStorage, and cookies
- a Facebook app login cookie inside that private session
- the normal-profile “open supported links in the Facebook app” handoff

If the private tab shows the Facebook verification page, the `POST` and the `302` succeeded in that browser, and the navigation stayed inside the browser.

## 5. Normal Mobile vs Incognito Comparison

| Area | Normal mobile | Incognito mobile | Difference | Evidence |
| --- | --- | --- | --- | --- |
| Facebook button | Same `OAuthProviderRow` click | Same click | None in code | `SocialLoginRow.tsx`, production bundle |
| OAuth attempt | `submitFacebookOAuthRedirectStart` | Same | None | `facebookOAuthRedirectWeb.ts`, `DM(){return!0}` |
| `/facebook/start` | Same `POST` path | Same `POST` path | Not observed on a device | Form action is the relative path |
| Response | `302` to `www.facebook.com` when the body is valid | Same | Server does not branch on private mode | `buildFacebookAuthorizationUrl` |
| Redirect | `https://www.facebook.com/v21.0/dialog/oauth` | Same URL shape | Host is always `www` | `FB_OAUTH_DIALOG_VERSION = "v21.0"` |
| Browser navigation | Can leave the browser for the Facebook app | Stays in the browser | **This is the split that matches the report** | Facebook `assetlinks.json`; historical Android reports. **Not filmed on this phone** |
| Facebook page | Reported: does not open | Reported: verification page opens | User report | Not reproduced here |
| JS bundle | `index-DtR_onsJ.js` if the tab is current | Same URL on a cold private load | Same file if the normal tab is not stuck on an older worker | Live HTML |
| Service worker | May already control the tab (`skipWaiting` + `clientsClaim`) | No controller until this visit registers one | Real, but **not** the start-request interceptor | Production `sw.js` denylists `/api` |
| Cookies | May send a CareTip refresh cookie on the `POST` | None | Signup start does not read that cookie | `startFacebookOAuthRedirect` |
| Local storage | May hold a session hint | Empty | Hint changes bootstrap UI, not the form target | `authSessionHint.ts` |
| Session state | Session card hides Facebook if a session is already shown | No session card | Would remove the button, not swallow a tap | `MobileWebAuthShell.tsx` |
| Facebook state | App and cookies can exist | No app handoff, no FB cookies | App handoff is the candidate | `assetlinks.json` |
| Page lifecycle | `pagehide` only if the document is actually leaving | Same listener | If the app opens without `pagehide`, the tab looks stuck | Production listener |
| Browser privacy state | Normal profile | Private profile | Private mode is what keeps the Facebook URL in the browser | Inference from the symptom plus app links. Not a packet capture |

## 6. First Point of Divergence

There is **no CareTip branch** where normal mobile and Incognito take different functions.

The first point that can differ, once both are on `index-DtR_onsJ.js`, is **after** a successful `302`:

`POST /api/auth/facebook/start` → `302 https://www.facebook.com/v21.0/dialog/oauth?...` → **browser / OS decides whether that URL stays in the tab or opens the Facebook app.**

Normal profile: the installed app can take `www.facebook.com`. The CareTip tab never shows the verification page. The spinner stays because `providerBusy` was set and the document did not unload.

Incognito: the same URL stays in the tab, so the verification page appears.

Anything earlier (click ignored, `POST` never sent, `400`/`403`/`503`, CSP `form-action`) would fail Incognito as well, unless the two tabs were not running this bundle. That was not shown.

## 7. Android Findings

**Not physically verified.**

Fetched `https://www.facebook.com/.well-known/assetlinks.json` and the same file on `https://m.facebook.com/` (HTTP 200, 8 October 2026). Both list `com.facebook.katana`, `com.facebook.wakizashi`, and `com.facebook.lite`.

Android App Links can open those packages for `https://www.facebook.com/...`, including `/v21.0/dialog/oauth`. Older public reports (Meteor `facebook-oauth`, 2018–2019) describe the same symptom: with the Facebook app installed and “open with the app” allowed, `www.facebook.com/.../dialog/oauth` leaves the browser; a private or in-browser navigation still shows the dialog. Those reports are not a substitute for a CareTip packet trace.

CareTip’s API does not look at the user agent when it builds this URL.

## 8. iOS Findings

**Not physically verified.**

`https://www.facebook.com/.well-known/apple-app-site-association` returned HTTP 200, so Universal Links exist for that host. This investigation did not parse which paths they claim, and it did not confirm that iOS Private Browsing refuses them. The Android app-link explanation must not be copied onto iPhone without a device trace.

## 9. In-App Browser / WebView Findings

The reported bug is a normal tab versus a private tab. That is not the Facebook, Instagram, or WhatsApp in-app browser, and it is not the Expo app.

Separate, known limitation, not the reported split:

- The Facebook in-app browser is a poor host for Facebook Login. Meta expects the system browser. A WebView often cannot complete this dialog even when a private Chrome tab can.
- CareTip’s native app uses its own Facebook SDK policy (`mobile/utils/facebookAuthPolicy.ts`) and does not use this web form. That path was not part of this bug.

Do not change the working browser flow to accommodate an embedded WebView unless a trace shows the failure is actually inside one.

## 10. Facebook / Meta Findings

Manual OAuth is the redirect dialog:

`https://www.facebook.com/v21.0/dialog/oauth?client_id&redirect_uri&state&scope=email,public_profile&response_type=code`

CareTip builds exactly that, on `www` only. Scope and redirect URI were not changed and were not the difference between a normal tab and a private tab: both would receive the same query if both `POST`s succeed.

`m.facebook.com` is also an Android App Link for `com.facebook.katana` today. A mobile-only host swap is not a proven workaround.

No Meta app setting was read or edited.

## 11. CSP Findings

Live response header on `https://caretip.de/signup` (8 October 2026):

`form-action 'self' https://www.facebook.com https://m.facebook.com https://web.facebook.com https://facebook.com`

That allows the same-origin `POST` and a follow-up navigation to those Facebook hosts. CSP is a document policy. It does not change between a normal tab and Incognito. A `form-action` block would fire `securitypolicyviolation` in both, and the client would assign `/auth/facebook/complete?error=start_failed`. Incognito showing the real Facebook page means CSP allowed that navigation.

CSP is ruled out as the normal-versus-Incognito cause. It was not weakened.

## 12. Service Worker / PWA Findings

Production `sw.js` (26,400 bytes, `Cache-Control: max-age=0, must-revalidate`):

- `skipWaiting()` and `clientsClaim()`
- precache plus `NavigationRoute` → `index.html`
- denylist: `/^\/api(\/|$)/`, `/uploads`, `/socket.io`
- the matcher checks `request.mode === "navigate"` and does **not** check `GET`

A form `POST` is a navigation, so the route could see it. The `/api` denylist then rejects it. The current worker does not answer `POST /api/auth/facebook/start` with `index.html`.

Image runtime caching is `GET` only.

Incognito starts with no controller. A normal tab can already be controlled. That difference is real and can serve an **older** precached shell until the new worker activates. It does not, by itself, explain two tabs that both run `index-DtR_onsJ.js`.

The previous performance audit’s cold loads had `navigator.serviceWorker.controller === false`. That matches a first visit, not a long-lived normal profile.

Service worker is **not** the root cause for a tab on the current bundle. It remains a possible cause only if the normal tab is still on an older worker whose navigation route did not denylist `/api`. That older worker was not recovered from the phone.

## 13. Loading / Timeout Findings

On tap, the UI sets `providerBusy` to `"facebook"` **before** `form.submit()`. The circle spinner means the click handler ran. It does not mean Facebook was contacted, and it does not mean navigation failed.

Production `index-DtR_onsJ.js` has no `client_start_aborted` stall. The spinner can sit there until the document unloads. If the Facebook app takes the URL and the CareTip document stays, the spinner stays. That is symptom **A/C**: navigation did not replace this document, and the spinner hides that fact. The spinner does not cancel `form.submit()`.

The local working tree (not production) adds a 20-second timer in `submitFacebookOAuthRedirectStart`. `shouldFailFacebookStartForStall` is true only when `navigationLeft` is false. `navigationLeft` is set from `pagehide`. On fire it navigates to `/auth/facebook/complete?error=start_failed`. It does not delete or reuse OAuth state.

Risk for that uncommitted timer, not a production finding: if Android opens the Facebook app **without** `pagehide`, the timer can still see “still on `/signup`” and send the tab to the error page while Facebook has the attempt. The timer must not run unless the document is still the original signup page and no navigation has started. It must not call the API, must not create a new state, and must not touch a callback already in flight.

Fixing the spinner will not make Facebook open.

## 14. OAuth State Findings

State is created only inside a successful `startFacebookOAuthRedirect`, then stored once and consumed once on callback. Replay maps to `already_processed`. Nothing in the mobile click path marks a state reusable.

A normal-tab failure **before** the `POST` creates no state. A `POST` that returns `302` creates one state even if the phone then opens the Facebook app and the user never finishes. That row expires on its own. Do not reuse it.

`form.submit()` is one submit per click. A second click is ignored while `providerBusy` is set. That is not a double callback.

## 15. Evidence Table

| Finding | Evidence | Confidence | Impact |
| --- | --- | --- | --- |
| Production uses one redirect `POST`, not `FB.login` | `index-DtR_onsJ.js`: `FB.login` count 0, form marker present, `DM()` returns true | High for the live bundle | Desktop and mobile share this path |
| Successful start always targets `www.facebook.com/v21.0/dialog/oauth` | `buildFacebookAuthorizationUrl` | High | No Incognito branch on the server |
| CSP allows that navigation | Live `form-action` on `/signup` | High | CSP does not explain the split |
| Current SW does not serve `/api` navigations as the SPA shell | Production `sw.js` denylist | High for this worker | Current SW is not the interceptor |
| Facebook Android app is an App Link for `www` and `m` | `assetlinks.json` fetched this session, includes `com.facebook.katana` | High that the claim exists | Normal Android can leave the browser |
| Incognito shows the dialog because it does not hand off to the app | User report plus the App Link claim. No HAR from the phone | **Probable** | Matches the clue. Not proven here |
| Spinner causes the failed navigation | `setProviderBusy` is local UI; `submit()` is not gated on it | High that it is not the cause | Do not “fix” OAuth by hiding the spinner |
| Physical normal-tab `POST` status and `Location` | Not captured | Unknown | Blocks a hard root-cause label |

## 16. Root Cause Classification

**Probable, not proven:** after the same `302`, a normal mobile browser hands `https://www.facebook.com/v21.0/dialog/oauth` to the installed Facebook app. Incognito keeps that navigation in the browser, so the verification page shows only there.

This is not established as an application bug in the click handler. CareTip does not check private mode. It is not established as a service-worker bug in the worker that is live today. It is consistent with Facebook/Android (and possibly iOS Universal Links) behavior.

## 17. What Has Been Ruled Out

- A second, Incognito-only OAuth implementation in the frontend or API
- Production still using the JS SDK popup on mobile (`FB.login` is absent from the live entry)
- CSP `form-action` differing by tab type
- The current service worker returning `index.html` for `POST /api/auth/facebook/start`
- Signup start reading the refresh cookie and choosing a different Facebook URL
- The visible session card swallowing the tap (that card removes the button)
- The production spinner aborting the navigation (production has no stall timer)
- Making OAuth state reusable (not done, and it would not decide whether the browser leaves the tab)
- Desktop regression (desktop was not modified)

Not ruled out, because there was no phone trace:

- the normal tab still running an older service worker and an older bundle
- the `POST` failing on that phone for a reason Incognito did not hit (legal checkbox, origin, rate limit)
- iOS-specific Universal Link behavior

## 18. Recommended Fixes

### Required fix

None. Do not ship a change from this report.

### Mobile-only fix

Do not implement yet. The next evidence, on the failing phone only, is a single network log of the Facebook tap:

1. Does `POST /api/auth/facebook/start` leave the device?
2. What status comes back?
3. Is `Location` `https://www.facebook.com/v21.0/dialog/oauth`?
4. Does the tab stay on `/signup` while the Facebook app opens or nothing opens?

If that log shows `302` and the tab stays, the failure is outside CareTip’s OAuth state machine. A later mobile-only experiment must not change the desktop `www.facebook.com` URL. Pointing mobile at `m.facebook.com` is **not** recommended on current evidence: that host’s `assetlinks.json` also includes `com.facebook.katana`.

### Optional hardening

On a real device, log only `pagehide` versus “still on `/signup` after the `302`.” Do not log cookies, state ids, or `Location` query strings.

### Not recommended

- Popup / `FB.login` fallback
- Reusable or deleted OAuth state
- A timeout that navigates away while a Facebook navigation is in flight
- CSP wildcards
- Service-worker changes aimed at this bug
- Any edit to the desktop button, desktop redirect, or desktop callback

### No change required

Desktop sequence in section 2. Callback replay protection. `form-action` host list. Current SW `/api` denylist.

## 19. Testing Limitations

- No physical Android phone, iPhone, or installed PWA was used.
- Desktop Chrome was not used as a stand-in for the failing tap.
- No Incognito session was driven.
- No production `POST /api/auth/facebook/start` was sent, so no OAuth state row was created and no Facebook screen was opened from this machine.
- Firefox and Safari were not available.
- The user report is the only observation of “normal fails, private works.”

## 20. Final Answers

1. **Why does Incognito open Facebook while normal mobile does not?** The app uses one redirect. The likely split is that a normal mobile profile opens `www.facebook.com` in the Facebook app, and a private tab keeps the same URL in the browser. That was not recorded on the device.

2. **What changes between them?** Stored CareTip and Facebook state, a possibly already-controlling service worker, and whether the OS may hand `facebook.com` to the installed app. The JavaScript function does not change.

3. **Does normal mobile send `/api/auth/facebook/start`?** Unknown on the failing phone. The current bundle’s click handler does send it, unless the button is disabled.

4. **Does normal mobile receive the Facebook redirect?** Unknown on the phone. The API returns that `302` for a valid body, with no private-mode branch.

5. **Does normal mobile attempt to navigate to Facebook?** The code attempts a full-page form navigation. Whether the phone follows it was not observed.

6. **Where does normal mobile stop?** Not inside a special mobile function. The first supported divergence is the browser/OS handling of `https://www.facebook.com/v21.0/dialog/oauth` after the `302`.

7. **Does Facebook behave differently on mobile?** The dialog URL is the same. Android can open the Facebook app for that host. That is Facebook/OS behavior, not a different CareTip request.

8. **Is it specific to normal browser state?** The symptom is. The implementation is not.

9. **Is it cache or the service worker?** Not the current worker: `/api` navigations are denylisted. An older controlling worker was not proven.

10. **Is it cookies or session state?** A visible Facebook button means the mobile session card is not up. The start handler does not change the Facebook URL because a refresh cookie is present.

11. **Is it an embedded WebView?** Not the reported case. In-app browsers are a separate limitation.

12. **Is CareTip preventing the redirect?** No Incognito check, no `preventDefault` on this button, no production timer that aborts the form. `form.remove()` runs immediately after `submit()` in production; that is the same in both tabs and does not explain the split by itself.

13. **Is the spinner the cause or a symptom?** A symptom. It is set before `submit()` and stays if the document never unloads.

14. **Will the timeout fix navigation?** No. The production bundle has no such timeout. The local 20-second recovery only changes the signup tab when `pagehide` has not fired. It must not cancel a navigation that has started, and it does not create or consume OAuth state.

15. **Is an OAuth architecture change necessary?** No.

16. **Smallest evidence-backed mobile-only fix?** None until one phone log shows the `POST` status and whether `Location` is followed. Do not change desktop’s Facebook URL in the meantime.

17. **What must stay untouched?** Desktop navigation, the desktop Facebook button, desktop CSP, the redirect/callback/state design, single-use state, cookies, the service worker, and Meta’s redirect URI list.
