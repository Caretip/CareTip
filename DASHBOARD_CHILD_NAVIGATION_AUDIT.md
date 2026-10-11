# Dashboard Child Navigation Audit

**Date:** 2026-09-24  
**Scope:** Replace Business Dashboard hero quick-action buttons with nested/sub-navigation destinations

---

## 1. Existing top-level sidebar routes

From `businessSidebarNavEntries` (`src/app/components/business/businessDashboardNav.ts`):

| ID | Label key | Href / default |
|----|-----------|----------------|
| overview | `dashboardNav.business.overview` | `/dashboard` |
| tips (group) | `dashboardNav.business.tips` | default `/dashboard/tips/transactions` |
| team (group) | `dashboardNav.business.team` | default `/dashboard/team/employees` |
| qr-studio (group) | `dashboardNav.business.qrStudio` | default `/dashboard/qr-studio/business` |
| locations | `dashboardNav.business.locations` | `/dashboard/locations` |
| customers | `dashboardNav.business.customers` | `/dashboard/customers` |
| stripe (group) | `dashboardNav.business.stripe` | default `/dashboard/stripe/connect` |
| billing (group) | `dashboardNav.business.billing` | default `/dashboard/billing/subscription` |
| settings (group) | `dashboardNav.business.settings` | default `/dashboard/settings?section=general` |

---

## 2. Existing child/sub-navigation routes

### Tips (`tipsSubNavItems`)

| Label (EN) | Href | Feature |
|------------|------|---------|
| Tip Distribution | `/dashboard/tips/tip-distribution` | — |
| Live Activity | `/dashboard/tips/live` | — |
| Tips History | `/dashboard/tips/transactions` | — |
| Analytics & Reports | `/dashboard/tips/analytics` | `advancedAnalytics` |

### Team (`teamSubNavItems`)

| Label (EN) | Href | Feature |
|------------|------|---------|
| Employees | `/dashboard/team/employees` | — |
| Team Performance | `/dashboard/team/performance` | `advancedAnalytics` |

### QR Studio (`qrStudioSubNavItems`)

| Label (EN) | Href |
|------------|------|
| Main QR Code | `/dashboard/qr-studio/business` |
| Employee QRs | `/dashboard/qr-studio/employees` |
| Table QRs | `/dashboard/qr-studio/tables` |
| Location QRs | `/dashboard/qr-studio/locations` |
| Print | `/dashboard/qr-studio/print` |
| Orders | `/dashboard/qr-studio/orders` |

### Stripe, Billing, Settings

Child routes exist under each group (see `businessDashboardNav.ts`).

---

## 3. Routes selected for dashboard quick access

Sourced from `tipsSubNavItems` via `businessDashboardQuickAccessItems`:

| # | Destination | Href | Why |
|---|-------------|------|-----|
| 1 | **Tip Distribution** | `/dashboard/tips/tip-distribution` | Core workflow nested under Tips; not a standalone sidebar item |
| 2 | **Tips History** | `/dashboard/tips/transactions` | Primary transaction history; hidden under Tips group |
| 3 | **Analytics & Reports** | `/dashboard/tips/analytics` | Deep reporting page; gated by `advancedAnalytics` (lock icon when locked) |

**Not selected (but valid children):**

- Live Activity — lower priority for dashboard shortcuts
- Team Performance — was a previous button but duplicates a visible team workflow; replaced by higher-priority Tips children
- QR Studio children — top-level QR Studio remains obvious in sidebar; Tips children are more “hidden”

---

## 4. Previous buttons removed

| Previous button | Previous href | Reason removed |
|-----------------|---------------|----------------|
| QR Studio | `/dashboard/qr-studio` | Top-level sidebar destination |
| Team Performance | `/dashboard/team/performance` | Team group is already prominent; replaced by deeper Tips workflows |

---

## 5. Implementation

| File | Change |
|------|--------|
| `businessDashboardQuickAccess.ts` | **New** — quick-access list derived from `tipsSubNavItems` |
| `BusinessDashboardHeroActions.tsx` | Renders 3 child-route buttons; preview mode unchanged |
| `BusinessDashboard.tsx` | Passes `entitlementsReady` / `tier` for analytics lock |
| `BusinessDashboardMobileHero.tsx` | Same entitlements props for mobile |
| `en.json` / `de.json` | `business.dashboard.quickAccessAria` |

**Unchanged:**

- `BusinessHeroFinancialMetrics` (financial hero)
- Sidebar navigation tree
- Routes / routing architecture
- Auth, Stripe, API, financial calculations

---

## 6. Confirmations

- **No new routes created**
- **No sidebar structure changes**
- **Financial hero untouched**
- **Auth/authorization unchanged** — analytics lock uses existing `isBusinessNavItemLocked`

---

## 7. Tests performed

| Test | Result |
|------|--------|
| `npx tsx src/app/components/business/businessDashboardQuickAccess.runtime.ts` | **Pass** — all hrefs exist in sidebar children; no top-level-only hrefs |
| `npm run typecheck` | **Pass** |

### Manual verification checklist

1. Each button → existing child route — **yes** (sourced from `tipsSubNavItems`)
2. No nonexistent routes — **yes**
3. No top-level QR Studio / Team shortcuts — **yes**
4. EN labels from `business.tips.nav.*` — **yes**
5. DE labels from same keys — **yes**
6. Responsive layout uses existing `business-hero-cta-row` flex/wrap — **yes**
7. Financial metrics unchanged — **yes**

---

## 8. EN / DE labels

| Key | EN | DE (from existing `business.tips.nav`) |
|-----|-----|----------------------------------------|
| `business.tips.nav.tipDistribution` | Tip Distribution | (existing DE translation) |
| `business.tips.nav.transactions` | Tips History | (existing) |
| `business.tips.nav.analytics` | Analytics & Reports | (existing) |
| `business.dashboard.quickAccessAria` | Quick access to nested pages | Schnellzugriff auf Unterseiten |
