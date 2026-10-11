# CareTip — QR Studio & Subscription Handoff Cross-Platform Audit

## Status legend

| Label | Meaning |
| --- | --- |
| **AUDITED** | Inspected; documented as-is |
| **IMPLEMENTED** | Changed in this task |
| **TESTED** | Covered by automated and/or documented checks |
| **NOT CHANGED** | Intentionally left alone |
| **REQUIRES OWNER DECISION** | Needs product clarification |

---

## 1. Executive summary

Mobile QR Studio showed the raw key `BUSINESS.BRANDING.DEFAULTTHANKYOUMESSAGE` because the **server QR render bundle** used an i18n stub that returned translation keys and ignored `defaultValue`. Luxury templates then **uppercased** that key. Web browser previews usually looked fine; **mobile/server PNGs did not**.

Subscription Mobile → Web handoff already existed (one-time token, in-app browser, return sync). Copy and a web banner were improved so managers understand they remain in the **same workspace** and can stay on web or return to mobile.

---

## 2. QR audit findings (**AUDITED**)

| Area | Finding |
| --- | --- |
| Onboarding | Collects name, type, address, phone, website; web also uploads logo. No thank-you / colors / templates in onboarding. |
| Branding fields | Logo, colors, welcome/thank-you, display name, tagline, QR template/shape/border (Premium+). |
| Web QR Studio | Full designer + inventory; client canvas render for many surfaces. |
| Mobile QR Studio | Inventory + share + **server-rendered** branded PNG. |
| Tip URL | Shared shapes across web/mobile/backend (`/{slug}`, `/{slug}/{employeeSlug}`, location/table paths). |
| Tenant scope | Manager JWT → own `businessId`; employee → own business; offline cache keyed by `userId`. |
| Subscription | Custom branding requires `brandingCustomization` (Premium/Enterprise). Basic still gets functional CareTip-default QR. |

---

## 3. Default QR issues (**AUDITED** → partially **IMPLEMENTED**)

| Issue | Status |
| --- | --- |
| Raw i18n key on Basic QR thank-you (mobile/server) | **FIXED** |
| Basic shell already has CareTip light default theme (`premium !== true`) | **AUDITED** — kept; sentence-case thank-you on default theme |
| Looks “generic” without logo/custom branding | Softened via correct thank-you + no uppercase on Basic; no full template redesign |
| Paid luxury templates for Premium | **NOT CHANGED** |

---

## 4. Thank-you message issue (**IMPLEMENTED** · **TESTED**)

**Root cause:** `backend/src/qr/stubs/i18n.ts` returned `key` and ignored `defaultValue`. Payload called `i18n.t("business.branding.defaultThankYouMessage", { defaultValue })`. Renderer uppercased the key → `BUSINESS.BRANDING.DEFAULTTHANKYOUMESSAGE`.

**Fix:**

1. Stub honors `defaultValue`.
2. `resolveQrThankYouMessage` / `looksLikeUnresolvedI18nKey` reject key-shaped strings.
3. Helpers live in `src/app/lib/qrThankYouCopy.ts` (re-exported from `businessBranding.ts`).
4. CareTip Basic/default theme no longer forces uppercase on card text.
5. QR render bundle rebuilt (`npm run build:qr-render`).

**Canonical default copy (EN):** *Your appreciation means the world to our team.*  
**DE locale key:** `business.branding.defaultThankYouMessage` (web i18n; server uses English `defaultValue` when stubbed).

---

## 5. Onboarding information audit (**AUDITED**)

| Field | On QR? | Notes |
| --- | --- | --- |
| Business name | Yes | Registered name / brand display name when Premium |
| Address / location | Yes when present | Manager path already passed profile; **employee render path now includes address fields** |
| Logo | Yes if uploaded | Mobile onboarding does not collect logo (**REQUIRES OWNER DECISION** if desired) |
| Thank-you | Yes | Default or Premium custom |
| Phone | Hidden by default | Studio can force show |
| Website / socials | Premium / extras | Basic hides |
| Business type | No | Not a public QR field by design |

---

## 6. Web vs Mobile comparison (**AUDITED**)

| Concern | Web | Mobile | Intentional? |
| --- | --- | --- | --- |
| Tip destination URL | Same conventions | Same | Yes |
| PNG render host | Often client canvas | Server branded API | Platform difference |
| Branding designer | Yes | No | Intentional |
| Default thank-you | Browser i18n OK | Was broken via stub | Accidental → **FIXED** |
| Address on employee PNG | Profile-aware when loaded | Was name-only | Accidental → **FIXED** |

---

## 7. Subscription / Web handoff audit (**AUDITED** → UX **IMPLEMENTED**)

| Item | Finding |
| --- | --- |
| Entry points | Settings → Billing; gated “Manage plan” EmptyStates; `AccessErrorState` on subscription-required |
| Mechanism | `POST /api/mobile/create-billing-session` → one-time token URL → `expo-web-browser` → `/mobile-auth` → `/dashboard/billing/subscription` |
| Tokens in URL | One-time handoff token only (90s, hash-at-rest). **Not** mobile JWT. |
| Return | Browser dismiss → poll sync-status (~16s) → invalidate workspace queries; AppState boost; realtime `billing.updated` |
| Workspace management handoff | **Does not exist** (billing purpose only) |
| Deep-link “return to app” after Stripe | **Not implemented** |

**Copy / banner updates:** clearer mobile confirm Alert; web dismissible banner after handoff; return overlay wording “Refreshing your workspace…” (no false “subscription successful” solely on return).

---

## 8. Changes implemented

1. Fix Node QR i18n stub + thank-you key sanitization.
2. Rebuild `backend/dist/qr-render.bundle.mjs`.
3. Sentence-case thank-you on CareTip Basic default QR shell.
4. Employee branded QR profile includes address/location/phone/website.
5. Mobile billing handoff EN/DE copy improvements.
6. Web `MobileBillingHandoffBanner` after `/mobile-auth` consume.
7. Regression scripts for thank-you + handoff copy.

---

## 9. Files changed

| File | Role |
| --- | --- |
| `backend/src/qr/stubs/i18n.ts` | Honor `defaultValue` |
| `backend/dist/qr-render.bundle.mjs` (+ assets) | Rebuilt render bundle |
| `backend/src/services/qr/brandedQrRender.service.ts` | Employee profile address parity |
| `src/app/lib/qrThankYouCopy.ts` | Thank-you helpers |
| `src/app/lib/businessBranding.ts` | Re-exports |
| `src/app/lib/qrTemplateEngine/renderer.ts` | No uppercase on Basic default |
| `src/app/pages/MobileAuthHandoffPage.tsx` | Mark handoff banner |
| `src/app/pages/business/billing/BusinessBillingLayout.tsx` | Show banner |
| `src/app/components/business/billing/MobileBillingHandoffBanner.tsx` | New |
| `src/i18n/locales/en.json`, `de.json` | Banner strings |
| `mobile/i18n/locales/en.ts`, `de.ts` | Handoff Alert copy |
| `mobile/scripts/billing-handoff-runtime.ts` | Copy assertions |
| `scripts/qr-thankyou-runtime.ts` | Thank-you regression |
| `package.json` | `test:qr-thankyou` |
| `docs/QR_STUDIO_AND_SUBSCRIPTION_HANDOFF_AUDIT.md` | This report |

---

## 10. Tests performed

| Test | Result |
| --- | --- |
| `npm run test:qr-thankyou` | **PASS** |
| `npm run typecheck` (web) | **PASS** |
| `npm --prefix mobile run test:billing-handoff` | **PASS** |
| `npm --prefix mobile run typecheck` | **PASS** |
| `npm --prefix backend run build:qr-render` | **PASS** |
| Device QR scan / Mobile→Web E2E | **NOT VERIFIED** (device E2E) |
| Visual print of Basic QR | **NOT VERIFIED** |

---

## 11. Security / tenant-isolation checks (**AUDITED** · **NOT CHANGED** architecture)

| Check | Result |
| --- | --- |
| QR tip URL business-scoped | Yes (slug / ownership services) |
| Manager branding from JWT business | Yes |
| Handoff: no access/refresh JWT in URL | Yes |
| Handoff: purpose allowlist → billing only | Yes |
| Same user/workspace after consume | Yes (multi-session; mobile session kept) |
| No new payment / auth architecture | Yes |

**Note (existing):** manager branded render encodes caller-supplied `targetUrl` with that manager’s branding; ownership of the URL’s slug/IDs is not re-validated at render time. Documented only — **NOT CHANGED** in this task (**REQUIRES OWNER DECISION** if hardening desired).

---

## 12. Remaining issues (**REQUIRES OWNER DECISION**)

1. **Mobile onboarding logo** — web collects logo; mobile onboarding does not. Should native onboarding upload logos?
2. **Server QR language** — Node stub uses English `defaultValue`; locale-aware server QR would need injecting UI locale into the render bundle.
3. **Deep-link return after Stripe checkout** — currently relies on dismissing the in-app browser.
4. **Manager `targetUrl` ownership check** on branded PNG render.
5. **Further Basic QR visual redesign** beyond thank-you / casing — only if product wants a distinct Basic template vs current CareTip light shell.
6. **Studio extras (CTA/socials)** live in web localStorage — not shared to mobile server PNGs; confirm if that should sync via API.

---

## NOT CHANGED (explicit)

Authentication/OAuth, GDPR lifecycle/deletion/export, tip payment processing, Stripe architecture, tenant isolation model, dashboard redesign, splash/loading, navigation structure, Premium luxury template gallery, guest tip flow (except shared thank-you helper hardening).
