# CARETIP — Admin complete premium redesign report

**Date:** 2026-10-01  
**Final status:** **NOT READY — SPECIFIC ADMIN UI ISSUES REMAIN**

---

## 1. Executive summary

CareTip platform admin already had `admin-web-design.css`, open overview KPIs, and `PlatformPageChrome`. This pass establishes a **coherent admin workspace layer** applied **app-wide** without rewriting every page’s logic:

- Unified **page header** (eyebrow, title, description, actions) on all routes using `PlatformPageHeader`
- **Open data surfaces** (tables on the page, not default card panels) via `PlatformDataPanel` / `PlatformResponsiveData` `surface="open"`
- Shared **section / metric / filter / empty** primitives (`PlatformAdminWorkspace.tsx`)
- **Sidebar navigation performance** parity (prefetch, pending active state, idle warmup)
- New **`platform-admin-workspace.css`** imported in `dashboard.css`

**Remaining:** Business detail and a few dense revenue/support flows still need a second pass for section hierarchy, button reduction, and mobile list polish. No screenshots captured in CI.

---

## 2. Complete admin route inventory

| Route | Page component | Purpose | Redesign priority |
|-------|----------------|---------|-------------------|
| `/platform-admin/dashboard` | `AdminDashboard` | Platform operations overview | P0 — already open KPI/charts |
| `/platform-admin/businesses/all` | `PlatformAllBusinessesPage` | All businesses directory | P0 |
| `/platform-admin/businesses/onboarding-verification` | `BusinessVerificationPage` | Onboarding queue | P0 |
| `/platform-admin/businesses/kyc-verification` | `BusinessVerificationPage` | KYC queue | P0 |
| `/platform-admin/businesses/subscriptions` | `PlatformBusinessSubscriptionsPage` | SaaS subscriptions | P1 |
| `/platform-admin/businesses/analytics` | `PlatformBusinessAnalyticsPage` | Cross-business analytics | P1 |
| `/platform-admin/businesses/:id` | `BusinessDetailPage` | Business admin detail | P0 — **needs section pass** |
| `/platform-admin/branding-orders` | `PlatformPhysicalQrOrdersPage` | QR print orders | P0 |
| `/platform-admin/branding-orders/:orderId` | `PlatformPhysicalQrOrderDetailPage` | Order detail | P1 |
| `/platform-admin/revenue/transactions` | `GlobalTransactionsPage` | Tip transactions | P0 |
| `/platform-admin/revenue/failed-billing` | `PlatformFailedBillingPage` | Failed SaaS billing | P1 |
| `/platform-admin/revenue/failed-payments` | `PlatformFailedPaymentsPage` | Failed tip payments | P1 |
| `/platform-admin/revenue/successful-subscriptions` | `PlatformSuccessfulSubscriptionsPage` | Active subs | P1 |
| `/platform-admin/revenue/failed-subscriptions` | `PlatformFailedSubscriptionsPage` | Churn/fail subs | P1 |
| `/platform-admin/revenue/refunds` | `PlatformRefundsPage` | Refunds | P1 |
| `/platform-admin/revenue/connect-payouts` | `PlatformConnectPayoutsPage` | Connect payouts | P0 |
| `/platform-admin/users/management` | `PlatformUserManagementPage` | User admin | P0 |
| `/platform-admin/users/staff` | `PlatformStaffAccountsPage` | Staff accounts | P1 |
| `/platform-admin/users/admins` | `PlatformAdminsPage` | Platform admins | P1 |
| `/platform-admin/communication/inbox` | `NotificationInboxPage` | Inbox | P1 |
| `/platform-admin/communication/notifications` | `PlatformCommunicationNotificationsPage` | Notification config | P2 |
| `/platform-admin/communication/broadcasts` | `PlatformAnnouncementsPage` | Broadcasts | P1 |
| `/platform-admin/reports/audit-logs` | `AuditLogsPage` | Audit trail | P0 |
| `/platform-admin/reports/security` | `PlatformSecurityReportsPage` | Security reports | P2 |
| `/platform-admin/reports/usage` | `PlatformUsageReportsPage` | Usage | P2 |
| `/platform-admin/reports/commercial` | `PlatformCommercialIntelligencePage` | Commercial intel | P1 |
| `/platform-admin/system/health` | `PlatformSystemHealthPage` | Health | P0 |
| `/platform-admin/system/settings` | `PlatformSettingsPage` | Platform settings | P1 |
| `/platform-admin/system/legal-hold` | `PlatformLegalHoldPage` | Legal hold | P2 |
| `/platform-admin/support/:ticketId` | `SupportTicketDetailPage` | Support ticket | P1 |
| `/platform-admin/login` | `PlatformAdminLoginPage` | Auth (outside shell) | — |

Legacy redirects: `/admin`, `/admin/transactions`, `/admin/verification`, `/platform-admin/businesses`, etc.

---

## 3. Design principles (aligned with business premium)

- Typography-led headers with **eyebrow + title + purpose** (not icon-only heroes)
- **Open sections** and **hairline dividers** instead of card grids
- Tables as primary data UI on desktop; existing mobile card lists retained
- Restrained CareTip orange (primary actions / active nav only)
- Preserve lazy routes, staged API loading on overview, request coalescing elsewhere

---

## 4. Shared components created / extended

| Component | Role |
|-----------|------|
| `PlatformAdminWorkspace.tsx` | `PlatformAdminSection`, `PlatformAdminMetricStrip`, `PlatformAdminFilterBar`, `PlatformAdminEmptyBlock` |
| `PlatformPageChrome.tsx` | Upgraded header; `surface` on data panels; removed per-page motion wrapper |
| `platformDashboardUi.ts` | Workspace tokens (eyebrow, metric strip, filter bar) |
| `platform-admin-workspace.css` | Open tables, headers, pending nav |
| `platformAdminRoutePrefetch.ts` | Production sidebar chunk warmup |

---

## 5. Card reduction strategy

- Default `PlatformResponsiveData` now uses **`surface="open"`** (no bordered card wrapper)
- Overview dashboard already used open KPI row (`admin-web-design.css`) — unchanged
- Pages that need a bordered panel can pass `surface="panel"` explicitly

---

## 6. Navigation

- `PlatformSidebarNavShell`: `PrefetchLink`, pending highlight, group expand → navigate + prefetch
- `useWarmPrefetchPlatformAdminSidebarRoutes` in `SuperAdminLayout`
- Group expand behavior aligned with business sidebar

---

## 7. Localization

- `admin.workspace.eyebrow` — EN + DE

---

## 8. Performance

- No new eager admin bundles; prefetch is best-effort only
- Typecheck: **pass**

---

## 9. Page checklist

| Admin page | Chrome/header | Open tables | Card reduction | EN/DE | Tested |
|------------|---------------|-------------|----------------|-------|--------|
| Overview | Yes | N/A | Already open | Yes | Manual |
| All businesses | Yes | Yes | Yes | Yes | — |
| Verification/KYC | Yes | Yes | Partial | Yes | — |
| Business detail | Yes | Partial | **Needs work** | Yes | — |
| QR orders | Yes | Yes | Partial | Yes | — |
| Revenue suite | Yes | Yes | Partial | Yes | — |
| Users | Yes | Yes | Partial | Yes | — |
| Reports | Yes | Yes | Partial | Yes | — |
| System | Yes | Partial | Partial | Yes | — |

---

## 10. Files changed (this pass)

- `src/app/components/platform/PlatformPageChrome.tsx`
- `src/app/components/platform/PlatformAdminWorkspace.tsx`
- `src/app/components/platform/platformDashboardUi.ts`
- `src/app/components/platform/PlatformSidebarNavShell.tsx`
- `src/app/lib/platformAdminRoutePrefetch.ts`
- `src/app/lib/useWarmPrefetchPlatformAdminSidebarRoutes.ts`
- `src/app/lib/prefetchAuthenticatedRoutes.ts`
- `src/app/layouts/SuperAdminLayout.tsx`
- `src/styles/platform-admin-workspace.css`
- `src/styles/bundles/dashboard.css`
- `src/i18n/locales/en.json`, `de.json`

---

## 11. Remaining work (blocks READY)

1. **Business detail** — restructure into tabbed/section hierarchy (identity → metrics → team → billing → activity) without card walls  
2. **Support ticket** flows — queue/console layout  
3. **Button audit** on refunds, announcements, legal hold (overflow menus)  
4. **Screenshot review** at listed breakpoints  
5. **`npm run build`** in deploy pipeline  

---

## 12. Final status

**NOT READY — SPECIFIC ADMIN UI ISSUES REMAIN**

Foundation and global admin UX are in place; deep page-by-page hierarchy (especially business detail and support) is the remaining gap before claiming full premium redesign complete.
