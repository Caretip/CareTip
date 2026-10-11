# CareTip Feature Parity Matrix — Mobile ↔ Web

**Date:** 2026-08-05  
**Method:** Code inspection of `mobile/`, `src/`, and relevant `backend/` — not documentation alone.  
**Legend:** ✅ Full Parity · 🟡 Intentional Difference · 🟠 Mobile Missing · 🔴 Bug

---

## Authentication

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| Email signup | `AuthPage.tsx` | `RegisterScreen.tsx` | ✅ | Business + employee invite paths |
| Login | `AuthPage.tsx` / `useAuth.ts` | `LoginScreen.tsx` / `useAuth.ts` | ✅ | Same API contract |
| Google login | GIS + `loginWithOAuth` | Native Google Sign-In + OAuth API | ✅ | Different client, same backend |
| MFA login challenge | Redirects to `/platform-admin/login` (`AuthPage.tsx` ~327) | `MfaChallengeScreen.tsx` | 🔴 (web) | **Web bug** — business MFA misrouted. Mobile correct. |
| MFA settings | Business security panel | `SecuritySettingsSection` (`includeMfa` on business) | ✅ | Employee MFA settings lighter on mobile |
| Email verification | `VerifyEmailPage.tsx` | `VerifyEmailScreen.tsx` + deep links | ✅ | Native continuity via `caretip://` |
| Password reset | Forgot/Reset pages | Forgot/Reset screens + deep links | ✅ | |
| Session recovery | Silent bootstrap | `SessionRecoveryScreen` | 🟡 | Mobile explicit UX for offline/timeout |
| Logout | `useAuth.logout` | `sessionManager.signOut` | ✅ | Clears RQ + SecureStore + offline QR |
| Token refresh | `api.ts` 401 → refresh | `client.ts` interceptor | ✅ | |
| Idle timeout | `IdleSessionController` | `IdleSessionBridge` | ✅ | Feature-flagged both |
| Session expiry | Clear session on failed refresh | `SessionExpiryBridge` | ✅ | |

---

## Business onboarding

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| Required fields | name, type, address (>3) | Same validation | ✅ | Comment cites web `managerProfileReadyToFinish` |
| Phone / website | Optional | Optional | ✅ | |
| Logo upload in onboarding | Yes | No | 🟡 | Web branding step; mobile later/web |
| Stripe checkout in onboarding | Optional | No | 🟡 | Mobile billing via handoff later |
| Completion API | Profile + onboarding status | `patchBusinessProfile` + `patchMyOnboardingStatus` | ✅ | |
| Post-complete navigation | Web dashboard / checkout | Native dashboard | 🟡 | Mobile stays in-app |

---

## Business dashboard

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| KPIs (tips, pulse) | `useBusinessDashboardStats` | `useBusinessDashboard` | ✅ | Same `/api/business/me/stats` |
| Stats scope (Basic) | `summary` if !advancedAnalytics | Always `summary` on home | ✅ | Verified `businessStatsScope.ts` |
| Stats scope (Premium home) | `full` when entitled | Still `summary` on home | 🟡 | Charts gated separately on mobile |
| Charts / goals / feedback | FeatureGate entitlements | Tier proxy `premiumTier` | 🟡 | Mechanism differs; surface similar |
| Pull/refresh | Dashboard refresh indicator | Pull-to-refresh | ✅ | |
| Realtime | Dashboard realtime sync | `RealtimeQueryBridge` | ✅ | |

---

## Employee management

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| Roster list | `StaffManagementPage` | `TeamManagementScreen` | ✅ (read) | |
| Invite / create / update / delete | Full CRUD | None | 🟡 | Intentional web-only |
| Role / job title mgmt | Yes | Display only | 🟡 | |
| Goals edit (employee) | Tip goals pages | Monthly goal in employee settings | 🟠 | Manager goals panel view-only on mobile |
| Goals view (manager) | Dashboard + performance | `EmployeeGoalsPanel` (Premium) | ✅ (view) | |

---

## QR Studio

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| Inventory list | Multi-page studio | `QrStudioScreen` | 🟡 | Mobile view/share |
| Branded PNG view | Server pipeline | `brandedQrService` + cache | ✅ | |
| Designer / logo size / templates | Full | None | 🟠 | Web-only |
| Slug regeneration | Yes | Refresh image only | 🟠 | |
| Offline QR cache | N/A | User-scoped AsyncStorage | 🟡 | Mobile+ |
| Tenant isolation | N/A offline | Envelope + regression script | ✅ | Fixed prior Critical |

---

## Tips

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| List + search | `TipsActivityPage` | `TipsListScreen` | ✅ | |
| Filters | Richer (location/staff/custom) | today/week/month + status | 🟡 | Mobile safer for Basic |
| Detail | List-centric | `TipDetailScreen` | 🟡 | Mobile has dedicated detail |
| Pagination | Page controls | Infinite query | ✅ | |
| CSV export | `csvExport` feature | None | 🟠 | Web-only |
| Offline mid-session | None special | Shows RQ cache if pages exist | 🟡 | Mobile improved |

---

## Analytics & insights

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| Analytics KPIs | Tips analytics pages | `BusinessAnalyticsScreen` | ✅ | |
| Performance | Team performance + FeatureGate | `BusinessPerformanceScreen` | ✅ (surface) | |
| Leaderboard | Awards / top performers | Simpler rankings | 🟡 | |
| Customer feedback | Full page + entitlements | Panel + Premium gate | 🟡 | |
| QR analytics | Premium gated | Premium tier gate; not fetched on Basic | ✅ | |
| Entitlement model | `hasFeature` / FeatureGate | `subscriptionTier` proxy | 🟡 | Documented residual |

---

## Notifications

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| Inbox list | Full feed | `NotificationsScreen` | ✅ | |
| Unread + mark read/all | Yes | Yes + optimistic | ✅ | |
| Realtime invalidation | Yes | Yes | ✅ | |
| Push | FCM | Expo push | 🟡 | |
| OS badge | N/A | Synced | 🟡 | Mobile+ |
| Category filters / delete UI | Yes | No delete UI | 🟠 | API exists unused |
| Inbox item deep navigation | `notificationNavigation.ts` | Mark-read only | 🟠 | |
| Auth deep links | Web routes | `DeepLinkBridge` + App Links | ✅ | |

---

## Business profile & branding

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| Edit name/location/phone/website | Yes | Yes | ✅ | |
| Logo upload | Yes | No | 🟠 | |
| Branding colors/templates | Yes | No editor | 🟡 | View branded QR only |
| Verification status chip | Yes | No UI | 🟠 | Sync exists; no display |

---

## Billing

| Feature | Web | Mobile | Status | Notes |
| --- | --- | --- | --- | --- |
| Subscriptions UI | Full | Web handoff | 🟡 | |
| Stripe | Embedded web | Via handoff | 🟡 | |
| Handoff security | N/A | One-time token, not JWT | ✅ | |
| Refresh after payment | Entitlements | Dismiss sync + `billing.updated` | ✅ | |

---

## Settings

| Section | Web | Mobile | Status |
| --- | --- | --- | --- |
| General | Yes | Yes (lighter) | ✅ / 🟡 |
| Appearance / theme | Settings panel | Header theme toggle + language section | 🟡 |
| Business profile | Full | Partial (no logo/verification) | 🟠 |
| Notifications prefs | Yes | Yes | ✅ |
| Security / MFA | Yes | Yes (business) | ✅ |
| Integrations | Stub | Stub | ✅ |
| Billing | In-app | Handoff | 🟡 |
| Team | Full CRUD | Read-only | 🟡 |
| Employee avatar | Upload | Missing | 🟠 |
| Employee privacy export/delete | Yes | Yes | ✅ |
| Legal / about / contact | Yes | Yes | ✅ |

---

## Localization

| Item | Status | Notes |
| --- | --- | --- |
| Mobile en/de key parity | ✅ | Structured `MobileMessages`; catalogs aligned |
| Web-only namespaces | 🟡 | Landing, tip flow, studio, platform admin not on mobile |

---

## Roles

| Role | Web | Mobile | Status |
| --- | --- | --- | --- |
| Guest tipper | Full tip flow | None (browser) | 🟡 |
| Employee | Full core | Full core | ✅ |
| Manager | Full ops | Core ops; CRUD/branding/billing web | 🟡 |
| Platform Admin | Full | Stub (session + logout) | 🟡 |

---

## Summary counts (approximate)

| Status | Count |
| --- | --- |
| ✅ Full Parity | Majority of auth, dashboard KPIs, tips list, notifications core, billing handoff security |
| 🟡 Intentional | Team CRUD, QR designer, guest tip, admin, billing UI, gating mechanism |
| 🟠 Mobile Missing | Logo upload, verification chip, inbox deep links, CSV export, QR designer, employee avatar |
| 🔴 Bug | Web MFA login misroute (web); no remaining Critical mobile scope=`full` bug found |
