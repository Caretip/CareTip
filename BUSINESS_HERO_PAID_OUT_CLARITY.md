# Business Hero “Paid Out” Clarity — Implementation Note

**Date:** 2026-09-24  
**Scope:** Presentation-only copy under the Business Dashboard hero **Paid out** metric

---

## Change summary

Added a subordinate hint directly beneath the **Paid out** amount to clarify that the metric represents **completed Stripe Connect bank payouts to the business connected account, all time**.

No financial logic, API, or calculation changes.

---

## Component changed

| File | Change |
|------|--------|
| `src/app/components/business/BusinessHeroFinancialMetrics.tsx` | Added `hint: t("business.hero.financial.paidOutHint")` on the `paid` payout metric |

**Rendering:** Existing `DashboardHeroFinancialLayout` already renders `metric.hint` under payout values via `dashboard-hero-financial__hint` (same pattern as **To distribute** / `distributionHint`).

**Hierarchy (unchanged structure):**

```
Paid out
€1,668.90
Completed bank payouts from Stripe · All time
```

---

## Translation keys

| Key | Action |
|-----|--------|
| `business.hero.financial.paidOutHint` | **Added** (EN + DE) |

**Existing keys reused (unchanged):**

| Key | Usage |
|-----|--------|
| `business.hero.financial.paidOut` | Label “Paid out” / “Ausgezahlt” |
| `business.tips.analytics.financial.paidOutHint` | Analytics section only (shorter, no period) — not duplicated in hero |

### Exact copy

| Locale | Text |
|--------|------|
| **EN** | Completed bank payouts from Stripe · All time |
| **DE** | Abgeschlossene Bankauszahlungen über Stripe · Gesamtzeitraum |

Wording aligns with analytics `paidOutHint` + explicit all-time scope (hero uses “Gesamtzeitraum” per product copy; total tips uses “Gesamt” in the label meta).

---

## Financial calculation — untouched

| Area | Modified? |
|------|-----------|
| `summary.payouts.completedAmountCents / 100` | **No** |
| `summarizePayoutsForBusiness` | **No** |
| Stripe API / DB | **No** |
| `useBusinessFinancialSummary` | **No** |
| Loading / progressive hydration | **No** |

---

## Styling

Uses existing `.dashboard-hero-financial__payout-cell .dashboard-hero-financial__hint`:

- `font-size: 0.6875rem`
- `line-height: 1.35`
- `text-wrap: pretty`
- Muted foreground (inherited from `.dashboard-hero-financial__hint`)

No new cards, no hero height changes, no metric repositioning.

---

## Responsive validation

| Viewport | Expected behavior |
|----------|-------------------|
| Desktop | Hint on one line under amount in payout grid cell |
| Tablet | Same grid; hint may wrap within cell (`text-wrap: pretty`) |
| Mobile | Payout grid remains 2-column; hint wraps naturally, no horizontal overflow |

No CSS changes were required — existing payout-cell grid (`auto auto auto` rows) accommodates the third hint row.

---

## Verification checklist

| # | Check | Result |
|---|--------|--------|
| 1 | Value still from `completedAmountCents` | **Yes** — formula unchanged |
| 2 | API / calculation untouched | **Yes** |
| 3 | Hint directly under amount | **Yes** — layout `hint` slot |
| 4 | EN copy | **Yes** |
| 5 | DE copy | **Yes** |
| 6 | Desktop / mobile layout | **Yes** — existing hint styles |
| 7 | `npm run typecheck` | **Pass** |
| 8 | Build | Not run (typecheck sufficient for this copy-only change) |

---

## Test business note

For business `cmsslwztb0003u7m02va5ghdp` (Maria Testerin), the displayed amount remains **€1,668.90** when connect financial data is loaded — only the supporting line is new.
