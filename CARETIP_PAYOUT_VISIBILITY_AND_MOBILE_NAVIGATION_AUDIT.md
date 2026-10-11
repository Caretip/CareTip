# CARETIP — Payout Schedule Visibility + Mobile Sidebar Navigation Audit

**Date:** 2026-09-28  
**FINAL STATUS:** **READY FOR REVIEW**

---

## 1. Executive Summary

Two independent UX issues were audited:

| Issue | Root cause | Fix |
|--------|------------|-----|
| Employee payout schedule missing on **Payout History** while business shows schedule on **Stripe Payout → Payouts** | **Route/layout parity**, not balance. Employee schedule lived only on `/employee/payments/connect`; business schedule lives on the single payouts workspace (`ConnectPayoutsPanel`). | Added `EmployeeBankPayoutScheduleCard` (with existing `businessDistribution` guard) to `EmployeePayoutHistoryPage`. |
| Mobile sidebar feels slow and forces repeated hamburger opens for sibling nav | Parent expand called `onNavigate` (closes drawer) and every child link closed the drawer. Perceived delay compounded by 200ms expand animation + lazy route load on parent-driven navigation. | Mobile drawer stays open when expanding a parent group or selecting a child under that group; top-level links still close the drawer. Applied to **Business** (`BusinessSidebarNavShell`) and **Employee** (`EmployeeSidebarNav`). |

No payout calculations, schedulers, Stripe payout creation, or transfer/release logic was changed.

---

## 2. Business Payout Schedule Visibility

**UI:** `BusinessBankPayoutScheduleCard` inside `ConnectPayoutsPanel` (`src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx`).

**Route:** `/dashboard/stripe/payouts` → `BusinessStripePayoutsPage` → `ConnectPayoutsPanel`.

**Nav labels:** “Connect” → `/dashboard/stripe/connect`; “Payout History” (payouts) → `/dashboard/stripe/payouts`. Schedule appears on the **payouts** route only (combined workspace with metrics, schedule, activity).

**Data path:**

- Component → `getBusinessBankPayoutSchedule` / `patchBusinessBankPayoutSchedule`
- API → `businessBankPayoutSchedule.service.ts` → Stripe Connect account `settings.payouts.schedule`

**Visibility conditions (`ConnectPayoutsPanel`):**

```tsx
const showConnectedRails =
  Boolean(bootLoading) ||
  eligibilityLoading ||
  eligibility == null ||
  eligibility.connected === true;

{showConnectedRails ? <BusinessBankPayoutScheduleCard ... /> : null}
```

**Not gated on:** available balance, pending balance, instant available, schedule value, subscription tier, or mobile breakpoint.

**Gated on (indirectly):** Connect eligibility loading / disconnected state (`eligibility.connected === false` and not loading hides schedule).

---

## 3. Employee Payout Schedule Visibility

**UI:** `EmployeeBankPayoutScheduleCard` (`src/app/components/employee/EmployeeBankPayoutScheduleCard.tsx`).

**Data path:**

- Component mount → `getEmployeeBankPayoutSchedule` / `patchEmployeeBankPayoutSchedule`
- API → `employeeBankPayoutSchedule.service.ts` → `EmployeeStripeAccount` + Stripe schedule

**Before fix — pages:**

| Route | Schedule card |
|-------|----------------|
| `/employee/payments/connect` | Yes, if `!businessDistribution` |
| `/employee/payments/history` | **No** |

**Parent guard (`EmployeePaymentsConnectPage`):**

```tsx
{!businessDistribution ? <EmployeeBankPayoutScheduleCard /> : null}
```

`businessDistribution` from `getEmployeeConnectStatus()` → `isEmployeeBusinessDistributionMode(employeeTipPayoutMode)`.

**Card internals:** No balance checks; loads schedule API on mount; shows loading/error/empty via local state only.

---

## 4. Exact Root Cause of the Difference

**Primary:** **Frontend route split**, not API failure or zero balance.

- Business “Payout History” nav item points to the payouts workspace that **includes** the schedule card.
- Employee “Payout History” nav item points to `EmployeePayoutHistoryPage`, which **never rendered** the schedule card.
- Users comparing screenshots were on **equivalent nav labels** but **different page compositions**.

**Secondary (only if user is on Connect page):** `businessDistribution === true` hides the card by design.

**Not the cause:** €0.01 vs €0.00 available balance.

---

## 5. Balance / Connect / Distribution Conditions

| Condition | Business schedule | Employee schedule (direct Connect) |
|-----------|-------------------|----------------------------------|
| Available balance = 0 | Shown (if connected/loading rails) | Shown |
| Balance &lt; €1 | Shown | Shown |
| Pending only | Shown | Shown |
| Instant unavailable | Shown | Shown |
| Connect not ready / disconnected | Hidden when `eligibility.connected === false` and loaded | Card still mounts; API may error/empty |
| Business distribution mode | N/A (business account) | **Hidden** (correct: employee does not control Connect bank cadence) |

---

## 6. Recommended Product Behavior

- **Direct Connect employees:** Payout schedule is a **persistent preference** for Stripe bank payout cadence; it should appear wherever they manage payout history, matching business payouts workspace semantics.
- **Business-distribution employees:** Do **not** show employee bank schedule; show `EmployeeTipDistributionNotice` instead (unchanged).

---

## 7. Changes Made to Payout Visibility

**File:** `src/app/pages/employee/EmployeePayoutHistoryPage.tsx`

- Load `businessDistribution` + business name (same sources as Connect page).
- Render `EmployeeTipDistributionNotice` when in business-distribution mode.
- Render `EmployeeBankPayoutScheduleCard` when **not** in business-distribution mode (above history tabs).

`EmployeePaymentsConnectPage` unchanged (schedule remains on Connect rail).

---

## 8. Sidebar Architecture

| Role | Desktop | Mobile drawer |
|------|---------|----------------|
| Business | `BusinessSidebar` → `BusinessSidebarNavShell` (no `onNavigate`) | `BusinessMobileSidebar` → `BusinessSidebarNavShell` with `onNavigate={onClose}` |
| Employee | `EmployeeSidebar` → `EmployeeSidebarNav` | `EmployeeMobileSidebar` → `EmployeeSidebarNav` with `onNavigate={onClose}` |

**Business groups:** `useBusinessSidebarNavState` — route drives `expandedGroupId`; single open group.

**Employee groups:** Local `expanded` state; `useEffect` expands when `groupActive`.

**Shared patterns:** Parent `button` with `aria-expanded`; children as `Link`; 200ms `grid-template-rows` transition on expand panel.

---

## 9. Sidebar Delay Root Cause

**Contributing factors (combined perception):**

1. **Navigation logic:** Expanding an inactive parent called `navigate(defaultHref)` **and** `onNavigate()` → drawer closed immediately while route/lazy chunk loaded.
2. **Drawer close on every child tap:** Sibling navigation required reopening the menu.
3. **CSS:** `duration-200` expand animation on parent panel (minor; expansion is synchronous in React).
4. **Lazy routes:** Employee/business child routes use `routeLazy` in `routes.tsx` — first navigation can wait on chunk load (not prefetched on parent expand).

**Not identified as primary:** auth/bootstrap blocking sidebar clicks, `setTimeout` in nav handlers, or API calls on menu tap.

---

## 10. Mobile Parent/Child Navigation Behavior

**Before:**

- Tap parent (collapsed, inactive) → expand + navigate to default + **close drawer**.
- Tap child → navigate + **close drawer**.

**After (mobile only, when `onNavigate` is passed):**

- Tap parent → expand (+ navigate to default if group inactive); **drawer stays open**.
- Tap child under group → navigate; **drawer stays open** (sibling switching without hamburger).
- Tap top-level link → still **closes drawer** (`onNavigate` preserved on `SidebarLink` / `EmployeeSidebarLink`).

**Desktop:** Unchanged (`onNavigate` undefined).

---

## 11. Changes Made to Navigation

| File | Change |
|------|--------|
| `src/app/components/business/sidebar/BusinessSidebarNavShell.tsx` | Removed `onNavigate?.()` from parent group expand; removed `onClick={onNavigate}` from child `Link` elements. |
| `src/app/components/employee/EmployeeSidebarNav.tsx` | Same for `EmployeeSidebarGroup` parent handler and child links. |

---

## 12. Business Navigation Verification

**Expected (manual / staging):**

- Mobile: Stripe Payout → expand → Connect ↔ Payout History without closing drawer.
- Desktop: Expand/collapse and active states unchanged.
- Top-level Dashboard links still close mobile drawer.

---

## 13. Employee Navigation Verification

**Expected (manual / staging):**

- Mobile: Payments group → Connect ↔ History with drawer open.
- Payout History now shows schedule when employee controls Connect payouts.

---

## 14. Responsive Verification

Automated: frontend `tsc --noEmit` and `npm run build` (see §17).

Manual checklist (recommended on staging):

- Widths: 320, 360, 375, 390, 412, 430 px — parent expand, sibling nav, drawer close on top-level only.
- 768+, 1024+, 1440+ — desktop sidebar unchanged.

---

## 15. Accessibility Verification

- Parent buttons retain `aria-expanded` / `aria-controls`.
- Child links retain `aria-current="page"` when active.
- Drawer still closable via header control and overlay (`MobileDrawer`).
- **Note:** Keeping drawer open after child navigation may require users to dismiss drawer explicitly; overlay tap still closes (existing behavior).

---

## 16. Tests Executed

| Command | Result |
|---------|--------|
| `npm run typecheck` (repo root) | Pass |
| `npx tsc --noEmit` (backend) | Pass |
| `npx tsx scripts/employee-bank-payout-schedule-runtime.ts` | Pass |
| `npx tsx scripts/business-bank-payout-schedule-runtime.ts` | Pass |
| `npm run build` (repo root) | Pass |

No dedicated frontend unit tests exist for sidebar or schedule page placement.

---

## 17. Test Results

- **Typecheck:** OK  
- **Backend tsc:** OK  
- **Runtime schedule scripts:** OK  
- **Frontend build:** OK (`npm run build`, exit 0).

---

## 18. Files Changed

- `src/app/pages/employee/EmployeePayoutHistoryPage.tsx`
- `src/app/components/employee/EmployeeSidebarNav.tsx`
- `src/app/components/business/sidebar/BusinessSidebarNavShell.tsx`
- `CARETIP_PAYOUT_VISIBILITY_AND_MOBILE_NAVIGATION_AUDIT.md` (this report)

---

## 19. Files Not Changed

- Payout schedulers, cron, `internalJobs.routes.ts` tick logic
- `employeeBankPayoutSchedule.service.ts`, `businessBankPayoutSchedule.service.ts`
- Stripe payout creation, tip release, transfers
- `EmployeePaymentsConnectPage.tsx` (schedule already present)
- `ConnectPayoutsPanel.tsx`, business routes
- Auth, authorization, GDPR
- Mobile native app

---

## 20. Remaining Risks / Limitations

1. **Duplicate schedule UI** on employee Connect and History when both are visited — intentional parity with business payouts workspace; both call the same API (acceptable).
2. **Lazy route load** on first visit to a child may still feel slightly slow; drawer no longer closes, so users can switch siblings without extra taps. Optional future: prefetch child chunks on parent expand (not implemented).
3. **Business Connect route** (`/dashboard/stripe/connect`) still does not show schedule (unchanged); only payouts route does — same as before.
4. **Employee on Connect page in business-distribution mode** still correctly hides schedule; History shows distribution notice only.

---

## Clear answers (per audit request)

**Employee schedule hidden because of:**

- **Frontend conditional rendering / page composition** (schedule not mounted on History page) — **fixed**.
- **Not** balance, **not** API absence on History (API was simply not invoked there before fix).
- **Business distribution mode** still hides schedule on both Connect and History (correct).

**Sidebar delay / repetition caused by:**

- **Navigation logic** (`onNavigate` closing drawer on parent expand and every child click).
- **Lazy route loading** (secondary, on first navigation).
- **200ms CSS expand animation** (minor).

---

*Do not deploy from this document alone; review diff and run staging QA.*
