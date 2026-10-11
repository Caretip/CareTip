# CARETIP QR Language & Tip Confirmation Email Audit

## 1. Issue Summary

Guests completing the QR tipping flow in German received English tip confirmation emails. The QR journey had no dedicated EN/DE control; UI language followed `boot-locale.js` / `localStorage` (`caretip_i18n_language`, default `de`), but that choice was **not** sent to Stripe or the confirmation-email pipeline.

## 2. QR Customer Journey Architecture

| Step | Route(s) | Component |
|------|----------|-----------|
| Business / table slug QR | `/table/:qrSlug`, `/qr-landing/:businessId?` | `QRLandingPage` |
| Table QR | `/qr/table/:tableId` | `TableQrLandingPage` |
| Location QR | `/qr/location/:locationId` | `LocationQrLandingPage` |
| Employee QR | `/qr/employee/:employeeId` | `EmployeeQrEntryPage` → `/tip-amount` |
| Staff public path | `/staff/:slug`, directory routes | `StaffLandingPage`, `BusinessStaffDirectoryPage`, etc. |
| Tip amount + email | `/tip-amount` | `TipAmountPage` |
| Legacy payment redirect | `/payment` | `PaymentPage` → `/tip-amount` |
| Stripe return | `/rating` | `RatingPage` |
| Completion | `/tip-complete`, `/success` | `TipCompletionPage`, `SuccessPage` |

Checkout: `startGuestTipCheckout` → `POST /api/payments/create-tip-session` → Stripe Checkout → webhook → tip record + guest confirmation email.

## 3. Current Language Handling (before fix)

- **Init:** `boot-locale.js` + `readDocumentOrStoredLanguage()` / `ensureI18nReady()` (`src/i18n/i18n.ts`). Default product locale **de** when unset.
- **Persistence:** `localStorage` key `caretip_i18n_language`; `languageChanged` updates `document.documentElement.lang`.
- **QR landing:** No guest-specific language switch; marketing `LanguageSwitcher` only on public nav/footer (not on QR team-picker layouts).
- **Checkout API:** No `locale` field in request body.
- **Stripe:** Checkout sessions created without `locale` or `metadata.locale`.
- **Email:** `resolveEmailLocaleFromCheckoutSession` used `session.locale` (Stripe default, typically **en**) then fell back to **en** — not guest UI language.

## 4. QR Language Switch Findings

- **Gap:** Customer journey headers (`CustomerJourneyHeader` / `CustomerFlowShell`) had no language control.
- **Fix:** `CustomerJourneyLanguageSwitcher` (EN | DE segmented control) on every `CustomerJourneyHeader` toolbar; employee QR repeat-tip entry gets the same control in a sticky bar.

## 5. Exact Email Flow

1. Guest pays via Stripe Checkout (`checkout.session.completed` webhook).
2. `stripe.service` records successful tip → `scheduleTipGuestConfirmationEmailForCheckoutSession(transactionId, session, paymentIntent)`.
3. `tipGuestConfirmationEmail.service` resolves email from session/PI, claims idempotent send on `Transaction.guestConfirmationEmailSentAt`.
4. `buildTipGuestConfirmationContent({ locale, ... })` in `backend/src/emails/i18nEmail.ts` → Resend via `sendResendEmail("tip-guest-confirmation", ...)`.

## 6. Current Language Source (after fix)

**Authoritative:** Guest’s active i18n locale at checkout (`getGuestTipPresentationLocale()` → `en` | `de`), sent as `locale` on `create-tip-session`, stored on Stripe Checkout `metadata.locale`, `payment_intent_data.metadata.locale`, and Checkout `locale` for hosted page copy.

**Email resolution order:**

1. `session.metadata.locale` (normalized)
2. `session.locale` (Stripe)
3. Default **en** (`resolveEmailLocale({})`)

PaymentIntent-only path: `paymentIntent.metadata.locale` with same normalization.

## 7. Exact Root Cause

**Primary:** **A + H + D** — Frontend UI used i18n but did not send locale to the API; QR landing had no explicit switch; email used Stripe `session.locale` / English default.

**Boundary where locale was lost:** `POST /api/payments/create-tip-session` → Stripe Checkout Session creation (no `metadata.locale`).

## 8. Where Locale Was Lost/Overridden

- Lost at API boundary on tip session creation.
- Overridden at email time by `resolveEmailLocaleFromCheckoutSession` preferring Stripe’s default `session.locale` (English) over unstored guest UI language.

## 9. Async/Webhook Analysis

Email sends **after** webhook success; no browser session required. Locale now lives on Stripe session + PI metadata, available when the webhook runs. No new DB column (presentation metadata only).

## 10. Email Template Analysis

`buildTipGuestConfirmationContent` already supports **en** and **de** (subject, HTML, text, receipt reference). No new templates added.

## 11. Implementation

### QR language switch

- `CustomerJourneyLanguageSwitcher.tsx` — uses `changeAppLanguage` / existing bundles.
- Wired in `CustomerJourneyHeader` (all QR landings using that header + `CustomerFlowShell`).

### Confirmation email

- `getGuestTipPresentationLocale()` + `locale` on checkout API.
- `parseTipGuestPresentationLocale` server-side validation.
- Stripe session + PI metadata + Checkout `locale`.
- `resolveEmailLocaleFromCheckoutSession` prefers `metadata.locale`.

## 12. QR Language Switch Implementation

Mobile-friendly EN/DE toggle in sticky header toolbar; touch targets ≥ 40px; styles in `caretip-customer-flow-premium.css` (`.customer-journey-lang-switch`). Switching language does not alter route params, `TipFlowContext`, or QR identifiers.

## 13. Database/API Changes

- **API:** Optional `locale` on `POST /api/payments/create-tip-session` (`en` | `de` only).
- **Database:** None.

## 14. Fallback Behavior

| Input | Email / Stripe |
|-------|----------------|
| `de` | German |
| `en` | English |
| Omitted | No metadata; Stripe default; email → **en** |
| `fr`, `xyz`, etc. | Ignored (`null`); same as omitted |

## 15. Security/Validation

`parseTipGuestPresentationLocale` only allows `en` / `de`. Locale does not affect amounts, routing, fees, or payout logic.

## 16. Responsive/Mobile Review

Switcher constrained (`max-width: 8.5rem`), in header toolbar — does not cover primary CTAs. Intended for 320–430px QR viewports (code review; manual device pass recommended).

## 17. SEO/Route Safety

No changes to robots, noindex, or public SEO routes. Customer routes remain non-marketing transaction flows.

## 18. Tests Executed

| Command | Result |
|---------|--------|
| `npm run test:qr-guest-tip-locale` | **Pass** (8 checks) |
| `npm run test:tip-guest-confirmation-email` | **Pass** (12 checks) |
| `npm run typecheck` (frontend) | **Pass** (`tsc --noEmit`) |
| `npm run build` (frontend) | Not confirmed complete in local run (long prebuild); typecheck covers TS |
| `npm run build` (backend) | **Blocked** — Windows `EPERM` on Prisma engine rename (environment lock), not code |

## 19. Test Results

Runtime scripts and frontend typecheck succeeded. Backend `tsc` not separately confirmed due to slow/locked local Prisma client on Windows; changes are limited to typed TS modules covered by runtime imports in `test:qr-guest-tip-locale`.

## 20. Manual Verification

Not performed in this environment (no staging QR + live Resend). Recommended: Tests A–D from spec on staging; verify Resend payload subject/body language if live send is disabled.

## 21. Files Changed

- `src/app/pages/customer/CustomerJourneyLanguageSwitcher.tsx` (new)
- `src/app/pages/customer/CustomerJourneyHeader.tsx`
- `src/app/pages/customer/EmployeeQrEntryPage.tsx`
- `src/app/lib/guestTipPresentationLocale.ts` (new)
- `src/app/lib/startGuestTipCheckout.ts`
- `src/app/lib/api.ts`
- `src/styles/caretip-customer-flow-premium.css`
- `backend/src/controllers/payment.controller.ts`
- `backend/src/services/stripe.service.ts`
- `backend/src/services/tipGuestConfirmationEmail.service.ts`
- `backend/src/emails/i18nEmail.ts`
- `backend/scripts/tip-guest-confirmation-email-runtime.ts`
- `scripts/qr-guest-tip-locale-runtime.ts` (new)
- `package.json` (test script)

## 22. Files Not Changed

Stripe payment amounts/fees, payout scheduling, marketing `LanguageSwitcher`, unrelated transactional emails, Prisma schema.

## 23. Remaining Limitations

- Locale not stored on `Transaction` row (relies on Stripe metadata at webhook time).
- Legacy tips without `metadata.locale` still email in English unless Stripe `session.locale` was German.
- Manual staging + real inbox verification still required.

---

### Direct answers

| Question | Answer |
|----------|--------|
| Where does the guest select language? | EN/DE toggle in customer journey header (QR landings, tip amount, rating, etc.). |
| What language does tipping UI use? | Active `i18next` locale (`en` / `de`). |
| How is language preserved? | `localStorage` + checkout `locale` API field. |
| Where was locale lost? | Tip session creation (not sent to backend/Stripe). |
| What determines email language? | `metadata.locale` on Checkout session, then `session.locale`, else en. |
| Missing locale? | English email default. |
| Invalid locale? | Stripped server-side; treated as missing. |
| Async Stripe/email? | Yes — locale on session/PI metadata survives webhook. |
| Mobile switch? | Yes — header toolbar control. |
| Preserves QR context? | Yes — language only changes i18n, not routes or tip state. |

## FINAL STATUS

**FIXED — READY FOR REVIEW**
