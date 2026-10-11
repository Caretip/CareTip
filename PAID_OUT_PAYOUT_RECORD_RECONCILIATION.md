# Paid Out — Record-Level Reconciliation (€0.45)

**Date:** 2026-09-24  
**Scope:** Read-only record-level reconciliation for Business Dashboard **“Paid out”**  
**Business:** Maria Testerin (`cmsslwztb0003u7m02va5ghdp`)  
**Method:** Read-only Prisma query + full Stripe `payouts.list` pagination (no DB/Stripe/code changes)

---

## Executive summary

| Source | Count | Total (EUR) |
|--------|------:|------------:|
| **CareTip DB** (`paid` + `eur`) | 16 | **€1,668.90** |
| **Stripe API** (`paid` + `eur`, full pagination) | 16 | **€1,668.90** |
| **User manual sum** (reported) | unknown | **€1,668.45** |

**Finding:** CareTip and Stripe API agree **exactly** (166,890 cents). The **€0.45** gap is **not** caused by CareTip data, formula, duplicates, sync cap, or missing Stripe payouts for this business. It is **entirely explained by the manual total being €0.45 lower** than the authoritative Stripe API sum — consistent with a **manual summation / transcription error** (Outcome **E**), not a CareTip sync issue.

---

## 1. Connected Stripe account

| Field | Value |
|-------|-------|
| Business ID | `cmsslwztb0003u7m02va5ghdp` |
| Business name | Maria Testerin |
| Stripe connected account | `acct_...O8I0` (masked) |
| `stripeConnectStatus` | `ready` |
| CareTip Stripe API mode | **`test`** (`sk_test_…`) |
| Currency filter | EUR |

**Verification:** CareTip resolves `Business.stripeAccountId` server-side. Stripe `payouts.list` was called with `{ stripeAccount: <same acct_*> }`.

**Important:** Reconciliation was performed against the **Stripe test** environment configured in this dev backend. If the manual Dashboard sum was taken from **live** mode (or a different account), totals would not be comparable. The near-match (0.45 / 1668.90 = 0.027%) suggests the same test account was likely used, but **mode must be confirmed** when reviewing Dashboard screenshots.

---

## 2. CareTip paid payouts (DB)

**Query (effective):**

```sql
SELECT stripe_payout_id, amount_cents, currency, status, paid_at, stripe_created_at,
       arrival_date, stripe_account_id, business_id, last_stripe_event_type
FROM stripe_connect_payouts
WHERE business_id = 'cmsslwztb0003u7m02va5ghdp'
  AND status = 'paid'
  AND currency = 'eur'
ORDER BY stripe_created_at ASC;
```

| Metric | Value |
|--------|------:|
| **COUNT(*)** | 16 |
| **SUM(amount_cents)** | **166,890** |
| **EUR total** | **€1,668.90** |
| Non-EUR paid rows | 0 |
| Total payout rows (any status) | 16 |

**Confirmed:** Database total matches hero display (`166890 / 100 = 1668.90`).

---

## 3. Stripe API paid payouts (full pagination)

**API:** `stripe.payouts.list({ limit: 100, starting_after? }, { stripeAccount })`  
**Pagination:** Continued until `has_more = false` (not capped at 100 for this business).

| Metric | Value |
|--------|------:|
| All payouts (any status) | 16 |
| **Paid EUR payouts** | 16 |
| **SUM(amount)** | **166,890 cents** |
| **EUR total** | **€1,668.90** |
| Status breakdown | `paid:eur` × 16 |

---

## 4. Row-level reconciliation

**Match key:** `stripe_payout_id` (`po_*`)

| Classification | Count |
|----------------|------:|
| **MATCHED** | **16** |
| CARETIP_ONLY | 0 |
| STRIPE_ONLY | 0 |
| AMOUNT_MISMATCH | 0 |
| CURRENCY_MISMATCH | 0 |
| STATUS_MISMATCH | 0 |
| ACCOUNT_MISMATCH | 0 |

### Full payout register (authoritative amounts)

| # | `stripe_payout_id` (suffix) | Amount (EUR) | Status | Classification |
|---|----------------------------|-------------:|--------|----------------|
| 1 | `…VoRjomb` | 89.93 | paid | MATCHED |
| 2 | `…ZEYBj3S` | 35.51 | paid | MATCHED |
| 3 | `…q25muTbY` | 13.01 | paid | MATCHED |
| 4 | `…MZ3D8dWG` | 114.06 | paid | MATCHED |
| 5 | `…A31HQP5z` | **8.51** | paid | MATCHED |
| 6 | `…bcsLfhl3` | 124.04 | paid | MATCHED |
| 7 | `…BXw9VBGr` | **17.02** | paid | MATCHED |
| 8 | `…ENJge7aa` | **8.30** | paid | MATCHED |
| 9 | `…YnEXp0Op` | 78.54 | paid | MATCHED |
| 10 | `…lPCoJQu0` | 41.52 | paid | MATCHED |
| 11 | `…VHxNXgeA` | 51.72 | paid | MATCHED |
| 12 | `…kQZ4qSFc` | 78.55 | paid | MATCHED |
| 13 | `…i4PuNRf7` | 86.78 | paid | MATCHED |
| 14 | `…grnDPStt` | 142.96 | paid | MATCHED |
| 15 | `…AuJSOqXd` | 49.02 | paid | MATCHED |
| 16 | `…xxqLOIv0` | 729.43 | paid | MATCHED |
| | **TOTAL** | **€1,668.90** | | |

Every row: `caretip_amount_cents === stripe_amount_cents`, `delta_cents = 0`.

---

## 5. Where the €0.45 comes from

```
CareTip total:     €1,668.90  (166,890 ¢)
Stripe API total:  €1,668.90  (166,890 ¢)
Manual total:      €1,668.45  (166,845 ¢)

CareTip − Stripe API = €0.00
CareTip − Manual     = €0.45
Stripe API − Manual  = €0.45
```

### Classification: **Outcome E — manual calculation / filter error**

There is **no** CareTip-only payout, **no** Stripe-only payout, and **no** amount mismatch. The €0.45 does **not** exist in CareTip or Stripe API data.

**No single payout of €0.45 exists** in the set, so the manual sum did not omit one whole payout of that size.

**Plausible manual error patterns** (each would produce exactly **−€0.45** on the running total if one line was mis-keyed):

| Payout (suffix) | Correct (EUR) | If mis-read as (EUR) | Delta |
|-----------------|-------------:|---------------------:|------:|
| `…A31HQP5z` | 8.51 | 8.06 | −0.45 |
| `…ENJge7aa` | 8.30 | 7.85 | −0.45 |
| `…BXw9VBGr` | 17.02 | 16.57 | −0.45 |

Other causes still consistent with **E**: spreadsheet typo, rounding in an intermediate step, or summing a **net** figure on one line while others are **gross** (CareTip and Stripe API both use `Payout.amount` gross in cents).

**Not supported by data:**

- Outcome A (omitted €0.45 payout) — no such payout exists  
- Outcome B (CareTip-only €0.45) — no CareTip-only rows  
- Outcome C (amount mismatch) — all 16 rows match exactly  
- Outcome D (multiple records totaling €0.45) — no mismatched rows at all  

---

## 6. Duplicate check

```sql
SELECT stripe_payout_id, COUNT(*) FROM stripe_connect_payouts
WHERE business_id = '…' GROUP BY stripe_payout_id HAVING COUNT(*) > 1;
```

**Result:** **0 duplicates**

---

## 7. Webhook / ingestion evidence

| Observation | Detail |
|-------------|--------|
| `last_stripe_event_type` on all 16 rows | `payout.api_sync` |
| Ingestion path | Throttled `stripe.payouts.list` sync + upsert (not missing from DB) |
| Missed webhook hypothesis | **Not supported** for this business — full Stripe history (16 payouts) is present in CareTip with exact amounts |

No webhook replay or modification was performed.

---

## 8. CareTip-only / Stripe-only records

| Type | Count |
|------|------:|
| CareTip-only | **0** |
| Stripe-only | **0** |

---

## 9. 100-payout API sync limit

| Metric | Value |
|--------|------:|
| Stripe total payout objects | 16 |
| CareTip paid EUR rows | 16 |
| Exceeds 100-payout API cap? | **No** |

**Conclusion:** The sync limit does **not** affect this business. All historical paid payouts are present in CareTip.

---

## 10. Manual vs authoritative Stripe total

| Total | EUR | Authoritative? |
|-------|----:|:--------------:|
| User manual | 1,668.45 | **No** — off by €0.45 |
| **Stripe API (full pagination)** | **1,668.90** | **Yes** |
| **CareTip DB** | **1,668.90** | **Yes** (matches Stripe API) |

---

## 11. Balance Summary (€1,610.64)

**Not reconciled in this task** — reporting period unknown.

Stripe Balance Summary **€1,610.64** remains **out of scope** for the €0.45 investigation. It is almost certainly a **period-scoped reporting figure**, not an all-time paid-payout sum. **No CareTip formula change** should be based on Balance Summary.

---

## 12. Direct answers

### 1. Is CareTip's €1,668.90 actually correct according to Stripe?

**Yes.** Stripe API full-pagination total is **€1,668.90** (166,890 cents), identical to CareTip.

### 2. What is the complete Stripe API payout total?

**€1,668.90** — 16 paid EUR payouts.

### 3. Is the manual €1,668.45 calculation missing anything?

**Yes — €0.45 relative to the complete Stripe API total.** Not a missing CareTip record; the manual sum is **€0.45 low**. Most likely a **transcription or arithmetic error** on one line (see §5).

### 4. Exactly where does the €0.45 difference come from?

**Not from any identifiable payout ID in CareTip or Stripe.** Both systems agree on all 16 `po_*` IDs and amounts. The delta exists **only in the manual total**.

### 5. Is there any CareTip-only payout?

**No.**

### 6. Is there any Stripe-only payout?

**No.**

### 7. Is there any amount mismatch?

**No.** All 16 rows: `delta_cents = 0`.

### 8. Does the 100-payout sync limit affect this business?

**No.** Only 16 payouts exist.

### 9. Are all historical payouts present in CareTip?

**Yes** for this connected account in **test** mode.

### 10. Does the CareTip “Paid out” formula need changing?

**No.** Formula and implementation are correct for this business.

### 11. Does Balance Summary €1,610.64 require any CareTip change?

**No** — separate reporting scope; do not use it to alter the hero formula.

### 12. If caused by data-sync issue, what is it?

**No data-sync issue identified.** CareTip mirrors Stripe exactly. If anything, ingestion used `payout.api_sync` successfully for all rows. **Do not repair** — nothing to repair.

---

## 13. What should remain unchanged

- CareTip formula: `SUM(amount_cents) WHERE status='paid' AND currency=eur`
- No code, DB, Stripe, or label changes required for the €0.45 discrepancy
- Balance Summary comparison deferred until reporting period is documented

---

## 14. Recommended follow-up (read-only, optional)

1. Re-sum the 16 payout amounts in Stripe Dashboard **test** mode for `acct_...O8I0` and compare line-by-line to §4 table.
2. Check whether the manual spreadsheet mis-keyed **€8.51**, **€8.30**, or **€17.02** (each ±€0.45 candidate).
3. Confirm Dashboard mode (test vs live) matches CareTip backend `STRIPE_SECRET_KEY` mode.

---

## 15. Tests performed

| Step | Result |
|------|--------|
| Prisma read `stripe_connect_payouts` | 16 rows, €1,668.90 |
| Stripe `payouts.list` full pagination | 16 rows, €1,668.90 |
| Row-level `po_*` match | 16/16 MATCHED |
| Duplicate `stripe_payout_id` check | 0 |
| Sync cap relevance | N/A (< 100 payouts) |

**No production data was modified.**
