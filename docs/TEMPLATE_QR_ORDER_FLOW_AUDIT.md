# Template QR Code Order Flow Audit

**Date:** 2026-08-30 (updated after admin email implementation)  
**Scope:** End-to-end audit of the CareTip **Physical QR / Template QR** print order workflow (Business → Backend → Admin)  
**Type:** Audit + implementation note — admin email on paid orders implemented 2026-08-30

---

## 1. Executive summary

In CareTip, “Template QR Code orders” are implemented as **Physical QR / Physical Branding** orders — printed **A5 CareTip flyers** (`templateId: caretip-a5-flyer`), not digital QR template selection.

**Business flow:** A Premium/Enterprise manager orders from **QR Studio → Branding** (`/dashboard/qr-studio/branding`), submits product + QR target + delivery details, then pays via **Stripe Checkout**.

**Admin flow:** Platform admins manage orders at **Branding orders** (`/platform-admin/businesses/branding-orders`), progressing fulfillment (processing → printing → shipped → delivered), downloading print PDFs, and adding internal notes.

### Email notification — direct answer

> **Admin does NOT receive an email when an order is initially placed** (unpaid `PENDING_PAYMENT`).

> **Admin DOES receive email when Stripe payment succeeds** — in addition to existing in-app + push (`physical_qr_paid_admin`).

Summary:

- **No email / in-app / push** to Admin at unpaid order creation.
- **In-app + push + email** to Admin after successful Stripe payment (webhook-confirmed).
- Business managers receive **in-app + push + email** after successful payment, and **email** on printing / shipped / delivered milestones.

### Before vs after (2026-08-30 implementation)

| Event | Before | After |
|---|---|---|
| Order placed (unpaid) | No admin notification | No admin notification (unchanged) |
| Payment succeeds | Admin: in-app + push only | Admin: **in-app + push + email** |
| Business payment email | Yes | Yes (unchanged) |

---

## 2. Terminology & naming

| User-facing term | Code / DB term |
|---|---|
| Template QR Code order | **Physical QR order** |
| QR Studio → Branding | `PhysicalBrandingStudio`, route `/dashboard/qr-studio/branding` |
| A5 flyer with/without address | Products `caretip-a5-flyer-address`, `caretip-a5-flyer-no-address` |
| Old templates route | `/dashboard/qr-studio/templates` redirects to `/branding` |

Digital QR template picking (`QrTemplatePicker`) is a **separate** feature and is not part of this physical print order pipeline.

---

## 3. Business → Order submission flow

### 3.1 UI entry points

| Location | Path / file |
|---|---|
| Primary order UI | `src/app/components/business/physical-branding/PhysicalBrandingStudio.tsx` |
| Page wrapper | `src/app/pages/business/qr-studio/QrStudioBrandingPage.tsx` |
| Route | `/dashboard/qr-studio/branding` (`src/app/routes.tsx`) |
| Order detail | `src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx` |
| Order history cards | `src/app/components/business/physical-branding/PhysicalQrOrderCard.tsx` |
| Timeline | `src/app/components/business/physical-branding/PhysicalQrOrderTimeline.tsx` |
| Preview | `src/app/components/business/physical-branding/PhysicalQrPreview.tsx` |

### 3.2 Information the business provides

Collected in `PhysicalBrandingStudio.tsx` and sent on submit:

| Field | API field | Notes |
|---|---|---|
| Product variant | `productId` | With address vs without address |
| QR context type | `qrContextType` | `storefront` \| `employee` \| `table` \| `location` |
| QR subject | `qrSubjectId` | Required when context ≠ storefront |
| Printed address | `address` | Only for address-enabled product |
| Recipient name | `shipping.recipientName`, `contact.name` | |
| Street, line 2, postal, city | `shipping.*` | |
| Country | `shipping.country` | Fixed **DE** in UI |
| Contact email, phone | `contact.email`, `contact.phone` | |
| Quantity | `quantity` | UI 1–50 |
| Color tokens | `colorTokens` | Currently hardcoded defaults |

**Server ignores (never trusted):** client `unitPrice`, `totalAmount`, `paymentStatus`, `fulfillmentStatus`, `businessIdClient`, `qrTargetUrl`.

### 3.3 Submit sequence (two API calls + Stripe)

1. **`POST /api/business/physical-qr/orders`** — creates order (`PENDING` / `PENDING_PAYMENT`)
2. **`POST /api/business/physical-qr/orders/:orderId/checkout`** — creates Stripe Checkout session
3. Browser redirects to Stripe via `performExternalStripeRedirect()`
4. Stripe webhook `checkout.session.completed` marks order paid and triggers notifications

Frontend: `placeOrder()` in `PhysicalBrandingStudio.tsx` (lines ~255–280)  
API client: `createPhysicalQrOrder()`, `checkoutPhysicalQrOrder()` in `src/app/lib/api.ts`

### 3.4 Post-submit business UX

- Immediate redirect to **Stripe Checkout**
- Success return URL: `/dashboard/qr-studio/branding/orders/:id?checkout=success`
- Cancel URL: `?checkout=canceled`
- UI polls order status until `PAID` or `FAILED` (branding page + detail page)
- Order appears in order history on branding page
- **No confirmation email or in-app notification at order creation**
- After payment: business manager gets in-app + push + **email** (“Payment received”)

### 3.5 Business authorization & gating

Middleware on all business physical-QR routes (`backend/src/routes/physicalQr.routes.ts`):

- `authMiddleware`
- `requireVerifiedEmail`
- `requireRole(Role.MANAGER)`
- `requireFeature("brandingCustomization")` on create + checkout (Premium/Enterprise)

Controller resolves tenant via `resolveBusinessIdForRequest(req)` — orders scoped to manager’s business.

Feature gate in service: `hasFeature(businessId, "brandingCustomization")`.

---

## 4. API / backend flow

### 4.1 Business API routes

Base mount: `/api/business/physical-qr` (`backend/src/index.ts`)

| Method | Route | Handler |
|---|---|---|
| GET | `/catalog` | Product catalog |
| GET | `/contexts` | QR subject options |
| POST | `/contexts/resolve` | Resolve target URL |
| GET | `/orders` | List own orders |
| GET | `/orders/:orderId` | Order detail |
| PATCH | `/orders/:orderId` | Patch (limited) |
| **POST** | **`/orders`** | **Create order** |
| **POST** | **`/orders/:orderId/checkout`** | **Stripe checkout** |
| GET | `/orders/:orderId/print` | Download print file (paid only) |

### 4.2 Create-order backend chain

```
physicalQr.routes.ts
  → physicalQr.controller.ts :: createMyPhysicalQrOrder
    → physicalQrOrder.service.ts :: createPhysicalQrOrder
      → physicalQrCatalog.service.ts (product + price)
      → qrContext.service.ts (resolve QR URL, tenant ownership)
      → shipping.ts (DE-only shipping/contact validation)
      → colors.ts (color token validation)
      → processing.ts (SAME_DAY / WITHIN_24_HOURS deadline)
      → prisma.physicalQrOrder.create(...)
```

**No notification calls exist in `createPhysicalQrOrder`.**

### 4.3 Validation & pricing

| Check | Implementation |
|---|---|
| Subscription | `brandingCustomization` feature required |
| Product | Must exist, active, checkout-ready |
| Quantity | Integer **1–50** (`PHYSICAL_QR_QUANTITY_MIN/MAX`) |
| Price | Server-side: `unitPrice = product.priceCents`, `totalAmount = unitPrice × quantity` |
| Test price | **990 cents (€9.90)** per unit (`PHYSICAL_QR_TEST_UNIT_PRICE_CENTS`) |
| Shipping | Germany only, 5-digit postal, required fields |
| Contact | Valid email, phone ≥ 8 digits |
| Checkout env | `PHYSICAL_QR_CHECKOUT_ENABLED` must not be `"false"` |
| Stripe | Must be configured for checkout session |

### 4.4 Payment webhook chain

```
Stripe webhook checkout.session.completed
  → physicalQrWebhook.service.ts :: handlePhysicalQrCheckoutSessionCompleted
    → Updates: paymentStatus=PAID, fulfillmentStatus=PROCESSING
    → notifyPhysicalQrPaymentReceived({ businessId, orderId })
```

Metadata source tag: `physical_qr_order` (`PHYSICAL_QR_CHECKOUT_METADATA_SOURCE`).

Webhook validates: order exists, business match, session match, amount match, idempotent on duplicate PAID.

---

## 5. Database / order lifecycle

### 5.1 Tables (Prisma)

| Table | Purpose |
|---|---|
| `physical_qr_products` | Catalog (A5 with/without address) |
| `physical_qr_orders` | Orders |
| `physical_qr_order_messages` | Messages (if used) |
| `physical_qr_order_internal_notes` | **Admin-only** notes |

Schema: `backend/prisma/schema.prisma` (lines ~1433–1563)

### 5.2 Initial status on create

| Field | Value |
|---|---|
| `paymentStatus` | **`PENDING`** |
| `fulfillmentStatus` | **`PENDING_PAYMENT`** |

Set in `physicalQrOrder.service.ts` lines 193–194.

### 5.3 Stored snapshots (immutable at order time)

- `qrTargetUrlSnapshot`, `addressSnapshot`, `shippingSnapshot`, `contactSnapshot`
- `colorTokensSnapshot`, `businessNameSnapshot`
- `processingClass`, `processingDeadlineAt`, `processingCopySnapshot`
- Stripe IDs after checkout

### 5.4 Status enums

**Payment:** `PENDING`, `PAID`, `FAILED`, `CANCELLED`

**Fulfillment:** `PENDING_PAYMENT`, `PAID`, `PROCESSING`, `PRINTING`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `PAYMENT_FAILED`

### 5.5 Fulfillment state machine

Defined in `backend/src/lib/physicalQr/status.ts`:

```
PENDING_PAYMENT → PAID | PROCESSING | CANCELLED | PAYMENT_FAILED
PAID            → PROCESSING | CANCELLED
PROCESSING      → PRINTING | CANCELLED
PRINTING        → SHIPPED | CANCELLED
SHIPPED         → DELIVERED
```

**Note:** After Stripe payment webhook, orders jump directly to `fulfillmentStatus=PROCESSING` (skipping intermediate `PAID` fulfillment state). Admin “Mark processing” button (shown when `fulfillmentStatus === "PAID"`) is therefore usually bypassed in normal checkout flow.

**Gap:** `CANCELLED` exists in enum/filters but **no admin API endpoint** transitions orders to cancelled.

---

## 6. Admin → Order management flow

### 6.1 Admin UI

| Screen | Route | File |
|---|---|---|
| Order list | `/platform-admin/businesses/branding-orders` | `PlatformPhysicalQrOrdersPage.tsx` |
| Order detail | `/platform-admin/businesses/branding-orders/:orderId` | `PlatformPhysicalQrOrderDetailPage.tsx` |
| Nav entry | Sidebar | `platformAdminNav.ts` |

### 6.2 Admin API routes

Base: `/api/platform/physical-qr/...` (also aliased under `/api/admin/...`)

All routes protected by (`platform.routes.ts` line 16):

- `authMiddleware`
- `requireAdminRoleClaim`
- `requirePlatformAdmin` (DB check: `SUPER_ADMIN` + `isPlatformAdmin` + active + email verified)
- `auditPlatformAccess`

| Method | Route | Action |
|---|---|---|
| GET | `/physical-qr/orders?filter=&q=` | List orders |
| GET | `/physical-qr/orders/:orderId` | Detail + internal notes |
| GET | `/physical-qr/orders/:orderId/print?format=pdf\|png` | Download print file |
| POST | `/physical-qr/orders/:orderId/processing` | Mark processing |
| POST | `/physical-qr/orders/:orderId/printing` | Mark printing |
| POST | `/physical-qr/orders/:orderId/ship` | Mark shipped (+ carrier/tracking) |
| POST | `/physical-qr/orders/:orderId/deliver` | Mark delivered |
| GET/POST | `/physical-qr/orders/:orderId/notes` | Internal notes |

Controller: `backend/src/controllers/platformPhysicalQr.controller.ts`  
Fulfillment: `backend/src/services/physicalQr/physicalQrFulfillment.service.ts`

### 6.3 What Admin sees per order

From `toAdminOrderDto()` — includes:

- Business name/slug, product, QR context, quantity
- Payment + fulfillment status, amounts, timestamps
- Address, shipping, contact snapshots
- QR target URL, Stripe payment intent ID
- Processing class / cutoff / estimated fulfillment copy
- Tracking (carrier, number, URL) after ship
- Internal notes (admin detail endpoint only — **not exposed to business APIs**)

**List filters:** `all`, `pending_payment`, `paid`, `processing`, `printing`, `shipped`, `delivered`, `cancelled`, `payment_failed`

### 6.4 Admin actions & side effects

| Admin action | Backend | Business notification |
|---|---|---|
| Mark processing | Sets `PROCESSING` | **None** |
| Mark printing | Sets `PRINTING` | In-app + push + **email** |
| Mark shipped | Sets `SHIPPED` + tracking | In-app + push + **email** |
| Mark delivered | Sets `DELIVERED` | In-app + push + **email** |
| Download PDF | Render print pipeline | None |
| Internal note | Stored admin-only | None |

**Not implemented:** reject, cancel, approve, manual status PATCH.

---

## 7. Email notification behavior (detailed)

### 7.1 At order placement (`POST /orders`)

| Recipient | Email | In-app | Push |
|---|---|---|---|
| **Platform Admin** | **NO** | **NO** | **NO** |
| **Business manager** | **NO** | **NO** | **NO** |

`createPhysicalQrOrder()` performs DB insert only — zero notification calls.

### 7.2 At payment success (Stripe webhook)

Trigger: `handlePhysicalQrCheckoutSessionCompleted` → `notifyPhysicalQrPaymentReceived`

#### Business manager

| Channel | Sent? |
|---|---|
| In-app | Yes |
| Push | Yes |
| **Email** | **Yes** |

- **Recipient:** Business owner user (`business.userId`)
- **Template ID:** `physical_qr_paid`
- **Subject (EN):** “Payment received”
- **Body (EN):** “Your physical QR order has been paid for and is now being processed.”
- **Action URL:** `/dashboard/qr-studio/branding/orders/:orderId`
- **Channels config:** `{ in_app: true, push: true, email: true }` (`physicalQrNotify.service.ts` line 46)

#### Platform Admin

| Channel | Sent? |
|---|---|
| In-app | Yes |
| Push | Yes |
| **Email** | **Yes** (implemented 2026-08-30) |

- **Trigger:** Same webhook, via `onPlatformOperationalAlert()` with `channels: { in_app: true, push: true, email: true }` (`physicalQrNotify.service.ts`)
- **Recipients:** All active platform admin users (`role=SUPER_ADMIN`, `isPlatformAdmin=true`, `isActive=true`) — queried from DB via `listPlatformAdminUserIds()`, **not** a hardcoded inbox address
- **Template ID:** `physical_qr_paid_admin`
- **Title (EN):** “Physical QR order paid”
- **Body (EN):** Includes business name, order ID, product label, quantity, amount paid, payment status (Paid), fulfillment status (Processing), paid-at timestamp, and “ready for processing”
- **Action URL:** `/platform-admin/businesses/branding-orders/:orderId`
- **Channels:** `{ in_app: true, push: true, email: true }`

> **Admin does NOT receive email on order placement.** Admin receives **in-app + push + email** after successful Stripe payment only.

**Idempotency:** Duplicate Stripe webhook deliveries for an already-`PAID` order return early (`duplicate: true`) before `notifyPhysicalQrPaymentReceived` runs — no duplicate admin emails from webhook retries.

### 7.3 At fulfillment milestones (admin actions)

Business only — no admin notifications:

| Event | Template | Email? |
|---|---|---|
| Printing | `physical_qr_printing` | Yes |
| Shipped | `physical_qr_shipped` | Yes |
| Delivered | `physical_qr_delivered` | Yes |

### 7.4 Resend / email implementation (when email IS sent)

Path: `deliverUserNotification` → `sendLocalizedUserNotificationEmail` → `sendResendEmail("notification", ...)`

| Setting | Source |
|---|---|
| **Client** | Single shared `backend/src/services/resendClient.ts` (fetch to Resend API) |
| **API key** | `RESEND_API_KEY` |
| **From** | `getResendFromAddress()` → `RESEND_FROM_EMAIL` or `RESEND_FROM` (transactional noreply, e.g. `CareTip <noreply@mail.caretip.de>`) |
| **Reply-To** | **Not set** for notification emails |
| **Subject** | Localized notification title |
| **HTML body** | Generic CareTip notification layout via `buildGenericNotificationContent()` (`i18nEmail.ts`) — not a dedicated physical-QR email template file |
| **Failure behavior** | `sendResendEmail` logs and returns `false`; does **not** throw; orchestrator `.catch(() => undefined)` — **email failure does not block order creation or webhook processing** |

Lead-specific From addresses (`hello@` / `support@`) do **not** apply to physical QR notifications.

### 7.5 Admin recipient determination

Platform admin notifications resolve recipients via:

```typescript
// notification.triggers.ts :: listPlatformAdminUserIds()
prisma.user.findMany({
  where: { role: "SUPER_ADMIN", isPlatformAdmin: true, isActive: true },
})
```

- **Not hardcoded** to an ops inbox email
- **Not environment-configured** (no `PHYSICAL_QR_ADMIN_EMAIL` env var)
- **Not** sent to all SUPER_ADMIN emails directly — delivered per **user account** (in-app inbox + push to registered admin users)

Unpaid orders (`PENDING_PAYMENT`) are discoverable only by Admin visiting the branding-orders queue (filter `pending_payment`) — **no alert** is generated.

---

## 8. In-app notification behavior

| Event | Business | Admin |
|---|---|---|
| Order created (unpaid) | None | None |
| Payment received | In-app + push + email | **In-app + push + email** |
| Printing / shipped / delivered | In-app + push + email | None |

Admin notifications use the standard notification inbox (`notificationInbox.service.ts`) with dedupe key prefix `platform_op:{orderId}:{adminUserId}`.

Socket events emitted for real-time inbox updates (`emitNotificationCreated`).

---

## 9. Authorization / security controls

| Control | Status |
|---|---|
| Business can only create/view own orders | Yes — `businessId` from session + `findFirst({ id, businessId })` |
| Business cannot access other business orders | Yes — 404 on mismatch |
| Business cannot see admin internal notes | Yes — notes only on admin endpoint |
| Only platform admins manage all orders | Yes — `requirePlatformAdmin` on all admin routes |
| Client cannot set price/status/QR URL | Yes — ignored server-side |
| QR subject ownership validated | Yes — `qrContext.service.ts` tenant checks |
| Print download requires payment | Yes — `paymentStatus === "PAID"` |
| Platform admin DB-verified (not JWT-only) | Yes — `requirePlatformAdmin` |

---

## 10. Gaps & missing notifications (current behavior)

1. **No Admin email when order is placed** (unpaid draft in queue) — intentional; avoids noise from abandoned checkouts.
2. **No Admin alert for unpaid `PENDING_PAYMENT` orders** — must poll admin UI or filter `pending_payment`.
3. **No business confirmation at order creation** — only after payment.
4. **No cancel/reject admin workflow** despite `CANCELLED` enum existing.
5. **Webhook skips `PAID` fulfillment state** — admin “Mark processing” rarely needed after normal Stripe checkout.
6. **Admin recipient is per platform-admin user account**, not a shared ops mailbox — admins without active accounts miss alerts entirely.
7. **Email delivery failure does not block payment** — Resend errors are logged; order remains `PAID`.

---

## 11. Recommendations (optional future work)

These are **suggestions only**, separate from implemented behavior:

1. **Optional Admin email on order placement** — new notify hook in `createPhysicalQrOrder` for unpaid queue visibility (may create noise before payment).
2. **Shared ops inbox** — env-configured address in addition to per-admin-user notifications (e.g. `PHYSICAL_QR_OPS_EMAIL`).
3. **Cancel workflow** — admin endpoint + business notification for abandoned/unpaid orders.
4. **Clarify UI copy** — “Template QR” vs “Physical Branding / A5 flyer” to reduce confusion with digital QR templates.

~~Admin email on payment~~ — **Implemented 2026-08-30** via `onPlatformOperationalAlert` channel override.

---

## 12. Files / components / routes / services inspected

### Frontend — Business

- `src/app/pages/business/qr-studio/QrStudioBrandingPage.tsx`
- `src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx`
- `src/app/components/business/physical-branding/PhysicalBrandingStudio.tsx`
- `src/app/components/business/physical-branding/PhysicalQrOrderCard.tsx`
- `src/app/components/business/physical-branding/PhysicalQrOrderTimeline.tsx`
- `src/app/components/business/physical-branding/PhysicalQrPreview.tsx`
- `src/app/lib/api.ts` (physical QR API client)
- `src/app/lib/physicalQrOrderUi.ts`
- `src/app/routes.tsx`

### Frontend — Admin

- `src/app/pages/platform/PlatformPhysicalQrOrdersPage.tsx`
- `src/app/pages/platform/PlatformPhysicalQrOrderDetailPage.tsx`
- `src/app/components/platform/platformAdminNav.ts`

### Backend — Routes & controllers

- `backend/src/routes/physicalQr.routes.ts`
- `backend/src/routes/platform.routes.ts`
- `backend/src/controllers/physicalQr.controller.ts`
- `backend/src/controllers/platformPhysicalQr.controller.ts`

### Backend — Services

- `backend/src/services/physicalQr/physicalQrOrder.service.ts`
- `backend/src/services/physicalQr/physicalQrCheckout.service.ts`
- `backend/src/services/physicalQr/physicalQrWebhook.service.ts`
- `backend/src/services/physicalQr/physicalQrNotify.service.ts`
- `backend/src/services/physicalQr/physicalQrFulfillment.service.ts`
- `backend/src/services/physicalQr/physicalQrCatalog.service.ts`
- `backend/src/services/physicalQr/qrContext.service.ts`
- `backend/src/services/notifications/notificationOrchestrator.service.ts`
- `backend/src/services/push/notification.triggers.ts`
- `backend/src/services/localizedNotificationEmail.service.ts`
- `backend/src/services/resendClient.ts`
- `backend/src/webhooks/stripe.webhook.ts`

### Backend — Schema & libs

- `backend/prisma/schema.prisma`
- `backend/src/lib/physicalQr/status.ts`
- `backend/src/lib/physicalQr/shipping.ts`
- `backend/src/lib/physicalQr/types.ts`
- `backend/src/config/physicalQrCheckout.ts`
- `backend/src/notifications/notificationI18n.ts`
- `backend/scripts/physical-qr-notify-runtime.ts`

---

## 13. Tests & results (post-implementation)

| Test | Result |
|---|---|
| `npm run test:physical-qr-notify` (backend) | **18/18 passed** |
| `npm run test:physical-qr` (backend) | 72/73 passed (1 pre-existing asset path failure unrelated to notify) |
| TypeScript (`tsc --noEmit`) | Pass |

Regression coverage includes: admin email channel enabled, PAID-only guard, webhook idempotency, platform-admin recipient path, shared Resend client, business/fulfillment templates unchanged, unpaid order creation silent.

---

## Concise summary for Fanny

### How Business places a Template QR order

1. Go to **Dashboard → QR Studio → Branding** (`/dashboard/qr-studio/branding`) — requires **Premium/Enterprise** (`brandingCustomization`).
2. Choose A5 flyer variant (with/without printed address), select QR target (storefront/employee/table/location), enter delivery address (Germany), contact details, and quantity (1–50).
3. Click place order → system creates a **`PENDING_PAYMENT`** order → redirects to **Stripe** for payment.
4. After payment, order moves to **PROCESSING**; business sees status in order history/detail and receives **email: “Payment received”**.

### How Admin sees/manages it

1. Go to **Platform Admin → Branding orders** (`/platform-admin/businesses/branding-orders`).
2. Filter/search orders; open detail for full snapshots (shipping, contact, QR URL, Stripe ID).
3. After payment: download print PDF, mark **printing → shipped → delivered**, add internal notes.
4. Unpaid orders appear under **`pending_payment`** filter — **no automatic alert**.

### Does Admin receive an email?

- **When order is placed (unpaid):** **No.**
- **When payment succeeds (Stripe webhook):** **Yes** — in-app + push + **email** to each active platform-admin user account.

### Does Admin receive an in-app notification?

**Only after payment succeeds** — in-app + push + email alert: “Physical QR order paid — {businessName} paid… (order details in body).”  
**Nothing** at unpaid order creation.

### What happens when the order is created?

- DB row in `physical_qr_orders` with `paymentStatus=PENDING`, `fulfillmentStatus=PENDING_PAYMENT`
- Snapshots stored (QR URL, shipping, contact, address, pricing)
- Immediate Stripe checkout redirect
- **No emails, no admin alerts, no business notifications** until payment webhook fires

### Remaining gaps Fanny should know about

- No admin email at **order placement** (only after payment) — by design
- Unpaid orders are silent — admin must check the queue manually
- No cancel/reject workflow in admin UI
- Admin alerts go to **platform-admin user accounts**, not a shared inbox like `info@caretip.de`
- Email send failure does not affect payment success
