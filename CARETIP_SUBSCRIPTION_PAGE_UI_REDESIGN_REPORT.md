# CARETIP — Subscription Page UI Redesign Report

**Date:** 2026-09-30  
**Route:** `/dashboard/billing/subscription`  
**Scope:** Presentation / UX only (billing logic unchanged)

---

## 1. Existing UI audit

| Layer | Implementation |
|--------|----------------|
| **Page shell** | `BusinessBillingLayout.tsx` — `BusinessModuleWorkspaceHeader`, billing sub-nav outlet |
| **Subscription content** | `BusinessBillingSubscriptionPage.tsx` → `BusinessSettingsBillingPanel.tsx` |
| **Current plan** | `BillingSubscriptionSummary.tsx` — `useBillingStatus` / `BillingStatus` DTO |
| **Lifecycle / cancel** | `BillingSubscriptionLifecycle.tsx`, cancel in `BillingPlanManagement.tsx` |
| **Plan comparison** | `BillingPlanManagement.tsx` — `buildPricingTierCatalog`, `PricingTierCard`, `PricingBillingToggle` |
| **Pricing source** | `pricingPlanCatalog.ts`, `pricingConfig.ts`, Stripe checkout/portal APIs |
| **Entitlements** | Unchanged — `resolveBillingPlanKey`, `hasOperationalBillingPlan`, upgrade/downgrade helpers |

States preserved: loading (`useBusinessPageBoot`), error + retry, no plan, sponsored, trial, active paid, cancel-at-period-end, billing disabled.

---

## 2. Design system / components reused

- `BusinessModuleWorkspaceHeader`, `businessUi.modulePageShell`
- `caretipBtnPrimary` / `caretipBtnSecondary` (Manage Plan)
- `PricingTierCard` **`variant="subscription"`** (existing subscription layout)
- `buildBillingPlanComparisonFeatures` (billing-specific feature bullets)
- `PricingBillingToggle`, `BillingStatusBadge`
- Dashboard shell tokens via `billing-subscription-workspace.css` + existing `caretip-pricing-premium.css`

---

## 3. Header redesign

- Module **eyebrow** now uses `business.billing.moduleTitle` (“Billing” / “Abrechnung”) instead of “Subscription”, avoiding duplicate “Subscription” + “Billing & subscription”.
- **Title** remains `business.settings.panels.billingTitle` — “Billing & subscription”.
- **Subtitle** unchanged: “Manage your plan and invoices.”

---

## 4. Current plan summary

- Restructured into `billing-subscription-summary__main`: plan name + status badge, fact row (price / billing interval / trial days / cancellation scheduled), renewal details, Manage Plan CTA.
- Shows **billing interval** only when present on `BillingStatus` and not on internal Basic.
- **Cancellation scheduled** surfaced in summary facts when `cancelAtPeriodEnd` (detail copy still in `BillingSubscriptionLifecycle`).

---

## 5. Billing cycle selector

- Wrapped in `billing-plan-management__toolbar` with plan comparison title/description.
- **Save 20%** shown as subordinate text when yearly cycle selected (existing i18n).
- Toggle styling tightened via `caretip-pricing-billing-toggle--in-panel`.

---

## 6. Plan cards

- `PricingTierCard` with `variant="subscription"`, `featureList` from `buildBillingPlanComparisonFeatures`.
- Flex layout: footer pinned to bottom; removed forced **28rem** min-height in billing context.
- **Current plan**: subtle primary border, muted “Current plan” badge styling (less dominant orange).

---

## 7. Feature lists

- Billing comparison strings from `business.billing.planComparison.*` (not marketing page features).

---

## 8. Responsive

- Summary: column on mobile, row on `md+` for plan block vs Manage Plan.
- Toolbar: stacked on mobile; toggle + cancel on one row on `sm+`.
- Plan grid: existing `caretip-pricing-tiers__grid` (unchanged breakpoints).

---

## 9. Accessibility

- Existing `aria-labelledby`, toggle labels, busy states on async buttons preserved.
- Status communicated via `BillingStatusBadge` + text (not color-only).

---

## 10. i18n

- EN: header eyebrow via existing `moduleTitle`.
- DE: `moduleTitle` = “Abrechnung” (already present).
- Reused `planComparisonTitle`, `planComparisonDesc`, `billingInterval`, cycle labels.

---

## 11. Performance

- No new API calls or dependencies.
- Same `useBillingStatus` single fetch.

---

## 12. Billing / business logic preserved

No changes to: Stripe checkout/portal, cancel scheduling, plan keys, prices, entitlements, webhooks, `createBillingCheckoutSession`, upgrade/downgrade rules, trial eligibility.

---

## 13. Files changed

| File |
|------|
| `src/styles/billing-subscription-workspace.css` (new) |
| `src/styles/bundles/dashboard.css` |
| `src/app/pages/business/billing/BusinessBillingLayout.tsx` |
| `src/app/components/business/settings/billing/BillingSubscriptionSummary.tsx` |
| `src/app/components/business/settings/billing/BillingSubscriptionLifecycle.tsx` |
| `src/app/components/business/settings/billing/BillingPlanManagement.tsx` |

---

## 14. Tests run

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npm run test:subscription-billing-ux-frontend` | Pass (8 groups) |

---

## 15. Build

Full `npm run build` not re-run in this pass; typecheck green. Run build in CI before deploy.

---

## 16. Routes / states verified (code-level)

- `/dashboard/billing/subscription` — layout + panel composition
- Manage Plan portal vs scroll-to-plans routing (unchanged)
- Monthly/yearly toggle drives card pricing display only
- Sponsored path unchanged in `BillingPlanManagement`

---

## Final status

**READY — SUBSCRIPTION PAGE REDESIGN COMPLETE**

_Manual check recommended: Pro current plan, cancel-at-period-end, Basic free, yearly toggle, EN/DE on narrow viewports._
