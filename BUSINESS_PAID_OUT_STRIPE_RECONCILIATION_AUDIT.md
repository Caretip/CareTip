# Business Dashboard “Paid Out” vs Stripe Payout Totals — Forensic Audit

**Date:** 2026-09-24  
**Scope:** Read-only forensic audit of Business Dashboard hero **“Paid out”** vs Stripe Dashboard figures  
**Observed discrepancy (same business, same session):**

| Source | Amount (EUR) |
|--------|----------------|
| CareTip Business Dashboard hero “Paid out” | **1,668.90** |
| User manual sum of individual Stripe payouts | **1,668.45** |
| Stripe Dashboard → Balance Summary → Payouts | **1,610.64** |

| Comparison | Delta (EUR) |
|------------|-------------|
| CareTip − manual Stripe payouts | **+0.45** |
| CareTip − Stripe Balance Summary | **+58.26** |
| Manual Stripe payouts − Balance Summary | **+57.81** |

**No code, database, Stripe, or financial records were modified.**

---

## 1. Executive summary

| Question | Answer |
|----------|--------|
| **What does CareTip “Paid out” mean?** | **Answer B is wrong. Answer A is correct:** lifetime sum of **Stripe Connect bank payouts** (`Payout` objects, `po_*`) with `status = paid`, persisted in `stripe_connect_payouts`, attributed to the **business connected account** (`Business.stripeAccountId`). |
| **Is it Stripe Transfers?** | **No.** `stripe.transfers.list` is used only in **reconciliation** (`businessPayoutReconciliation.service.ts`), not in the hero metric. |
| **Is it CareTip ledger payables?** | **No.** `EmployeeTipPayable` / `Transaction` are used for ledger metrics and reconciliation, not for `completedAmountCents`. |
| **Same financial event as Balance Summary “Payouts”?** | **Not provably.** CareTip is **all-time, no date filter**. Stripe Balance Summary is a **reporting-period aggregate** in the Stripe Dashboard UI — almost certainly a **different date scope**. |
| **Same financial event as manual payout sum?** | **Should be, if** the manual sum uses the same connected account, live mode, EUR, all `paid` `Payout.amount` values, and complete history. The **€0.45** gap implies a **small set/amount mismatch**, not a different financial concept. |
| **Is the label “Paid out” accurate?** | **Mostly yes** for bank payouts, but the **hero tile has no hint** (analytics section does: “Completed bank payouts from Stripe”). It does **not** mean CareTip transfers to employees or money in employee personal banks. |
| **Is the implementation correct?** | **Semantically correct** for “completed Stripe bank payouts to the business connected account.” **Operational risks:** incomplete history if webhooks missed payouts and API backfill is capped at **100** payouts; **no period label** on hero despite analytics disclaimer elsewhere. |
| **Should code change now?** | **Not without record-level proof.** Recommended next step is **read-only reconciliation** (SQL + Stripe export), not a formula change. |

---

## 2. Exact source of CareTip “Paid out” (€1,668.90)

### 2.1 Frontend display chain

| Layer | File | Detail |
|-------|------|--------|
| Page | `src/app/pages/business/BusinessDashboard.tsx` | `useBusinessFinancialSummary(enabled, "all", { progressive: true })` |
| Hook | `src/app/hooks/useBusinessFinancialSummary.ts` | `GET .../financial-summary?period=all&section=connect` |
| API client | `src/app/lib/api.ts` | `getBusinessFinancialSummary()` → `BusinessFinancialSummaryBundle` |
| Hero component | `src/app/components/business/BusinessHeroFinancialMetrics.tsx` | See formula below |
| Mobile hero | `src/app/components/business/BusinessDashboardMobileHero.tsx` | Same `BusinessHeroFinancialMetrics` |

**Display formula:**

```typescript
paidOutEur = summary.payouts.completedAmountCents / 100
```

- Gated on **connect slice** loading (`connectLoading`), not ledger loading.
- Rendered via `CountUpMetric` + `formatEur` (de-DE locale, 2 decimals).
- **No client-side period filter** on payouts.

**i18n (hero):**

| Key | EN |
|-----|-----|
| `business.hero.financial.paidOut` | “Paid out” |
| `business.hero.financial.totalTipsPeriod` | “All time” (applies to **total tips**, not paid out) |

**Note:** Hero has **no** `paidOutHint`. Analytics uses `business.tips.analytics.financial.paidOutHint` → “Completed bank payouts from Stripe”.

### 2.2 API endpoint

```
GET /api/me/connect/financial-summary?period=all&section=connect
```

| Layer | File |
|-------|------|
| Route | `backend/src/routes/connect.routes.ts` |
| Controller | `backend/src/controllers/connect.controller.ts` → `getMyBusinessFinancialSummary` |
| Service | `backend/src/services/businessFinancialSummary.service.ts` → `loadBusinessFinancialSummaryForBusiness` |

**Auth:** JWT business manager, `requireCompletedOnboarding`, `businessId` from server session — **not** client-supplied.

### 2.3 Server aggregation

```typescript
// businessFinancialSummary.service.ts (connect slice)
payouts: {
  completedAmountCents: payoutSummary.completedAmountCents,
  ...
}
```

```typescript
// stripeConnectPayout.service.ts → summarizePayoutsForBusiness
completedAmountCents = SUM(amount_cents)
  FROM stripe_connect_payouts
  WHERE business_id = :businessId
    AND status = 'paid'
    AND currency = :selectedCurrency   // 'eur' preferred if any EUR rows exist
```

**Documented exclusion (service comment L947):**

> Does not convert FX. Does not include CareTip transfers or employee bank payouts.

### 2.4 Database table

**Model:** `StripeConnectPayout` → table `stripe_connect_payouts`  
**Schema:** `backend/prisma/schema.prisma` (L731–777)

| Field | Role in “Paid out” |
|-------|---------------------|
| `business_id` | Tenant filter |
| `stripe_account_id` | Must match `Business.stripeAccountId` |
| `stripe_payout_id` | Unique `po_*` |
| `amount_cents` | **Summed** (integer cents, authority) |
| `currency` | EUR preferred; `mixedCurrency` if multiple |
| `status` | Must be `paid` |
| `application_fee_amount_cents` | Stored but **not subtracted** from sum |
| `paid_at`, `arrival_date`, `stripe_created_at` | **Not used** in aggregation filter |

**Not used:** `EmployeeTipPayable`, `Transaction.payoutStatus`, balance lines, reconciliation status.

### 2.5 Stripe object

| Concept | Used for “Paid out”? |
|---------|----------------------|
| **Stripe Payout** (`po_*`) | **Yes** — `Payout.amount` → `amount_cents` |
| Stripe Transfer (`tr_*`) | **No** (reconciliation only) |
| Stripe Balance Transaction | **No** for hero total (used for payout line-item drill-down) |
| `stripe.balance.retrieve` | **No** for paid out (used for Available/Pending hero columns) |

**Stripe API ingestion:**

1. **Webhooks (primary):** `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `payout.reconciliation_completed`  
   Handler: `handleConnectPayoutEvent()` → `persistAttributedConnectPayout()`  
   Attribution: `event.account` → `Business.stripeAccountId` (employee accounts routed to `employeeStripePayout` table instead).

2. **Throttled API sync (secondary):** `syncConnectPayoutsFromStripeForBusiness()`  
   `stripe.payouts.list({ limit, starting_after }, { stripeAccount })`

**CareTip does not initiate standard automatic payouts** (observation-only per service header), but **does** support manager **Instant Payout** creation (`stripeConnectInstantPayout.service.ts` → `payouts.create`), which then flows through the same `StripeConnectPayout` persistence path.

---

## 3. Financial semantics (strict separation)

| Concept | CareTip representation | In “Paid out”? |
|---------|------------------------|----------------|
| **EmployeeTipPayable** | CareTip entitlement / routing ledger | **No** |
| **Stripe Transfer** | Platform → connected Stripe account | **No** |
| **Stripe Payout** | Connected account → external bank/card | **Yes** |
| **Stripe Balance** | Available / pending in connected account | Separate hero columns |
| **Business distribution** | Manual off-platform distribution obligation | Separate hero row when applicable |

**Money flow (typical direct-to-employee):**

```
Guest tip → Stripe charge → (optional) Transfer to employee Connect account → Payout to employee bank
Business connected account payouts → separate Stripe Payout stream (business’s own Connect account)
```

The hero **“Paid out”** measures **payouts from the business’s connected Stripe account to its external bank**, not transfers to employees.

---

## 4. Date range & timezone audit

### 4.1 CareTip “Paid out”

| Aspect | Value |
|--------|-------|
| **Start date** | None (all rows in DB for business) |
| **End date** | None (present) |
| **Date field used** | **None** — status-only filter |
| **Timezone** | **Not applied** to payout aggregation |
| **Period query param** | `period=all` sent by dashboard, but **ignored for payouts** |
| **Ledger period basis** | `periodBasis: "tip_created_at"` — **ledger only** |

Adjacent hero label “Total tips · All time” does **not** apply a period to paid out; paid out is also lifetime in practice, but **without an explicit “all time” label**.

### 4.2 User manual Stripe payout calculation (€1,668.45)

**Not observable in code.** Assumed to be a manual sum of visible **paid** payout amounts in Stripe Dashboard for the business connected account.

**If the manual sum used:**

- A **date filter** (month, custom range) → would **not** match CareTip lifetime.
- **Arrival date** vs **created date** → could exclude/include different payouts.
- **In-transit** payouts → CareTip excludes (only `paid`).
- **Net** vs **gross** payout amount → CareTip uses Stripe `Payout.amount` (gross payout amount in cents).

The **€0.45** gap is **too small** for a period-scope explanation; it points to **one or few payout rows** or **rounding/spreadsheet error**, not months of missing data.

### 4.3 Stripe Balance Summary → Payouts (€1,610.64)

**Not implemented in CareTip codebase** — this is Stripe Dashboard reporting UI.

**Stripe product behavior (external, not CareTip code):**

- Balance Summary aggregates activity for a **selected reporting period** (commonly current month or user-selected range).
- The **“Payouts”** line is **not** an all-time lifetime total of every `Payout` object.
- Reporting may use Stripe’s **accounting/reporting date** conventions, which can differ from summing `Payout.amount` by `created` or `arrival_date`.

**Conclusion:** The **€57.81** gap between manual all-time-style sum and Balance Summary is **highly consistent with different date/reporting scope**, not with CareTip using the wrong Stripe object.

---

## 5. Pagination audit

### 5.1 `stripe.payouts.list` (API sync)

| Constant | Value | File |
|----------|-------|------|
| `CONNECT_PAYOUT_SYNC_PAGE_SIZE` | 50 | `stripeConnectPayout.service.ts` L36 |
| `CONNECT_PAYOUT_SYNC_MAX_PAGES` | 2 | L37 |
| **Max payouts per sync** | **100** | |

- `has_more` / `starting_after`: **handled** within the 2-page cap.
- Throttle: **60s** per business (`CONNECT_PAYOUT_LIST_SYNC_TTL_MS`).
- Force full sync when DB count = 0 (first hydration).

### 5.2 Hero aggregation query

```sql
-- Effective query via Prisma groupBy
SELECT status, currency, SUM(amount_cents), COUNT(*)
FROM stripe_connect_payouts
WHERE business_id = ?
GROUP BY status, currency
```

**No LIMIT** — sums **all** persisted rows, not just the last 100.

### 5.3 Completeness risk

| Scenario | Effect on hero total |
|----------|---------------------|
| Webhooks delivered all historical `payout.paid` events | DB complete → hero accurate |
| Missed webhooks + business has **≤100** payouts | API sync may backfill |
| Missed webhooks + business has **>100** payouts | **Older payouts may never sync** → hero **understates** true lifetime |
| User sees CareTip **higher** than manual sum | Pagination **unlikely** to be the cause of **over**-statement |

**For this case (CareTip +€0.45 vs manual):** pagination does **not** explain CareTip being **higher**.

---

## 6. Cache audit

### 6.1 Frontend

| Mechanism | TTL | Key |
|-----------|-----|-----|
| In-flight dedup `Map` in `api.ts` | Until request completes | `business-financial-summary:${period}:${section}:${recon}` |
| React state in hook | Per mount | — |
| Persistent cache | **None** | — |

### 6.2 Backend

| Mechanism | TTL | Key |
|-----------|-----|-----|
| `lastConnectPayoutSyncAtByBusiness` | 60s | `businessId` |
| HTTP / Redis cache on endpoint | **None** | — |

**Stale €1,668.90?** Possible for **≤60s** after a new payout if sync is throttled and webhook not yet processed; **unlikely** to explain a stable **€0.45** structural gap vs a fresh manual Stripe export.

---

## 7. Currency & rounding

- All math in **integer cents** on server.
- Display: `cents / 100` → `formatEur` (2 decimal places).
- **No FX conversion.**
- If multiple currencies exist: **only one currency** summed (`eur` preferred); `mixedCurrency: true` — other currencies **excluded** from total.
- `application_fee_amount_cents` stored but **not deducted** from `completedAmountCents`.
- **€0.45 = 45 cents** — exactly one smallest-EUR payout or one amount mismatch; **not** floating-point drift.

---

## 8. Account verification

CareTip resolves account server-side:

```typescript
// businessFinancialSummary.service.ts
stripeAccountId = business.stripeAccountId
connected = stripeAccountId.startsWith("acct_") && stripeConnectStatus === "ready"
```

| Check | CareTip behavior |
|-------|------------------|
| Live vs test | Uses server Stripe API key environment |
| Connected account | `Business.stripeAccountId` only |
| Employee accounts | Payout events on employee `acct_*` → `employee_stripe_payouts`, **not** business hero |
| Client-supplied account | **Rejected** (`rejectClientConnectSteering`) |

**Verification required:** Stripe Dashboard view must be the **same `acct_*`** as `Business.stripeAccountId` for this business, **live mode**, **EUR**.

---

## 9. Investigation: €0.45 difference (CareTip vs manual)

**CareTip higher by €0.45** — CareTip includes **45 cents more** than the manual sum.

### 9.1 Code-backed possible causes

| Cause | Plausible? | Notes |
|-------|------------|-------|
| Different payout **set** (extra `paid` row in CareTip DB) | **Yes** | Most likely for exact cent delta |
| Same payout, different **amount** in DB vs Stripe UI | Possible | Webhook snapshot vs user misread |
| User manual sum **omitted** one payout | **Yes** | Spreadsheet/filter error |
| User summed **net**; CareTip uses **gross** `Payout.amount` | Possible | Check instant payout / fee display |
| Rounding in manual calculation | Possible | 45¢ is large for rounding alone |
| CareTip includes `in_transit` / `pending` | **No** | Only `status = paid` |
| CareTip uses Transfers | **No** | Not in code path |
| Duplicate `po_*` in DB | **No** | Unique constraint on `stripe_payout_id` |
| Stale cache | Unlikely | 45¢ stable gap |

### 9.2 Exact record identification

**Cannot be determined from code alone** — requires read-only comparison:

```sql
-- CareTip DB (read-only)
SELECT stripe_payout_id, amount_cents, status, currency, paid_at, stripe_created_at, arrival_date
FROM stripe_connect_payouts
WHERE business_id = '<businessId>' AND status = 'paid' AND currency = 'eur'
ORDER BY stripe_created_at;
```

Compare to Stripe Dashboard export / API:

```
stripe.payouts.list({ status: 'paid', limit: 100 }, { stripeAccount: 'acct_...' })
-- paginate until has_more = false
```

Sum `amount` fields (cents) and diff row-by-row.

---

## 10. Investigation: €57.81 / €58.26 difference (vs Balance Summary)

| Comparison | Delta |
|------------|-------|
| Manual payouts − Balance Summary | **57.81** |
| CareTip − Balance Summary | **58.26** |
| Difference between those deltas | **0.45** (= CareTip vs manual gap) |

### 10.1 Interpretation

1. **Balance Summary vs manual/CareTip (≈€58):** Almost certainly **different reporting period / scope**. CareTip and manual sum are **~€0.45 apart** but **~€58 above** Balance Summary — they share the same “all-time-ish” ballpark; Balance Summary does not.

2. **CareTip vs manual (€0.45):** Independent **row-level** mismatch on top of the period effect.

### 10.2 Code-backed causes for Balance Summary gap

| Cause | Supported? |
|-------|------------|
| **Different date / reporting period** | **Strongly yes** (primary) |
| Transfers vs payouts confusion | No — CareTip uses payouts |
| Fees deducted in Balance Summary but not in Payout.amount | Possible in Stripe reporting; not in CareTip code |
| Pagination in CareTip | Would **under**-state, not explain Balance Summary being lower |
| Refunds / disputes / adjustments in reporting view | Possible in Stripe UI; not in CareTip paid sum |

**Action to confirm:** Note the **exact period** shown on Stripe Balance Summary (month label / date picker) and re-sum only payouts in that window.

---

## 11. Source-of-truth architecture (recommended)

| Domain | Authoritative source |
|--------|---------------------|
| A. Employee earnings (CareTip view) | `EmployeeTipPayable` + analytics |
| B. CareTip entitlement / routing | `EmployeeTipPayable`, `Transaction` |
| C. Transfer to connected account | Stripe **Transfer** (`tr_*`) |
| D. **Bank payout** (connected → bank) | Stripe **Payout** (`po_*`), status `paid` |
| E. Current Stripe balance | `stripe.balance.retrieve` |
| F. Business distribution (off-platform) | CareTip distribution ledger |

**Hero “Paid out” should represent D** — and the implementation **does** target D via `stripe_connect_payouts`.

---

## 12. Label audit

| Surface | Label | Hint | Accurate? |
|---------|-------|------|-----------|
| Hero | “Paid out” | **None** | Partially — implies bank payout but lacks clarity |
| Analytics | “Paid out” | “Completed bank payouts from Stripe” | **Yes** |
| Analytics `periodBasis` | — | “Stripe balance and payouts are current totals.” | **Yes** (not period-scoped) |

**Risk:** Managers may equate “Paid out” with **employee money paid out** or **CareTip transfers**. Code explicitly excludes those.

---

## 13. Is the current implementation correct?

| Dimension | Assessment |
|-----------|------------|
| **Financial concept** | Correct: Stripe Connect **paid bank payouts** to business account |
| **vs manual Stripe payout sum** | **Nearly correct** (0.45 / 1668.90 = **0.027%**) — investigate row-level diff |
| **vs Balance Summary** | **Not comparable** without matching reporting period |
| **Pagination / completeness** | **Risk** for businesses with >100 payouts and incomplete webhooks |
| **Label / UX** | Hero under-explains; no “all time” on paid out tile |

---

## 14. Recommended correction (DO NOT IMPLEMENT YET)

### 14.1 Immediate (read-only)

1. Export `stripe_connect_payouts` paid rows for the business.
2. Export all Stripe `po_*` paid payouts for `Business.stripeAccountId` (full pagination).
3. Record Balance Summary **period label** and date range from Stripe UI.
4. Row-level diff to find the **45¢** delta.

### 14.2 If implementation changes are later approved

| Priority | Change | Rationale |
|----------|--------|-----------|
| P1 | Add hero hint: “Completed bank payouts from Stripe (all time)” | Match analytics semantics |
| P2 | Expose `completedCount` + `asOf` timestamp in API/UI | Transparency |
| P3 | Remove or raise **100-payout API sync cap**; full backfill job | Lifetime accuracy |
| P4 | **Do not** change formula to match Balance Summary without explicit product decision on reporting period |

**Safest formula (unchanged):**

```
paidOutEur = SUM(stripe_connect_payouts.amount_cents WHERE status='paid' AND currency=eur) / 100
```

---

## 15. Direct answers to required questions

### 1. What exactly is CareTip's €1,668.90?

The **lifetime sum of integer cents** of all `stripe_connect_payouts` rows for this business where `status = paid` and `currency = eur` (preferred), divided by 100 and formatted — i.e. **completed Stripe Connect bank payouts** from the business connected account, as mirrored from Stripe `Payout` objects.

### 2. What exactly is the manually calculated €1,668.45?

**Not defined in code.** Presumed to be the user's manual sum of **individual paid Stripe payout amounts** in the Dashboard for the same connected account. Should represent the same **Payout.amount** concept if done correctly.

### 3. What exactly is Stripe Balance Summary's €1,610.64?

**Not defined in CareTip.** Stripe Dashboard **reporting-period** aggregate for the “Payouts” line in Balance Summary — **not** provably the same as an all-time sum of `Payout` objects.

### 4. Are these three numbers measuring the same financial event?

| Pair | Same event? |
|------|-------------|
| CareTip vs manual payouts | **Intended yes** (both paid bank payouts, lifetime) |
| CareTip vs Balance Summary | **No** (different scope highly likely) |
| Manual vs Balance Summary | **No** (same reason) |

### 5. Why is there a €0.45 difference?

**Not provable without row-level data.** Code allows: **one extra or larger paid payout in CareTip DB**, **one omitted payout in manual sum**, or **amount/display mismatch** on a single payout. **Not** explained by transfers, ledger, or period filter on CareTip side.

### 6. Why is there a €57.81 difference (manual vs Balance Summary)?

**Most likely: different date/reporting period** in Balance Summary. Not explained by CareTip using transfers or ledger.

### 7. Why is there a €58.26 difference (CareTip vs Balance Summary)?

**Same as §6**, plus the **€0.45** CareTip vs manual offset.

### 8. Is the difference caused by…?

| Factor | CareTip vs manual (€0.45) | vs Balance Summary (≈€58) |
|--------|---------------------------|---------------------------|
| Different source | Unlikely (same Payout concept) | **Yes** (reporting vs object sum) |
| Different date range | Unlikely | **Yes** |
| Timezone | Unlikely at 45¢ | Possible for period boundaries |
| Fees | Possible if manual used net | Possible in Stripe reporting |
| Transfers vs payouts | **No** | **No** for CareTip |
| Caching | Unlikely | Unlikely |
| Pagination | Would under-state CareTip | N/A |
| Other | Manual error / one row | Stripe reporting scope |

### 9. What should CareTip's “Paid out” metric actually represent?

**Completed Stripe Connect bank payouts** (`Payout`, `status = paid`) for the business connected account, **all time** — which matches current implementation intent.

### 10. Is the current CareTip number correct, incorrect, or a different concept?

**Correct concept, near-correct value** vs manual lifetime payout sum (0.03% delta). **Not comparable** to Balance Summary without period alignment. **Not** measuring transfers or employee payouts.

### 11. Should the CareTip implementation be changed?

**Not the core formula** based on this audit. **Yes** to operational/UX hardening (hints, completeness, reconciliation tooling) after row-level diff.

### 12. Safest source of truth and formula (if changed later)

**Keep:** `SUM(amount_cents) WHERE status='paid'` on `stripe_connect_payouts` sourced from Stripe `Payout` webhooks + complete pagination backfill.  
**Do not** substitute Balance Summary, Transfer totals, or `EmployeeTipPayable` without explicit product definition.

---

## 16. What should remain unchanged (this audit)

- No code changes
- No database changes
- No Stripe changes
- No financial repairs
- No label changes (until product decision)

---

## 17. Key file index

| Layer | Path |
|-------|------|
| Hero UI | `src/app/components/business/BusinessHeroFinancialMetrics.tsx` |
| Hook | `src/app/hooks/useBusinessFinancialSummary.ts` |
| API types | `src/app/lib/api.ts` |
| Route | `backend/src/routes/connect.routes.ts` |
| Controller | `backend/src/controllers/connect.controller.ts` |
| Summary orchestrator | `backend/src/services/businessFinancialSummary.service.ts` |
| Payout aggregator | `backend/src/services/stripeConnectPayout.service.ts` |
| Webhook | `backend/src/webhooks/stripe.webhook.ts` |
| Schema | `backend/prisma/schema.prisma` (`StripeConnectPayout`) |
| Transfer recon (not hero) | `backend/src/services/businessPayoutReconciliation.service.ts` |

---

## 18. Tests performed

| Test | Result |
|------|--------|
| Static code trace (frontend → API → DB → Stripe) | **Complete** |
| Live DB query for observed business | **Not run** (read-only audit, no production access in this session) |
| Stripe Dashboard period capture | **Not run** — user must confirm Balance Summary date range |
| Row-level €0.45 identification | **Pending** — requires export diff |
