# CareTip Mobile — Final Release Verification Checklist

**Date:** 2026-08-05  
**Use before:** External penetration testing · Production iOS/Android store builds  
**Environments:** Staging API (HTTPS) · Production API (HTTPS) · Physical devices (iOS + Android)

Mark each item only after observed behavior on a **current** build of this repository.

---

## 0. Pre-build gates

- [ ] `cd mobile && npm run typecheck` passes  
- [ ] `npx tsx mobile/scripts/business-stats-scope-regression.ts` passes  
- [ ] `npx tsx mobile/scripts/offline-qr-tenant-isolation-regression.ts` passes  
- [ ] EAS project logged in (`eas whoami`)  
- [ ] `EXPO_PUBLIC_API_URL` (HTTPS) set for target env  
- [ ] Android App Links rebuilt after `app.json` pathPrefix change  
- [ ] iOS AASA hosted and lists only auth paths (verify-email, reset-password, login)  
- [ ] Digital Asset Links matches Android package + SHA256  

---

## 1. Manager journey

- [ ] Signup (email) succeeds  
- [ ] Verify email via `caretip://` / HTTPS → lands in native verify/login  
- [ ] Google signup/login works  
- [ ] Native onboarding (name, type, address) validates like web  
- [ ] Offline onboarding save shows offline error (no stuck spinner)  
- [ ] After onboard, Basic dashboard loads KPIs (not “Not available on this account”)  
- [ ] Admin approval while app backgrounded → foreground → state updates  
- [ ] Kill/reopen → correct business name + QR tenant  
- [ ] Logout/login → no prior venue QR  
- [ ] Tips list + detail  
- [ ] Notifications: receive, badge, mark read, mark all  
- [ ] QR Studio: branded/standard display, share, offline mid-session  
- [ ] Analytics: Basic upgrade CTA for QR analytics; Premium full when entitled  
- [ ] Billing handoff → change plan → dismiss → Premium unlocks without reinstall  
- [ ] Profile edit updates dashboard name; branded QR refreshes  

---

## 2. Employee journey

- [ ] Login / Google / MFA (if enabled)  
- [ ] Dashboard tips KPIs  
- [ ] Tips list filters + detail  
- [ ] Notifications + badge clear on logout  
- [ ] Employee QR offline cache scoped to user  
- [ ] Settings: profile, language, notifications, security, privacy export/delete  
- [ ] Logout  

---

## 3. Guest (web — must not break)

- [ ] Tip HTTPS URL opens **browser**, not empty native app  
- [ ] QR scan → tip → Stripe → feedback → complete  

---

## 4. Platform Admin (web)

- [ ] Login + MFA  
- [ ] Approve business → mobile receives update  
- [ ] Impersonate / revoke  
- [ ] Mobile SUPER_ADMIN stub only (expected)  

---

## 5. Cross-device / lifecycle

- [ ] Cold start authenticated  
- [ ] Warm start  
- [ ] Background → foreground sync  
- [ ] App killed → restore  
- [ ] Deep link verify / reset / login  
- [ ] Warm push tap → inbox  
- [ ] Offline mid-session tips show cache; reconnect refreshes  
- [ ] Session recovery UI when offline at cold start  
- [ ] Idle timeout / session expiry → login  
- [ ] Token refresh after long idle  

---

## 6. Security smoke

- [ ] Access/refresh tokens only in SecureStore (not AsyncStorage prefs)  
- [ ] Account A offline QR never appears for account B  
- [ ] Billing URL contains handoff token only (not access JWT)  
- [ ] Socket connects only when authenticated  
- [ ] Permission EmptyState only for true role denial; subscription shows upgrade  

---

## 7. Performance smoke

- [ ] Login → logout → login ×10: no duplicate push navigation  
- [ ] Resume does not freeze UI  
- [ ] Dashboard first paint acceptable on mid-range device  

---

## 8. Sign-off

| Role | Name | Date | Result |
| --- | --- | --- | --- |
| Engineering | | | Pass / Fail |
| QA | | | Pass / Fail |
| Product | | | Pass / Fail |
| Security (pentest kickoff) | | | Authorized / Hold |

**Build IDs:** Android ______ · iOS ______ · API ______
