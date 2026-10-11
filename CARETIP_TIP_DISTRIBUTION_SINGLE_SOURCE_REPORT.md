# CareTip Tip Distribution Single Source Report

**Date:** 2026-09-28  
**Principle:** Payout History = Stripe/business payouts only. Tip Distribution = employee tip distribution only.

---

## 1. Duplicate functionality found

On **Stripe → Payout History** (`BusinessStripePayoutsPage`), a **CareTip / Business tab** pair exposed:

| CareTip tab (`BusinessPayoutsCareTipView`) | Overlap with Tip Distribution |
|--------------------------------------------|-------------------------------|
| Employee tips awaiting business distribution | Yes — obligations list |
| Distribution row metadata (gross, fees, aged) | Yes — operational distribution |
| Held tip shares for unconnected employees | Related routing (not full distribution UI) |
| Employee Stripe connection roster | Partial overlap with Connect / team |

The **Business** tab (`ConnectPayoutsPanel`) correctly covered Stripe balances, payout history, instant payout, and payout destination.

The CareTip tab duplicated **employee tip distribution** workflows and fetched distribution-specific APIs on the payout route.

---

## 2. Payout-page elements removed

- Removed **Tabs** (CareTip / Business toggle) from `BusinessStripePages.tsx`.
- Removed embedded **`BusinessPayoutsCareTipView`** from the payout page.
- Payout page now renders **`ConnectPayoutsPanel` only** (Stripe payout operations).

**Legacy URL:** `/dashboard/stripe/payouts?view=caretip` → **301-style client redirect** to `/dashboard/tips/tip-distribution`.

---

## 3. Canonical Tip Distribution route

**`/dashboard/tips/tip-distribution`** (`TipDistributionPage`) — unchanged.

Legacy alias `/dashboard/tip-distribution` still redirects via `routes.tsx`.

---

## 4. Components / hooks removed from Payout page

| Removed from payout page | Notes |
|--------------------------|--------|
| `BusinessPayoutsCareTipView` import/render | File retained in repo (not deleted); no longer mounted on payout route |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Payout page only |
| `useSearchParams` tab state | Replaced with redirect guard for `view=caretip` |

`ConnectPayoutsPanel`, instant payout, consent, and Stripe history unchanged.

---

## 5. API requests removed from Payout page

These calls were only triggered by `BusinessPayoutsCareTipView` on the payout page and **no longer run** when visiting Payout History:

- `getEmployeeTipRoutingOverview()`
- `getEmployeeStripeConnections()`
- `getBusinessDistributionObligations()`

**Still on Payout History** (via `ConnectPayoutsPanel` / eligibility): `listMyConnectPayouts`, `getInstantPayoutEligibility`, `createInstantPayout`, `createConnectLoginLink`, etc.

**Still on Tip Distribution:** `getTipDistributionSummary`, `getTipDistributionEmployees`, `getTipDistributionHistory`, batch APIs.

---

## 6. Functionality preserved

- All backend tip-distribution and Stripe APIs unchanged.
- `TipDistributionPage` — full distribution UI, zero state, history, actions.
- Stripe Connect page — connect + employee tip **routing mode** (`EmployeeTipPayoutModeCard`).
- Dashboard hero **To distribute** metric (business distribution mode) — not part of Payout History page.
- `BusinessPayoutsCareTipView.tsx` source kept but **unmounted** (safe to delete in a later cleanup if desired).

---

## 7. Navigation verification

| Entry | Target |
|-------|--------|
| Tips → Tip Distribution | `/dashboard/tips/tip-distribution` (canonical) |
| Stripe → Payout History | `/dashboard/stripe/payouts` (Stripe only) |
| Analytics “view obligations” link | Updated to `/dashboard/tips/tip-distribution` (was `?view=caretip`) |

No new Tip Distribution item under Stripe Payout.

---

## 8. Mobile verification

Payout page loses tab chrome → single column `ConnectPayoutsPanel` (existing mobile payout workspace CSS). No new horizontal overflow introduced.

---

## 9. Tests executed

| Command | Result |
|---------|--------|
| `npm run typecheck` | **Pass** (2026-09-28) |
| `npm run test:stripe-connect-phase4-5-ui` | Updated payout ownership assertions; 2 unrelated pre-existing failures (EUR format, PaymentPage friendly message) |
| `npm run build` | **Pass** — vite built in ~1m 48s; prerender 18 SEO pages |

---

## 10. Build result

**`npm run build`** completed successfully (exit 0).

---

## Confirmation

**Business Tip Distribution now has one canonical UI location: Tips → Tip Distribution.**

Payout History is limited to Stripe/business payout operations (balances, history, instant payout, destination, consent, View in Stripe).
