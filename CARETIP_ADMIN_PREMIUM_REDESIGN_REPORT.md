# CareTip Platform Admin — Premium Redesign Report

**Date:** 2026-10-01  
**References:** `CARETIP_ADMIN_DATA_INTEGRITY_FORENSIC_AUDIT.md`, `CARETIP_ADMIN_DATA_INTEGRITY_REMEDIATION_REPORT.md`  
**Final status:** **NOT READY — SPECIFIC ISSUES REMAIN**

---

## Executive summary

This pass strengthens the **shared Admin visual system**, **Platform Overview command center**, **Business Analytics payout intelligence**, and several **secondary Admin pages**. All **data-integrity remediation** behavior remains intact (no financial logic, Stripe, scheduler, or auth changes).

A **full, page-by-page premium redesign** across every `/platform-admin/*` surface (phases 4–11 in the spec) is **not complete**. Remaining work is listed under [Remaining issues](#remaining-issues).

---

## Complete Admin route inventory

| Route | Page component | Notes |
|-------|----------------|-------|
| `/platform-admin/dashboard` | `AdminDashboard` | Redesigned KPI strip + KYC attention |
| `/platform-admin/businesses/all` | `PlatformAllBusinessesPage` | Existing open table chrome; no full IA pass this sprint |
| `/platform-admin/businesses/onboarding-verification` | `BusinessVerificationPage` | Workflow-specific KPI cards remain |
| `/platform-admin/businesses/kyc-verification` | `BusinessVerificationPage` | Same component, KYC workflow |
| `/platform-admin/businesses/subscriptions` | `PlatformBusinessSubscriptionsPage` | Subscription monitoring section |
| `/platform-admin/businesses/analytics` | `PlatformBusinessAnalyticsPage` | Open charts + payout section enhanced |
| `/platform-admin/businesses/:id` | `BusinessDetailPage` | Removed outer content card; section header |
| `/platform-admin/branding-orders` | `PlatformPhysicalQrOrdersPage` | Prior layout |
| `/platform-admin/branding-orders/:orderId` | `PlatformPhysicalQrOrderDetailPage` | Prior layout |
| `/platform-admin/revenue/transactions` | `GlobalTransactionsPage` | Remediation labels preserved |
| `/platform-admin/revenue/failed-billing` | `PlatformFailedBillingPage` | **Redirect** → subscriptions + filter |
| `/platform-admin/revenue/failed-payments` | `PlatformFailedPaymentsPage` | **Redirect** → subscriptions `filter=failed` |
| `/platform-admin/revenue/successful-subscriptions` | `PlatformSuccessfulSubscriptionsPage` | **Redirect** → subscriptions `filter=successful` |
| `/platform-admin/revenue/failed-subscriptions` | `PlatformFailedSubscriptionsPage` | **Redirect** → subscriptions `filter=past_due` |
| `/platform-admin/businesses/subscriptions` | `PlatformBusinessSubscriptionsPage` | **SSOT** for subscription ops + activity filters |
| `/platform-admin/revenue/refunds` | `PlatformRefundsPage` | Status/reason remediation preserved |
| `/platform-admin/revenue/connect-payouts` | `PlatformConnectPayoutsPage` | K-way merge + Berlin TZ preserved |
| `/platform-admin/users/management` | `PlatformUserManagementPage` | |
| `/platform-admin/users/staff` | `PlatformStaffAccountsPage` | Open section (no card wrapper) |
| `/platform-admin/users/admins` | `PlatformAdminsPage` | Open section |
| `/platform-admin/communication/inbox` | `NotificationInboxPage` | Shared inbox |
| `/platform-admin/communication/notifications` | `PlatformCommunicationNotificationsPage` | |
| `/platform-admin/communication/broadcasts` | `PlatformAnnouncementsPage` | |
| `/platform-admin/reports/audit-logs` | `AuditLogsPage` | |
| `/platform-admin/reports/security` | `PlatformSecurityReportsPage` | Open section |
| `/platform-admin/reports/usage` | `PlatformUsageReportsPage` | |
| `/platform-admin/reports/commercial` | `PlatformCommercialIntelligencePage` | |
| `/platform-admin/system/health` | `PlatformSystemHealthPage` | |
| `/platform-admin/system/settings` | `PlatformSettingsPage` | |
| `/platform-admin/system/legal-hold` | `PlatformLegalHoldPage` | |
| `/platform-admin/support/:ticketId` | `SupportTicketDetailPage` | |
| Legacy redirects | `routes.tsx` | Unchanged |

**Navigation:** `platformAdminNav.ts` + `SuperAdminLayout` / `PlatformSidebarNavShell` — prefetch, pending nav, and warmup **not modified**.

---

## Old UI problems (targeted this pass)

- Overview KPIs used a **four-up stat card grid** instead of an operational **metric strip**.
- No **composable freshness** treatment (`generatedAt` / `cacheTtlSeconds`) on overview KPIs.
- Business Analytics **payout block** was a single bordered card with a flat `<dl>`; tip vs Stripe payout separation was copy-only.
- Business Analytics charts used **heavy card chrome** on the business variant.
- Several placeholder Admin pages wrapped copy in **`contentCard`** with no hierarchy.
- No shared **status badge** primitive for future ledger/refund consistency.

---

## Design system decisions

- **Hierarchy over cards:** Continue `PlatformAdminSection`, divider-separated sections, `PlatformDataPanel` `surface="open"` for tables.
- **Metric strip:** Border-top/bottom grid (`platform-admin-metric-strip`) for KPIs — not rounded stat cards.
- **Charts:** Business analytics uses **open** chart sections (`overviewAnalyticsCard` tokens); usage reports keep panel cards.
- **Financial timezone:** `ADMIN_FINANCIAL_TIMEZONE` (`Europe/Berlin`) used in freshness formatting via `formatAdminFinancialDateTime`.
- **Status language:** Semantic badge tones (success, pending, attention, failure, dispute, neutral) for reuse on financial tables.

---

## Shared components created or extended

| Component | Location |
|-----------|----------|
| `PlatformAdminMetricCell` | `PlatformAdminDesignPrimitives.tsx` |
| `PlatformAdminFreshnessIndicator` | `PlatformAdminDesignPrimitives.tsx` |
| `PlatformAdminStatusBadge` | `PlatformAdminDesignPrimitives.tsx` |
| Existing `PlatformAdminSection`, `PlatformAdminMetricStrip`, `PlatformAdminFilterBar`, `PlatformAdminEmptyBlock` | `PlatformAdminWorkspace.tsx` |
| Re-exports | `PlatformPageChrome.tsx` |
| CSS: metric cells, status badges, freshness | `platform-admin-workspace.css` |

---

## Pages redesigned or touched (this pass)

| Area | Change |
|------|--------|
| **Overview** | Metric strip (onboarding approved, total businesses, staff, successful transactions, tip volume, pending onboarding); `PlatformAdminFreshnessIndicator`; KYC queue attention alert |
| **Business Analytics** | Open chart surfaces; header freshness; payout intelligence metric strip + stacked volume chart; Stripe vs tip copy |
| **Business Detail** | Removed single giant `contentCard`; `PlatformAdminSection` identity header |
| **Admins / Staff / Security reports** | Open sections instead of cards |
| **AdminDashboardAnalyticsCharts** | `surface="open"` when `variant="business"` |

**Not materially redesigned this pass:** Global Transactions, Refunds, Connect Payouts (already remediated), All Businesses, Onboarding/KYC queues, Subscriptions, Branding, User Management, Communication, Revenue sub-pages, Reports (except security stub), System pages — still on prior chrome mix.

---

## Data sources and financial logic preserved

- `payableStatus` / employee payable semantics — **unchanged**
- Connect Payouts **K-way merge** pagination — **unchanged**
- Stripe **`arrival_date`** for expected arrival — **unchanged**
- `payoutAnalytics` API consumption — **display only** enhanced
- `generatedAt`, `cacheTtlSeconds` — **display only**
- Payout schedule context panel — **unchanged**
- No Stripe webhook, scheduler, calculation, or schema changes

---

## Responsive and accessibility

- Metric strip: single column on narrow viewports; multi-column with vertical dividers from `sm+`.
- Status badges: text labels + border/background (not color-only).
- Overview KPI help for **Onboarding approved** retained via `hint` on metric cell.
- **German / English** strings added for freshness and payout chart copy; layout not fully audited at all breakpoints (320–1280+) for every Admin page.

---

## Performance impact

- No new eager route loads; lazy routes unchanged.
- Overview adds one lightweight API call: `fetchKycQueueMetrics` in secondary stage (parallel with existing secondary fetches).
- Payout chart uses existing recharts chunk (already loaded on analytics page).
- Sidebar prefetch / pending navigation — **untouched**.

---

## Localization

- **EN/DE** added: `admin.statsFreshness*`, `admin.overview.alerts.pendingKyc`, `admin.businessAnalyticsPage.payoutTotalVolume`, `payoutStripeVolumeHint`, `payoutCountLabel`, `payoutVolumeOverTime*`, `admin.businessDetailPage.sectionIdentity`.

---

## Tests and verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | **Pass** |
| `npm run build` | **Pass** |
| Backend merge runtime script | **Not re-run** this pass |
| E2E `e2e/platform-admin-login-perf.spec.ts` | **Not run** this pass |
| Manual EN/DE + mobile matrix | **Not completed** for all routes |

---

## Information Architecture + Clarity Consolidation

**Date:** 2026-10-01 (focused pass)

### Subscription administration

- **Removed from Revenue & Transactions sidebar:** Successful Subscriptions, Failed Billing.
- **Single surface:** Business Management → **Subscription Management** (`/platform-admin/businesses/subscriptions`).
- **Preserved functionality:** Same `PlatformSubscriptionMonitoringSection` (monitoring KPIs, billing health widgets, activity table, filters including `successful`, `failed`, `past_due`). Activity filters are now visible on the consolidated page; URL `?filter=` syncs with chips.
- **Legacy routes (redirect, not dead pages):**
  - `/platform-admin/revenue/failed-billing?filter=failed|past_due` → `/platform-admin/businesses/subscriptions?filter=…`
  - `/platform-admin/revenue/successful-subscriptions` → `/platform-admin/businesses/subscriptions?filter=successful`
  - `/platform-admin/revenue/failed-payments` → `?filter=failed`
  - `/platform-admin/revenue/failed-subscriptions` → `?filter=past_due`
- **Backend/APIs:** Unchanged; only presentation and navigation.
- **Overview alert:** Failed payments today links to Subscription Management with `filter=failed`.
- **Prefetch:** Legacy revenue URLs prefetch the subscriptions page module.

### Global Transactions readability

- Ledger table `min-w-[72rem]` with column min-widths, truncation + `title` tooltips for IDs and business names.
- Financial columns use `whitespace-nowrap` and right-aligned tabular nums.
- Employee payable column uses `PlatformAdminStatusBadge` + `adminPayableStatusTone` (semantics unchanged; still `payableStatus`).

### Admin Inbox

- Platform admin uses the same **flush/open** inbox layout as Employee/Business (`flushSurface` + `.platform-dashboard` CSS for `.inbox-feed-panel` without outer card chrome).

### Audit Logs

- User column: removed `break-all`; `table-fixed` + dedicated user column width; horizontal truncation with full email on hover.
- Action/Details: truncate so long JSON does not crush the User column.

### Copy / hyphens

- No broad hyphen stripping; remediation labels (e.g. em dash in payable statuses) kept. New subscription section titles use plain typography (EN/DE `overviewTitle`, `healthTitle`).

### Verification (this pass)

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass |
| `admin-failed-transactions-clarity-runtime.ts` | Run locally after nav assertion update |
| `npm run build` | Not re-run in this pass |

---

## Remaining issues (why NOT READY)

1. **Incomplete route coverage:** Financial ops pages (transactions, refunds, connect payouts) need a unified **open ledger** visual pass without touching logic; business management tables still mix card/panel patterns.
2. **Business Detail:** Single large section — spec calls for distinct **Financial snapshot**, **Operational status**, and **Activity** sections without nested mini-cards everywhere.
3. **Onboarding / KYC / Subscriptions:** KPI card grids (`BusinessOnboardingKpiCards`, etc.) not migrated to metric strips + queue tables.
4. **Physical branding, Users, Communication, Announcements, Legal Hold:** Operational table IA not fully redesigned.
5. **Global status system:** `PlatformAdminStatusBadge` created but **not wired** into refunds/connect/transactions tables yet.
6. **Mobile pass:** Deliberate stacked row patterns not verified on every Admin page at 320–430px.
7. **Automated regression:** Admin/data runtime scripts and perf e2e not executed in this pass.

---

## Build result

```
npm run typecheck  → exit 0
npm run build      → exit 0 (vite + SEO prerender)
```

---

## Recommendation

Continue phases **4–11** using the new primitives: apply `PlatformAdminFreshnessIndicator` on financial pages, migrate verification KPIs to strips, wire `PlatformAdminStatusBadge` to ledger/refund/connect columns, and complete Business Detail sectioning — **without** modifying protected backend behavior.

When the above remaining issues are closed and manual/automated verification is green, update this document to:

**READY — ADMIN PREMIUM REDESIGN COMPLETE**
