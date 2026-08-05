# Deep Link Audit

**Date:** 2026-08-05  
**Scope:** `caretip://`, HTTPS Universal Links / App Links, OAuth, billing return, tip/QR URLs

---

## Executive summary

Native deep linking is **auth-focused**: verify email, reset password, and login handoff. Guest tip/QR/staff journeys are **web**. Android previously claimed **all** HTTPS paths (`pathPrefix: "/"`), which could open the native app for tip URLs the bridge does not route. Intent filters are now narrowed to auth paths only.

---

## Catalog

### Custom scheme `caretip://` (`app.json` scheme)

| URL | Source | Consumer | Status |
| --- | --- | --- | --- |
| `caretip://verify-email?token=` | Backend email (mobile platform) | `DeepLinkBridge` | Supported |
| `caretip://reset-password?token=` | Backend reset email | `DeepLinkBridge` | Supported |
| `caretip://login?emailVerified=1&pendingEmail=` | Web verify success | `DeepLinkBridge` | Supported |

### HTTPS Universal / App Links

| Path | Intent | Status |
| --- | --- | --- |
| `/verify-email` | Native verify | **Claimed** (narrowed) |
| `/reset-password` | Native reset | **Claimed** |
| `/login` | Native login handoff | **Claimed** |
| `/staff/*`, `/qr/*`, tip/payment/rating | Guest web | **Not claimed** (fixed) |
| Billing `/mobile-auth`, `/dashboard/billing/*` | In-app browser | Not a native deep link |

### Other

| Flow | Mechanism | Status |
| --- | --- | --- |
| Google OAuth (mobile) | Native Google Sign-In SDK | No URL return needed |
| Google OAuth (web) | Web Identity | Web only |
| Billing return | Browser dismiss → `syncAuthUserFromServer` + workspace invalidate | **Fixed** in `openBillingWeb` |
| Notification deep link | Warm push tap → inbox route | Not URL-based |
| Tip / QR / staff links | Web routes | Must stay in browser |

### Config

| Item | Location | Notes |
| --- | --- | --- |
| iOS associated domains | `app.json` `applinks:caretip.de` | Requires hosted AASA |
| Android intent filters | `app.json` | **Narrowed** to auth prefixes |
| AASA / assetlinks.json | Not in repo | Must be on caretip.de `/.well-known/` |

---

## Findings & fixes

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| D1 | High | Catch-all HTTPS App Links hijacked tip URLs | Narrow `pathPrefix` to verify-email / reset-password / login |
| D2 | Medium | Billing dismiss did not sync plan | `openBillingWeb` syncs AuthUser + workspace |
| D3 | Medium | AASA/assetlinks not in repo | Ops recommendation |
| D4 | Low | No native inbox URL | Product; push tap covers warm case |

---

## Files modified

- `mobile/app.json` — Android intent filter paths  
- `mobile/utils/openBillingWeb.ts` — post-dismiss sync  

---

## Validation

- [ ] `caretip://verify-email?token=…` opens VerifyEmailScreen  
- [ ] `caretip://reset-password?token=…` opens ResetPasswordScreen  
- [ ] HTTPS tip URL opens **browser**, not empty native shell  
- [ ] Billing handoff → change plan → close tab → Premium gates update without logout  
- [ ] After next native build: confirm App Links only for auth paths
