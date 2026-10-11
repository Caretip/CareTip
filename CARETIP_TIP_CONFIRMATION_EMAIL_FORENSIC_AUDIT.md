# CareTip tip confirmation email — production forensic audit

**Audit date:** 2026-09-27  
**Scope:** Read-only review of repository code and configuration references. No production, Resend, or Stripe dashboard access was performed unless stated.

---

## 1. Expected behavior (from codebase)

### What “tip confirmation email” means here

CareTip sends a **guest/tipper-facing transactional email** after a **successful tip** is recorded. It is **not** the employee or business notification; it is **not** the in-app notification inbox; it is **not** automatically the same as Stripe’s receipt email (though Stripe may also email when `receipt_email` is set).

| Question | Answer (code-defined) | Evidence |
|----------|----------------------|----------|
| **Recipient** | **Tipper / guest (customer)** only | `scheduleTipGuestConfirmationEmailForCheckoutSession` resolves `to` from checkout session / PI and calls `sendResendEmail(..., { to: [input.to] })` — `backend/src/services/tipGuestConfirmationEmail.service.ts` |
| **When sent** | After tip row exists with **`status: "success"`**, triggered from Stripe webhook handlers (not at session creation) | `void scheduleTipGuestConfirmationEmailForCheckoutSession(...)` immediately after `transaction.create` in `handleSuccessfulTipPayment` — `backend/src/services/stripe.service.ts` (~1297–1299); `claimGuestConfirmationSend` requires `status: "success"` — `tipGuestConfirmationEmail.service.ts` |
| **Successful tip** | `Transaction` (table `tips`) row with `status: "success"`, created from **`checkout.session.completed`** when `session.payment_status === "paid"` (primary guest Checkout path), or `pending` → `success` via **`payment_intent.succeeded`** (legacy/pending path only) | `handleSuccessfulTipPayment` guards — `stripe.service.ts` (~1084–1087, 1265–1295); `handlePaymentSuccess` — (~890–895, 973–1049) |
| **CareTip vs Stripe** | **CareTip** builds HTML/text via `buildTipGuestConfirmationContent` and sends via **Resend**. **Stripe** may separately send a **payment receipt** when `payment_intent_data.receipt_email` is set at Checkout creation | `createTipCheckoutSession` — `stripe.service.ts` (~636–666); template — `backend/src/emails/i18nEmail.ts` (`buildTipGuestConfirmationContent`, ~709–757) |

### CareTip state machine (payment vs tip)

| Stage | CareTip behavior | Mark |
|-------|------------------|------|
| Checkout session **created** | No email | PASS (by design) |
| Payment **processing** | No tip email | PASS |
| **`checkout.session.completed`** + `payment_status: paid` | Tip insert attempted | PASS (primary path) |
| **`payment_intent.succeeded`** | Email only if a **`pending`** tip exists for that PI; guest Checkout creates **`success`** directly, so this path usually **does not** send guest confirmation | PARTIAL |
| Tip record **`success`** | Email scheduled (if wired + email resolvable) | See §9–17 |

---

## 2. End-to-end production flow (traced)

Legend: **PASS** = wired in repo; **PARTIAL** = conditional / alternate path; **FAIL** = known gap; **NOT VERIFIED** = needs live env.

| Step | Component | Details | Status |
|------|-----------|---------|--------|
| 1 | Guest opens QR / tip journey | Frontend routes → `TipAmountPage` | PASS |
| 2 | Optional email + amount | `guestEmail` optional; passed to `startGuestTipCheckout` → `POST /api/payments/create-tip-session` | PASS (working tree); **NOT VERIFIED** on deployed SPA if old build |
| 3 | Create Checkout | `payment.controller.createTipSession` → `createTipCheckoutSession` | PASS |
| 4 | Stripe fields for email | If normalized `guestEmail`: `customer_email` + `payment_intent_data.receipt_email` | `stripe.service.ts` (~636–666) | PASS (working tree) |
| 5 | Customer pays | Stripe Hosted Checkout | NOT VERIFIED |
| 6 | Webhook | `POST /api/webhooks/stripe` or `/api/webhook` — raw body | `backend/src/index.ts` (~142–144), `stripe.webhook.ts` | PASS |
| 7 | Event | **`checkout.session.completed`** → `handleSuccessfulTipPayment(session)` | `stripe.webhook.ts` (~143–153) | PASS |
| 8 | Guards | `payment_status === "paid"`, EUR, PI id, no duplicate PI, Connect/eligibility, metadata `employeeId` / `businessId` | `stripe.service.ts` (~1084–1240) | PASS |
| 9 | DB | `transaction.create` with `status: "success"`, receipt number, payables | (~1277–1295) | PASS |
| 10 | Email trigger | `void scheduleTipGuestConfirmationEmailForCheckoutSession(tip.id, session, paymentIntent)` — **fire-and-forget** | (~1299) | PASS (working tree) |
| 11 | Recipient | `resolveGuestEmailFromCheckoutSession`: `customer_details.email` → `customer_email` → `paymentIntent.receipt_email` | `tipGuestConfirmationEmail.service.ts` (~18–27) | PASS |
| 12 | No email | Logs `[tip-guest-confirmation] skipped_no_email` and **returns** | (~114–117) | PASS |
| 13 | Idempotency | `claimGuestConfirmationSend` sets `guestConfirmationEmailSentAt`; on send failure, `releaseGuestConfirmationClaim` | (~53–70, 120–137) | PASS |
| 14 | Template | `buildTipGuestConfirmationContent` (EN/DE) | `i18nEmail.ts` | PASS (working tree) |
| 15 | Resend | `sendResendEmail("tip-guest-confirmation", ...)` — no throw on failure | `resendClient.ts` (~121–190) | PASS |
| 16 | Webhook idempotency | `markStripeWebhookEventProcessed` after handler | `stripe.webhook.ts` (~255–260) | PASS |
| 17 | Delivery observability | Console logs only; **no** Resend message ID in DB | — | PARTIAL |

### Alternate path: `payment_intent.succeeded`

- Handler: `handlePaymentSuccess` — `stripe.webhook.ts` (~168–170).  
- Guest confirmation: `scheduleTipGuestConfirmationEmailForPaymentIntent` only after promoting **`pending`** → **`success`** — `stripe.service.ts` (~1048–1049).  
- Guest Checkout that creates **`success`** in `handleSuccessfulTipPayment` leaves **no** `pending` row → PI handler **returns early** (~893–895).  
- **Status:** PARTIAL — correct for Checkout-first model; must not rely on PI event for guest tips.

### Failure handling (tip vs email)

- Tip persistence errors can return **500** from webhook (Stripe retries).  
- Email errors **do not** fail the webhook or tip — `sendResendEmail` returns `boolean`; failures log `delivery_failed` and release claim.  
- **Status:** PASS (by design), with recovery gaps in §14.

---

## 3. Previous “fix” (Albertina Part A)

### What was added (working tree)

| Artifact | Role |
|----------|------|
| `backend/src/services/tipGuestConfirmationEmail.service.ts` | **New** — resolve email, claim/release, Resend send |
| `backend/src/services/stripe.service.ts` | Imports schedulers; `guestEmail` → Stripe; `void schedule...` after success |
| `backend/src/controllers/payment.controller.ts` | Accepts `guestEmail` on `create-tip-session` |
| `backend/src/emails/i18nEmail.ts` | `buildTipGuestConfirmationContent` |
| `backend/prisma/schema.prisma` | `guestConfirmationEmailSentAt` on `Transaction` |
| `backend/prisma/migrations/20260926120000_tip_guest_confirmation_email/migration.sql` | `ALTER TABLE "tips" ADD COLUMN guest_confirmation_email_sent_at` |
| `backend/scripts/tip-guest-confirmation-email-runtime.ts` | Static wiring test (`npm run test:tip-guest-confirmation-email`) |
| Frontend | `TipAmountPage` optional email; `startGuestTipCheckout` / `api.ts` pass `guestEmail` |
| UI | Success UI hides receipt by default (`showReceipt={false}`) — receipt in **email** instead |

### Git / deployment evidence

At audit time on branch **`main`**:

- `tipGuestConfirmationEmail.service.ts` — **untracked** (`??`).
- Migration folder — **untracked**.
- `git show HEAD:backend/src/services/stripe.service.ts` — **no** matches for `GuestConfirmation`, `guestEmail`, or `receipt_email`.
- `git show HEAD:backend/src/emails/i18nEmail.ts` — **no** `buildTipGuestConfirmationContent`.
- `git diff --stat HEAD` — `stripe.service.ts` **+16 lines** vs HEAD (scheduling/import only in working tree).

**Conclusion on previous fix:** Implemented in the **local working tree** (comments: “Albertina Part A”). **Not present in last committed `HEAD`.** Production deploys from committed `main` without these changes would **not** run this flow at all.

**Classification:** **B. implemented but not reachable** (on production built from committed `main`) **and/or D. implemented but not deployed**.

Commit hash for the fix: **NOT AVAILABLE** (changes not committed at audit time).

---

## 4. Stripe webhook path

### Events that matter for guest tips

| Event | Role for tip | Email |
|-------|--------------|-------|
| **`checkout.session.completed`** | **Authoritative** for guest Checkout: `handleSuccessfulTipPayment` | Scheduled here (working tree) |
| **`payment_intent.succeeded`** | Only updates **`pending`** tips | Guest Checkout usually **skipped** |
| `charge.succeeded` | **Not** handled for tip creation in `stripe.webhook.ts` | N/A |
| `checkout.session.expired` | Funnel metrics only (non–physical-QR) | No |

### Webhook implementation notes

- Signature: `verifyWebhookSignature` — missing `STRIPE_WEBHOOK_SECRET` or signature → **400** (`stripe.webhook.ts` ~64–66).
- Billing / physical QR / subscription sessions routed before tip handler (~77–98, ~143–147).
- Duplicate Stripe event IDs: `isStripeWebhookEventProcessed` → **200** `duplicate: true` (~106–108) **before** tip handler on non-billing path.
- **`checkout.session.completed`** is **not** in `TIP_EVENT_TYPES` set but is **explicitly** included when marking processed (~255–258).

### Duplicate payment intent (critical)

In `handleSuccessfulTipPayment`, if a tip already exists for `stripePaymentIntentId`, handler **returns immediately** (~1109–1114) **without** scheduling guest confirmation.

**Implication:** If the first webhook pass created the tip but email failed (or was skipped), a **Stripe retry** or manual replay of the same event will **not** resend email via this path.

**Status:** PARTIAL / FAIL for recovery.

---

## 5. Email trigger conditions (all gates)

Must all pass for CareTip confirmation send (working tree):

1. Webhook reaches `handleSuccessfulTipPayment` (not skipped: unpaid, duplicate PI, missing metadata, Connect ineligible, currency, etc.).
2. Tip row created with **`status: "success"`**.
3. **`resolveGuestEmailFromCheckoutSession`** returns non-null (see §6).
4. **`claimGuestConfirmationSend`**: same transaction, `status: "success"`, `guestConfirmationEmailSentAt IS NULL`.
5. **`loadTipConfirmationContext`**: tip still `success`.
6. **`getResendFromAddress()`** — in production throws if `RESEND_FROM` invalid/missing (caught in scheduler `catch`, claim released).
7. **`RESEND_API_KEY`** set — otherwise `sendResendEmail` returns `false` (production warns, claim released).

**Not gated by (searched):** business/employee notification settings, guest user accounts, marketing consent, feature flags for this email.

**Dev/test:** Missing `RESEND_API_KEY` in non-production skips send with info log (`resendClient.ts` ~125–131).

**Duplicate send prevention:** `guestConfirmationEmailSentAt` claim (~53–62). Silent no-op if claim fails (already sent).

**Scenario: tip succeeds, email skipped**

| Condition | Log / behavior |
|-----------|----------------|
| No resolvable email | `[tip-guest-confirmation] skipped_no_email` |
| Claim already set | No log (early return) |
| Resend failure | `[tip-guest-confirmation] delivery_failed` + claim released |
| Missing DB column (migration not applied) | Prisma error in `claimGuestConfirmationSend` → `catch` → `logServerError("tipGuestConfirmationEmail.checkout", ...)` — **NOT VERIFIED IN PRODUCTION** |

---

## 6. Recipient email resolution

### Data path (guest Checkout — primary)

```
TipAmountPage guestEmail (optional)
  → POST /api/payments/create-tip-session { guestEmail }
  → createTipCheckoutSession: customer_email + payment_intent_data.receipt_email (if normalized)
  → Stripe Checkout (customer may also enter/change email on hosted page)
  → checkout.session.completed webhook payload
  → resolveGuestEmailFromCheckoutSession(session, paymentIntent):
        session.customer_details?.email
     ?? session.customer_email
     ?? paymentIntent.receipt_email
  → normalizeGuestEmail (trim, lower, must contain @)
  → sendResendEmail to [to]
```

**Functions:** `normalizeGuestEmail`, `resolveGuestEmailFromCheckoutSession` — `tipGuestConfirmationEmail.service.ts`.

**Payment-intent-only path:** `paymentIntent.receipt_email` only — `scheduleTipGuestConfirmationEmailForPaymentIntent` (~152–158).

**Not used for this email:** employee email, business owner email, CareTip `User` email, Stripe Customer object (unless reflected in session email fields).

**Edge cases (repository):**

- Empty optional field + no email on Stripe session → **skipped_no_email**.
- Wallet / Link may populate `customer_details.email` — **REQUIRES PRODUCTION/STRIPE VERIFICATION** if missing in API object.
- Normalization lowercases; no plus-address stripping.

---

## 7. Resend integration

| Topic | Implementation | Status |
|-------|----------------|--------|
| Client | `fetch("https://api.resend.com/emails")` | `resendClient.ts` |
| API key | `process.env.RESEND_API_KEY` | REQUIRED in prod (startup `assertProductionEmailEnv` — `index.ts` ~137, `emailEnv.ts` ~83–106) |
| From | `getResendFromAddress()` ← `RESEND_FROM_EMAIL` / `RESEND_FROM` | REQUIRED in prod |
| Tag | `tip-guest-confirmation` | PASS |
| Errors | **Not thrown** — `return false`; `console.error` on non-OK | PASS |
| Success log | `[resend][tip-guest-confirmation] Email sent` with `to[0]` — **no message id persisted** | PARTIAL |
| Reply-To | Defaults to support email | `resendClient.ts` ~134–136 |
| Tip success coupling | `void schedule...` — email failure does not affect tip or webhook 200 | PASS |

**Swallowed failure pattern:** Yes — intentional (`sendResendEmail` + scheduler try/catch). Successful tip processing **can hide** email failure from the customer.

---

## 8. Production environment configuration

| Variable | Role | Local dev | Production backend |
|----------|------|-----------|---------------------|
| `RESEND_API_KEY` | Send mail | OPTIONAL (skip) | **REQUIRED** (process exit if missing) |
| `RESEND_FROM` / `RESEND_FROM_EMAIL` | From address | Optional (dev default/warn) | **REQUIRED** (valid format) |
| `STRIPE_WEBHOOK_SECRET` | Webhook | Required for real webhooks | **REQUIRED** |
| `STRIPE_SECRET_KEY` | Checkout + PI retrieve | Required for payments | **REQUIRED** |
| `FRONTEND_URL` | Checkout redirect | Required | **REQUIRED** (https in prod) |
| `NODE_ENV=production` | Email asserts | — | **REQUIRED** on Render/host |
| Feature flag for tip email | — | **None in code** | N/A |

**Secret values:** NOT reported (presence only).

**Render:** `render.yaml` documents cron jobs pointing at `https://caretip.onrender.com` — **does not** define `RESEND_*` for the web service. **REQUIRES PRODUCTION VERIFICATION** on Render dashboard.

---

## 9. Deployment status

| Check | Result |
|-------|--------|
| Fix in committed `HEAD` | **No** — guest confirmation service and template absent from `HEAD` |
| Fix in working tree | **Yes** — full Albertina Part A |
| Production build contains fix | **NOT VERIFIED IN CODEBASE** — evidence suggests **no** if deploy tracks committed `main` |
| DB migration applied in production | **NOT VERIFIED IN CODEBASE** — column `guest_confirmation_email_sent_at` required |
| Frontend guest email field in production | **NOT VERIFIED IN CODEBASE** — depends on SPA deploy |

---

## 10. Delivery / logging observability

| Signal | Recorded? |
|--------|-----------|
| Email attempted | Only via console (`skipped_no_email`, Resend logs) |
| Resend accepted | `console.info` on HTTP OK — **no ID stored** |
| Email failed | `delivery_failed`, `[resend] Email sending failed` |
| DB “sent” flag | `guestConfirmationEmailSentAt` set on **claim before send** (released on failure) |
| Resend webhooks (bounce/complaint) | **NOT FOUND** in repo for tip-guest-confirmation |

**Can you answer “Did CareTip send this tip confirmation?” from DB alone?** **No** — only `guestConfirmationEmailSentAt` (claim timestamp, not provider ID). **REQUIRES** backend logs or Resend dashboard.

---

## 11. Duplicate-prevention logic

- **Field:** `Transaction.guestConfirmationEmailSentAt` (`guest_confirmation_email_sent_at`).
- **Mechanism:** Optimistic claim via `updateMany` before send; release on failure.
- **Stripe webhook duplicate events:** Second event skipped entirely at idempotency layer — **no second chance** for email if first run created tip but email failed.
- **Risk:** Claim held if process crashes **after** claim **before** send completes and **before** catch releases — rare; would block resend until manual DB clear. **NOT VERIFIED** frequency.

No `confirmationSent` / separate notification row for guests.

---

## 12. Notification settings

- In-app / push notification settings (`userNotificationSettingsDefaults`, orchestrator) — **no** reference to guest tip confirmation email.
- Guest tipper is **unauthenticated** — no per-user email preference path found.

**Status:** **Missing** as a configurable setting — email is **always attempted** when code path and email address exist (transactional).

---

## 13. Email template

| Check | EN | DE |
|-------|----|----|
| Exists | `buildTipGuestConfirmationContent` | Same function, `locale === "de"` |
| Subject | “Your tip was sent” | “Ihr Trinkgeld wurde gesendet” |
| Body | Amount, employee, business, receipt number | Same structure |
| Rendering | `renderStandardEmail` | PASS |
| Failure blocks send? | Only if `sendTipGuestConfirmationEmail` throws before Resend (e.g. DB); template itself is sync | PASS |

Runtime test: `backend/scripts/tip-guest-confirmation-email-runtime.ts` asserts EN/DE receipt in text.

---

## 14. Failure / recovery

| Scenario | Behavior |
|----------|----------|
| Stripe succeeds, Resend fails | Tip remains; claim released; webhook still 200; **no automatic retry job** |
| Webhook retries same `event.id` | Duplicate skipped — **no** email retry |
| Webhook retries new event, duplicate PI | `SKIP REASON: duplicate payment intent` — **no** email |
| DB success, email `void` async fails | Tip OK; logs only |
| Migration missing | Prisma error on claim — **NOT VERIFIED** |
| `payment_intent.succeeded` after Checkout tip | No guest email (no pending row) |

**Recovery:** Manual resend **not implemented** in repo. Operational workaround: fix email/config and **manually** clear `guest_confirmation_email_sent_at` + trigger resend (no admin endpoint found) — **NOT VERIFIED**.

---

## 15. Reproduction plan (production-safe)

### Staging / test mode (preferred)

1. Use Stripe **test** keys and test webhook endpoint (Stripe CLI or dashboard).
2. Deploy **working-tree** backend + run migration `20260926120000_tip_guest_confirmation_email` on staging DB.
3. Deploy frontend with optional email field.
4. Complete tip with known `guestEmail` on amount step.
5. Verify in order:
   - Stripe Dashboard: Payment succeeded; Checkout session shows customer email.
   - API logs: `TIP CREATED`, no `skipped_no_email`, `[resend][tip-guest-confirmation] Email sent`.
   - DB: `tips` row `status=success`, `guest_confirmation_email_sent_at` set.
   - Resend dashboard: outbound to test inbox.

### Minimal production verification (no new charge if possible)

For an **existing** successful tip:

1. **Did tip succeed?** DB or manager dashboard — `tips.status = success`.
2. **Webhook?** Stripe Events → `checkout.session.completed` for session id (from success URL `session_id` if still available).
3. **Tip row?** Match `stripe_payment_intent_id`.
4. **Email trigger?** Render logs grep `[tip-guest-confirmation]` and `[resend][tip-guest-confirmation]` around event time.
5. **Resend?** Resend → Emails filtered by recipient/time.
6. If logs show `skipped_no_email` — recipient was never on session/PI.
7. If no log lines at all — production likely **without** deployed guest-confirmation code.

**Do not** run card charges in production solely for this audit unless you accept the cost.

---

## 16. USER / DEPLOYMENT ACTIONS REQUIRED

| Action | Required? | Evidence |
|--------|-----------|----------|
| **Commit + deploy backend** with `tipGuestConfirmationEmail.service.ts`, stripe/controller/i18n changes | **REQUIRED** if production tracks old `HEAD` | §3, §9 |
| **Deploy frontend** (`TipAmountPage`, `startGuestTipCheckout`, API types) | **REQUIRED** for reliable prefill of Stripe email | §6 |
| **Apply migration** `guest_confirmation_email_sent_at` on production DB | **REQUIRED** for idempotent send | `migration.sql`, schema |
| `RESEND_API_KEY` on production API | **REQUIRED** (else startup exit or send false) | `assertProductionEmailEnv`, `resendClient` |
| `RESEND_FROM` on verified domain | **REQUIRED** | README, `emailEnv.ts` |
| Stripe webhook: **`checkout.session.completed`** (+ existing tip events) | **REQUIRED** for tip creation | `stripe.webhook.ts` |
| `STRIPE_WEBHOOK_SECRET` matches endpoint | **REQUIRED** | Webhook 400 if wrong |
| Enter email on tip amount step or ensure Stripe Checkout captures email | **REQUIRED** for CareTip send | `skipped_no_email` |
| Check spam/junk | **NOT REQUIRED** but prudent | — |
| Resend dashboard delivery/bounce | **REQUIRED** to confirm provider acceptance | §10 |
| Enable notification setting | **NOT REQUIRED** | §12 |
| Restart backend after env change | **REQUIRED** if vars added | Standard ops |
| Stripe receipt email | **OPTIONAL** (separate from CareTip); set when `guestEmail` passed | `receipt_email` |
| Run `npm run test:tip-guest-confirmation-email` in CI | **NOT REQUIRED** for prod but validates wiring | Local script |

---

## 17. Final root cause

**CODE FIXED — DEPLOYMENT/CONFIGURATION ACTION REQUIRED**

**Evidence:**

1. Guest tip confirmation email logic exists **only in uncommitted / untracked files**; **committed `HEAD` lacks** scheduler, service, template, `guestEmail` Stripe wiring, and migration.
2. If production matches last commit, **no CareTip confirmation email is sent** regardless of Resend health.
3. Even after deploy, email sends **only** when a guest address is present on the Checkout session / PI (`skipped_no_email` otherwise).
4. Resend and webhook infrastructure are shared with other transactional mail (password reset, etc.) — if those work in production, provider config is likely fine; **missing feature deploy** is the primary repo-backed explanation for “fix reported but no email.”

Secondary risks after deploy: **no email on session**, **Resend failure** (logged only), **duplicate PI skip** blocking retry.

---

## 18. Recommended next action

**Smallest corrective path (no refactor):**

1. **Ship Albertina Part A:** commit all guest-confirmation files, apply migration on production DB (`prisma migrate deploy` or Supabase SQL per `backend/.env.example`), deploy API to Render (`caretip.onrender.com` or your host), deploy SPA.
2. **Verify one test-mode tip** with email filled; confirm logs and Resend.
3. **Production spot-check** an existing tip time window in logs for `[tip-guest-confirmation]`.

**If code already deployed manually but still no mail:**

- Inspect logs for `skipped_no_email` vs `delivery_failed`.
- Confirm `guest_confirmation_email_sent_at` column exists.
- **Minimal code fix (future):** `handleSuccessfulTipPayment` duplicate-PI branch (`stripe.service.ts` ~1109–1114) should call `scheduleTipGuestConfirmationEmailForCheckoutSession` for existing tip when `guestConfirmationEmailSentAt` is null — **not implemented**; only if logs prove duplicate skip.

**Test:** `npm --prefix backend run test:tip-guest-confirmation-email`.

---

## 19. Regression tests (existing / proposed)

| Area | Existing | Gap |
|------|----------|-----|
| Wiring + template EN/DE | `test:tip-guest-confirmation-email` (static) | No live Resend mock |
| Stripe webhook tip create | `stripe-connect-phase2-runtime`, pentest scripts | No assertion on guest email send |
| `handleSuccessfulTipPayment` duplicate PI | Mentioned in pentest | No email reschedule test |
| Resend failure | Lead/password scripts | Not for tip-guest-confirmation |
| Notification settings | N/A | N/A |
| Duplicate webhook event | `sprint4-payment-e2e-runtime` idempotency | No email side effect |

**Proposed (do not implement in this audit):** integration test mocking `sendResendEmail` on synthetic `checkout.session.completed`; test `skipped_no_email`; test claim release on `false`; test duplicate PI + existing tip without sentAt schedules send.

---

## 20. Audit rules acknowledgment

Read-only audit. No code, env, Stripe, Resend, or DB changes performed.

---

## Summary appendix

### A. Root cause

**Guest tip confirmation is implemented locally but not in committed `main`; production likely never runs the sender.** After deploy, missing guest email on the Stripe session is the main runtime skip.

### B. What is already correct (in working tree)

Webhook tip creation on `checkout.session.completed` when paid; Resend client pattern; idempotent claim; EN/DE template; optional guest email UI; Stripe `customer_email` / `receipt_email` forwarding.

### C. What is broken / missing

- **Not on `HEAD` / likely not deployed.**
- No DB/log correlation to Resend message ID.
- No retry when duplicate PI short-circuits handler.
- Fire-and-forget email can fail silently from customer perspective.

### D. What you need to do

Deploy backend + frontend + migration; verify `RESEND_*`; test with email entered; check Resend dashboard and Render logs.

### E. What developer needs to do

Commit Albertina Part A; optional: duplicate-PI email retry + persist Resend id (out of scope unless requested).

### F. Verify in Resend

Outbound `tip-guest-confirmation` / subject “Your tip was sent”; bounces; domain verification.

### G. Verify in Stripe

`checkout.session.completed` delivered; session `customer_details.email`; `payment_intent.receipt_email` when using amount-step email.

### H. Tests required

Run `test:tip-guest-confirmation-email`; add webhook+mock Resend test (proposed).

### I. Final status

**CODE FIXED — DEPLOYMENT/CONFIGURATION ACTION REQUIRED** (primary). After deploy, if still failing: **CODE IMPLEMENTED — TRIGGER NOT REACHED** (`skipped_no_email`) or **CODE IMPLEMENTED — EMAIL DELIVERY FAILURE** (`delivery_failed` / Resend) — **REQUIRES PRODUCTION/RESEND/STRIPE VERIFICATION**.
