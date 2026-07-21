# Phase 11 — Global Transactions Timestamp Implementation

**Date:** 2026-07-21  
**Prerequisite:** [PHASE11_GLOBAL_TRANSACTIONS_AUDIT.md](./PHASE11_GLOBAL_TRANSACTIONS_AUDIT.md)

---

## Root cause

`listGlobalTransactions` already returns `createdAt` as an ISO string. The Global Transactions desktop table and mobile card never rendered it, so admins could not correlate individual rows with Daily Tip chart day buckets or activity timelines.

---

## Chosen timestamp source

| Field | Why |
|---|---|
| **`createdAt`** (`tips.created_at`) | Sole tip timestamp on the model; already in the API; used for list sort order; same underlying column Daily Tip / platform analytics bucket on |

No backend change. No new fields. No `paidAt` / `processedAt` (not present on tip transactions).

---

## Formatting

- Pattern: `Intl` / `toLocaleString` with `{ dateStyle: "medium", timeStyle: "short" }` — same options as `PlatformRefundsPage` `formatRefundDate`.
- Locale: `i18n.language` (English vs German UI).
- Timezone: `Europe/Berlin` — matches admin platform analytics default (`ADMIN_ANALYTICS_TZ_DEFAULT`). Global list is cross-business and does not include per-row business TZ; Berlin keeps day/time aligned with platform chart buckets.
- No hardcoded display strings; header label via i18n `colDateTime`.

Example shapes (locale-dependent): `21 Jul 2026, 14:37` / `21.07.2026, 14:37`.

---

## Files modified

| File | Change |
|---|---|
| `src/app/pages/platform/GlobalTransactionsPage.tsx` | Date & time column; `formatTransactionAt`; colspan 7 |
| `src/app/components/platform/platformAdminMobileCards.tsx` | Muted datetime under business name on `PlatformTransactionMobileCard` |
| `src/app/components/dashboard/DashboardContentSkeletons.tsx` | Skeleton gains 7th column |
| `src/i18n/locales/en.json` | `admin.globalTransactionsPage.colDateTime` |
| `src/i18n/locales/de.json` | `admin.globalTransactionsPage.colDateTime` |

**Not modified:** backend routes/services, API contracts, filters, pagination, search, refund/CSV mappers, analytics aggregation.

---

## Screens / components affected

- Admin **Global Transactions** desktop table
- Admin **Global Transactions** mobile cards (`PlatformTransactionMobileCard`)
- Loading skeleton for that table only

---

## UI notes

- Typography: `text-xs` + `text-muted-foreground` + `tabular-nums` (subtle; does not compete with amount / status).
- No new colors, cards, or layout redesign beyond one column / one muted line.
- Full ISO kept on `title` for hover precision.

---

## Regression verification

| Concern | Status |
|---|---|
| Pagination (`PAGE_SIZE` / skip) | Unchanged |
| Search / debounce | Unchanged |
| Sort (server `createdAt desc`) | Unchanged |
| Fetch / cache keys | Unchanged |
| Infinite scroll / virtualization | N/A (paged table) |
| Export / CSV on this page | N/A (none on this page) |
| Refunds mapping from `GlobalTransactionRow` | Unchanged (still uses `createdAt` internally where needed) |
| Performance | Client-only format of already-fetched ISO strings |

---

## Consistency (not unified)

Activity Center still uses `occurredAt` + relative time; tip history still uses business-TZ absolute formatting where available. This change only surfaces the existing Global Transactions `createdAt` for reconciliation with day-bucket charts.
