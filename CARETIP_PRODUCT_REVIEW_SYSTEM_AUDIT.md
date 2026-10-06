# CareTip Product Review System — Pre-Implementation Audit

**Status:** Read-only investigation (no code, schema, routes, or UI changes).  
**Date:** 2026-10-05  
**Scope:** Separate in-app system for Business (MANAGER) and Employee users to submit feedback **about the CareTip product** to platform operators — distinct from guest/customer tip feedback and external review links.

---

## 1. Executive Summary

**FACT:** CareTip already has a mature **guest → business/employee** feedback pipeline centered on the `TipFeedback` model (`tip_feedback`), public `POST /api/feedback/tip`, and manager `GET /api/feedback/business` behind the `customerFeedback` subscription feature. Business UI labels this area **“Customer Feedback”** (`/dashboard/customers/feedback`). There is **no** dedicated database model, API, or dashboard for **users reviewing CareTip itself**.

**FACT:** Business users can already contact the platform via **Support tickets** (`SupportTicket`, `/api/business/support`, `/dashboard/support`) and public **contact form** categories including `product_feedback` (`src/components/contact/contactTypes.ts`) — neither is structured product NPS/review collection inside the authenticated product shell.

**RECOMMENDATION:** Introduce a **new, isolated** persistence and API surface (e.g. model `PlatformProductFeedback`, table `platform_product_feedback`, routes **not** under `/api/feedback`). Place user entry as **“Review CareTip”** in Business Settings and Employee nav (not under Customers). Place admin consumption under **Reports → Product feedback** (new child in `platformAdminNav.ts`), with MVP list + detail + simple aggregates.

**RECOMMENDATION (MVP):** 1–5 star rating + optional comment (max ~2k chars) + role/business context snapshots at submit; **one upsertable submission per user** (or edit window — product decision); platform-only read; lightweight rate limits; optional admin in-app notification (no email blast).

**Major risks:** Naming/route collision with `/api/feedback`; accidental reuse of `CustomerFeedback*` UI; cross-tenant data leaks on admin list; free-text PII in comments; GDPR erasure/anonymization not wired if added as an afterthought.

**UNKNOWN (product):** Subscription gating (“premium” as tier vs. polish), resubmission cadence, whether employees without verified email can submit, and whether managers and employees at the same business should dedupe to one business-level score.

---

## 2. Existing Review System — What It Does

### 2.1 Purpose and actors

| Dimension | **Guest / customer tip feedback (existing)** |
|-----------|-----------------------------------------------|
| **Submitter** | Anonymous guest after successful Stripe Checkout (`POST /api/feedback/tip`, no auth) |
| **Recipient / consumer** | Business **MANAGER** (dashboard) |
| **Entity reviewed** | Service experience tied to a **successful tip `Transaction`** (employee/location/table context) |
| **Not** | CareTip product satisfaction, employee peer review, or Google/TripAdvisor ratings stored in CareTip |

**FACT — external review links:** Google/TripAdvisor URLs are configuration on locations/business (`backend/src/lib/externalReviewLinks.ts`, `src/app/lib/externalReviewLinks.ts`, `GuestExternalReviewLinks` on `RatingPage.tsx`). When configured, `guestReviewExperience()` can hide in-app CareTip rating UI in favor of external links — still **not** the new product-review feature.

### 2.2 Data model (Prisma)

**File:** `backend/prisma/schema.prisma` (model `TipFeedback`, table `tip_feedback`)

- **Relationships:** `transactionId` **unique** → `Transaction` (`onDelete: Cascade`)
- **Tenant fields:** `businessId`, optional `employeeId`, `locationId`, `tableId`
- **Content:** `rating` (Int? 1–5), `comment` (Text?), `tags` (String[]), `customerName` (nullable; **not stored** on submit — forced `null` + `nameAnonymizedAt`)
- **Timestamps:** `createdAt`, `updatedAt`
- **Indexes:** `businessId`, `employeeId`, `createdAt`
- **Migrations:** `backend/prisma/migrations/20260420124434_init/migration.sql`, `20260810140100_tip_feedback_employee_nullable`, `20260817120000_gdpr_retention_policy_v1` (`name_anonymized_at`)

**FACT:** No moderation status, admin notes, or platform-admin visibility on `TipFeedback`.

### 2.3 Backend API and authorization

| Route | Auth | Authorization / gates |
|-------|------|------------------------|
| `POST /api/feedback/tip` | Public | `feedbackTipRateLimit` (`backend/src/middleware/securityRateLimit.middleware.ts`, config `SEC_FEEDBACK_TIP_IP_MAX_PER_15M` default 25/15m); validates Stripe session → successful transaction; **upsert** by `transactionId` |
| `GET /api/feedback/business` | Bearer | `MANAGER`, verified email, completed onboarding, operational subscription, feature **`customerFeedback`** |

**Files:**

- `backend/src/routes/feedback.routes.ts`
- `backend/src/controllers/feedback.controller.ts`
- `backend/src/services/feedback.service.ts`
- Mount: `backend/src/index.ts` → `app.use("/api/feedback", feedbackRoutes)`

**FACT — validation (tip submit):** Rating 1–5 if present; comment max **1500**; up to **12** tags; requires rating and/or comment and/or tags; guest name stripped.

**FACT — business list:** Paginated `take`/`skip` (max 100), optional `employeeId` filter; returns `summary` (average, counts) + items with employee names resolved in-business only.

### 2.4 Downstream use of tip feedback data

- **Employee roster ratings:** `queryEmployeeRatingAggregates()` in `feedback.service.ts` → `business.service.ts`
- **Charts:** `backend/src/utils/tipChartBuckets.ts` (SQL `LEFT JOIN tip_feedback`)
- **Dashboard widgets:** `RecentCustomerFeedbackPanel.tsx`, `CustomerFeedbackDashboardSnapshot.tsx` on `BusinessDashboard.tsx`
- **Demo seed:** `backend/prisma/seedDemoEnvironment.ts` creates `tipFeedback` rows (includes legacy `customerName` in seed only)

### 2.5 Frontend — customer (guest) flow

| Asset | Path |
|-------|------|
| Rating page | `src/app/pages/customer/RatingPage.tsx` (route `/rating`, **eager** import in `routes.tsx`) |
| API client | `submitTipFeedback()` in `src/app/lib/api.ts` |
| Tags | Canonical English API strings + i18n keys in `FEEDBACK_TAGS`; display via `src/app/lib/feedbackTagLabels.ts` |
| Styles | `src/styles/customer-feedback-workspace.css` (business workspace; guest flow uses customer flow UI) |

### 2.6 Frontend — business (manager) flow

| Asset | Path |
|-------|------|
| Routes | `/dashboard/customers/*` — `BusinessCustomersLayout.tsx`, `BusinessCustomersFeedbackPage.tsx` → `CustomerFeedbackPage.tsx` |
| Redirects | `/dashboard/reviews`, `/dashboard/customer-feedback` → `/dashboard/customers/feedback` (`routes.tsx`) |
| Nav | `businessDashboardNav.ts`: top-level **“Customer Feedback”** (`dashboardNav.business.customers`); subnav `business.customers.nav.feedback` |
| Entitlement | `FeatureGate` + `customerFeedback` in `subscriptionFeatureCatalog.ts` / `subscriptionCapabilities.ts` |
| API | `listBusinessCustomerFeedback()` → `/api/feedback/business` with inflight dedupe in `api.ts` |

**FACT — i18n framing:** `business.customers.title` = “Customer Feedback”; subtitle references **guests** and **tipping journey** (`en.json` ~6555+). German mirror in `de.json`.

### 2.7 Employees and platform admin

**FACT:** Employees have **no** API or UI to view guest `TipFeedback`.

**FACT:** Platform admin has **no** product-feedback inbox. Support is API-driven: `GET /api/platform/support/tickets` (`platform.routes.ts`) with UI primarily **ticket detail** `/platform-admin/support/:ticketId` (`routes.tsx`) and notifications (`supportTicketNotify.service.ts`). There is **no** platform-admin support **list** route in `routes.tsx` (unlike business `/dashboard/support`).

### 2.8 Related but separate “feedback” concepts

| System | Purpose |
|--------|---------|
| **Support tickets** | `SupportTicket` / `SupportTicketMessage`; business MANAGER → platform; categories `technical`, `billing`, `kyc`, `feature_request`, `general` |
| **Contact / leads** | `POST /api/lead/support` (`lead.routes.ts`); public `product_feedback` category on marketing contact form only |
| **Landing marketing** | `src/app/components/landing/FeedbackSection.tsx` (not tip feedback) |
| **Notifications** | No notification types for tip feedback; support uses `SUPPORT_TICKET_*` (`notification.types.ts`) |

### 2.9 Tests and security artifacts

- **Runtime / pentest scripts:** `backend/scripts/sprint3-guest-flow-runtime.ts`, `external-review-links-runtime.ts`, `business-logic-pentest.ts`, `api-security-sprint-runtime.ts` (assert `feedbackTip` limits)
- **E2E:** `e2e/payment-guest-flow.spec.ts` (rating / external links); `e2e/performance-stability-validation.spec.ts` mocks **`/api/business/customer-feedback`** (legacy mock path — **not** the live `/api/feedback/business` endpoint)
- **OpenAPI / Postman:** `security/pentest-preparation/*` documents `/api/feedback/*`
- **RLS inventory:** `tip_feedback` in `backend/scripts/supabase-security-pentest.ts`, `backend/prisma/repair/enable_rls_public_tables.sql`

### 2.10 GDPR / retention (existing tip feedback)

**FACT:** `guest_scrub` retention runner scrubs leftover `customerName` on `tipFeedback` (`categoryRetention.runners.ts` → `runGuestScrub`), category alias `guest` in `retentionPolicy.helpers.ts` (`RETENTION_T_GUEST_DAYS`).

**FACT:** `TipFeedback` is **not** referenced in `anonymization.service.ts` (user erasure path). Guest PII minimization is enforced at write time in `submitTipFeedback`.

---

## 3. Existing Review System — DO NOT TOUCH Boundary

**Do not modify, rename, merge, or behaviorally change** the following without a **separate authorized task**:

### 3.1 Database and migrations

- Model **`TipFeedback`**, table **`tip_feedback`**, all migrations touching it
- **Do not** add product-review columns to `tip_feedback` or reuse `transactionId` uniqueness for product reviews

### 3.2 Backend

- `backend/src/routes/feedback.routes.ts`
- `backend/src/controllers/feedback.controller.ts`
- `backend/src/services/feedback.service.ts`
- `POST /api/feedback/tip`, `GET /api/feedback/business` contracts (status codes, upsert semantics, entitlements)
- `feedbackTipRateLimit` and `securityRateLimit.config.ts` `feedbackTip` block
- `queryEmployeeRatingAggregates`, `getBusinessFeedbackSummary`, `listBusinessCustomerFeedback` signatures and SQL
- `tipChartBuckets.ts` join logic for analytics

### 3.3 Frontend (guest + business customer feedback)

- `src/app/pages/customer/RatingPage.tsx`, route `/rating`
- `submitTipFeedback`, `listBusinessCustomerFeedback`, types `CustomerFeedbackRow` / `CustomerFeedbackSummary` in `api.ts`
- `CustomerFeedbackPage.tsx`, `BusinessCustomersFeedbackPage.tsx`, `BusinessCustomersLayout.tsx`
- Components under `src/app/components/business/feedback/*`, `RecentCustomerFeedbackPanel.tsx`, `CustomerFeedbackListItem.tsx`
- `feedbackTagLabels.ts`, `customerFeedbackDashboardInsights.ts`
- Nav keys and routes: `/dashboard/customers/feedback`, redirects from `reviews` / `customer-feedback`
- `customerFeedback` feature flag and `FeatureGate` on customer feedback pages
- External review link behavior (`externalReviewLinks.ts`, `GuestExternalReviewLinks.tsx`)

### 3.4 Seeds, scripts, and tests tied to tip feedback

- `seedDemoEnvironment.ts` tip feedback seeding/purge
- Guest-flow runtime scripts and `e2e/payment-guest-flow.spec.ts` expectations
- Pentest/OpenAPI entries for `/api/feedback/*` (update only when intentionally changing tip feedback — out of scope here)

### 3.5 Safe separation rule for the new feature

- **New** Prisma model and table name **must not** be `TipFeedback`, `Review`, or `Feedback` without a distinct prefix (e.g. `PlatformProductFeedback`).
- **New** HTTP mount **must not** be `/api/feedback/*`.
- **New** frontend routes **must not** live under `/dashboard/customers/*` or reuse `CustomerFeedback*` component names.

---

## 4. Proposed CareTip Product Review Concept

**Intent:** Authenticated users answer: *“How is your experience with CareTip?”* so operators can measure satisfaction, diagnose product issues, and segment **MANAGER vs EMPLOYEE** experiences.

**Consumer:** Users with `requirePlatformAdmin` access (`Role.SUPER_ADMIN` + `isPlatformAdmin` + active + verified — `auth.middleware.ts`).

### 4.1 Field-by-field evaluation

| Field | MVP? | Why | Privacy | Ops value | Maintenance |
|-------|------|-----|---------|-----------|-------------|
| `rating` (1–5) | **MVP** | Single KPI, filters, trends | Low | High | Low |
| `comment` (text, optional) | **MVP** | Qualitative insight | **High** (PII risk) | High | Medium (moderation) |
| `submitterRole` snapshot (`MANAGER` \| `EMPLOYEE`) | **MVP** | Segment experiences | Low | High | Low |
| `userId` | **MVP** | Auth, erasure, abuse | Personal data | High | Low |
| `businessId` (+ optional `employeeId`) | **MVP** | Context for support follow-up | Business relationship | High | Low |
| `createdAt` / `updatedAt` | **MVP** | Ordering, trends | Low | High | Low |
| `locale` / `appVersion` snapshot | Later | Debug reports | Low | Medium | Low |
| Optional **product area** enum (e.g. payouts, QR, billing) | Later | Structured themes | Low | Medium | Medium |
| **Sentiment** (ML) | **Out of MVP** | — | — | Low vs cost | High |
| **Admin status** (`new` / `read` / `archived`) | **MVP (minimal)** | Inbox hygiene | N/A | Medium | Low |
| **Admin internal notes** | Post-MVP | CRM-style follow-up | N/A | Medium | Low |
| **Follow-up state** | Post-MVP | Ops workflow | N/A | Medium | Medium |
| Public visibility | **Never** | — | — | — | — |

**RECOMMENDATION:** Smallest useful architecture = dedicated table + submit + “my submission” read + admin list/detail + aggregate endpoint (avg + count + histogram).

**UNKNOWN:** Whether “premium” means **subscription-gated** UI or **quality bar only**. **FACT:** Guest customer feedback is Pro-gated; product feedback could remain **ungated** to maximize signal (recommendation: no `customerFeedback` coupling).

---

## 5. Recommended User Experience (Business + Employee)

### 5.1 Placement and label

**FACT — naming conflict:** Business sidebar already uses **“Customer Feedback”** for guests (`dashboardNav.business.customers`). Subnav item is **“Feedback”** under Customers (`business.customers.nav.feedback`).

**RECOMMENDATION — label:** **“Review CareTip”** (EN) / **“CareTip bewerten”** or **“CareTip-Feedback”** (DE — finalize with native copy review). Avoid **“Feedback”** alone and avoid **“Reviews”** under Customers.

**RECOMMENDATION — placement:**

| Role | Location | Route (proposed) |
|------|----------|------------------|
| **MANAGER** | **Settings** group: new section id e.g. `review-caretip` in `businessSettingsSections.ts` **or** dedicated top-level link immediately above Settings (lower risk of confusion than Customers) | `/dashboard/settings?section=review-caretip` **or** `/dashboard/review-caretip` |
| **EMPLOYEE** | Flat nav link before **Settings** (`employeeDashboardNav.ts`) | `/employee/review-caretip` |

**Rationale:** Keeps guest “Customers” module semantically pure; mirrors mature SaaS “Help improve [Product]” patterns; settings-adjacent signals low-frequency, thoughtful action.

**Icon (RECOMMENDATION):** Distinct from `inbox` (customers) — e.g. `sparkles`, `message`, or CareTip icon variant; match `CareIconName` conventions in `businessDashboardNav.ts` / `employeeDashboardNav.ts`.

### 5.2 Page flow (conceptual)

1. Workspace header: title **Review CareTip**, short trust copy (“Your feedback goes to the CareTip team only — not your guests or employer’s customer reviews”).
2. Star input (1–5), required for submit **OR** require at least rating **or** comment (align with tip feedback rule).
3. Optional textarea with character counter (recommend **2000** max, slightly above tip 1500 for product context).
4. Submit → success state explaining how feedback is used; no full-screen branded loader (use inline/button loading per dashboard patterns).
5. **Empty/first-time:** Form ready.
6. **Already submitted (MVP):** Show current submission + “Update” if within edit policy, else read-only thank-you with last submitted date.

### 5.3 MVP behavior decisions (recommended)

| Topic | RECOMMENDATION |
|-------|----------------|
| Multiple submissions | **One row per `userId`** (upsert); post-MVP add cooldown (e.g. 90 days) for new row |
| Edit | Allow update for **7 days** after submit, then read-only |
| Duplicate spam | Rate limit per user + IP; server-side upsert |
| Network errors | Toast + retry; preserve form state |
| Validation | Mirror tip feedback clarity; i18n validation messages |
| Contextual prompts | Post-MVP (after payout, after onboarding) |
| Employee employer visibility | **Never** expose to business MANAGER |

**UNKNOWN:** Whether managers should see a nudge on business dashboard (could be confused with customer feedback widget).

---

## 6. Recommended Admin Experience

### 6.1 Information architecture

**FACT — current admin nav** (`platformAdminNav.ts`): groups Overview, Business Management, Physical Branding, Revenue, Users, **Communication**, **Reports**, System. No support list entry.

**RECOMMENDATION:** Add under **Reports** group:

- Label: **“Product feedback”** (admin) / avoid “Reviews” without “Product”
- Route: `/platform-admin/reports/product-feedback` (list) + optional `/platform-admin/reports/product-feedback/:id` (detail)

**Alternatives considered:**

- **Communication:** Better for outbound/inbox; product feedback is inbound analytics — weaker fit.
- **Support:** Conceptually related, but support tickets are threaded incidents; mixing dilutes SLA workflows.
- **Dedicated top-level:** Justified only if volume is very high — not needed for MVP.

### 6.2 MVP admin UI

- Summary cards: total count, average rating (30d + all-time), simple 1–5 distribution bar
- Table: date, role, business name (link to existing business detail), rating, comment excerpt, status `new`/`read`
- Detail drawer/page: full comment, user email (platform admin only), business/employee ids, mark read/archive
- Filters: role, rating range, date range, status; search comment text (post-MVP full-text if needed)

### 6.3 Post-MVP admin analytics

- Trend line (weekly avg rating)
- Role mix pie chart
- Tag/product-area breakdown when enums exist
- Export CSV
- Integration with Commercial Intelligence page — optional, not MVP

**FACT:** Platform support ticket admin notifications already use `listPlatformAdminUserIds()` + high priority multi-channel (`supportTicketNotify.service.ts`). Product feedback can mirror **in-app only** for MVP.

---

## 7. Recommended Information Architecture (summary)

| Surface | Item | Must not collide with |
|---------|------|------------------------|
| Business nav | **Review CareTip** (settings or standalone) | **Customer Feedback** (`/dashboard/customers`) |
| Employee nav | **Review CareTip** | Tip activity / inbox |
| Admin nav | **Reports → Product feedback** | Communication broadcasts |
| API | `/api/product-reviews` (example) | `/api/feedback` |
| i18n root | `productReview.*` or `caretipReview.*` | `business.customerFeedback.*` |

Mobile: reuse dashboard shell side drawers (`EmployeeSidebarNav.tsx`, business sidebar patterns); no new global loader.

---

## 8. Recommended Data Model

**RECOMMENDATION — new model (conceptual, not implemented):**

```prisma
// Illustration only — DO NOT apply in this audit task
model PlatformProductFeedback {
  id            String   @id @default(cuid())
  userId        String   @map("user_id")
  submitterRole Role     @map("submitter_role") // MANAGER | EMPLOYEE at submit time
  businessId    String?  @map("business_id")
  employeeId    String?  @map("employee_id")

  rating        Int?     @db.SmallInt  // 1-5
  comment       String?  @db.Text

  adminStatus   PlatformProductFeedbackAdminStatus @default(new)

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user     User      @relation(...)
  business Business? @relation(...)
  employee Employee? @relation(...)

  @@unique([userId]) // MVP one active submission per user — REVISIT if cadence added
  @@index([createdAt(sort: Desc)])
  @@index([adminStatus, createdAt(sort: Desc)])
  @@index([businessId])
  @@map("platform_product_feedback")
}
```

**Relationships:**

- **User:** required; `onDelete` → **Restrict** or **SetNull** on anonymization job — **not** cascade delete financial graph
- **Business / Employee:** optional FKs for context; validate employee belongs to business on submit
- **No FK** to `TipFeedback`, `Transaction`, or `SupportTicket`

**Indexes:** As above; add `(submitterRole, createdAt)` if role filters are hot.

**Uniqueness:** MVP `@@unique([userId])` simplifies UX; change to `(userId, period)` if recurring surveys are required.

**Lifecycle:**

- User erasure: redact `comment`, clear/direct identifiers per `anonymization.service.ts` patterns; retain anonymized aggregate row **or** delete row if no legal hold (product/legal choice)
- Business closure: keep feedback for platform analytics; strip `businessId` only if business deletion policy requires — **avoid** cascade that deletes feedback when business tips are preserved
- **New retention category** recommended: e.g. `product_feedback` in `retentionPolicy.helpers.ts` (parallel to `guest`, `support`) — **UNKNOWN** legal retention period

**Auditability:** Log admin status changes via existing `audit.service.ts` / platform audit patterns on `/api/platform` routes.

---

## 9. Security Model

### 9.1 Authorization matrix (target)

| Action | MANAGER | EMPLOYEE | Other business | Platform admin |
|--------|---------|----------|----------------|----------------|
| Submit product review | Yes (own business context) | Yes (own employee context) | — | No |
| Read own submission | Yes | Yes | — | — |
| Read others’ submissions | **No** | **No** | **No** | **Yes (all tenants)** |
| Update admin status / notes | No | No | No | Yes (`requirePlatformAdmin`) |

**FACT — platform admin gate:** DB-backed `requirePlatformAdmin` — do not trust JWT role alone.

**FACT — business tip feedback:** `GET /api/feedback/business` scopes by `getBusinessByUserId` — replicate **explicit** user-id scope for product reviews; never accept `businessId` from client for reads.

### 9.2 Controls

- **Rate limiting:** Dedicated limiter (user + IP), stricter than generic API; do not reuse `feedbackTipRateLimit` (keeps guest boundary clean)
- **Input:** Max lengths; reject null bytes; store plain text; render escaped in UI (React default); no HTML whitelist needed if not rendered as HTML
- **IDs:** Opaque cuid; admin detail by id — platform only
- **Enumeration:** 404 for other users’ ids on any mistaken endpoint; list endpoints role-gated
- **Mass assignment:** DTO whitelist — only `rating`, `comment` (and later `productArea`) writable by users
- **Tenant isolation:** Admin queries may join business name; export controls for admin UI
- **Audit:** `auditPlatformAccess` on new `/api/platform/product-feedback/*` routes

**UNKNOWN:** Whether non-`MANAGER` business staff roles exist in future; today **FACT:** support and customer feedback are **MANAGER-only**.

---

## 10. GDPR / Data Lifecycle

| Topic | Recommendation |
|-------|----------------|
| Lawful basis | Legitimate interest / contract improvement — **confirm with legal** (UNKNOWN) |
| Privacy notice | Update privacy policy & in-product disclosure near form (feedback may contain personal opinions/PII) |
| Data minimization | Do not require name/email in form (already on `User`) |
| DSAR export | Include in `lifecycleExport` user export bundle when implemented |
| Erasure | On `anonymizeUser`, redact comment + disassociate or delete row; respect `legalHold` categories |
| Free-text PII | Warn users not to include guest/staff PII; admin training |
| Backups | Standard retention; no special case |
| Employee vs manager | Same erasure rules per `userId` |

**FACT:** Tip feedback guest scrub is separate (`guest` category). Product feedback should **not** piggyback on `guest_scrub`.

---

## 11. Notification Strategy

| Option | MVP | Notes |
|--------|-----|-------|
| In-app to platform admins | **Optional** | New `NotificationType` e.g. `PRODUCT_FEEDBACK_SUBMITTED`; use `listPlatformAdminUserIds()` pattern |
| Email per review | **No** | Spam risk; support tickets already email admins |
| Push | **No** for MVP | Unless volume is low and product insists |
| Digest (daily) | Post-MVP | Better for scale |
| User preference | Post-MVP | No admin preference surface exists for support emails today beyond orchestrator channels |

**RECOMMENDATION:** MVP = **no notification** OR **in-app only, deduped** per feedback id; revisit when volume known.

---

## 12. Internationalization

**FACT:** EN/DE via `src/i18n/locales/en.json` and `de.json`; dashboards use `useTranslation()`.

**New key namespaces (RECOMMENDATION):**

- `productReview.title`, `productReview.subtitle`, `productReview.ratingLabel`, `productReview.commentLabel`, `productReview.commentPlaceholder`, `productReview.submit`, `productReview.success.*`, `productReview.error.*`, `productReview.alreadySubmitted`, `productReview.privacyNote`
- `dashboardNav.business.reviewCaretip`, `dashboardNav.employee.reviewCaretip`
- `business.settings.sections.reviewCaretip` (+ description) if settings section
- `admin.reports.productFeedback.*` (list, columns, filters, empty states)
- Validation messages mirrored in DE with formal “Sie” consistency for business/admin copy

**Do not** overload `business.customerFeedback.*` or `tipFlow.*` keys.

---

## 13. Performance Architecture

**FACT — patterns to follow:**

- Lazy routes via `routeLazy()` (`routes.tsx`) for new pages
- Dashboard CSS bundle already loaded for business/employee shells
- `listBusinessCustomerFeedback` inflight dedupe in `api.ts` — replicate for `getMyProductReview` + admin list query keys
- React Query: if existing pages use hooks, match cache keys and stale times (inspect neighbor settings/support pages)
- Loading: skeleton/inline spinners; **no** new global `CareTipPageLoader` for this feature
- Mobile: single-column form, touch-friendly stars (min tap target)

---

## 14. Analytics Strategy

### Core product feedback data (MVP)

- Average rating (all-time, 30d)
- Count by star
- Submissions by `submitterRole`
- Recent comments list

### Nice-to-have (post-MVP)

- NPS-style trend, cohort by plan tier, correlation with churn, word clouds, AI summarization, Jira integration

**Avoid** building a full embedded BI tool; export to warehouse later if needed.

---

## 15. Abuse / Quality Controls (MVP)

| Threat | Mitigation |
|--------|------------|
| Duplicate spam | `@@unique([userId])` upsert + user rate limit |
| Low-effort ratings | Optional minimum comment length for ≤2 stars (post-MVP) |
| Profanity | Admin archive; no AI moderation MVP |
| Long text | Server max length |
| XSS | Plain text + React escaping |
| Gaming averages | One vote per user; admin exclude archived from aggregates |
| Bot abuse | Auth required + rate limits |

---

## 16. API Design (proposed, not implemented)

### User/authenticated (`/api/product-reviews` example mount)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PUT` or `POST` | `/api/product-reviews/me` | MANAGER or EMPLOYEE, verified email, onboarding rules as applicable | Upsert own feedback |
| `GET` | `/api/product-reviews/me` | Same | Return own row or `null` |

**Validation:** Rating integer 1–5 if present; at least one of rating/comment; comment max 2000; strip whitespace.

**Errors:** 401, 403, 400, 429, 503 consistent with `httpErrors.ts` patterns.

### Platform admin (`/api/platform/product-reviews` under existing `platform.routes.ts` stack)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/platform/product-reviews` | Paginated list + filters |
| `GET` | `/api/platform/product-reviews/summary` | Aggregates for dashboard cards |
| `GET` | `/api/platform/product-reviews/:id` | Detail |
| `PATCH` | `/api/platform/product-reviews/:id` | `adminStatus`, later `adminNotes` |

**Pagination:** `take`/`skip` with caps like feedback business list.

**Do not implement** public POST or guest endpoints.

---

## 17. Testing Strategy

### Unit tests

- Validation (rating bounds, empty payload, comment length)
- Authorization helpers (role, user scope)
- Upsert/uniqueness per user
- Aggregate math (distribution, average)

### Integration / API tests

- Manager submit + read own
- Employee submit + read own
- Cross-user read denied (404/403)
- Cross-tenant admin list includes multiple businesses
- Non-admin denied on platform routes
- Rate limit returns 429
- Admin PATCH status

### E2E

- Business: navigate to Review CareTip → submit → success (EN + DE)
- Employee: same
- Admin: Reports → Product feedback → open detail → mark read
- Mobile viewport nav
- Regression: `e2e/payment-guest-flow.spec.ts` unchanged guest rating
- Regression: business customer feedback page still gated on `customerFeedback`

### Regression explicit list

- `POST /api/feedback/tip` upsert by session still works
- `GET /api/feedback/business` entitlement unchanged
- `RatingPage` external review hide/show logic unchanged
- `queryEmployeeRatingAggregates` unchanged outputs

---

## 18. Safe Code Reuse Opportunities

| Asset | Classification |
|-------|----------------|
| `routeLazy`, dashboard layouts, `BusinessModuleWorkspaceHeader` | **SAFE** |
| `useTranslation`, toast (`sonner`), form primitives (Input, Textarea, Button) | **SAFE** |
| Star rendering pattern (`lucide-react` `Star`, see `CustomerFeedbackRatingDisplay.tsx`) | **SAFE** (copy pattern, do not import customer-feedback-specific component if it pulls wrong i18n) |
| `apiRequest`, `getHeaders`, error mapping | **SAFE** |
| `getPageSessionCache` pattern (`BusinessSupportPage.tsx`) | **SAFE** |
| `requirePlatformAdmin`, `auditPlatformAccess`, `platform.routes.ts` mounting | **SAFE** |
| `listPlatformAdminUserIds`, `deliverNotificationToUsers` | **SAFE** (new notification type) |
| `feedback.service.ts`, `feedback.controller.ts`, `feedback.routes.ts` | **RISKY — do not extend** |
| `submitTipFeedback`, `listBusinessCustomerFeedback` | **RISKY — do not extend** |
| `CustomerFeedbackPage` and `components/business/feedback/*` | **RISKY — separate components** |
| `FeatureGate` + `customerFeedback` | **RISKY** unless product explicitly ties gating |
| `POST /api/lead/support` | **RISKY** — different channel; do not merge |

---

## 19. Risks / Unknowns

| Risk | Severity | Mitigation |
|------|----------|------------|
| Naming collision (“feedback”, “reviews”) | High | Distinct routes, labels, table, API mount |
| Accidental refactor of tip feedback | High | DO NOT TOUCH list + CI regression |
| PII in comments | Medium | Disclosure + admin process |
| Admin platform stores emails in exports | Medium | Access control + audit |
| One-review-per-user hides sentiment drift | Low | Post-MVP cadence |
| E2E mocks wrong path (`/api/business/customer-feedback`) | Low | Do not “fix” unless tasked; new tests use real paths |
| No platform support list UI precedent | Low | Build list UI for product feedback; optional later for support |
| Legal retention period for product feedback | Unknown | Legal input |
| Subscription gating | Unknown | Default: open to all authenticated roles |

---

## 20. MVP Scope

- New table/model and migration (separate task)
- User upsert + get own (MANAGER + EMPLOYEE)
- Business + employee UI pages and nav entries (**Review CareTip**)
- Admin list + detail + mark read/archived + summary aggregates
- EN/DE strings
- Rate limiting + validation
- Basic tests (unit + API + one E2E per role)
- Privacy copy on form
- Optional in-app admin notification (single channel)

**Out of MVP:** AI sentiment, email digests, product-area enums, admin notes, Jira, contextual triggers, subscription tier analytics, user-facing history of past submissions beyond current row.

---

## 21. Post-MVP Scope

- Resubmission cadence (quarterly check-in)
- Product-area tags + filter chips
- Admin internal notes + assignee
- Trend charts and CSV export
- Digest notifications
- DSAR export inclusion
- Retention category automation
- Prompts after key milestones (onboarding complete, first payout)
- NPS / CES variants

---

## 22. Recommended Implementation Phases

### Phase 0 — Design sign-off (no code)

- Resolve UNKNOWNs: gating, cadence, edit window, lawful basis text
- Approve naming: table, API mount, routes, i18n keys

### Phase 1 — Backend foundation

- Prisma model + migration
- `productReview.service.ts` (new file — **not** `feedback.service.ts`)
- User routes + platform routes
- Rate limiter config
- Unit + integration tests

### Phase 2 — User-facing UI

- Business page/section + employee page
- Nav + i18n EN/DE
- Wire API hooks, loading/error states

### Phase 3 — Admin UI

- Reports nav child + list/detail pages
- Summary API consumption
- Admin tests

### Phase 4 — Hardening

- Notifications (if approved)
- GDPR export/erasure hooks
- Documentation + observability (structured logs, no PII)

### Phase 5 — Post-MVP analytics

- Trends, tags, exports

---

## 23. Explicit Out-of-Scope Items

- Any change to `TipFeedback`, `/api/feedback`, `RatingPage`, or customer feedback dashboard
- Merging with support tickets or contact form leads
- Employee/customer review features
- Renaming existing “Customer Feedback” to “Reviews”
- AI moderation
- Public/unauthenticated product review submission
- Mobile app separate binary (unless mobile web shares same routes)

---

## Appendix A — File path index (existing tip feedback system)

| Layer | Path |
|-------|------|
| Schema | `backend/prisma/schema.prisma` (`TipFeedback`) |
| Migrations | `backend/prisma/migrations/20260420124434_init/migration.sql`, `20260810140100_tip_feedback_employee_nullable`, `20260817120000_gdpr_retention_policy_v1` |
| Routes | `backend/src/routes/feedback.routes.ts` |
| Controller | `backend/src/controllers/feedback.controller.ts` |
| Service | `backend/src/services/feedback.service.ts` |
| Rate limit | `backend/src/middleware/securityRateLimit.middleware.ts`, `backend/src/config/securityRateLimit.config.ts` |
| Guest UI | `src/app/pages/customer/RatingPage.tsx` |
| Business UI | `src/app/pages/business/CustomerFeedbackPage.tsx`, `customers/BusinessCustomersFeedbackPage.tsx`, `customers/BusinessCustomersLayout.tsx` |
| Nav | `src/app/components/business/businessDashboardNav.ts` |
| API client | `src/app/lib/api.ts` (`submitTipFeedback`, `listBusinessCustomerFeedback`) |
| i18n | `src/i18n/locales/en.json` (`business.customerFeedback`, `business.customers`, `dashboardNav.business.customers`) |
| Seed | `backend/prisma/seedDemoEnvironment.ts` |
| Retention | `backend/src/services/categoryRetention.runners.ts` (`runGuestScrub`) |
| Charts | `backend/src/utils/tipChartBuckets.ts` |
| External reviews | `backend/src/lib/externalReviewLinks.ts`, `src/app/lib/externalReviewLinks.ts`, `GuestExternalReviewLinks.tsx` |

## Appendix B — Related platform patterns (for new feature)

| Pattern | Path |
|---------|------|
| Support tickets (business → platform) | `SupportTicket` schema; `backend/src/routes/supportTicket.routes.ts`; `BusinessSupportPage.tsx`; `backend/src/routes/platform.routes.ts` support endpoints |
| Platform admin shell | `src/app/layouts/SuperAdminLayout.tsx`, `platformAdminNav.ts`, `PlatformAdminRoute` |
| Admin auth | `backend/src/middleware/auth.middleware.ts` (`requirePlatformAdmin`) |
| Admin notify | `backend/src/services/supportTicketNotify.service.ts` |
| Contact product_feedback (public) | `src/components/contact/contactTypes.ts`, `backend/src/controllers/lead.controller.ts` |

---

## Concise closing summary

| Question | Answer |
|----------|--------|
| **What already exists?** | Guest tip-linked `TipFeedback` + manager analytics UI (**Customer Feedback**); external Google/TripAdvisor links; business support tickets; public contact `product_feedback`. |
| **What the new system needs?** | Separate `platform_product_feedback` (name TBD), authenticated submit/read for MANAGER/EMPLOYEE, platform-admin list/analytics, **Review CareTip** nav, EN/DE, security/GDPR hooks. |
| **What must stay untouched?** | Entire `/api/feedback` stack, `tip_feedback`, `RatingPage`, customer feedback pages/components, `customerFeedback` entitlement, employee rating aggregates from tip feedback. |
| **Recommended MVP** | Rating + optional comment, one upsert per user, admin list/summary/read status, Reports nav placement, no subscription gate (unless product decides otherwise). |
| **Post-MVP** | Cadence, tags, notes, trends, digests, DSAR category, contextual prompts. |
| **Major technical risks** | API/naming collision, UI confusion with Customer Feedback, tenant leaks, PII in free text, erasure not wired. |
| **Unresolved product decisions** | Premium gating, resubmission policy, edit window, legal basis copy, employee vs manager duplicate voices per business. |
| **Next implementation phase** | **Phase 0 sign-off** on UNKNOWNs, then **Phase 1 backend** with new model and routes **not** under `/api/feedback`. |
