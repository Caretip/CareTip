# Phase 11 — Global Transactions Audit

**Scope:** Admin Dashboard → Global Transactions (`/platform/.../revenue/transactions`)  
**Mode:** Read-only architectural audit (no behavior change in this document)  
**Date:** 2026-07-21

---

## Verdict

| Question | Answer |
|---|---|
| Is the transaction timestamp returned from the backend? | **Yes** — `createdAt` (ISO-8601 string) |
| Is the frontend simply not rendering it? | **Yes** |
| Which layer removes it? | **None** — data is present end-to-end; UI never binds it |
| Timestamp field | **`createdAt`** only (`tips.created_at`). No `paidAt` / `processedAt` on tip transactions |

**Root cause:** Frontend omission. `GlobalTransactionRow.createdAt` is typed and populated; `GlobalTransactionsPage` and `PlatformTransactionMobileCard` never display it.

---

## 1. Full-stack trace

| Layer | File | Behavior |
|---|---|---|
| Route | `backend/src/routes/platform.routes.ts` | `GET /transactions` → `listTransactions` |
| Controller | `backend/src/controllers/platform.controller.ts` | Passes through service result |
| Service | `backend/src/services/platform.service.ts` → `listGlobalTransactions` | `orderBy: { createdAt: "desc" }`; maps `createdAt: t.createdAt.toISOString()` |
| Database | `backend/prisma/schema.prisma` → `Transaction` (`@@map("tips")`) | Column `createdAt` / `created_at`. **No `paidAt`.** |
| FE type / client | `src/app/lib/api.ts` | `GlobalTransactionRow.createdAt: string`; `fetchPlatformTransactions` → `/api/platform/transactions` |
| Page | `src/app/pages/platform/GlobalTransactionsPage.tsx` | Columns: id, business, amounts, fee, net, payout — **no date** |
| Mobile card | `src/app/components/platform/platformAdminMobileCards.tsx` → `PlatformTransactionMobileCard` | **Does not use `row.createdAt`** |

### Service response shape (relevant)

```ts
{
  id, amountEur, caretipFeePercent, caretipFeeEur, netToStaffEur,
  payoutStatus, tipStatus, stripePaymentIntentId,
  createdAt, // ISO string — already returned
  businessId, businessName, employeeName
}
```

---

## 2. Why `createdAt` is the correct source of truth

1. Tip rows are written once at payment success; `createdAt` is the recorded tip moment.
2. Platform list ordering already uses `createdAt desc`.
3. Daily Tip charts and platform analytics day buckets aggregate on `tips.created_at` (in business / platform TZ).
4. Business/employee tip activity lists expose the same tip `createdAt`.
5. There is no separate `paidAt` on the `Transaction` / `tips` model in this codebase.

---

## 3. Existing formatters (for implementation reuse)

| Helper | Location | Notes |
|---|---|---|
| `formatRefundDate` | `PlatformRefundsPage.tsx` | `toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })` — closest admin peer |
| `formatTime` | `AuditLogsPage.tsx` | `toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" })` |
| `formatTipDateTime` | `src/app/lib/employeeFormat.ts` | `date-fns` `"Pp"` + DE/EN locale |
| Local `formatDateTime` | `TipsActivityPage.tsx` | `"PPp"` + optional business TZ |
| Platform analytics default TZ | `ADMIN_ANALYTICS_TZ_DEFAULT = "Europe/Berlin"` | Used by admin analytics / usage reports |

**Timezone note:** Global Transactions is **cross-business**. The API does not return per-row business timezone. Platform analytics already default to `Europe/Berlin` for day bucketing. Browser-local formatting alone would diverge from Daily Tip / platform chart days for admins outside Berlin.

---

## 4. Consistency matrix (document only — do not unify)

| Surface | Source field | Origin | FE display |
|---|---|---|---|
| **Global Transactions** | `createdAt` | `tips.created_at` via `listGlobalTransactions` | **Not rendered** (data present) |
| **Business Activity** (Activity Center) | `occurredAt` | `BusinessActivityEvent.occurredAt`; tip-received often from tip `createdAt` | Relative (`formatTimeAgo`) |
| **Employee Activity** (Tip History) | `createdAt` | Same tip table via tip list / `toTipRow` | Absolute datetime (+ business TZ when available) |
| **Business Tips & Activity** | `createdAt` | Same tip list | Absolute datetime |
| **Customer Payments** | Activity `occurredAt` | Payment activity projection; some events use wall-clock at projection time | Relative via Activity Center |
| **Platform Analytics** | Day key `YYYY-MM-DD` | Bucketed from `tips.created_at` in platform TZ | Chart axis labels only |
| **Daily Tip Charts** | Day / hour buckets | `created_at AT TIME ZONE tz` (`tipChartBuckets.ts`) | Day/weekday labels, not per-tx timestamps |

### Documented inconsistencies (left as-is)

- List UIs use tip `createdAt`; Activity Center uses `occurredAt`.
- Absolute datetime vs relative “time ago”.
- Some payment activity events use projection wall-clock rather than tip `createdAt`.
- Charts expose **day buckets**, not per-transaction timestamps.
- **`paidAt` does not exist** on tip transactions in CareTip.

---

## 5. Recommended smallest fix

**Render existing `row.createdAt`** on desktop + mobile. No backend/API contract change. No business-logic change. Reuse admin `toLocaleString` pattern (Refunds), with platform default timezone alignment for correlation with Daily Tip / platform analytics.
