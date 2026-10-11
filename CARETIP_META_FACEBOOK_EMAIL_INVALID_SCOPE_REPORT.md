# CareTip — Meta `email` Permission / “Invalid Scopes: email” Investigation

**Date:** 2026-10-05  
**Scope:** Meta configuration analysis only — **no CareTip code changes.**

---

## CareTip scope (code verification)

| Surface | Requested scope | Source |
|---------|-----------------|--------|
| **Web** | `email,public_profile` (comma-separated string) | `src/app/lib/facebookOAuthWeb.ts` → `FB.login(..., { scope: "email,public_profile", return_scopes: true })` |
| **Mobile** | `public_profile`, `email` (array) | `mobile/services/facebook/facebookSignIn.ts` → `logInWithPermissions(["public_profile", "email"], ...)` |

**Conclusion (D):** CareTip is **not** sending a wrong or unsupported scope name. The strings match Meta’s documented permission IDs `email` and `public_profile`. **Do not remove `email` from CareTip** for this error — the failure is on the **Meta app configuration** side.

---

## What Meta’s “Invalid Scopes: email” means

Meta shows this in the login dialog when the **application ID** used in `FB.init` / OAuth **has not been configured to request `email`** for the active Facebook Login product/use case.

Important Meta behavior (documented in developer forums and permission guides):

- **`public_profile`** is often **“Ready for testing”** / granted by default for Facebook Login.
- **`email` is not granted automatically** on new apps; until it is **added to the Facebook Login use case**, any `scope` that includes `email` produces **“Invalid Scopes: email”** (developer-visible; end users may see a failed login).
- This is **not** a malformed scope string from CareTip; it is Meta rejecting a permission the app is **not allowed to ask for yet**.

Your reproduced flow (SDK loads → dialog opens → credentials accepted → **Invalid Scopes: email**) is consistent with: **Facebook Login works; `email` is not enabled for this app.**

---

## Why “Permissions and features → email → Add” shows “Sorry, something went wrong”

This is a **separate** Meta Developer Console issue from CareTip code.

Reported widely on [Meta Developer Community](https://developers.facebook.com/community/threads/533540185516580/) and Stack Overflow: developers click **Add** on `email` under a generic permissions list and get a generic **“Sorry, something went wrong”** — including when that is the **correct** permission they need.

Typical explanations:

1. **Wrong console surface** — `email` for consumer login must be attached via **Use cases → Authentication and account creation → Customize (Facebook Login) → Permissions**, not only the top-level **Permissions and features** catalog.
2. **Meta dashboard / account backend error** — same thread: Add fails even on the use-case path; login may still work only after Meta fixes the app record or after using an alternate path (see below).
3. **Wrong login product on the app** — apps set up with **“Facebook Login for Business”** (or other business-only use cases) do **not** support the same consumer `email` + JS SDK flow; developers report **Invalid Scopes** until they use standard **“Facebook Login”** under **Authentication and account creation** ([Stack Overflow discussion](https://stackoverflow.com/questions/75890476/invalid-scopes-email-openid-public-profile)).

CareTip uses **consumer Facebook Login + JS SDK + `email`/`public_profile`** — the app must be on the **standard Facebook Login** use case, not a business-only variant.

---

## Configuration checklist (what to verify in Meta)

### App type & use cases

| Item | What to verify |
|------|----------------|
| **App type** | Consumer / standard app suitable for “log in with Facebook” on your website — not a Gaming-only or Business-only template unless that template explicitly supports `email` for Login. |
| **Use case** | **Authentication and account creation** is present. |
| **Login product** | **Facebook Login** (JavaScript SDK) — **not** “Facebook Login for Business” alone if you need consumer `email` on the web SDK. |
| **Customize** | Open **Use cases → Authentication and account creation → Customize** (or “Customize the Authenticate and request data…” link), then **Permissions** tab — `email` should appear with **Add** or already **Added**. |
| **Permissions and features (global)** | `public_profile` “Ready for testing” matches your observation; `email` **absent or not addable** here while Add errors → use use-case Customize; if Add fails everywhere → Meta-side issue (§ C). |

### App mode & roles

| Item | What to verify |
|------|----------------|
| **App mode** | **Development** — only users with a **role** on the app (Administrator, Developer, Tester) can complete login while permissions are unreviewed. |
| **Test account** | The Facebook account used in the dialog is listed under **App roles → Roles** (e.g. **Tester**) or is the app admin. |
| **Live mode** | After Development works: **App Review** may be required for `email` for **non-role** users in Live mode (separate from “Invalid Scopes” during dev, which usually means permission not added at all). |

### Business verification

| Item | Relevance |
|------|-----------|
| **Business verification** | Required for some **advanced** permissions and **Live** access at scale; **not** usually the first blocker for adding `email` to a Development app for testers. |
| **Privacy Policy URL** | Often required before **Live** / review; less commonly the cause of **Invalid Scopes** in Development when `email` was never added to the use case. |

### Web settings (already working for you)

- **Login with JavaScript SDK** enabled ✓ (per your evidence)
- **Client OAuth Login / Web OAuth Login**
- **Allowed domains for JavaScript SDK** / App Domains (CareTip origins)
- **No** CareTip `/auth/facebook/callback` — not required for `FB.login`

### Redirect URI

CareTip does not use a server redirect. If Meta’s UI requires redirect URIs for JS SDK, use real SPA origins only (`https://caretip.de/`, `http://localhost:5173/`) — not a fabricated callback path.

---

## Is `email` “available” for this app?

| Question | Answer |
|----------|--------|
| Is `email` a valid Facebook Login permission? | **Yes**, for standard consumer Facebook Login. |
| Should CareTip stop requesting it? | **No** — signup requires email on the CareTip backend. |
| Is it exposed in Permissions and features? | Often **yes**, but **enabling** it for Login is via the **use case Customize** flow. |
| Can Add fail while `email` is still required? | **Yes** — dashboard error does not mean CareTip should drop `email`; it means Meta has not persisted `email` on the app. |
| How to confirm `email` is enabled? | In use-case **Permissions**, `email` shows as added; repeat login — **“Invalid Scopes: email”** should disappear for developers. |

---

## Primary conclusion

### **B. Meta dashboard / app configuration is blocking `email` — missing requirement**

**Why “Invalid Scopes: email”:** The Meta app tied to your `VITE_FACEBOOK_APP_ID` **does not currently authorize the `email` permission** for Facebook Login, while CareTip correctly requests `email,public_profile`. Meta allows `public_profile` (ready for testing) but rejects `email` until it is successfully attached to the **Facebook Login** use case under **Authentication and account creation**.

**Why “Sorry something went wrong” on Add:** The global **Permissions and features → Add** action is **often broken or the wrong place**; your symptom matches **Meta console / app-record issues**, not incorrect CareTip scope syntax. The functional requirement remains: **`email` must be added via the Authentication use case Customize flow** (or Meta support must fix the app if every Add path fails).

**Not D:** CareTip sends exactly `email` and `public_profile` as documented.

---

## Recommended dashboard steps (configuration fix — conclusion A as remediation path)

Perform in order; stop when `email` shows as added and login no longer shows Invalid Scopes:

1. **developers.facebook.com → Your CareTip app → App ID** matches CareTip `VITE_FACEBOOK_APP_ID` / `FACEBOOK_APP_ID`.
2. **Use cases** — confirm **Authentication and account creation** is added.
3. **Customize** that use case (not only the left-nav “Permissions and features” list).
4. Under **Permissions** (within Customize), add **`email`** if not listed. If **Add** errors here too, go to step 8.
5. Confirm login product is **Facebook Login** (JavaScript SDK), not **Facebook Login for Business** only. If the app was created with Business Login, add or switch to standard **Facebook Login** for consumer web login with `email`.
6. **Settings → Basic** — App Domains, Site URL, Privacy Policy URL (as required for your mode).
7. **Facebook Login → Settings** — Web OAuth / JS SDK domains (CareTip origins).
8. **Roles** — add your Facebook user as **Tester**; stay in **Development** for testing.
9. Retry login — scope dialog should list **email** and **public_profile** without Invalid Scopes.

If step 4 **and** global Permissions **Add** both fail with “Something went wrong”:

### **C. Meta-side dashboard / app-record problem — next step**

- Try another browser / incognito, different Meta admin account with **Administrator** on the app.
- **Meta Developer Support / bug report** with App ID, screenshot, and timestamp (forums reference prolonged “Sorry something went wrong” on Add).
- Optional: create a **new Meta app** with **Authentication and account creation** only, add **email** in Customize **before** first `FB.login` test, point CareTip env to the new App ID (configuration change only — out of scope for this code-free pass).

---

## After `email` is enabled

- Dialog should complete; CareTip receives an access token → existing `POST /api/auth/oauth` → `facebookVerifier` (`/me?fields=id,name,email`) — unchanged.
- Some Facebook users have **no email on file**; signup may still fail at CareTip with email-required — that is account data, not Invalid Scopes.

---

## Final classification (single letter)

**B** — Meta app configuration is blocking `email` (permission not successfully attached to Facebook Login), with **C** as the likely explanation for the broken **Add** button on Permissions and features.

**No CareTip code changes in this pass.**
