# CareTip Product Review — Phase 1 Implementation Report

**Date:** 2026-10-05  
**Scope:** Backend foundation only (no UI).  
**Reference audit:** `CARETIP_PRODUCT_REVIEW_SYSTEM_AUDIT.md`

---

## 1. Implementation summary

Introduced an isolated **Platform Product Feedback** stack for authenticated **MANAGER** and **EMPLOYEE** users to submit CareTip product reviews, plus **platform-admin** list/detail/summary/status APIs. The existing guest/customer **`TipFeedback`** pipeline under `/api/feedback` was not modified.

---

## 2. Files created

| Path |
|------|
| `backend/prisma/migrations/20261005160000_platform_product_feedback/migration.sql` |
| `backend/src/lib/platformProductFeedbackValidation.ts` |
| `backend/src/services/platformProductFeedback.service.ts` |
| `backend/src/controllers/platformProductFeedback.controller.ts` |
| `backend/src/routes/productReview.routes.ts` |
| `backend/scripts/platform-product-review-runtime.ts` |

---

## 3. Files modified

| Path | Change |
|------|--------|
| `backend/prisma/schema.prisma` | New enum + model + relations on `User`, `Business`, `Employee` |
| `backend/src/index.ts` | Mount `/api/product-reviews` |
| `backend/src/routes/platform.routes.ts` | Platform admin product-review routes |
| `backend/src/config/securityRateLimit.config.ts` | `productReviewMe` limits |
| `backend/src/middleware/securityRateLimit.middleware.ts` | `productReviewMeRateLimit` |
| `backend/src/services/anonymization.service.ts` | Scrub `comment` on user anonymization |
| `backend/package.json` | `test:platform-product-review` script |
| `security/pentest-preparation/_internal/_extract_routes.mjs` | Route inventory mount |
| `.gitignore` | Allow tracking this report |

**Not modified:** `feedback.routes.ts`, `feedback.controller.ts`, `feedback.service.ts`, guest/business customer feedback frontend, or `RatingPage.tsx`.

---

## 4. Prisma model / schema changes

- **Enum:** `PlatformProductFeedbackAdminStatus` → `new`, `read`, `archived`
- **Model:** `PlatformProductFeedback` → table `platform_product_feedback`
- **Fields:** `userId` (unique), `submitterRole`, `businessId?`, `employeeId?`, `rating` (1–5), `comment?`, `adminStatus`, timestamps
- **FKs:** `user` → `Restrict`; `business` / `employee` → `SetNull` (no financial cascade)

---

## 5. Migration details

- **Migration:** `20261005160000_platform_product_feedback`
- **Operations:** `CREATE TYPE`, `CREATE TABLE`, indexes, FKs only
- **No** changes to `tip_feedback` or existing tables
- **Applied:** `npm run db:migrate:deploy` succeeded (2026-10-05)

---

## 6. API endpoints

### User (authenticated)

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/product-reviews/me` | MANAGER or EMPLOYEE, verified email, onboarding (managers only) |
| `POST` | `/api/product-reviews/me` | Same + `productReviewMeRateLimit` |

### Platform admin (`/api/platform` and `/api/admin` alias)

| Method | Path |
|--------|------|
| `GET` | `/api/platform/product-reviews/summary` |
| `GET` | `/api/platform/product-reviews` |
| `GET` | `/api/platform/product-reviews/:id` |
| `PATCH` | `/api/platform/product-reviews/:id` (`adminStatus` only) |

**Not under** `/api/feedback/*`.

---

## 7. Authorization matrix

| Action | MANAGER | EMPLOYEE | Platform admin |
|--------|---------|----------|----------------|
| POST/GET `/me` | Yes (own business context) | Yes (own employee context) | No |
| Platform list/detail/summary/patch | No | No | Yes (`requirePlatformAdmin`) |

Ownership (`userId`, `businessId`, `employeeId`, `submitterRole`) is **server-derived**; client fields rejected with 400.

---

## 8. Validation rules

- `rating`: required integer 1–5
- `comment`: optional; trim; reject empty when provided; max **2000** chars
- Forbidden body keys: `userId`, `businessId`, `employeeId`, `submitterRole`, `adminStatus` (user routes)
- Admin PATCH: only `adminStatus`; rejects `rating`, `comment`, ownership fields

---

## 9. Rate-limit configuration

| Setting | Default | Window |
|---------|---------|--------|
| `SEC_PRODUCT_REVIEW_IP_MAX_PER_15M` | 40 | 15 min |
| `SEC_PRODUCT_REVIEW_USER_MAX_PER_15M` | 15 | 15 min |

- **Keys:** `sec:product-review:ip:{ip}`, `sec:product-review:user:{userId}`
- **429:** `{ message: "Too many feedback submissions. Please try again later." }` (same user-facing copy as other feedback limiters; **separate** limiter from `feedbackTipRateLimit`)

---

## 10. GDPR / lifecycle integration

- **Anonymization:** On `anonymizeUser`, `platform_product_feedback.comment` set to `null` for that `userId` (row retained; `userId` FK `Restrict` — user row is tombstoned, not deleted).
- **Deferred:** Dedicated retention category / DSAR export bundle inclusion (documented in audit; not required for Phase 1 correctness).
- **RLS:** `platform_product_feedback` not yet added to `enable_rls_public_tables.sql` — follow-up if Supabase RLS policy requires parity with other PII tables.

---

## 11. Audit logging

- Admin status changes → `writeAuditLog` action `platform_product_feedback.admin_status_changed` with JSON metadata `{ feedbackId, from, to }` (no comment body).

---

## 12. Tests added

- `npm run test:platform-product-review` (`backend/scripts/platform-product-review-runtime.ts`)
  - Validation unit cases
  - Service create/upsert/uniqueness/adminStatus reset/summary
  - HTTP cases when `RUNTIME_API_BASE` is reachable (skipped if API down)

---

## 13. Existing tests executed

| Command | Result |
|---------|--------|
| `npm run test:platform-product-review` | **PASS** (HTTP skipped — API not on localhost:3001) |
| `npm run test:sprint3-guest-flow` | **PASS** (16/16) |
| `npm run test:external-review-links` | **PASS** |
| `npm run build` (backend) | **PASS** |

---

## 14. Existing review regression results

- `sprint3-guest-flow`: RatingPage + `submitTipFeedback` wiring unchanged
- `external-review-links`: “CareTip internal tip feedback endpoint still present”
- Runtime script probes `POST /api/feedback/tip` and `GET /api/feedback/business` when API is up
- **No diffs** on `feedback.controller.ts`, `feedback.service.ts`, `feedback.routes.ts`

---

## 15. Security verification

- Separate API namespace and rate limiter from guest tip feedback
- Role gating + platform admin DB check
- Ownership injection rejected
- Admin mass-assignment on PATCH rejected
- Pagination `take` capped at **100**, `skip` bounded via `parseBoundedSkip`

---

## 16. Build / typecheck results

- `npm run db:generate` — OK  
- `npm run build` (backend `tsc`) — OK  
- Migration deploy — OK  

---

## 17. Known limitations

- HTTP integration tests require a running API (`RUNTIME_API_BASE`, default `http://localhost:3001`).
- No in-app/email notifications (Phase 2+).
- No DSAR export section for product feedback yet.
- Summary includes **all** rows regardless of `adminStatus` (archived still counts toward product-health metrics).

---

## 18. Deferred Phase 2+ work

- Business / employee / admin UI
- Notifications
- DSAR export + retention category
- Edit cooldown / resubmission cadence
- OpenAPI/Postman regeneration from inventory (mount added to `_extract_routes.mjs` only)

---

## EXISTING CUSTOMER FEEDBACK PROTECTION

**Verified unchanged:**

| Asset | Verification |
|-------|----------------|
| `TipFeedback` / `tip_feedback` | No migration or schema edits |
| `/api/feedback/tip`, `/api/feedback/business` | Files untouched; regression scripts pass |
| `queryEmployeeRatingAggregates`, `listBusinessCustomerFeedback` | No edits to `feedback.service.ts` |
| `customerFeedback` entitlement | No subscription or route changes |
| `RatingPage`, customer feedback UI | No frontend changes in Phase 1 |
| `feedbackTipRateLimit` | Not reused; guest limiter unchanged |

**Upsert semantics (new system only):** One row per `userId`; updates preserve `createdAt`, refresh `updatedAt`, reset `adminStatus` to `new` on content change.
