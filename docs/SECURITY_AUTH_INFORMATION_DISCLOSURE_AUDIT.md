# CareTip Authentication Information Disclosure Audit

**Date:** 2026-08-26  
**Scope:** Authorized security hardening — account enumeration and authentication method disclosure  
**Status:** Remediation applied for confirmed security findings; regression tests passed

---

## Executive summary

CareTip’s public authentication flows contained several responses that confirmed whether an email was registered, which sign-in method was configured, or how OAuth linking should proceed. The highest-impact case was OAuth signup/login returning `409` with `email`, `provider`, and copy directing users to **Settings → Security → Linked Accounts**.

Remediation unifies sensitive public auth failures behind shared, helpful-but-non-confirming messages; removes method-specific login oracles; aligns web and mobile clients with the API; and adds a backend enumeration regression suite (`npm run test:auth-enumeration`).

Legitimate flows (password login, register, forgot password, OAuth, invite redeem, MFA for platform admins) remain intact. Some authenticated or post-credential UX signals (for example `EMAIL_NOT_VERIFIED` after a correct password) are intentionally retained.

---

## Scope

| Area | Covered |
|------|---------|
| Web app (React) auth UI + error mapping | Yes |
| Mobile app auth i18n + OAuth error mapping | Yes |
| Backend auth / OAuth / password reset / resend verification | Yes |
| Employee invitation / activation conflict messages | Yes |
| MFA enrollment / login (platform admin) | Reviewed |
| Account deletion / erasure / sessions / refresh | Reviewed (no new public existence oracles found) |
| Business / employee public lookup | Reviewed (invite preview still returns business identity by design) |

---

## Methodology

1. Code search across backend services/controllers, web `errorMessages` / i18n, and mobile auth strings for existence/method-confirming copy.
2. Classify each hit as **Safe**, **Needs improvement**, or **Security finding**.
3. Remediate confirmed findings in **API first**, then web/mobile consistency.
4. Add/run regression tests; second-pass search for leftover primary copy.
5. Document remaining accepted risks and product decisions.

---

## Findings discovered

### Fixed — Security findings

| ID | Finding | Severity | Original behavior | Why expository | Remediation |
|----|---------|----------|-------------------|----------------|-------------|
| F-01 | OAuth linking required | High | `409` + `OAUTH_LINKING_REQUIRED` + email/provider + Linked Accounts instructions | Confirms email registered and reveals linking architecture | Uniform `401` + `OAUTH_SIGN_IN_FAILED` + generic social failure message; no email/provider in JSON |
| F-02 | OAuth “not registered” | High | Distinct `400` + not-registered codes/messages | Distinguishes missing vs existing accounts | Same uniform OAuth failure as F-01 |
| F-03 | OAuth disabled / platform-admin forks | High | Distinct `403` messages for disabled / admin routing | Account status / type oracle on OAuth login | Mapped to uniform OAuth sign-in failure |
| F-04 | Password register “Email already registered” | High | Explicit existence confirmation | Account enumeration on signup | `AUTH_REGISTER_GENERIC_MESSAGE` |
| F-05 | Prisma P2002 email unique | High | Client message “email already in use” | Existence confirmation on race | Maps to register generic message |
| F-06 | OAuth-only password login | High | “This account uses social sign-in…” | Confirms account + method | Same as invalid credentials |
| F-07 | Super Admin without platform flag | Medium | Distinct permission / cannot-sign-in messages | Account-type oracle | Invalid credentials |
| F-08 | Employee invite redeem existing email | Medium | “Email already registered” | Public invite path confirms email taken | Register generic message |
| F-09 | Authenticated OAuth link “another user” | Low–Med | Confirmed cross-user link | Softens privacy of other accounts | `Unable to link this social account.` |
| F-10 | Manager create employee existing email | Low–Med | “Email already registered” | Confirms global registration to manager | Soft invite wording (authenticated context) |

### Fixed — Needs improvement

| ID | Finding | Original | Remediation |
|----|---------|----------|-------------|
| N-01 | Resend verification “already verified” | Distinct `400` after password proof | Silent success (same as send path) |
| N-02 | Web/mobile linking toasts & ERROR_MAP | Mirrored expository API copy | Generic social / register copy; AuthPage no longer switches mode on “not registered” |
| N-03 | Legacy ERROR_MAP / DE translations | Old Google/register strings | Mapped to generic copy |

### Already secure (Safe)

| ID | Area | Notes |
|----|------|-------|
| S-01 | Forgot / reset password | Generic success; invalid token wording only |
| S-02 | Login unknown vs wrong password (password accounts) | Already shared “Invalid email or password” |
| S-03 | Inactive user password login | Treated as invalid credentials |
| S-04 | Refresh / session errors | Generic auth required / invalid token |
| S-05 | MFA lockout / invalid TOTP | Does not reveal whether MFA is enrolled on arbitrary emails (platform-admin MFA is after credential success) |

### Needs improvement — intentionally not changed (accepted / product)

| ID | Finding | Why left | Recommendation |
|----|---------|----------|----------------|
| A-01 | `EMAIL_NOT_VERIFIED` after correct password | Useful UX; requires knowing the password | Keep; optional future: always challenge verify without stating “not verified” only if product accepts friction |
| A-02 | Role mismatch (“Business” / “Staff” permissions) after valid credentials | Guides correct lane | Keep for UX; not a pre-auth oracle |
| A-03 | Invite validate returns business name | Required for join UX | Keep; rate-limit / monitor invite probing |
| A-04 | Signup `201` vs conflict `400` | Status still differs by existence | Industry-common tradeoff; message no longer confirms. Future: always `200` “check email” if product wants stronger anti-enum |
| A-05 | MFA challenge shape after platform-admin password success | Post-auth for known admin path | Keep |
| A-06 | “Email already in use” on staff **update** (same business) | Authenticated manager tooling | Keep as team collision message |

### Future decision required

| ID | Topic | Decision needed |
|----|-------|-----------------|
| D-01 | Stronger signup anti-enumeration (identical status for taken vs free emails) | Product + support load vs security |
| D-02 | Whether password-proven resend should say “already verified” again | UX clarity vs residual state disclosure |

---

## Remediation applied (summary)

Central messages live in `backend/src/services/authDisclosureMessages.ts`:

- Invalid credentials  
- Generic register conflict  
- Generic OAuth sign-in failure (`OAUTH_SIGN_IN_FAILED`)  
- Soft OAuth link failure  

Controllers and services throw/map these consistently. Web `errorMessages.ts` / i18n and mobile `oauthErrorMessage` / locales follow the same wording.

---

## Files changed

### Backend
- `backend/src/services/authDisclosureMessages.ts` (new)
- `backend/src/services/auth.service.ts`
- `backend/src/services/oauthAuth.service.ts`
- `backend/src/services/employeeInvite.service.ts`
- `backend/src/services/employee.service.ts`
- `backend/src/controllers/auth.controller.ts`
- `backend/src/utils/httpErrors.ts`
- `backend/scripts/auth-enumeration-disclosure-runtime.ts` (new)
- `backend/scripts/oauth-expansion-runtime.ts`
- `backend/package.json` (`test:auth-enumeration`)

### Web
- `src/app/lib/apiError.ts`
- `src/app/lib/api.ts`
- `src/app/lib/errorMessages.ts`
- `src/app/lib/friendlyMessageDe.ts`
- `src/app/components/AuthPage.tsx`
- `src/i18n/locales/en.json`
- `src/i18n/locales/de.json`

### Mobile
- `mobile/constants/authErrors.ts`
- `mobile/utils/oauthErrorMessage.ts`
- `mobile/utils/userFacingError.ts`
- `mobile/i18n/types.ts`
- `mobile/i18n/locales/en.ts`
- `mobile/i18n/locales/de.ts`
- `mobile/scripts/social-auth-consistency-runtime.ts`

---

## Tests performed

| Test | Command | Result |
|------|---------|--------|
| Auth enumeration disclosure | `npm run test:auth-enumeration` (backend) | **PASS** |
| Mobile social auth consistency | `npx tsx scripts/social-auth-consistency-runtime.ts` (mobile) | **PASS** |
| OAuth expansion (updated expectations) | `npm run test:oauth-expansion` (backend) | **PASS** (20/20) |

### Enumeration suite coverage
- Existing email signup message (generic, non-expository)
- Login unknown email === wrong password
- OAuth-only password login === invalid credentials
- Forgot password succeeds for existing and missing
- OAuth linking / not-registered constants unified
- Resend verification when already verified → silent success
- Employee invite existing email → register generic
- Prisma P2002 → register generic
- Primary Linked Accounts copy absent from backend constant

---

## Remaining accepted risks

1. Signup HTTP status still differs (`201` vs `400`) when an email is free vs taken.  
2. Correct password + unverified email still returns `EMAIL_NOT_VERIFIED`.  
3. Valid invite codes still expose venue identity on validate.  
4. Authenticated managers can still observe email collisions when inviting/updating staff (softened wording).  
5. Timing side channels were not instrumented (no artificial delays added).

---

## Recommendations (non-blocking)

1. Decide on D-01 / D-02 with product.  
2. Force-add this report if it should be tracked in git (`*.md` is gitignored except `README.md`).  
3. Keep monitoring invite-code probing via existing abuse monitors.  
4. Periodically re-run `npm run test:auth-enumeration` in CI.

---

## Second-pass audit notes

After remediation, searches no longer show the primary Linked Accounts OAuth toast as live API/UI copy (only as a regression negative assertion). Remaining “Email already registered” / `OAUTH_LINKING_REQUIRED` identifiers are legacy aliases, allowlist entries, or UI titles (“Linked Accounts” settings page), not public existence oracles.
