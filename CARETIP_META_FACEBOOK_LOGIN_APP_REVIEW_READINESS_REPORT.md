# CARETIP META FACEBOOK LOGIN APP REVIEW READINESS REPORT

**Date:** 2026-10-05  
**Scope:** Read-only architecture audit + minimal code hardening (Facebook SDK loader). No changes to Google/Apple/email auth, guest Tip Feedback, or legal document text.

---

## Executive Summary

**Verdict: READY AFTER CONFIGURATION** (with one small code fix applied for SDK readiness polling).

CareTip uses the **Facebook JavaScript SDK** on web (not a server-side OAuth redirect). Requested permissions are exactly **`email`** and **`public_profile`**. The backend verifies tokens via Graph `debug_token` + `/me?fields=id,name,email` (or Limited Login JWT on mobile iOS), then maps identities through **`OAuthAccount`** using **`provider` + `subject` (Facebook user ID)** — not email alone. Account isolation for login is **strong**: no silent email-based linking on sign-in; signup rejects duplicate emails with a generic failure.

**Primary blockers before Meta submission** are **Meta Developer Console** configuration (`email` on the Authentication use case, app roles/test users, Live mode review) and **deployment env** (`VITE_FACEBOOK_APP_ID` on the SPA build, `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` on the API). Production **CSP** in `public/_headers` already allows Facebook SDK hosts (remediation from prior forensic pass).

---

## Current Facebook OAuth Architecture

```
Facebook (JS SDK dialog / native SDK)
        ↓
CareTip frontend
  OAuthProviderRow / AuthPage.runSocialOAuth
  facebookOAuthWeb.ts → FB.login(scope: email,public_profile) → access token
        ↓
POST /api/auth/oauth { provider: "facebook", idToken, isLogin, ... }
        ↓
auth.controller.oauth → oauthAuth.service.authenticateWithOAuth
        ↓
verifyOAuthIdentity → facebookVerifier.ts
  • JWT path (mobile Limited Login)
  • OR debug_token + GET graph.facebook.com/me?fields=id,name,email
        ↓
OAuthAccount lookup by (provider=facebook, subject=Facebook id)
        ↓
User load / create (signup) + refresh session
        ↓
Authenticated dashboard (/dashboard/... or employee routes)
```

**There is no** CareTip backend route such as `/api/auth/facebook/callback`. Meta “Valid OAuth Redirect URIs” are **not** used for the web JS SDK flow; configure **App Domains** and **Allowed Domains for the JavaScript SDK** instead.

| Layer | Key files |
|--------|-----------|
| UI button | `src/app/components/auth/OAuthProviderRow.tsx`, `AuthPage.tsx`, `AuthOAuthButtons.tsx`, mobile `FacebookAuthButton.tsx` |
| Web SDK | `src/app/lib/facebookOAuthWeb.ts` |
| Mobile | `mobile/services/facebook/facebookSignIn.ts` |
| API | `backend/src/controllers/auth.controller.ts` → `oauth` |
| Verify | `backend/src/services/oauth/facebookVerifier.ts` |
| Account logic | `backend/src/services/oauthAuth.service.ts` |
| Schema | `backend/prisma/schema.prisma` → `OAuthAccount` |
| Settings link/unlink | `LinkedOAuthAccountsSection.tsx` → `/api/auth/oauth/link`, `/unlink` |
| CSP | `scripts/spa-csp-policy.mjs`, `public/_headers` |

**State parameter:** Not used on web (token returned in JS callback). Standard for FB JS SDK; CSRF risk is mitigated by server-side token verification bound to your App ID/secret.

**Logout:** Facebook SDK session is not explicitly revoked on CareTip logout; CareTip clears its own refresh/access session only (same pattern as other social providers).

---

## Permissions Requested

| Permission | Why requested | Where requested | Where used | Necessary? | Review risk |
|------------|---------------|-----------------|------------|------------|-------------|
| **`email`** | Unique CareTip account identifier, login contact, welcome/compliance emails | Web: `facebookOAuthWeb.ts` `FB.login` scope string; Mobile: `logInWithPermissions(["public_profile","email"])` | Stored on `User.email` at signup; `OAuthAccount.emailAtLink`; shown in Settings → Security → Linked accounts (`emailAtLink`); required for new Facebook signup if no prior link | **Yes** | **HIGH** if not added in Meta **Use cases → Authentication and account creation** (Invalid Scopes / dialog failure). Requires App Review for non-role users in Live mode. |
| **`public_profile`** | Default login permission; provides Facebook user id context via token/`/me` | Same as above | Facebook **user id** → `OAuthAccount.subject`; **name** → signup default / `OAuthAccount.displayName` / optional `User` naming paths; **not** profile picture (always `avatarUrl: null`) | **Yes** (id + name via Graph) | **LOW** if `email` is configured; do not add extra permissions. |

**Not requested (correct):** `user_friends`, `pages_*`, `instagram_*`, `openid` (explicitly), ads, etc.

---

## Facebook Data Mapping

| Facebook data | CareTip field | Stored? | Purpose | UI usage |
|---------------|---------------|---------|---------|----------|
| **User id** (`id` / JWT `sub`) | `OAuthAccount.subject` | Yes | Stable provider identity | Not shown directly; drives login resolution |
| **email** | `User.email` (signup), `OAuthAccount.emailAtLink` | Yes | Account identity & comms | Settings → **Security** → Linked accounts (“linked as {email}”); login email throughout app |
| **name** | `OAuthAccount.displayName`; signup may set business/employee display via `verified.displayName` or form `name` | Partial (`displayName` on OAuth row; business/employee names from signup flow) | Default display label on registration | Business name default on manager OAuth signup (`{displayName}'s venue` if no business name); employee name if invite signup |
| **first_name / last_name** | — | **No** | Not requested separately | — |
| **Profile picture** | — | **No** (`avatarUrl: null` in verifier) | Not used | CareTip does **not** import Facebook avatars |

**Retention / deletion:** On user anonymization, `oAuthAccount.deleteMany({ userId })` runs (`anonymization.service.ts`). Privacy policy content is served from `/privacy` (API-backed); **explicit “Facebook/Meta” OAuth wording was not verified in stored legal HTML** — flag for legal/product review (see below).

**Third parties:** Facebook data is used only for auth/account management on CareTip; verification calls go to `graph.facebook.com` from the API.

---

## Account Isolation Assessment

**Model:** `OAuthAccount` with `@@unique([provider, subject])` and `@@unique([userId, provider])`.

| Case | Expected behavior | Verified in code |
|------|-------------------|------------------|
| **A** New Facebook identity | Signup creates `User` + `OAuthAccount` with `subject` = Facebook id | `authenticateWithOAuth` signup branch |
| **B** Same Facebook identity again | `findUserByOAuthSubject` → same user | Login branch when `isLogin: true` |
| **C** Same email, different CareTip user, no OAuth link | Login: **generic failure** (no auto-link). Signup: **generic failure** if email exists | Lines 250–257, 313–318 `oauthAuth.service.ts` |
| **D** Inactive user | `OAuthSignInFailedError` | `isActive !== true` |
| **E** Facebook id already linked to another user | Link API: `AUTH_OAUTH_LINK_FAILED_MESSAGE`; signup: `subjectTaken` check | `linkOAuthProviderForUser`, signup |
| **F** Demo accounts | `isWalkthroughDemoAccount` blocks link; OAuth login still subject-based | `oauth-demo-isolation-runtime.ts`, service guards |

**Email is not the authoritative OAuth key** for login — only `(facebook, subject)`.

**Authenticated linking:** User must be logged in; cannot steal another user’s Facebook id (`existingSubject.userId !== userId` → link failed).

**Gaps:** No dedicated automated test simulating “Facebook login with token for email that exists on password account” end-to-end with mocked Graph (behavior is clear from service code). Recommended manual QA before review.

---

## Email Matching (Login vs Signup)

```
Facebook returns verified identity (subject + optional email)
        ↓
isLogin === true?
  YES → findUserByOAuthSubject(facebook, subject)
        found → session (if active, not SUPER_ADMIN, email verified rules)
        not found → OAuthSignInFailedError (same message whether email exists elsewhere)
  NO  → require email (Facebook → OAuthEmailRequiredError if missing)
        email normalized → User.findUnique(email)
        exists → OAuthSignInFailedError
        else → create User + OAuthAccount(subject)
```

**No silent “email match → link account” on login.** Users with an existing password account must sign in and use **Settings → Security → Linked accounts** to link Facebook.

---

## Production Configuration

### Web (actual implementation)

| Setting | Value / pattern |
|---------|-----------------|
| Production site | `https://caretip.de` / `https://www.caretip.de` (CSP in `public/_headers`) |
| Login UI | `https://caretip.de/login`, `https://caretip.de/signup` |
| API | Same-origin `/api/*` (CSP allows `https://caretip.de`, `https://*.caretip.de`, Render hosts) |
| OAuth callback URL | **N/A** for JS SDK web flow |
| Local dev | `http://localhost:*` — add to Meta **JavaScript SDK allowed domains** for local testing |

### Meta Developer Dashboard (configure manually)

1. **Use case:** Authentication and account creation → **Facebook Login** (consumer JS SDK, not Business-only login if you need `email` on web).
2. **Permissions:** Add **`email`** under use-case **Customize → Permissions** (see `CARETIP_META_FACEBOOK_EMAIL_INVALID_SCOPE_REPORT.md` if “Invalid Scopes: email”).
3. **Facebook Login → Settings:** Client OAuth login / Web OAuth login enabled; **Login with JavaScript SDK** enabled.
4. **App Domains:** `caretip.de`, `www.caretip.de` (and `localhost` for dev).
5. **Allowed Domains for JavaScript SDK:** production hostnames above.
6. **Privacy Policy URL:** `https://caretip.de/privacy` (public, no auth).
7. **Development mode:** Add Meta reviewers as **Testers** or use Facebook test users until Live + App Review approved.
8. **App Review:** Submit **`email`** (and **`public_profile`** if prompted) with screencast and instructions below.

---

## Environment Variables

| Variable | Used by | Production required? | Public? | Notes |
|----------|---------|----------------------|---------|-------|
| `VITE_FACEBOOK_APP_ID` | Web SPA (`oauthProviderIds.ts`) | **Yes** (build-time) | **Yes** (App ID only) | Without it, Facebook button is **hidden** |
| `FACEBOOK_APP_ID` / `META_APP_ID` | API verifier | **Yes** | No | May fall back to `VITE_*` in verifier only — prefer explicit API env |
| `FACEBOOK_APP_SECRET` / `META_APP_SECRET` | `debug_token` on API | **Yes** for web access tokens | **Never** | Not in mobile `EXPO_PUBLIC_*` |
| `EXPO_PUBLIC_FACEBOOK_APP_ID` | Mobile | If shipping mobile FB login | Yes | Same numeric App ID |
| `EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN` | Mobile SDK init | Mobile builds | Yes (client token) | Meta-issued public token |

**Consistency:** Web App ID in `VITE_FACEBOOK_APP_ID` must match Meta app used in `FB.init` and backend `FACEBOOK_APP_ID`.

---

## Privacy / Legal Assessment

| Item | Status |
|------|--------|
| Public privacy policy | **Yes** — `/privacy` via `PrivacyPage` → `ApiLegalDocumentPage` |
| Reviewer can open without login | **Yes** (`publicRoutes.ts`) |
| Merchant signup legal checkbox | **Yes** — business lane blocks OAuth signup until accepted (`AuthPage`, API `MERCHANT_LEGAL_ACCEPTANCE_REQUIRED`) |
| OAuth-specific disclosure naming Facebook/Meta | **Not verified in code** — content lives in legal CMS/API; **legal/product review recommended** to confirm OAuth categories, processors, and retention align with actual Facebook fields (`id`, `email`, `name`) |
| German-only legal docs | Acceptable if target market is DE; note for Meta reviewers who prefer English — consider EN privacy availability if offered elsewhere on site |

---

## Test Credentials (template — do not commit real secrets)

### Recommended Meta Reviewer Test Credentials

| Field | Value |
|-------|--------|
| **CareTip account name** | CareTip Meta Review Account |
| **CareTip email** | `meta-review@caretip.de` (or dedicated mailbox you control) |
| **CareTip password** | `[GENERATE_SECURE_PASSWORD]` — store in Meta submission notes only |
| **CareTip role** | **MANAGER** (business signup via Facebook demonstrates full flow) |
| **Facebook test user** | Create under Meta **App roles → Test users** OR use reviewer’s Facebook account added as **Tester** while app is in Development |

**Do not** use `employee@caretip.de` / `demo@caretip.de` walkthrough accounts for OAuth linking tests (linking is forbidden).

---

## Reviewer Instructions (copy for Meta App Review)

1. Open: **https://caretip.de/signup** (or **https://caretip.de/login** for returning test user).
2. Choose the **business** signup path if creating a new merchant account.
3. Check the box confirming acceptance of Terms, Privacy Policy, DPA, and PLV (required for business signup).
4. Click **Continue with Facebook** (Facebook icon in the social login row).
5. Sign in with the **Facebook test account** provided in the submission notes.
6. On the Facebook dialog, approve **email** and **public profile** permissions.
7. After redirect back to CareTip, confirm you land in the **business dashboard** (authenticated).
8. Open **Settings** → **Security** section: **https://caretip.de/dashboard/settings?section=security**
9. Under **Linked accounts**, confirm **Facebook** shows as linked and displays the **email** returned by Facebook (`emailAtLink`).
10. Optional: sign out, open **https://caretip.de/login**, use **Continue with Facebook** again — you should return to the **same** CareTip account.

---

## Permission Demonstration

### PERMISSION: `email`

- **Requested at:** Facebook authorization dialog (web: `FB.login` with `email` in scope).
- **Returned to:** CareTip via access token → API Graph `/me?fields=...,email`.
- **Stored in:** `User.email` (signup), `OAuthAccount.emailAtLink`.
- **Used for:** Account identity, notifications, login identifier.
- **Visible at:** Dashboard account settings → Security → Linked accounts (linked email line).
- **Reason:** CareTip accounts are keyed by email; required to create a new merchant account via Facebook.

### PERMISSION: `public_profile`

- **Requested at:** Same Facebook dialog (bundled with login).
- **Returned to:** Facebook user id and name via token validation / `/me`.
- **Stored in:** `OAuthAccount.subject` (id), `OAuthAccount.displayName` (name).
- **Used for:** Stable login identity (`subject`); default naming on signup when user does not type a separate name.
- **Visible at:** Indirectly — correct account after login; business name may default from Facebook name on first signup.
- **Reason:** Minimum permission set for Facebook Login identity; profile picture is **not** imported.

---

## Review Video Script (~2 minutes)

| Shot | Action |
|------|--------|
| 1 | Browser on **https://caretip.de** — show URL bar. |
| 2 | Navigate to **Sign up** → business path. |
| 3 | Show legal acceptance checkbox being checked. |
| 4 | Click **Continue with Facebook**. |
| 5 | **Facebook permission screen** — pause so **`email`** and **public profile** are visible. |
| 6 | Approve; return to CareTip loading then **dashboard**. |
| 7 | Open **Settings → Security**; show **Facebook** linked with email. |
| 8 | Sign out; **Login** → **Continue with Facebook** → same dashboard (persistence). |
| 9 | End — no admin panels, no customer tip flows, no secrets on screen. |

---

## Meta Dashboard Actions Required

- [ ] Add **`email`** to Facebook Login under **Authentication and account creation** use case.
- [ ] Confirm app is **standard Facebook Login**, not Business-only misconfiguration.
- [ ] Set **Privacy Policy URL** to `https://caretip.de/privacy`.
- [ ] Add **App Domains** and **JavaScript SDK allowed domains** for production (and localhost for internal QA).
- [ ] Ensure **FACEBOOK_APP_SECRET** only on API host (e.g. Render).
- [ ] Ensure production frontend build has **`VITE_FACEBOOK_APP_ID`** set.
- [ ] Add reviewer Facebook accounts as **Testers** (Development) or complete **App Review** before public Live login.
- [ ] Submit **`email`** permission with video + instructions above.

---

## Meta App Review Risks

| Severity | Finding |
|----------|---------|
| **CRITICAL** | Meta app missing **`email`** on use case → **Invalid Scopes** / failed login (`CARETIP_META_FACEBOOK_EMAIL_INVALID_SCOPE_REPORT.md`). |
| **CRITICAL** | Production SPA built without **`VITE_FACEBOOK_APP_ID`** → Facebook button hidden; reviewer cannot test. |
| **CRITICAL** | API missing **`FACEBOOK_APP_SECRET`** → access token verification fails after dialog succeeds. |
| **HIGH** | App in **Development** without reviewer added as Tester → Facebook login denied for reviewer. |
| **HIGH** | Privacy policy does not describe social login / Meta processing — **legal review** (not a code fix). |
| **MEDIUM** | Reviewer tries **signup** without legal checkbox → blocked by design (instruct to check box). |
| **MEDIUM** | Reviewer has existing CareTip account with same email but no link → signup/login fails generically (instruct to use fresh email or link while logged in). |
| **LOW** | Facebook profile photos not used — do not claim picture usage in review text. |
| **LOW** | No server OAuth `state` on JS SDK — industry-normal; optional note if Meta asks. |

**Resolved / mitigated in repo:** Production CSP includes Facebook SDK endpoints (`public/_headers`). SDK loader no longer hangs indefinitely when `sdk.js` is present but `FB` is late (`facebookOAuthWeb.ts` poll).

---

## Implementation Classification

| ID | Finding | Class |
|----|---------|-------|
| A1 | OAuth architecture sound | **A — No change required** |
| A2 | Account isolation by `subject` | **A — No change required** |
| A3 | Scopes minimal (`email`, `public_profile`) | **A — No change required** |
| B1 | Meta `email` use case + env vars | **B + D — Configuration / Meta Dashboard** |
| B2 | `VITE_FACEBOOK_APP_ID` on Netlify/build | **B — Configuration** |
| C1 | SDK loader hang | **C — Code fix applied** |
| E1 | Privacy OAuth disclosure | **E — Legal/product review** |

---

## Code Changes Made

1. **`src/app/lib/facebookOAuthWeb.ts`** — When `sdk.js` is already in the document but `window.FB` is not ready, poll up to ~15s then resolve or reject (prevents stuck Facebook button spinner).

No other auth/OAuth files modified in this pass.

---

## Tests Run

```text
cd backend
npm run test:oauth-expansion    → All 20 checks passed
npm run test:oauth-demo-isolation → All 15 checks passed
npm run test:auth-enumeration   → OVERALL: PASS
```

Facebook-specific coverage in `test:oauth-expansion`: existing Facebook login reuse, `OAUTH_EMAIL_REQUIRED` when email missing.

---

## Remaining Blockers

1. Meta Developer Console: **`email`** permission on Authentication use case + reviewer roles.
2. Production/staging env: **`VITE_FACEBOOK_APP_ID`**, **`FACEBOOK_APP_ID`**, **`FACEBOOK_APP_SECRET`** aligned.
3. Legal/product: confirm privacy policy text covers Facebook Login data (`id`, `email`, `name`).
4. Manual E2E on **https://caretip.de** with a Facebook Tester account after deploy.

---

## FINAL VERDICT

**READY AFTER CONFIGURATION**

Code and architecture are appropriate for Meta App Review once Meta dashboard permissions, deployment environment variables, and reviewer test access are in place. The SDK loader hardening reduces risk of a stuck UI during review.
