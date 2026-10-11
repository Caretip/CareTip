# Remaining Issues — Prioritized Backlog

**Date:** 2026-08-05  
**Scope:** Issues still present in the repository after architectural audits and fixes.  
**Severity:** Critical · High · Medium · Low

---

## Critical

*None identified in current mobile code for previously known blockers* (Basic `scope=full` dashboard denial, cross-tenant offline QR, catch-all App Links, JWT in billing URL, push listener race). Each was verified fixed or mitigated by reading current files.

---

## High

| ID | Issue | Root cause | Affected files | Recommended fix | Effort |
| --- | --- | --- | --- | --- | --- |
| H1 | **Production / closed-beta device validation not proven for this codebase revision** | Prior Phase 4.1 was NO-GO; this audit is code-based only — no fresh EAS APK/IPA smoke on physical devices for *current* tree | `docs/PHASE4_1_ANDROID_BUILD_VALIDATION.md`, `mobile/eas.json` | Run EAS preview/production build; execute `RELEASE_CHECKLIST.md` on device | 1–2 days |
| H2 | **iOS Universal Links path allowlist not verified in-repo** | `associatedDomains` declared; AASA / path rules not in repository | `mobile/app.json`; hosted `/.well-known/apple-app-site-association` | Confirm AASA only lists auth paths (verify-email, reset-password, login); tip URLs stay browser | 0.5 day ops |
| H3 | **Web business MFA login misroutes to platform-admin** | `AuthPage.tsx` navigates any `mfaRequired` to `/platform-admin/login` | `src/app/components/AuthPage.tsx` | Route to in-lane MFA challenge (mirror mobile `MfaChallengeScreen`) | 0.5–1 day |

*H3 is a web High; does not block mobile pentest of native MFA, but blocks “full product” parity claims.*

---

## Medium

| ID | Issue | Root cause | Affected files | Recommended fix | Effort |
| --- | --- | --- | --- | --- | --- |
| M1 | Inbox item tap does not navigate (mark-read only) | No port of web `notificationNavigation` | `NotificationsScreen.tsx` | Port destination resolver for tip/security/team links | 1 day |
| M2 | No business verification status chip on mobile | Profile UI omits `onboardingVerificationStatus` | Business profile / dashboard | Show chip from `businessProfile` | 0.5 day |
| M3 | No logo upload on mobile | Image picker + upload API unused | Settings / onboarding | Add upload or deep-link to web branding | 1–2 days |
| M4 | Entitlements gated by tier string, not `hasFeature` | No mobile entitlements client | `businessStatsScope.ts` | Shared entitlements endpoint or catalog | 2–3 days |
| M5 | Team invite/CRUD web-only | Product split | `TeamManagementScreen.tsx` | Document or ship invite later | Product |
| M6 | QR designer / regen / CSV export web-only | Product split | — | Keep intentional; document in release notes | — |
| M7 | Notification delete / category filters unused | UI not wired | `useNotifications.ts` | Optional polish | 0.5 day |
| M8 | Foreground/reconnect query overlap under flaky networks | AuthSession + reconnect invalidations | Bridges | Debounce shared workspace invalidate | 0.5 day |
| M9 | Dead Zustand `businessStore` / `employeeStore` | Cleared but never hydrated | `store/*.ts` | Remove or hydrate | 0.25 day |
| M10 | Cold-start push tap skipped | Intentional Android stale-response fix | `PushNotificationBridge.tsx` | Safe consumed-id one-shot after auth | 1 day |

---

## Low

| ID | Issue | Recommended fix | Effort |
| --- | --- | --- | --- |
| L1 | Auth shells lack OfflineBanner | Add banner to `AuthExperienceShell` | 0.25 day |
| L2 | AuthFooterSheet 80ms timeout without unmount clear | Clear on unmount | 0.1 day |
| L3 | Theme in header vs web settings panel | Document intentional UX | — |
| L4 | Employee avatar upload missing | Optional | 1 day |
| L5 | Platform admin mobile stub | Keep web-only; document | — |
| L6 | No durable offline mutation outbox | Preflight online (done); outbox only if required | Product |

---

## Fixed since earlier audits (do not re-open without evidence)

| Former issue | Evidence of fix |
| --- | --- |
| Dashboard `scope=full` → fake permission EmptyState | `resolveDashboardStatsScope` → `summary` |
| Cross-tenant offline QR | User-scoped envelopes + regression script |
| Android catch-all App Links | `app.json` pathPrefix auth-only |
| Billing JWT in URL | One-time `/mobile-auth?token=` |
| Push listener leak on login flip | Ref-held subs + cancel |
| Subscription 403 as permission copy | `AccessErrorState` + classifiers |
| Stale AuthUser after approval | `verification_updated` + resume sync |
| Billing dismiss no sync | `openBillingWeb` workspace sync |

---

## Suggested backlog order for post-pentest

1. H1 device smoke + H2 AASA  
2. H3 web MFA (if claiming full-web parity)  
3. M2 verification chip (manager trust UX)  
4. M1 inbox deep links  
5. M4 entitlements parity  
6. Polish (M3/M7/M8/L*)
