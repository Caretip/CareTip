# CareTip Security Evidence Catalog

**Audience:** Engineering leadership · Security · External penetration testers  
**Date:** 2026-08-05  
**Purpose:** Map each major security control to the code that implements it — evidence of intentional design, not afterthought hardening.

This document is an **implementation index**, not a new audit. Status reflects presence and design intent in the current repository.

---

## Control index

| Security Control | Primary surface | Status |
| --- | --- | --- |
| Access JWT issuance & verification | Backend | ✅ |
| Access JWT staleness / session validity | Backend | ✅ |
| Refresh token rotation (reuse detection) | Backend | ✅ |
| Refresh cookie / mobile mirror | Backend + Mobile | ✅ |
| Role-based authorization | Backend | ✅ |
| Tenant isolation (API) | Backend | ✅ |
| QR scan ownership isolation | Backend | ✅ |
| Offline QR tenant isolation | Mobile | ✅ |
| Branded QR disk isolation | Mobile | ✅ |
| Auth React Query cache boundary | Mobile | ✅ |
| Mobile ↔ web billing handoff token | Backend + Mobile | ✅ |
| Deep link / App Link scoping | Mobile | ✅ |
| SecureStore for secrets | Mobile | ✅ |
| Auth & security rate limiting | Backend | ✅ |
| MFA (TOTP) + attempt lockout | Backend + Mobile | ✅ |
| Password policy | Backend | ✅ |
| Password reset (tokenized) | Backend + Mobile | ✅ |
| Email verification (tokenized) | Backend + Mobile | ✅ |
| Session expiry (client) | Mobile (+ Web) | ✅ |
| Idle session timeout | Mobile (+ Web) | ✅ |
| WebSocket authentication | Backend + Mobile | ✅ |
| Public tip-room socket tokens | Backend | ✅ |
| File upload validation | Backend | ✅ |
| Security response headers | Backend | ✅ |
| CORS / trusted origin | Backend | ✅ |
| Subscription / feature entitlement gates | Backend | ✅ |
| Completed-onboarding gate | Backend | ✅ |
| Business verification capability gate | Backend | ✅ |

---

## 1. Access JWT issuance & verification

**Purpose:** Short-lived bearer credentials identify the caller without storing passwords client-side.

**Files**
- `backend/src/lib/jwtConfig.js` (via imports) — `signJwt` / `verifyJwt`
- `backend/src/services/auth.service.ts` — `authResultForUserRecord` / `authResultForUserId`
- `backend/src/middleware/auth.middleware.ts` — `authMiddleware`, `optionalAuthMiddleware`
- `backend/src/lib/accessTokenRefresh.ts` — access-token validation helpers
- `mobile/services/api/client.ts` — `Authorization: Bearer` attachment + 401 refresh

**How it works**
1. Successful login/OAuth/MFA/refresh returns an access JWT in the JSON body.
2. Clients send `Authorization: Bearer <access>`.
3. `authMiddleware` verifies signature/type, normalizes claims, then checks the token is still valid against server-side session state (`assertAccessJwtStillValid`).
4. Mobile stores the access token in SecureStore and hydrates an in-memory copy for Axios.

**Limitations**
- Access JWT lifetime is env-configured; clients must refresh before expiry.
- Web MFA challenge for non–platform-admin accounts is misrouted in `src/app/components/AuthPage.tsx` (web bug; mobile MFA path is correct).

---

## 2. Access JWT staleness / session validity

**Purpose:** Revoked or superseded sessions cannot keep using an unexpired JWT.

**Files**
- `backend/src/middleware/auth.middleware.ts` — `assertAccessJwtStillValid` → `SESSION_STALE`
- `backend/src/lib/accessTokenRefresh.ts`

**How it works**
After cryptographic verify, the middleware loads server state and rejects stale sessions with `401` / `SESSION_STALE` so clients must re-authenticate via refresh or login.

**Limitations**
Depends on server clock and session bookkeeping consistency across instances.

---

## 3. Refresh token rotation (reuse detection)

**Purpose:** Steal-resistant long-lived sessions; reuse of a rotated refresh token revokes the family.

**Files**
- `backend/src/services/refreshToken.service.ts` — `issueRefreshToken`, `rotateRefreshToken`, `revokeRefreshToken`, `revokeAllRefreshTokensForUser`
- `backend/src/controllers/auth.controller.ts` — refresh / logout cookie handling
- Storage: hashed tokens in DB (`tokenHash` = SHA-256 of opaque value)

**How it works**
1. Opaque refresh tokens are stored **hashed** (`sha256Hex`).
2. On refresh, `rotateRefreshToken` issues a new token, revokes the old one, and sets `replacedByTokenId`.
3. If a **revoked-by-rotation** token is presented again, all active refresh tokens for that user are revoked (reuse detection).
4. Explicit logout revoke does **not** treat reuse the same way (no family wipe when `replacedByTokenId` is null).

**Limitations**
- Rotation path avoids interactive Prisma transactions for pooler compatibility; race notes are documented in-service.
- Mobile must persist the rotated value from `Set-Cookie` / `X-CareTip-Refresh`.

---

## 4. Refresh cookie / mobile mirror

**Purpose:** HttpOnly cookie for browsers; SecureStore mirror for native (no cookie jar).

**Files**
- Backend: `refreshToken.service.ts` — `setRefreshCookie`, `clearRefreshCookie`, `CARETIP_REFRESH_HEADER`
- Mobile: `mobile/services/auth/tokenStorage.ts` — `saveRefreshToken` / `getRefreshToken`
- Mobile: `mobile/services/api/client.ts` — Cookie header on refresh; `persistRefreshFromResponse`

**How it works**
Web relies on HttpOnly `caretip_refresh`. Mobile cannot use that jar reliably, so it mirrors the opaque refresh value into SecureStore and re-sends it as `Cookie` (and reads `X-CareTip-Refresh` when present).

**Limitations**
Mobile mirror is as sensitive as the cookie; device compromise of Keystore/Keychain is out of app scope.

---

## 5. Role-based authorization

**Purpose:** Enforce MANAGER / EMPLOYEE / SUPER_ADMIN boundaries on APIs.

**Files**
- `backend/src/middleware/auth.middleware.ts` — `requireRole`, `requirePlatformAdmin`, `requireAdminRoleClaim`, `requireVerifiedEmail`
- Route mounts across `backend/src/routes/*`

**How it works**
Middleware loads the live user role from the database (not only JWT claims) before allowing privileged handlers.

**Limitations**
Platform admin product surface is web-first; mobile SUPER_ADMIN is a stub shell.

---

## 6. Tenant isolation (API)

**Purpose:** Managers only see their business; client-supplied business IDs are not trusted.

**Files**
- `backend/src/controllers/business.controller.ts` — `getBusinessIdForManagerUser`; deprecated client `businessId` ignored for stats
- `backend/src/utils/dashboardTenantLog.js` — tenant logging
- Tips / employees / QR controllers resolve business from the authenticated manager or employee row

**How it works**
Dashboard and manager APIs resolve `businessId` from the JWT user → business ownership mapping. Comments explicitly mark client-supplied IDs as ignored.

**Limitations**
Every new endpoint must follow the same pattern; reviews should reject “trust body.businessId”.

---

## 7. QR scan ownership isolation

**Purpose:** Scan/event attribution cannot attach to another venue’s location/table/employee.

**Files**
- `backend/src/services/qr/qrScanOwnership.service.ts` — `assertQrScanTargetsBelongToBusiness`
- `backend/src/controllers/qrScan.controller.ts`
- Related guest visit: `backend/src/services/qr/qrGuestVisit.service.ts`

**How it works**
Before accepting scan targets, the service asserts location/table/employee IDs belong to the resolved business; mismatches raise `QR_SCAN_OWNERSHIP_MISMATCH`.

**Limitations**
Public tip URLs remain enumerable by design (guest tipping); ownership checks protect write/attribution paths.

---

## 8. Offline QR tenant isolation (mobile)

**Purpose:** Prevent Account B from painting Account A’s tip URLs after login switch.

**Files**
- `mobile/utils/offlineQrTenantIsolation.ts` — user-scoped keys, envelopes, write guards, display resolution
- `mobile/utils/offlineQrCache.ts` — AsyncStorage persistence
- `mobile/services/auth/authCacheBoundary.ts` — clear on interactive auth
- `mobile/scripts/offline-qr-tenant-isolation-regression.ts`

**How it works**
Caches are keyed `caretip_offline_qr_cache_v2:{userId}` with a `{ userId, businessId, items }` envelope. Legacy device-global keys are wiped and never hydrated. Writes are rejected if the intended user ≠ current AuthUser. Interactive login/onboarding clears all offline QR caches; session restore keeps same-user offline UX.

**Limitations**
Cold-start offline cannot enter the authenticated shell (by design — unvalidated JWT). Mid-session offline QR only.

---

## 9. Branded QR disk isolation (mobile)

**Purpose:** Branded PNG cache must not leak across users.

**Files**
- `mobile/utils/brandedQrImageCache.ts` — `caretip_branded_qr_png_v2:{userId}:…`
- `mobile/services/api/brandedQrService.ts`
- `mobile/services/api/invalidateUserQueries.ts` — `invalidateBrandingArtifacts`

**How it works**
Disk entries include `userId`; load rejects mismatched owners. Profile edits and business-data realtime events invalidate branded RQ keys and wipe disk caches.

**Limitations**
No TTL on disk PNGs; stale branding possible until next online fetch.

---

## 10. Auth React Query cache boundary (mobile)

**Purpose:** Private API caches never survive account changes.

**Files**
- `mobile/services/auth/authCacheBoundary.ts` — `queryClient.clear()` before `setAuthenticated`
- `mobile/services/api/queryKeys.ts` — keys namespaced `["u", userId, …]`
- `mobile/services/auth/sessionManager.ts` — logout / bootstrap clear

**How it works**
Every interactive auth boundary clears the in-memory React Query cache before navigation. Keys are user-scoped so even residual entries cannot match another user id.

**Limitations**
React Query is not persisted to disk; offline mid-session data dies with process kill.

---

## 11. Mobile ↔ web billing handoff token

**Purpose:** Open web Billing without putting the mobile access JWT in a URL.

**Files**
- `backend/src/services/mobileWebHandoff.service.ts` — `createMobileWebHandoff`, `consumeMobileWebHandoff`, TTL 90s, purpose allowlist, IP/UA compatibility, audit
- `backend/src/controllers/mobileWebHandoff.controller.ts`
- `backend/src/routes/mobile.routes.ts`
- `mobile/services/api/billingHandoffService.ts`
- `mobile/utils/openBillingWeb.ts` — in-app browser; sync AuthUser on dismiss

**How it works**
1. Authenticated mobile calls `POST /api/mobile/create-billing-session`.
2. Backend stores a one-time hashed handoff token and returns `/mobile-auth?token=…&purpose=billing`.
3. Web consumes the token once, establishes a web session, redirects to billing.
4. On browser dismiss, mobile refreshes AuthUser + invalidates workspace queries.

**Limitations**
- Purpose currently allowlisted to `"billing"` only.
- IP/UA binding is best-effort (NAT / browser UA changes can fail consume).
- iOS/Android in-app browser UX depends on OS Custom Tabs / SFSafariViewController.

---

## 12. Deep link / App Link scoping

**Purpose:** Only auth recovery URLs open the native app; tip/guest URLs stay in the browser.

**Files**
- `mobile/components/providers/DeepLinkBridge.tsx` — routes verify-email, reset-password, login
- `mobile/app.json` — Android `intentFilters` pathPrefix: `/verify-email`, `/reset-password`, `/login` only; scheme `caretip`
- Backend email builders: `backend/src/services/emailVerification.service.ts`, `passwordReset.service.ts` — mobile `caretip://` + HTTPS fallback
- Web handoff helper: `src/app/lib/mobileAppDeepLink.ts`

**How it works**
Custom scheme and narrowed HTTPS App Links deliver tokens into native auth screens. Tip/staff/QR HTTPS paths are **not** claimed by Android filters (fixed from prior catch-all `/`).

**Limitations**
- iOS `associatedDomains` requires hosted AASA path allowlists (ops; not in repo).
- Cold-start push → inbox intentionally not auto-routed (Android stale response history).

---

## 13. SecureStore for secrets (mobile)

**Purpose:** Tokens never land in AsyncStorage.

**Files**
- `mobile/services/auth/tokenStorage.ts` — access, refresh, user snapshot
- `mobile/constants/storageKeys.ts` — documents SecureStore vs preference keys
- AsyncStorage used only for prefs / offline QR / branded PNG (non-JWT)

**How it works**
Expo SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Comments forbid JWT storage in AsyncStorage. Snapshot is UX-only; bootstrap never authorizes from snapshot alone (`sessionManager.ts`).

**Limitations**
User snapshot in SecureStore is not a secret equivalent to tokens but still PII-adjacent.

---

## 14. Auth & security rate limiting

**Purpose:** Slow credential stuffing, reset spam, invite abuse, push spam.

**Files**
- `backend/src/config/authRateLimit.config.ts` — layered IP / email / composite caps
- `backend/src/middleware/authRateLimit.middleware.ts`
- `backend/src/utils/rateLimitStore.ts` — Redis with in-memory fallback
- `backend/src/config/securityRateLimit.config.ts` + `securityRateLimit.middleware.ts`
- Route-local limiters: push, tipping QR slug, leads, support tickets, etc.

**How it works**
Auth endpoints enforce multi-dimensional limits (IP, email, IP+email). Store prefers Redis when `REDIS_URL` is set; otherwise process-local buckets.

**Limitations**
In-memory fallback is per-instance (weaker under multi-node without Redis).

---

## 15. MFA (TOTP) + attempt lockout

**Purpose:** Second factor for privileged / enabled accounts.

**Files**
- Backend: `backend/src/services/mfaLogin.service.ts`, `mfaAttemptLimit.service.ts`, `auth.controller.ts` (setup/enable/verify)
- Mobile: `mobile/services/auth/mfaService.ts`, `mobile/features/auth/MfaChallengeScreen.tsx`
- Settings: `mobile/features/settings/sections/SecuritySettingsSection.tsx`

**How it works**
Pending MFA is a short-lived signed JWT (`purpose` claim). TOTP verification is rate-limited/locked on repeated failure. Mobile completes MFA then establishes a full session via auth cache boundary.

**Limitations**
- Backend login challenge path historically focused on platform-admin accounts in controller branches; mobile implements a full native challenge UX.
- Web business MFA login currently redirects incorrectly to platform-admin login (`AuthPage.tsx`) — known web defect.

---

## 16. Password policy

**Purpose:** Reject weak passwords at the API boundary.

**Files**
- `backend/src/utils/passwordValidation.ts` — `validatePassword`
- Used by register / reset / password-change controllers

**How it works**
Central validator returns structured pass/fail used before hashing and persistence.

**Limitations**
Policy strength is whatever `validatePassword` encodes; keep aligned with product policy docs.

---

## 17. Password reset (tokenized)

**Purpose:** Account recovery without exposing existing password hashes.

**Files**
- `backend/src/services/passwordReset.service.ts` — `requestPasswordReset`, `resetPasswordWithToken`
- Rate limits: `authRateLimits.passwordReset` / `resetPasswordSubmit`
- Mobile: `ForgotPasswordScreen.tsx`, `ResetPasswordScreen.tsx` + deep links

**How it works**
Opaque reset tokens (stored hashed, TTL-bound) are emailed as `caretip://reset-password?token=` (mobile) or HTTPS web URLs. Submit sets a new password and invalidates the token.

**Limitations**
Email delivery security is outside the app (provider compromise / inbox access).

---

## 18. Email verification (tokenized)

**Purpose:** Prove mailbox ownership before full product access.

**Files**
- `backend/src/services/emailVerification.service.ts` — create/send/verify; mobile-aware URL builders
- `backend/src/utils/clientPlatform.ts` — `X-CareTip-App: mobile` detection
- `backend/src/middleware/auth.middleware.ts` — `requireVerifiedEmail`
- Mobile: `VerifyEmailScreen.tsx`, `DeepLinkBridge.tsx`

**How it works**
Verification tokens are single-use/TTL. Mobile clients receive primary `caretip://verify-email?token=` plus HTTPS fallback with `client=mobile`. Success continues native login/onboarding.

**Limitations**
Web success screens may still appear for HTTPS opens; CTA returns users to the app via `caretip://login?emailVerified=1`.

---

## 19. Session expiry (client)

**Purpose:** Force re-login when refresh fails permanently.

**Files**
- Mobile: `mobile/components/providers/SessionExpiryBridge.tsx`, `mobile/services/api/client.ts` (`notifySessionExpired`)
- Web: session clear on failed refresh in `src/app/lib/api.ts`

**How it works**
After refresh failure, mobile signs out locally and routes to login with user-visible handling.

**Limitations**
Network blips should prefer session_recovery / retry, not hard logout — bootstrap distinguishes offline vs rejected.

---

## 20. Idle session timeout

**Purpose:** Reduce risk on unattended shared devices.

**Files**
- Mobile: `mobile/lib/idleSession/*`, `IdleSessionBridge.tsx`, `IdleWarningModal`
- Web: `src/app/lib/idleSession*` + idle controller
- Feature-flagged via env / config

**How it works**
Activity listeners reset timers; warning modal offers stay-signed-in; expiry triggers logout. Unsaved “dirty” registry can extend grace.

**Limitations**
Disabled when feature flag off; not a substitute for short access-token TTL.

---

## 21. WebSocket authentication

**Purpose:** Realtime events only for authenticated users (or scoped public tip rooms).

**Files**
- `backend/src/socket/socketServer.ts` — `io.use` handshake auth
- `backend/src/services/publicSocketToken.service.ts` — public room tokens
- `backend/src/routes/socket.routes.ts` + rate limit for public token minting
- Mobile: `mobile/components/providers/SocketProvider.tsx` — `auth: { token: accessToken }`

**How it works**
1. Authenticated clients present access JWT in `handshake.auth.token`; server verifies JWT type, loads active user, attaches `userId` / role / business rooms.
2. Guests may present a **public room token** (not a user JWT) bound to a business id for tip-flow realtime only.

**Limitations**
Public room tokens are intentionally weaker than user JWTs; minting is rate-limited. Mobile reconnect invalidates queries — monitor stampede under flaky networks.

---

## 22. File upload validation

**Purpose:** Block malicious/oversized uploads (SVG XSS, polyglots, huge files).

**Files**
- `backend/src/lib/imageUploadValidation.ts` — MIME allowlist, **magic-byte sniff**, SVG ban
- `backend/src/lib/verificationUploadValidation.ts` — KYC/verification content rules
- `backend/src/lib/multerUploadLimits.ts` — size caps
- `backend/src/middleware/businessUpload.middleware.ts` — multer filters
- `backend/src/lib/uploadMimeGuard.ts`
- `backend/src/middleware/blockSensitiveStaticUploads.middleware.ts`
- Controllers: platform/business/employee/media upload paths

**How it works**
Multer accepts memory buffers with size limits; service layer re-validates by magic bytes, rejects SVG, and stores via controlled upload service paths.

**Limitations**
Clients can still send garbage until rejected; AV scanning beyond magic bytes is not claimed here unless separately deployed.

---

## 23. Security response headers

**Purpose:** Reduce browser misuse of API responses.

**Files**
- `backend/src/middleware/securityHeaders.middleware.ts`

**How it works**
Sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`, production HSTS, and a restrictive API CSP (`default-src 'none'`).

**Limitations**
SPA CSP for the marketing/web app is configured at the host (`public/_headers` / Vercel), not only in Express.

---

## 24. CORS / trusted origin

**Purpose:** Browser clients only from allowlisted origins; CSRF-sensitive actions can require trusted Origin.

**Files**
- `backend/src/config/cors.ts`
- `backend/src/middleware/requireTrustedOrigin.middleware.ts`

**How it works**
CORS allowlist drives browser access. Sensitive routes can additionally require a trusted `Origin`.

**Limitations**
Native mobile apps are not browser CORS subjects; they authenticate with Bearer tokens instead.

---

## 25. Subscription / feature entitlement gates

**Purpose:** Premium capabilities cannot be unlocked by client UI alone.

**Files**
- `backend/src/config/subscriptionCapabilities.ts` — tier → capabilities, stats scope rules
- `backend/src/services/subscriptionEntitlement.service.ts` — `requireFeature`, `SUBSCRIPTION_REQUIRED`
- Controllers: business stats/QR analytics, tips advanced filters, feedback routes, goals routes
- Mobile client gates: `mobile/utils/businessStatsScope.ts`, `AccessErrorState.tsx` (UX only — server enforces)

**How it works**
Server checks business tier/capabilities before returning Premium payloads (`scope=full`, QR analytics, customer feedback, etc.). Mobile must request Basic-safe scopes and treat `SUBSCRIPTION_REQUIRED` as upgrade UX, not permission denial.

**Limitations**
Mobile UI currently proxies some gates from `subscriptionTier` string rather than a full entitlements catalog (server remains source of truth).

---

## 26. Completed-onboarding gate

**Purpose:** Incomplete managers cannot hit dashboard data APIs.

**Files**
- `backend/src/middleware/requireCompletedOnboarding.middleware.ts` — `ONBOARDING_INCOMPLETE`
- Mobile: `postAuthNavigation.ts` + `(app)/_layout.tsx` redirects; `BusinessOnboardingScreen.tsx`

**How it works**
Middleware returns `403` + `ONBOARDING_INCOMPLETE` for managers who have not finished onboarding. Profile/onboarding routes remain open to complete setup.

**Limitations**
Platform **admin approval** is a separate gate (verification capability), not this middleware.

---

## 27. Business verification capability gate

**Purpose:** Pending/unapproved businesses cannot use go-live capabilities (e.g. certain QR/public tipping features).

**Files**
- `backend/src/middleware/requireBusinessVerificationCapability.middleware.ts`
- `backend/src/middleware/isApprovedBusiness.middleware.ts`
- Policy: `backend/src/config/mvpVerificationPolicy.ts`

**How it works**
After auth, capability middleware checks verification/approval state before sensitive business actions. Mobile syncs AuthUser/profile on `verification_updated` / resume so UI reflects approval without reinstall.

**Limitations**
Mobile currently lacks a dedicated verification status chip in settings UI (data sync exists; display polish pending).

---

## How to use this document in a pentest

1. Start from the **Control index** and pick a control to attack.  
2. Open the listed files — they are the authoritative implementation.  
3. Note **Limitations** as explicit residual risk, not hidden gaps.  
4. Cross-check runtime behavior with staging env vars (JWT secrets, Redis, CORS origins, AASA hosting).

For product release posture (parity / QA gates), see `FINAL_MOBILE_RELEASE_READINESS_REPORT.md`. For defect backlog, see `REMAINING_ISSUES.md`.

---

*End of security evidence catalog.*
