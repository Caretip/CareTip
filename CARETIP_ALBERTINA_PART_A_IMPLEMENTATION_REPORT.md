# CareTip — Albertina Part A Implementation Report

Source document: `template/Updates 26.09.pdf` (uploaded 26 Sep 2026).

**Enterprise sections in that document: ON HOLD — NOT IMPLEMENTED IN THIS CHANGE** (no customer/job management, CSV import, Tap to Pay, Enterprise Stripe metadata, white-label PWA, etc.).

---

## 1. Tip success screen / receipt

### Requirements (Part A)

- Remove customer-facing receipt/reference (`Quittung / Receipt CT-26-…`) from the tip-success UI.
- Send the tipper a confirmation email after a successful tip.
- Prefer reusing existing email infrastructure; PDF attachment only if already supported.

### Existing implementation (audit)

| Area | Finding |
|------|---------|
| **CT-… reference** | Secure customer receipt number allocated in `tipReceipt.service.ts` when `Transaction.status` becomes `success` (format `CT-YY-RANDOM8`). Stored on `tips.receipt_number`; used in dashboards and employee analytics. |
| **Customer UI** | `TipSuccessExperience.tsx` showed a collapsible “View receipt” panel with `tipFlow.success.receiptReference` (`Receipt: {{code}}`). Fed by `GET /api/payments/tip-session/:sessionId` → `receiptNumber`. |
| **Checkout flow** | Stripe Checkout `checkout.session.completed` → `handleSuccessfulTipPayment`; legacy `payment_intent.succeeded` can finalize pending rows via `handlePaymentSuccess`. |
| **Guest email** | No guest tip confirmation email existed. `tipFlow.success.emailReceipt` i18n string was unused. No PDF receipt generator for guests. |
| **Email stack** | Resend via `resendClient.ts`; HTML/text templates in `i18nEmail.ts` (EN/DE). Attachments supported in Resend client but no guest receipt PDF pipeline. |
| **Stripe email** | Checkout collects guest email into `customer_details.email` / `customer_email` when the customer completes payment. |

### Gap / root cause

Product showed the receipt reference on the success screen while Albertina’s spec moves confirmation to email. Email was never wired on tip success.

### Changes implemented

- **UI:** Default `showReceipt` to `false`; success pages pass `showReceipt={false}`. Short note uses updated `emailReceipt` copy (checkout email → confirmation sent).
- **Backend:** `tipGuestConfirmationEmail.service.ts` sends EN/DE confirmation via Resend after successful tip commit. Receipt reference remains in **email body** (not PDF). `guestConfirmationEmailSentAt` on `Transaction` prevents duplicate sends; claim released if Resend fails so webhook retries can resend. **Tip success is never rolled back** on email failure.
- **Hooks:** `handleSuccessfulTipPayment` and `handlePaymentSuccess` schedule email asynchronously (`void`).

### Clarification for Albertina / Fanny

- **PDF attachment:** Not implemented — no existing guest receipt PDF. Confirmation is email body + text part with amount, recipient, business, and reference line.
- **No email at checkout:** If Stripe has no email, send is skipped (logged); tip still succeeds.

---

## 2. Google / TripAdvisor feedback

### Requirements

Customer should understand they leave CareTip for a **public** review on Google or TripAdvisor.

### Audit

- Location-level `googlePlaceId` / `tripadvisorReviewUrl` → `toPublicGuestExternalReviews` → `RatingPage` → `GuestExternalReviewLinks`.
- Fallback: internal CareTip star rating when no external links (`guestReviewExperience`).

### Changes

- Updated EN/DE `externalReviewsHint` (explicit “leaving CareTip”).
- Button labels: “Continue to Google” / “Continue to TripAdvisor” with visible sub-hints per destination.
- Minimal CSS for two-line button layout.

No change to location configuration or URL validation.

---

## 3. Field Service & Trades

### Audit

- Route `/industries/field-service` in `industryPages.ts`.
- EN eyebrow: “For field service & trades”; DE: “Für Außendienst & Handwerk”.
- Industry page copy, steps, benefits, FAQ, SEO entries, landing real-life card assets present.

**No code changes required** for Part A — page already matches Albertina’s ENG/GER labels.

---

## Files changed

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | `guestConfirmationEmailSentAt` on `Transaction` |
| `backend/prisma/migrations/20260926120000_tip_guest_confirmation_email/migration.sql` | Column migration |
| `backend/src/emails/i18nEmail.ts` | `buildTipGuestConfirmationContent` |
| `backend/src/services/tipGuestConfirmationEmail.service.ts` | Send + idempotency |
| `backend/src/services/stripe.service.ts` | Schedule email on tip success |
| `backend/scripts/tip-guest-confirmation-email-runtime.ts` | Regression script |
| `backend/package.json` | `test:tip-guest-confirmation-email` |
| `src/app/pages/customer/TipSuccessExperience.tsx` | Hide receipt by default; email note |
| `src/app/pages/customer/SuccessPage.tsx` | `showReceipt={false}` |
| `src/app/pages/customer/TipCompletionPage.tsx` | `showReceipt={false}` |
| `src/app/pages/customer/GuestExternalReviewLinks.tsx` | Destination clarity |
| `src/styles/caretip-customer-flow-premium.css` | External review button hints |
| `src/i18n/locales/en.json`, `de.json` | Copy updates |
| `package.json` | Root test script |

---

## Tests (local run 2026-09-26)

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npx vite build` | Pass |
| `npm run test:tip-guest-confirmation-email` | Pass |
| `npm --prefix backend run test:tip-receipt-format` | Pass |
| `npm --prefix backend run test:external-review-links` | Pass |
| `npm run test:seo-category-p1` | Pass |
| `npm run test:seo-remediation` | Pass |
| `npm run test:seo-head-reconciliation` | Pass |
| `npm run test:external-review-links-frontend` | **Fail** (2 assertions: employee QR boot-handoff / locationId wiring — unchanged by Part A; review-link i18n assertions passed) |

**Deploy note:** apply migration `20260926120000_tip_guest_confirmation_email` before enabling guest confirmation emails in production.

---

## Enterprise (on hold)

All Enterprise workflow items in `Updates 26.09.pdf` after Part A are **ON HOLD — NOT IMPLEMENTED IN THIS CHANGE**.
