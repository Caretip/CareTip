# CareTip Customer Journey — UX Simplification Audit

**Date:** 2026-08-27  
**Scope:** Unauthenticated customer tipping journey (tip selection → payment → Stripe checkout → success / tip-complete)  
**Status:** UX/UI simplification implemented; payment architecture unchanged

---

## 1. Executive summary

The customer tipping journey was audited end-to-end and simplified toward a **Choose → Review → Pay → Done** flow. Changes are presentation-only: fewer cards, one Stripe security explanation on the payment step, a flatter success page with a **collapsed-by-default** accessible receipt, and CareTip branding as a page-surface footer rather than a card.

**Not changed:** Stripe Checkout session creation/redirect, tip/amount calculations, webhooks, auth, API contracts, receipt generation logic, or supported payment method labels (Apple Pay, Google Pay, Credit/Debit Card).

---

## 2. Customer journey routes / components audited

| Step | Route | Primary components |
|------|-------|--------------------|
| Tip selection / custom tip | `/tip-amount` | `TipAmountPage`, `CustomerFlowShell`, `CustomerJourneyHeader` |
| Payment summary + methods | `/payment` | `PaymentPage`, `PaymentMethodsAvailable` |
| Stripe Checkout | External Stripe URL | `createTipCheckoutSession`, `performExternalStripeRedirect` (logic untouched) |
| Payment processing | `/success` (loading) | `TipPaymentProcessingView`, `useVerifiedTipSession` |
| Success / thank-you | `/success` | `SuccessPage` → `TipSuccessExperience` |
| Optional feedback | `/rating` | `RatingPage` (actions preserved; not redesigned) |
| Post-feedback completion | `/tip-complete` | `TipCompletionPage` → `TipSuccessExperience` |

**Shared:** `CustomerFlowShell`, `CustomerJourneyCareTipAttribution`, `customerFlowUi.ts`, `customerJourneyHeaderCopy.ts`, `caretip-customer-flow-premium.css`, `tipFlow.*` i18n (en/de).

Canonical path: QR/slug entry → tip amount → payment → Stripe → success → (optional rating) → tip-complete.

---

## 3. UX issues discovered

| Issue | Where |
|-------|--------|
| Stacked large cards for tip presets, custom tip, and selected amount | `TipAmountPage` |
| Duplicate amount lines (tip amount + amount to pay when identical) | `PaymentPage` |
| Repeated Stripe copy (header hint + method description + stripe note + trust card) | `PaymentPage` + header copy |
| Method rows with redundant per-method descriptions | `PaymentMethodsAvailable` |
| CareTip attribution in a bordered/shadowed card strip | `customerJourneyAttribution` |
| Success page as one heavy card with expanded receipt + Stripe trust lines | `TipSuccessExperience` |
| Oversized success headline / vertical padding encouraging scroll | success CSS + shell spacing |

---

## 4. Repetitive content identified

**Payment step (before):**

1. Header: “Secure checkout powered by Stripe.”
2. Methods card description: “Continue to Stripe checkout…”
3. Note: card details on Stripe’s secure page
4. Trust card: “Secure payment” + Stripe processes wallets/cards

**After:** Header is non-Stripe review copy; **one** body line uses `tipFlow.payment.secureCheckoutNote`. Legacy keys (`stripeCardNote`, `secureBody`, `selectMethodDesc`) remain in locale files for safety but are **not rendered** on the payment page.

**Success step (before):** “Payment completed” + “Secure payment powered by Stripe” + always-visible receipt + tip amount card.

**After:** Status “Payment successful”, thank-you hierarchy, recipient block; Stripe trust line removed from success; tip amount lives inside expandable receipt (or a single quiet line if no receipt number).

---

## 5. Cards / containers removed and why

| Removed / flattened | Why |
|---------------------|-----|
| Tip amount “Quick select” + “Custom tip” + accent summary cards | Presets and custom input are the interaction; wrapping cards did not add hierarchy |
| Payment methods `Card` + trust `Card` | Methods list + one security line are enough |
| Duplicate tip-amount line inside payment summary | Same value as amount to pay |
| CareTip attribution card chrome | Branding should sit on the page surface |
| Success outer celebration card + summary meta card | Confirmation reads better as page content |
| Recipient bordered box on success | Label + name/role do not need a nested card |

**Kept (intentional):** Tip preset tiles (selectable controls); light payment summary surface (groups who + amount); payment method rows (scannable list).

---

## 6. Stripe / payment messaging consolidated

| Location | Messaging |
|----------|-----------|
| Payment header trust | `completePaymentHint` → review/continue (no Stripe) |
| Payment body (single line) | `secureCheckoutNote` |
| Success | No Stripe trust line |
| Checkout redirect loader | Existing redirect copy unchanged (functional state) |

Payment method **names** retained: Apple Pay, Google Pay, Credit/Debit Card. Selection still occurs on Stripe Checkout (informational list only).

---

## 7. Thank-you page improvements

Primary hierarchy in `TipSuccessExperience`:

1. Check affordance + **Payment successful**
2. **Thank you!** (headline)
3. Supporting thank-you / tip-received copy (existing branded or i18n message)
4. **Tip sent to** + employee name / role
5. Collapsible receipt
6. Existing primary/secondary actions only (`leave feedback` / `back home` on `/success`; `tip another` / `exit` on `/tip-complete`)
7. Flat CareTip attribution footer

No new dashboard/account navigation added.

---

## 8. Receipt collapse implementation

- Default: **collapsed**
- Collapsed row: `Receipt: {{code}}` via `tipFlow.success.receiptReference`
- Toggle: button with `aria-expanded`, `aria-controls`, region label, sr-only expand/collapse strings
- Expanded: tip amount (when present) + receipt code
- Subtle chevron rotation; respects `useReducedMotion`
- Receipt data/API unchanged

---

## 9. Mobile responsiveness improvements

- Reduced shell vertical padding / bottom CTA bar padding
- Smaller tip preset min-heights on narrow viewports
- Compact payment method rows (name only)
- Success headline clamped smaller; ambient particles removed from success (ambient wash kept)
- Attribution and success padding tightened to reduce forced scroll

**Widths considered in layout tokens:** 320–412px class of phones via existing `sm:` breakpoints and fluid type; no separate duplicate mobile components.

**Desktop:** Same components; max-width containers (`max-w-xl` / `max-w-lg`) preserved.

---

## 10. Files changed

| File | Change |
|------|--------|
| `src/app/pages/customer/TipAmountPage.tsx` | Single section; no stacked cards |
| `src/app/pages/customer/PaymentPage.tsx` | Flattened summary/methods; one Stripe note |
| `src/app/components/payments/PaymentMethodsAvailable.tsx` | Names only |
| `src/app/pages/customer/TipSuccessExperience.tsx` | Flat surface; collapsible receipt; simplified hierarchy |
| `src/app/pages/customer/customerFlowUi.ts` | Attribution footer; payment/spacing tokens |
| `src/app/pages/customer/CustomerFlowShell.tsx` | Attribution spacing |
| `src/app/pages/customer/customerJourneyHeaderCopy.ts` | Comment clarifying Stripe placement |
| `src/styles/caretip-customer-flow-premium.css` | Success surface + receipt styles |
| `src/i18n/locales/en.json` | New/updated copy keys |
| `src/i18n/locales/de.json` | Matching DE copy |
| `docs/CUSTOMER_JOURNEY_UX_AUDIT.md` | This deliverable |

---

## 11. Tests performed and results

| Check | Result |
|-------|--------|
| `npm run typecheck` | Completes with **pre-existing** errors in unrelated modules (`fcmPush`, `qrPdfLazy`, `saas-3d-hero`); **no errors** reported in the customer-journey files listed above |
| `npm run test:qr-thankyou` | **OK** |
| `npm run test:stripe-connect-phase4-5-ui` | Unrelated Connect UI assertion failed (`Connect card must surface charges/payouts disabled copy`); PaymentPage friendly-error check still present in that suite |
| Manual full Stripe E2E (select tip → pay → expand receipt) | **Not run in this session** (requires live Stripe test checkout + browser) |
| Visual check at 320/360/375/390/412 | **Code/CSS review only** — browser device emulation not executed here |

---

## 12. Remaining UX issues requiring your decision

1. **Success page secondary CTA on `/success`:** Still offers “Leave optional feedback” + “Back to home”. Keep both, drop home, or demote feedback?
2. **QR / staff landing Stripe footer** (`tipFlow.qrLanding.secureFooter`): Still says “Secure payment powered by Stripe” on entry screens. Leave as journey-entry trust, or remove so Stripe appears only on `/payment`?
3. **Locale coverage:** Copy updates applied to **en** and **de**. Other locale files (if any) may fall back until translated.
4. **Unused i18n keys:** `selectMethodDesc`, `stripeCardNote`, `secureTitle`, `secureBody`, method `*Desc` keys are unused on the payment UI; safe to delete later or keep for future reuse.
5. **Live mobile QA:** Confirm fixed bottom CTA clearance and receipt keyboard focus in a real device browser after deploy.

---

## Second-pass UX search (post-implementation)

| Check | Status |
|-------|--------|
| Repeated Stripe messaging on `/payment` | Cleared to one `secureCheckoutNote` |
| Stripe trust on success | Removed |
| Repeated tip amount cards on payment | Single amount-to-pay |
| Unnecessary CareTip card | Flattened to footer |
| Success receipt dominating viewport | Collapsed by default |
| Payment / tip / success payment logic | Unchanged (verified by code review of handlers) |
