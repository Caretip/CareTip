# E2E User Journey Audit

**Date:** 2026-08-05  
**Scope:** Guest, Employee, Manager, Platform Admin — end-to-end across mobile + web  
**Related:** `POST_ONBOARDING_STATE_AUDIT.md`, `ENTITLEMENT_PARITY_AUDIT.md`, `STATE_SYNCHRONIZATION_AUDIT.md`, `OFFLINE_SYNC_AUDIT.md`, `NOTIFICATION_LIFECYCLE_AUDIT.md`, `DEEP_LINK_AUDIT.md`, `MEMORY_CLEANUP_AUDIT.md`

---

## Executive summary

| Role | Primary surface | Overall |
| --- | --- | --- |
| **Guest** | Web | Complete tip → pay → feedback |
| **Employee** | Mobile (+ web parity) | Complete for dashboard/tips; goals partial |
| **Manager** | Mobile + web admin/billing | Complete core path after recent fixes; team CRUD / full branding richer on web |
| **Platform Admin** | Web | Complete; mobile admin is a stub |

Recent work removed the post-onboarding “Not available on this account” Basic stats bug, entitlement misclassification, state-sync gaps, offline tip error walls, push listener leaks, and catch-all App Links hijacking tip URLs.

---

## 1. Guest

```
QR scan → Tip amount → Payment → Feedback / rating → Exit
```

| Step | Surface | Status | Notes |
| --- | --- | --- | --- |
| Scan QR | Camera / browser | **OK** | Encoded tip/staff URLs |
| Tip amount | Web `/tip-amount` | **OK** | |
| Payment | Web `/payment` + Stripe | **OK** | |
| Feedback | Web `/rating`, `/tip-complete` | **OK** | |
| Exit | Browser | **OK** | |

**Gaps:** If Universal Links incorrectly claimed tip paths, native app opened with no guest UI — **mitigated** by narrowing Android App Links (`DEEP_LINK_AUDIT.md`). Confirm AASA path allowlists on caretip.de.

---

## 2. Employee

```
Login → Dashboard → Tips → Goals → Logout
```

| Step | Surface | Status | Notes |
| --- | --- | --- | --- |
| Login (password / Google / MFA) | Mobile | **OK** | Auth boundary clears RQ + offline QR |
| Dashboard | Mobile | **OK** | Tips `scope=summary` Basic-safe |
| Tips list / detail | Mobile | **OK** | Offline shows cached pages when available |
| Goals | Mobile settings monthly goal | **Partial** | Rich goal analytics are manager/Premium |
| Notifications | Mobile | **OK** | Badge sync + optimistic read |
| Logout | Mobile | **OK** | Clears session, QR caches, badge |

---

## 3. Manager

```
Signup → Verify → Onboard → Approval → Dashboard → Employees → Branding → QR → Billing → Logout
```

| Step | Surface | Status | Notes |
| --- | --- | --- | --- |
| Signup | Mobile | **OK** | |
| Verify email | Mobile scheme / HTTPS handoff | **OK** | Continuity fixed earlier |
| Native onboarding | Mobile | **OK** | Online preflight; cache clear on complete |
| Admin approval | Web platform → socket/resume | **OK** | AuthUser + workspace sync |
| Dashboard (Basic) | Mobile | **OK** | `scope=summary`; no fake permission EmptyState |
| Analytics / feedback | Mobile | **OK** | Premium gated with upgrade CTA |
| Employees / team | Mobile | **Partial** | Read-only roster; invite/CRUD on web |
| Branding | Mobile profile + web branding | **Partial** | Profile edits invalidate branded QR |
| QR Studio + offline | Mobile | **OK** | Tenant-scoped offline QR |
| Billing | Mobile→web handoff | **OK** | Sync on browser dismiss |
| Logout | Mobile | **OK** | |

**Manual device checklist (manager):** signup → verify → onboard → approve (app backgrounded + kill/reopen + logout/login) → dashboard name/logo/QR/verification/analytics tier → no spurious “Not available on this account”.

---

## 4. Platform Admin

```
Login → MFA → Approve business → Impersonate → Revoke → Logout
```

| Step | Surface | Status | Notes |
| --- | --- | --- | --- |
| Login + MFA | Web `/platform-admin` | **OK** | |
| Approve business | Web | **OK** | Should emit `verification_updated` |
| Impersonate / revoke | Web | **OK** | |
| Mobile SUPER_ADMIN | Mobile `/(app)/admin` | **Stub** | Session + sign-out only |

---

## Cross-cutting regressions covered

| Theme | Document |
| --- | --- |
| Post-onboarding fake authz | `POST_ONBOARDING_STATE_AUDIT.md` |
| Premium scope parity | `ENTITLEMENT_PARITY_AUDIT.md` |
| Cache / AuthUser sync | `STATE_SYNCHRONIZATION_AUDIT.md` |
| Offline reads / no outbox | `OFFLINE_SYNC_AUDIT.md` |
| Push / badge | `NOTIFICATION_LIFECYCLE_AUDIT.md` |
| Listener leaks | `MEMORY_CLEANUP_AUDIT.md` |
| Auth vs tip URLs | `DEEP_LINK_AUDIT.md` |

---

## Known intentional product boundaries

1. Guest tipping is web-only.  
2. Platform admin operations are web-only.  
3. Manager employee invite/CRUD remains web.  
4. Cold-start offline does not open authenticated shell (security).  
5. Cold-start push tap does not auto-open inbox (Android stale response).  

---

## Release validation plan

### Smoke (every build)
- [ ] Manager Basic dashboard loads after onboard  
- [ ] Employee tips list loads  
- [ ] Logout clears badge and offline QR  

### Full E2E (pre-release)
- [ ] Guest tip on production domain stays in browser  
- [ ] Manager verify deep link → native onboarding → dashboard  
- [ ] Admin approve → mobile resume shows verified/QR-ready state  
- [ ] Billing upgrade → dismiss browser → Premium section unlocks  
- [ ] Login/logout × 10 with push enabled — no duplicate inbox opens  

### Commands
```bash
npx tsx mobile/scripts/business-stats-scope-regression.ts
npx tsx mobile/scripts/offline-qr-tenant-isolation-regression.ts
cd mobile && npm run typecheck
```
