# CareTip — Business Dashboard Hero Vertical Spacing Refinement

**Status:** READY

**Date:** 2026-10-02

---

## Root cause

1. **`dashboard-hero-financial__hint-slot`** used `min-height: 2.65em`, reserving ~two lines under the main KPI even when the hint is a single line (“Erhaltene Kundentrinkgelder seit CareTip-Start.”).
2. **Stacked gaps** between primary and payout zones: panel `gap` (0.625–0.75rem), payout `margin-top` (0.375rem), and payout `padding` (~0.69rem top).
3. **Desktop flex composition:** `business-hero-cta-block` and financial panel used `flex: 1 1 auto` with **`margin-top: auto`** on the CTA row, pushing “Statistiken & Berichte” / “Trinkgeld-Historie” to the bottom of the left column and exaggerating empty vertical space in the hero.

No negative margins, transforms, or absolute positioning were used.

---

## Spacing before → after (business hero)

| Element | Before (approx.) | After (approx.) |
|--------|------------------|-----------------|
| Hint slot below KPI value | `min-height: 2.65em` + `margin-top: 0.35rem` | `min-height: 0`, `margin-top: 0.2rem` |
| Panel gap (primary → payout) | 0.625rem (0.75rem @ lg) | **0.375rem** ( **0.5rem** @ lg) |
| Payout zone offset | `margin-top: 0.375rem`, padding ~0.69rem | `margin-top: 0.125rem`, padding **0.5rem** (mobile) / **0.56rem** (lg) |
| CTA row separation | `margin/padding-top: 0.875rem` (1rem @ lg) | **0.625rem** / **0.75rem** @ lg |
| Desktop CTA anchor | `margin-top: auto` + flex grow | **`flex: 0 1 auto`**, fixed margin above CTAs |

---

## Elements affected

- `src/styles/business-dashboard-hierarchy.css` (business-scoped only)
- `BusinessHeroFinancialMetrics` / `DashboardHeroFinancialLayout` (unchanged markup)
- Employee hero unchanged

---

## Desktop / mobile

- **Desktop (≥1024px):** Stripe metrics sit closer to KPI hint; CTAs follow metrics with comfortable, smaller separation (not bottom-pinned).
- **Mobile:** Same hint-slot and zone tightening; CTA row slightly reduced top padding; illustration column untouched.

---

## Validation

| Command | Result |
|---------|--------|
| `npm run test:business-hero-vertical-spacing` | run locally |
| `npm run typecheck` | run locally |

---

**Definition of done:** KPI → Stripe metrics gap is smaller but breathable; CTAs sit naturally higher via layout rhythm, not hacks.
