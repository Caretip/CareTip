# CareTip

CareTip is a hospitality tipping platform: guests scan QR codes, pay tips by card (Stripe), and businesses and staff see payouts and analytics in a web app.

## Stack

- **Frontend:** React, Vite, TypeScript
- **Backend:** Node.js, Express, Prisma, PostgreSQL
- **Auth & storage:** Supabase (where configured), Firebase (push notifications)

## Getting started

1. Clone the repository and install dependencies at the repo root and under `backend/`.
2. Copy `backend/.env.example` to `backend/.env` and fill in required values (database, Stripe, etc.).
3. Run database migrations from `backend/` (`npx prisma migrate deploy` or `migrate dev` for local work).
4. Start the API (`npm run dev` in `backend/`) and the web app (`npm run dev` at the repo root).

Demo and admin seed scripts read credentials from environment variables only; see `backend/.env.example` for placeholders.

## Scripts

- Root `package.json` — frontend dev, build, and tests
- `backend/package.json` — API, Prisma, and backend tests

## Stripe Disputes, Chargebacks and Financial Recovery

This section describes what is **implemented** (Stage 1) and what is **future work** (Stage 2). Stage 1 code and tests live in the files listed at the end; nothing here describes a mechanism the code does not contain unless it is marked as future work.

### 0. Who does what (read this first)

Status labels: **[verified]** implemented and tested against mocked Stripe; **[not verified with real Stripe]** CareTip's handling is tested but Stripe's real behaviour has not been observed; **[Stripe docs, not implemented]**; **[not established]** Stripe documentation does not say; **[pending decision]** needs owner, legal or Stripe confirmation.

**What Stripe does on its own** (per [Disputes on Connect](https://docs.stripe.com/connect/disputes) and [How disputes work](https://docs.stripe.com/disputes/how-disputes-work)):
- For destination charges and separate charges and transfers, Stripe takes the disputed amount and the dispute fee from **CareTip's platform balance**, not from the connected account.
- If the dispute is **won**, Stripe returns the disputed amount to CareTip's platform balance (`charge.dispute.funds_reinstated`). The connected account is not involved; Stripe's guidance is "If you win, don't reverse the transfer."
- If the dispute is **lost**, the withdrawal stands. **Stripe does not take anything back from the connected account by itself.** The platform may reverse the transfer: "If you lose, reverse the transfer."
- If a connected account's balance becomes negative, Stripe first tries to collect from that account's bank account; for accounts where the platform covers losses (CareTip), the platform pays in the end ([risk management](https://docs.stripe.com/connect/risk-management)).

**What CareTip asks Stripe to do** (CareTip-initiated, executed by Stripe):
- Submit evidence (`disputes.update`, after an admin confirms the exact text). **[verified]** **[not verified with real Stripe]**
- Reverse the original transfer of a lost tip dispute (`transfers.createReversal`), only after an admin approves it. This is a CareTip financial action, not Stripe managing recovery. **[verified]** **[not verified with real Stripe]** **[pending decision]**: whether CareTip should do this at all is an owner and legal decision (section 16).

**What CareTip only records and displays:** dispute status, deadlines, evidence submissions, funds withdrawn and reinstated, fees, reversals read from Stripe, and a plain-language summary for admins. CareTip cannot know whether a beneficiary already paid the money out to their bank: Stripe does not link bank payouts to single tips, and the admin page says so instead of guessing.

**Stripe's own automatic recovery (Stripe Workflows):** Stripe offers Workflow templates that reverse the transfer automatically when a dispute is lost ("Recover lost dispute funds from connected accounts") or when funds are withdrawn, and return funds when reinstated. These still create transfer reversals, just configured in the Stripe Dashboard instead of CareTip's code. **[Stripe docs, not implemented, not enabled]** Pricing, availability and insufficient-funds handling of these templates are **[not established]** in the documentation. **Never enable them while CareTip's recovery is in use**, or the same transfer could be reversed twice.

### 1. Chargeback lifecycle

1. A cardholder disputes a card payment with their bank. Stripe creates a dispute and sends `charge.dispute.created`. For CareTip's charges (destination charges and separate charges and transfers), the dispute is on the **platform** charge, so the disputed amount and Stripe's dispute fee are withdrawn from CareTip's balance.
2. CareTip records the dispute, links it to the original payment, and notifies platform admins (and the affected business and employee for tips).
3. An admin reviews the evidence workflow before Stripe's deadline (`evidence_details.due_by`).
4. Stripe decides: **won** (funds reinstated to CareTip, `charge.dispute.funds_reinstated`) or **lost** (the withdrawal stands).
5. For a lost tip dispute, an admin may approve a **recovery** from the beneficiary's original transfer (Stage 1). Nothing is recovered automatically.

### 2. Stripe is the source of truth

Every dispute event (`charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`) only tells CareTip *which* dispute changed. The current state is always re-read with `disputes.retrieve` (charge expanded). The same applies to the reconciliation job, the admin "Sync from Stripe" button and the tip backfill. Stripe-owned fields (status, amounts, deadline, submissions, funds withdrawn/reinstated, fees) are only ever written from a Stripe read and cannot be edited by admins. An older Stripe snapshot never overwrites newer data. If Stripe cannot be read, the webhook returns 500 so Stripe retries.

Recovery amounts come from Stripe too: the transfer (`transfers.retrieve`, `amount`, `amount_reversed`), its reversals (`transfers.listReversals`, tagged with `metadata.caretip_stripe_dispute_id`) and the connected account's available balance (`GET /v1/balance` sent as that account). The recovered total is the sum of Stripe reversals, never a local estimate.

### 3. Evidence

Admins can prefill evidence from facts only (the Stripe charge: card checks, 3D Secure result, refunds, billing name and email; CareTip records: tip, QR order, subscription). The prefill never claims a service was delivered, that the cardholder authorised the payment or that a refund was refused. The admin edits the text, saves a draft, confirms the exact reviewed version (hash) and submits it with `disputes.update(..., { submit: true })`. CareTip then reads the dispute back and compares the stored evidence text with the reviewed draft field by field; mismatches are recorded and shown. Only Stripe's text evidence fields are supported: **evidence files must be uploaded in the Stripe Dashboard.**

### 4. Winning and losing

- **Won** (or inquiry closed): Stripe returns the funds to CareTip. Any approved recovery is cancelled automatically. If money had already been recovered, it is flagged for an admin decision; nothing is transferred back automatically.
- **Lost**: the loss is recorded in the dispute projection, the tip refund/dispute ledger and, for employee tips, the payable (`disputed_lost_cents`, which blocks further release of that share). Nothing is reversed automatically.

### 5. Stripe Connect liability configuration

Connected accounts are created with Accounts v2, Express dashboard, and `defaults.responsibilities.fees_collector = application` and `losses_collector = application`. CareTip is therefore responsible for refunds, chargebacks and negative balances of connected accounts. Stripe's dispute fee is never recovered from beneficiaries. Under this configuration a lost chargeback is CareTip's loss unless CareTip itself recovers it; a connected account's negative balance is CareTip's responsibility after Stripe's attempt to debit the account's bank. CareTip's code does not change this configuration.

### 6–8. Administrator-controlled recovery (Stage 1, implemented)

- **Available by default, never automatic.** There is no feature switch. A recovery only starts when a platform admin (database-verified `SUPER_ADMIN`, MFA at login) opens a **lost** dispute in *Platform admin → Revenue → Disputes*, reviews the breakdown and confirms. Webhooks, reconciliation, tip backfill and admin sync never start a recovery.
- **Before approving** the admin sees the disputed amount, the beneficiary's share, CareTip's fee, refunds already issued, the original transfer, all reversals on it (refunds and others separately), the account's available balance read from Stripe, previous attempts and the outstanding amount.
- **The approval** records the admin, time, policy version (`stage1-2026-11-26`), the approved maximum, and its scope: one transfer and one connected account. Destination charges: the maximum is the disputed amount minus CareTip's application fee (proportional for partial disputes). Separate charges and transfers: the employee's lost share, never more than was transferred.
- **Each attempt** re-reads the dispute (must still be `lost`, funds not reinstated), the transfer and the balance, checks that the transfer is in the dispute's currency and was paid to the account CareTip recorded for the beneficiary (otherwise it stops for manual review), then calls `transfers.createReversal` on the approved transfer only, never for more than the approved remainder, the transfer's unreversed amount or the account's available balance (a recovery never pushes an account negative). Results are read back from Stripe and recorded per attempt (trigger, amount, balance and transfer state before the request, reversal ID or error, Stripe request ID).

### 9. When the connected account has no available funds

Stripe documents that a transfer reversal can fail when the account lacks available funds "if Stripe is responsible for the connected account's negative balances", and recommends retrying once funds are available ([Disputes on Connect platforms](https://docs.stripe.com/connect/disputes)). CareTip's accounts are platform-liable, for which the behaviour is **[not established]**, so CareTip never asks for more than the available balance. **[not verified with real Stripe]**

- No available balance at approval: no request is sent; the recovery is **outstanding** with a scheduled retry.
- Stripe refuses for insufficient funds: the attempt is recorded as failed, the recovery stays **outstanding** and a retry is scheduled.
- Partial balance: the available part is reversed (**partially recovered**); the rest stays outstanding.
- Scheduled retries run inside the internal job `dispute-reconciliation-tick`, only for approved, not-cancelled recoveries, with back-off (1 h doubling to 24 h) and at most 20 retries, after which the recovery is **failed** and needs an admin. Admins can retry manually ("Retry now") or stop a recovery (reason required).
- Idempotency: a definite Stripe refusal burns its key (Stripe replays the stored error for 24 h), so the next request uses a new key (`…:rN`). A request whose outcome is unknown (network error, 5xx, 409) is resolved by reading the transfer's reversals and is only ever retried with its original key. A database claim with a 2-minute lease prevents concurrent workers from overlapping.
- Whether funds that arrive in the account from a *later* tip can satisfy a reversal of the *earlier* transfer is decided by Stripe; CareTip only retries the original transfer within the approval.

### 10. Original-transfer reversal vs. future-distribution offsets

- **A. Reversing the original transfer after funds arrive** — implemented (retries above).
- **B. Withholding part of a new tip before it is transferred** — technically possible only for separate charges and transfers (CareTip sets the `transfers.create` amount), not for destination charges (the transfer amount is fixed at checkout). **Not implemented.** It would deduct from employee tips and needs an approved contractual and German legal basis first. If approved, it must be a separate ledger entry linked to the same outstanding recovery, visible to the employee.
- **C. Reversing a new transfer after it was created** — technically a reversal of a different transfer; outside the approved scope. **Not implemented.**

### 11. Ledgers, audit and double-recovery protection

- `stripe_disputes`: Stripe projection plus CareTip operational data (classification, investigation, evidence draft and verification, approval, retry schedule, recovery status, recovered amount, notification keys).
- `stripe_dispute_recovery_attempts`: every Stripe request with its idempotency key, trigger (`admin` / `scheduled_retry`), amount, available balance and transfer state before the request, result, reversal ID, error and Stripe request ID.
- `tip_refunds`, `employee_tip_payables`, `physical_qr_payment_adjustments`: the existing ledgers, still fed from the same Stripe state. A successful recovery of a platform-hold tip is also recorded on the payable (`reversed_cents`) so refund reversals keep the right cumulative total.
- `audit_logs`: approvals, requests, cancellations, evidence actions and state changes.
- A Stripe reply alone is not proof: an attempt counts as succeeded only once the reversal is read back from the transfer. If it is not visible, the attempt stays **unknown** and nothing is counted as recovered.
- Funds totals are only ever added within one currency. If a dispute's balance transactions are in more than one currency, the dispute is flagged (`funds_currency_mixed`) and shown as "reconciliation required".
- The same amount can never be recovered twice: every attempt first resolves unknown attempts from Stripe, the remainder is computed from Stripe reversals for that dispute, and refunds and chargeback recoveries both count against the transfer's unreversed amount.

### 12. Dashboards

- **Platform admins:** *Revenue → Disputes* — each dispute opens with a plain-language summary computed on the server: what happened, what Stripe confirmed (with the last check time), where the money is (with the source of each statement: confirmed by Stripe, CareTip record, or cannot be confirmed), what happens next and what the admin needs to do. Stale or unconfirmed data is shown as "financial reconciliation required". Views for open, needs evidence, deadlines, awaiting decision, won, lost, funds withdrawn/reinstated, recovery to review, recovery outstanding and sync errors; full detail with the recovery panel.
- **Business managers:** *Stripe → Disputes* (`/dashboard/stripe/disputes`) — disputes on tips paid at their own venue, outcome, the team member's name, and recovery details only where the business itself was paid.
- **Employees:** *Payments → Disputed tips* (`/employee/payments/disputes`) — their own tips only, outcome and recovery details.

The server scopes both participant views from the signed-in user; no admin notes, evidence, other parties' data or cardholder data are returned.

### 13. Notifications (English / German)

Admins are notified of new disputes, deadlines, evidence failures, outcomes, reinstated funds and every recovery step. Businesses are told about disputes on their tips and recovery steps where they are the beneficiary; employees about disputes and recovery steps on their own tips. Each (dispute, event, approval) is sent once, whatever the number of webhook retries, syncs or scheduled runs. Messages contain no amounts and no cardholder data; the dashboards show the details.

### 14. Refund reversal vs. chargeback recovery

Refunds are unchanged: a refund of a separate-transfer tip automatically reverses the employee's transfer (tagged `metadata.caretip_payable_id`); destination-charge refunds use `reverse_transfer` and `refund_application_fee`. Chargeback recovery is a different, admin-approved process (tagged `metadata.caretip_stripe_dispute_id`). Both reduce the same transfer's unreversed amount, so together they can never exceed what was transferred.

### 15. Money already paid out to a bank account (Stage 2, future work)

A transfer reversal is not a documented way to recall money that has already reached an employee's or business's bank account. If the account has no available balance, the recovery stays outstanding. Possible future options — contractual repayment, business repayment arrangements, approved future-distribution offsets (see 10 B), Stripe's negative-balance debiting where available for the account's country, other legally permitted collection — are **not implemented**. Salary deductions, unapproved tip deductions, bank debits, external collections and rolling reserves are out of scope.

### 16. Contractual and legal considerations

Stripe supporting an operation does not mean CareTip may use it. Before recovering chargebacks from businesses or employees in production, CareTip needs a confirmed contractual basis in its terms, and German legal review for anything affecting employee tips (deductions, set-offs, repayment demands). The admin approval records who decided; it does not replace that legal basis.

### 17. Reference

- **Services:** `backend/src/services/disputes/` — `stripeDisputeProjection.service.ts` (sync, classification), `stripeDisputeRecovery.service.ts` (approval, attempts, retries), `stripeDisputeEvidence.service.ts`, `stripeDisputeReconciliation.service.ts`, `stripeDisputeNotify.service.ts`, `stripeDisputeAdmin.service.ts`, `stripeDisputeParticipant.service.ts`, `stripeDisputeExplain.service.ts` (admin summary); existing ledgers in `finance/tipRefunds.service.ts` and `employeeTipPayable.service.ts`.
- **Webhook:** `backend/src/webhooks/stripe.webhook.ts` (platform `/api/webhooks/stripe` and Connect `/api/webhooks/stripe-connect`). Subscribe the platform endpoint to all five `charge.dispute.*` events.
- **Migrations:** `backend/prisma/migrations/20261126120000_stripe_dispute_projection` and `20261126190000_stripe_dispute_funds_currency` (both additive).
- **Admin API** (`/api/platform`, platform admins only): `GET /disputes`, `GET /disputes/summary`, `GET /disputes/:id`, `POST /disputes/:id/sync`, `PATCH /disputes/:id/internal`, `GET /disputes/:id/evidence/suggestion`, `PUT /disputes/:id/evidence/draft`, `POST /disputes/:id/evidence/submit`, `POST /disputes/:id/recovery` (approve), `POST /disputes/:id/recovery/retry`, `POST /disputes/:id/recovery/cancel`, `GET /disputes/:id/recovery/context`.
- **Participant API:** `GET /api/me/connect/disputes` (business manager), `GET /api/me/employee-connect/disputes` (employee).
- **Internal job:** `POST /api/internal/jobs/dispute-reconciliation-tick` (`CRON_SECRET`; proposed schedule `40 * * * *`; the Render Cron Job is not created by this repository).
- **Frontend:** `src/app/pages/platform/revenue/PlatformDisputesPage.tsx`, `src/app/pages/disputes/ParticipantDisputesPages.tsx`, `src/app/components/disputes/ParticipantDisputesList.tsx`.
- **Tests (disposable database, Stripe mocked):** `node scripts/safe-test.mjs test:stripe-dispute-lifecycle` and `test:employee-tip-dispute-lifecycle` from `backend/`.

## License

Proprietary — CareTip Limited. All rights reserved.
