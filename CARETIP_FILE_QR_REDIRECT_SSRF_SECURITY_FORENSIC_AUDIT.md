# CARETIP — File Downloads, Image Uploads, QR URLs, Redirects & SSRF Security Forensic Audit

**Mode:** READ-ONLY forensic audit (no code changes).  
**Date:** 2026-09-30  
**Scope:** Backend-primary; frontend redirect allowlists where they affect outbound navigation.

---

## 1. Executive Summary

CareTip’s security-sensitive file, QR, redirect, and outbound-HTTP surfaces are **largely server-authoritative**: guest tip checkout re-validates employee–business binding and venue IDs; KYC uses private storage references with auth-gated signed URLs and path jails; Connect/billing handoffs **reject client-supplied redirect URLs**; Stripe guest checkout success/cancel URLs are **built server-side**.

**No confirmed CRITICAL or HIGH vulnerabilities** were identified from static code tracing. Residual risk is concentrated in **abuse/hardening**: unauthenticated QR scan analytics spam, optional rate limits on some public context endpoints, manager-branded QR accepting **arbitrary `targetUrl`** (phishing/brand misuse, not SSRF), and **no image dimension/decompression caps** beyond byte limits.

**SECURITY AUDIT STATUS:** **MEDIUM/LOW FINDINGS — REMEDIATION RECOMMENDED** (hardening and abuse controls; no emergency fix class identified in-repo).

---

## 2. Scope

| In scope | Out of scope |
|----------|----------------|
| PDF/document download & generation | Stripe Connect payout logic changes |
| Image/KYC uploads, Supabase Storage | Frontend UI redesign |
| QR generation, resolution, public tipping APIs | DB schema changes |
| HTTP redirects (server + Stripe navigation) | Marketing SEO content |
| Outbound `fetch`/HTTP from backend | Mobile app binaries (except shared API contracts) |

---

## 3. Architecture Map — Security Surface Inventory

| Surface | Route / file | Auth | Authorization | Storage | Public / private | Risk areas |
|---------|----------------|------|---------------|---------|------------------|------------|
| Guest tip checkout | `POST /api/payments/create-tip-session` — `payment.controller.ts` → `stripe.service.ts` `createTipCheckoutSession` | None | `assertEmployeeEligibleForTipPayment`, `resolveTipVenueIds`, `resolveTipCheckoutRouting` (server) | Stripe metadata | Public | Tip recipient IDOR, amount abuse |
| Public employee profile | `GET /api/employees/:employeeId` — `employee.controller.ts` `getEmployeeById` | None | Active/verified employee + business go-live capability | N/A | Public | UUID enumeration, info disclosure |
| Public business profile | `GET /api/business/:businessId` — `business.controller.ts` `getById` | None | `getPublicBusinessById` (public DTO) | N/A | Public | ID enumeration |
| Tipping context (location/table/slug) | `GET /api/tipping-context/*` — `tippingContext.controller.ts` | None | DB join + verification / signed slug | N/A | Public | Enumeration, scraping |
| QR scan analytics | `POST /api/qr/scan` — `qrScan.controller.ts` | None | `assertQrScanTargetsBelongToBusiness` | `qr_scan_events` | Public | Spam, no IP limit in route |
| KYC secure access | `GET /api/media/secure-access`, `secure-stream` — `media.controller.ts` | JWT | `userCanAccessKycStorageRef` | KYC bucket / disk jail | Private | IDOR via `ref` |
| Manager KYC upload | `POST /api/business/...` verification — `business.controller.ts` `uploadMyKycDocument` | Manager | `getBusinessByUserId` | `uploadPlatformVerificationDocument` | Private ref | MIME, traversal |
| Logo/banner upload | `businessUpload.middleware.ts` + `upload.service.ts` | Manager | Own business from session | Public bucket / disk | Public URLs | MIME spoof, storage abuse |
| Employee avatar | `POST` employee avatar — `employee.controller.ts` `uploadMyAvatar` | Employee | `setEmployeeAvatarUrl(userId)` | `avatars/*` public | Public | Same as images |
| Platform KYC/logo upload | `platform.routes.ts` + `platform.controller.ts` | Platform admin | `requirePlatformAdmin` | KYC / platform paths | Mixed | Admin trust |
| Static disk uploads | `index.ts` `express.static("/uploads")` + `blockSensitiveStaticUploadPaths` | None | KYC paths blocked | Disk | Avatars/logos public | KYC path block bypass |
| Legal PDFs | `GET /api/legal/*.pdf` — `legal.controller.ts` `getCareTipControlledPdf` | None | Fixed doc IDs on disk | Repo files | Public intentional | Cache headers |
| Physical QR PDF (manager) | `GET /api/physical-qr/orders/:orderId/print` — `physicalQr.controller.ts` | Manager | Order ownership | Generated in memory | Private session | IDOR on orderId |
| Physical QR PDF (admin) | `platform.routes.ts` admin print | Platform admin | Paid order check | ZIP/PDF | Admin | Bulk export abuse |
| Branded digital QR PNG | `GET /api/business/qr/branded` — `qr.controller.ts` `getBusinessBrandedQr` | Manager | `resolveManagerBusinessId` | In-memory QR | Manager | Arbitrary `targetUrl` in QR |
| DSAR export download | `GET /api/me/export/:jobId/download` — `lifecycleExport.controller.ts` | User | `downloadDsarExportForUser` | DSAR bucket | Private signed | Token/job IDOR |
| CSV export | `GET /api/transactions/export` — `transactions.routes.ts` | Manager + feature | Onboarding + entitlement | Generated | Private | Filename (server-built) |
| Connect onboarding | `connect.controller.ts` / `employeeConnect.controller.ts` | Auth | Rejects `returnUrl`/`refreshUrl` from client | Stripe | N/A | Open redirect |
| Mobile web handoff | `mobileWebHandoff.service.ts` | Auth | `PURPOSE_DESTINATIONS` allowlist | DB token | One-time | Open redirect |
| Stripe client redirect | `src/app/lib/externalStripeRedirect.ts` | N/A (browser) | Host allowlist per kind | N/A | N/A | Open redirect |
| Login geo lookup | `loginGeoLookup.service.ts` | N/A (server) | Fixed host `ipwho.is` | N/A | Outbound | SSRF (mitigated) |
| IT-Recht webhook PDF URL | `itRechtKanzleiWebhook.service.ts` | Webhook auth | Validates URL string only | Stored metadata | N/A | SSRF if fetched (not fetched) |

---

## 4. PDF Security

### 4.1 Endpoints traced

| Endpoint | Auth | Authorization | Response headers |
|----------|------|---------------|------------------|
| `GET /api/legal/avv.pdf`, `/dpa.pdf`, `/plv.pdf` — `legal.routes.ts` → `getCareTipControlledPdf` | Public | `parseCareTipControlledLegalDocId` + filesystem under `caretipControlledLegalDocs.ts` | `Content-Type: application/pdf`, `Content-Disposition` inline/attachment from query, `Cache-Control: public, max-age=300` |
| `GET /api/physical-qr/orders/:orderId/print` — `physicalQr.controller.ts` | Manager JWT | `requireManagerBusiness` + order scoped to business | `application/pdf`, `attachment`, filename uses `row.id` (server UUID) |
| `GET /api/platform/.../physical-qr/orders/:orderId/print` — `platformPhysicalQr.controller.ts` | Platform admin | Paid order; rejects `body.path` traversal hints | PDF/ZIP attachment |
| Manager/platform CSV/refunds exports | Platform/manager controllers | Role + business context | Server-built filenames |

**Public legal PDFs** are intentional (AVV/DPA/PLV). **No user-supplied path** reaches `readCareTipControlledPdf` — only enum doc id + language.

### 4.2 IDOR / path traversal

- **VERIFIED — EXISTING CONTROL INTACT:** Physical QR print uses DB order id resolved inside services bound to authenticated manager business or platform admin; no raw filesystem path from client.
- **VERIFIED — EXISTING CONTROL INTACT:** KYC disk reads use `resolveKycDiskPathForBusiness` (`kycDiskPath.ts`) — strict directory jail, `realpath` when present, rejects `..` and absolute paths.

### 4.3 Storage URLs for PDFs

- KYC PDFs stored as **`kyc-object:`** references (`upload.service.ts` `uploadPlatformVerificationDocument`), not public URLs in production (production blocks KYC disk fallback at lines 325–328).
- Secure view: `resolveSecureKycMediaAccess` → `createSignedUrlForPrivateObject` with TTL `kycSignedUrlTtlSeconds()` (default 300s, clamped 60–3600) — `supabaseStorageClient.ts`.

### 4.4 `streamSecureKycDocument` redirect

- `media.controller.ts` line 52–53: `res.redirect(access.url)` only when `access.mode === "signed"` (Supabase signed URL). Disk mode streams with `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.

---

## 5. Image Upload Security

### 5.1 Pipeline (all uploads)

`multipart` → **multer** (`businessUpload.middleware.ts`, `employee.routes.ts`, `platformUpload.middleware.ts`) → **MIME gate** (`uploadMimeGuard.ts`) → **buffer validation** (`imageUploadValidation.ts` or `verificationUploadValidation.ts`) → **opaque object name** (`storageObjectName.ts`) → Supabase or disk (`upload.service.ts`).

### 5.2 Controls verified

| Control | Evidence |
|---------|----------|
| Size limits | Logo 5 MB, banner 8 MB, KYC 10 MB — multer `fileSize` + `VERIFICATION_MAX_BYTES` / `AVATAR_MAX_BYTES` |
| SVG blocked | `isSvgMimetype`, `isSvgContent`, explicit errors in image + verification validators |
| Magic bytes | `sniffImageKind`, `sniffVerificationImageKind`, PDF `%PDF-` header |
| Extension | From sniff only — `extensionForImageBuffer`, `buildUniqueStorageObjectNameFromExtension` |
| Filename | `Date.now()-{uuid8}{ext}` — user filenames not used as keys |
| Multer DoS limits | `MULTER_SAFE_LIMITS` — `fieldNestingDepth: 0`, `files: 1` |
| Re-encoding | **Not performed** — stored bytes are validated originals (GIF/HEIC/AVIF allowed for avatars/logos) |
| Dimension / decompression bomb | **No megapixel cap or sharp pipeline** — **HARDENING** (see §18) |
| Tenant isolation (upload) | Manager uploads resolve `businessId` from `getBusinessByUserId`; KYC path `verification/{safeBizId}/...` |
| Production KYC disk | **Disabled** — `uploadPlatformVerificationDocument` throws in production without Supabase |

### 5.3 Public serving

- `index.ts`: `/uploads` static with `blockSensitiveStaticUploadPaths` denying `/uploads/kyc` and platform-verification paths.
- Avatars/logos on **public** bucket or disk URLs — **by design** for guest UI; keys are unguessable UUID-based names.

---

## 6. KYC File Security

| Step | Implementation |
|------|----------------|
| Upload auth | `business.controller.ts` `uploadMyKycDocument` — manager + own business |
| Storage | Private bucket `caretip-kyc` (configurable); `uploadBufferToSupabasePrivateObject` |
| Reference format | `kyc-object:{bucket}/{path}` or dev-only `kyc-disk:` |
| Parse allowlist | `parseKycStorageReference` + `isAllowedKycObjectPathForBusiness` |
| Read auth | `secureMedia.service.ts` `userCanAccessKycStorageRef` — manager must own `businessId` extracted from ref; platform admin for SUPER_ADMIN |
| Signed URL | Auth check **before** `createSignedUrlForPrivateObject` |
| Static leak | **VERIFIED** — `blockSensitiveStaticUploadPaths` |

**Note:** `legacy-public-url` refs can return a stored HTTPS URL for admins or legacy rows; manager access still requires parsing business id from path patterns (`secureMedia.service.ts`). Arbitrary external URLs as `ref` fail manager ownership checks.

---

## 7. QR Security

### 7.1 QR types & encoded identifiers

| Type | Customer URL (frontend) | Backend resolution |
|------|-------------------------|-------------------|
| Business / team picker | `/qr-landing/:businessId`, `/table/:qrSlug` | `GET /api/business/:businessId`, tipping context by slug |
| Employee | `/qr/employee/:id`, slug paths | `GET /api/employees/:employeeId` |
| Location | `/qr/location/:locationId` | `GET /api/tipping-context/location/:locationId` |
| Table (id) | `/qr/table/:tableId` | `GET /api/tipping-context/table/:tableId` |
| Table (slug) | `/table/:qrSlug` | `GET /api/tipping-context/:qrSlug` |
| Physical print | Snapshot `qrTargetUrlSnapshot` at order time | Server-rendered; not guest-editable |

**Slug entropy:** `tables.service.ts` `generateQrSlug()` → `t-${randomBytes(8).toString("hex")}` (16 hex chars). Optional signed slug `st-{inner}.{hmac}` when `QR_TOKEN_SECRET` set — `tippingContext.controller.ts` `getByQrSlug`.

### 7.2 Enumeration & disclosure

- **Slug endpoint:** Invalid/missing slugs return **403** with generic verification message (not 404) — anti-oracle (`getByQrSlug`).
- **Location/table by UUID:** **404** `"Location not found"` / `"Table not found"` — enables existence probing (**INFO** / accepted for UUID APIs).
- **Employee id:** **404** `"Staff member not found"` for missing/inactive — logs server-side only (`employee.service.ts`).
- **QR scan:** Invalid `businessId` → **404** `"Business not found"` vs unverified → **403** — mild business existence oracle.

### 7.3 Tenant validation

- **VERIFIED — EXISTING CONTROL INTACT:** `assertQrScanTargetsBelongToBusiness` (`qrScanOwnership.service.ts`).
- **VERIFIED — EXISTING CONTROL INTACT:** `assertEmployeeEligibleForTipPayment` rejects `emp.businessId !== trimmedBusinessId` (`tipPaymentEligibility.service.ts` line 85–87).
- **VERIFIED — EXISTING CONTROL INTACT:** `resolveLocationTable` in `stripe.service.ts` ensures table/location belongs to `businessId`.

### 7.4 Rate limiting

- **Slug context:** `tippingContextQrSlugLimiter` — 60/IP/15m (env `SEC_TIPPING_QR_SLUG_IP_MAX_PER_15M`) — `tippingContextQrSlugRateLimit.middleware.ts`.
- **Location/table by id:** **No dedicated limiter** on route file — relies on global `authenticatedApiRateLimit` for `/api` (applies to all methods) — `index.ts` line 175.
- **`POST /api/qr/scan`:** **No route-specific limiter** — **HARDENING** (analytics spam).

### 7.5 Branded QR `targetUrl` (manager)

- `qr.controller.ts` `getBusinessBrandedQr` accepts **any non-empty** `targetUrl` query param.
- `digitalPlainQrPng.ts` uses `QRCode.toBuffer(encoded)` — **no HTTP fetch** (not SSRF).
- **Risk:** Manager can generate a CareTip-dashboard QR image encoding **phishing / third-party URLs** — **HARDENING / LOW business-integrity** (not guest IDOR).

---

## 8. Redirect Security

### 8.1 Server-side `res.redirect`

| Location | Destination | Classification |
|----------|-------------|----------------|
| `media.controller.ts` `streamSecureKycDocument` | Supabase signed URL | **SAFE** (third-party storage host, time-limited) |

No other `res.redirect` in `backend/src` grep sweep.

### 8.2 Rejected client redirect parameters

- **VERIFIED — EXISTING CONTROL INTACT:** `connect.controller.ts` / `employeeConnect.controller.ts` return 400 `CONNECT_CLIENT_URL_FORBIDDEN` if `returnUrl`, `refreshUrl`, `redirectUrl` in body/query.
- **VERIFIED — EXISTING CONTROL INTACT:** `payment.controller.ts` `findClientControlledConnectPaymentField` blocks nested Connect destination keys on tip session create.
- **VERIFIED — EXISTING CONTROL INTACT:** `mobileWebHandoff.service.ts` `PURPOSE_DESTINATIONS` — server-only paths; client destination ignored (audited in controller).

### 8.3 Stripe guest checkout URLs

- `stripe.service.ts`: `success_url` fixed to `{frontend}/rating?session_id={CHECKOUT_SESSION_ID}`; `cancel_url` from `guestTipCheckoutCancelUrl` (same origin, query params only).

### 8.4 Client-side Stripe navigation

- **VERIFIED — EXISTING CONTROL INTACT:** `externalStripeRedirect.ts` — HTTPS only; host allowlists for checkout, portal, connect, express dashboard; regression in `scripts/stripe-connect-phase4-5-ui-runtime.ts`.

### 8.5 Open redirect test matrix (conceptual)

| Payload | Server redirect | Client Stripe redirect |
|---------|-----------------|------------------------|
| `https://evil.example` | Not used for guest flows | **Blocked** |
| `//evil.example` | N/A | **Blocked** (URL parser + host check) |
| `javascript:` | N/A | **Blocked** (`protocol !== https:`) |

---

## 9. SSRF Security

**Classification: NOT PRESENT (user-controlled URL fetch) — outbound calls are fixed-purpose.**

| Sink | URL source | Controls |
|------|------------|----------|
| `loginGeoLookup.service.ts` | Client IP → path segment | Host fixed `ipwho.is`; `isPrivateOrLocalIp` skips lookup; 2.5s timeout |
| `resendClient.ts` | Fixed `api.resend.com` | API key |
| `oauth/facebookVerifier.ts` | Fixed Graph URLs | OAuth |
| `landingAi.service.ts` | `resolveOpenAiConfig().base` | Env config, not user URL |
| IT-Recht `rechtstext_pdf_url` | Webhook field | **Validated only** — **no `fetch`** (`phase-14-ssrf-webhooks.ts` asserts) |
| QR PNG render | `targetUrl` string | Encoded into QR matrix only — **no network** |

**DNS rebinding / metadata:** Not applicable to current sinks (no user-supplied hostname fetch).

**UNKNOWN (ops):** Supabase/Stripe SDK internal HTTP — assumed vendor-safe; not audited at SDK level.

---

## 10. Storage Security

| Bucket (default names) | Public? | Purpose | Upload path | Download |
|------------------------|---------|---------|-------------|----------|
| `caretip` | Public read | Avatars, logos, banners | `avatars/`, `business-logos/`, etc. | Public URL |
| `caretip-kyc` | Private | Verification docs | `verification/{businessId}/` | Signed URL after auth |
| `caretip-dsar` | Private | DSAR exports | `exports/{userId}/` | `createSignedUrlForDsarObject` + path assert |

**Regression:** `backend/scripts/supabase-security-pentest.ts` checks KYC bucket private, anon upload blocked, KYC static path middleware.

**Predictability:** Object keys use timestamp + UUID fragment — not sequential.

---

## 11. Authorization / IDOR

| Operation | Client supplies | Server derives | Verdict |
|-----------|-----------------|----------------|---------|
| Tip payment | `employeeId`, `businessId` | Re-validates binding + eligibility | **VERIFIED** |
| KYC download | `ref` query | Parses ref → businessId → manager ownership | **VERIFIED** |
| DSAR download | `jobId`, optional token | `downloadDsarExportForUser({ userId })` | **VERIFIED** (service-layer) |
| Physical QR print | `orderId` | Manager business match in controller/service | **VERIFIED** |
| Public employee GET | `employeeId` | Public profile only if active + verified | **By design** (no PII email in traced DTO) |
| Platform admin | Various ids | `requirePlatformAdmin` on router | Admin trust model |

**RISKY pattern not found:** Authenticated manager passing another tenant’s `businessId` alone to download KYC without ref ownership — blocked by ref parser + `findFirst({ userId, id: businessId })`.

---

## 12. Tenant Isolation

- Upload paths scoped by **server-resolved** `businessId` from session.
- Tip venue resolution ties table → location → `businessId` in DB.
- QR scan ownership ties optional employee/location/table to declared `businessId`.

**VERIFIED — EXISTING CONTROL INTACT** for payment and scan write paths.

---

## 13. Response Headers

| Context | Headers observed |
|---------|------------------|
| Global API | `securityHeaders.middleware.ts` — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, CSP for API, HSTS in production |
| KYC stream (proxy mode) | `nosniff`, `private, no-store` — `media.controller.ts` |
| Legal PDF | `application/pdf`, short public cache |
| Static `/uploads` images | `Cache-Control: public, max-age=86400` for images — appropriate for public media |

CSP for guest SPA is documented as CDN/`_headers` — not re-audited here.

---

## 14. Rate Limiting / Abuse

| Endpoint | Limit | Evidence |
|----------|-------|----------|
| Tip checkout | `publicTipCheckoutLimiter` | 30/15m default — `rateLimit.middleware.ts` |
| QR slug lookup | `tippingContextQrSlugLimiter` | 60/15m/IP |
| Auth | Layered IP+email | `authRateLimit.middleware.ts` |
| Global `/api` | `authenticatedApiRateLimit` | `index.ts` |
| Image/KYC upload | Auth only | **No upload-specific limit** — **HARDENING** |
| `POST /api/qr/scan` | None dedicated | **HARDENING** |
| Signed URL minting | Behind auth + per-request | Abuse tied to stolen session |

---

## 15. Error Disclosure

- **VERIFIED — EXISTING CONTROL INTACT:** `clientSafeMessage` / `CLIENT_FALLBACK` patterns on public controllers.
- KYC/media errors map permission failures to **403** generic message.
- Employee not found: **404** guest message; detailed ids in **server logs** only.
- Prisma/stack traces: routed through `logServerError` — not audited for every path; standard Express error handler assumed.

---

## 16. Security Regression Coverage

| Property | Test / script |
|----------|----------------|
| Upload MIME/SVG/polyglot | `npm run test:file-upload-pentest` (backend) |
| KYC disk jail | `npm run test:kyc-disk-path-jail` |
| SSRF / webhooks inventory | `npm run test:phase-14-ssrf-webhooks` |
| Supabase bucket privacy | `supabase-security-pentest.ts` |
| Stripe redirect allowlist | `stripe-connect-phase4-5-ui-runtime.ts` |
| Connect client URL forbidden | Controllers + payment `findClientControlledConnectPaymentField` (exported for regression) |

**Missing high-value tests (recommendations only):**

- Rate limit presence on `POST /api/qr/scan`
- Manager `targetUrl` allowlist policy (if product requires CareTip-only QRs)
- Image dimension bomb / huge GIF dimensions
- Public tipping-context location/table ID enumeration policy (404 vs 403)

---

## 17. Confirmed Vulnerabilities

**None rated CRITICAL or HIGH** from code evidence in this audit.

---

## 18. Hardening Opportunities

| ID | Severity | Finding | Evidence | Recommended direction |
|----|----------|---------|----------|------------------------|
| H-1 | **LOW** | `POST /api/qr/scan` lacks dedicated rate limit | `qrScan.routes.ts` only mounts controller | IP-based limiter similar to slug endpoint |
| H-2 | **LOW** | Manager branded QR accepts arbitrary `targetUrl` | `qr.controller.ts`, `brandedQrRender.service.ts` | Optional allowlist: same registrable domain as `PUBLIC_APP_ORIGIN` / business slug URLs |
| H-3 | **LOW** | No image width/height/decompression limits | `imageUploadValidation.ts` byte cap only | Cap pixels via lightweight probe or re-encode |
| H-4 | **INFO** | UUID public APIs (employee, location, table, business) | Public routes above | Monitor scraping; optional rate limits on context by-id routes |
| H-5 | **INFO** | `upsert: true` on public Supabase upload | `uploadBufferToSupabasePublicUrl` | Keys are random — overwrite requires guessing key |
| H-6 | **INFO** | `isValidRechtstextPdfUrl` allows `http://127.0.0.1` | `itRechtKanzleiPdfValidator.ts` | Acceptable while URL is not fetched; document for compliance |

---

## 19. False Positives / Already-Protected Areas

- **Client-controlled Stripe Connect account / return URLs on tips** — blocked.
- **KYC on public `/uploads`** — blocked by middleware.
- **SVG upload** — rejected at multer and buffer layers.
- **Path traversal on KYC disk** — jail + tests.
- **Guest tip to wrong business’s employee** — `EMPLOYEE_BUSINESS_MISMATCH`.
- **Open redirect via tip checkout success URL** — server-built.
- **SSRF via IT-Recht PDF URL** — validated, not fetched.

---

## 20. Recommended Remediation Priority

1. **H-1** — QR scan rate limit (cheap, reduces analytics noise).
2. **H-2** — Product decision: restrict manager `targetUrl` if QRs must only point to CareTip guest journeys.
3. **H-3** — Image dimension caps if abuse or memory incidents appear.
4. Continue running **`test:file-upload-pentest`**, **`test:phase-14-ssrf-webhooks`**, **`supabase-security-pentest`** in CI.

---

## 21. Malicious File / Content Attack Matrix

| Attack | Surface | Protected? | Evidence | Severity |
|--------|---------|------------|----------|----------|
| Path traversal | PDF/KYC disk | Yes | `kycDiskPath.ts`, tests | — |
| IDOR | PDF/KYC | Yes | `secureMedia.service.ts` | — |
| IDOR | Public tip | Yes | `tipPaymentEligibility.service.ts` | — |
| MIME spoofing | Image upload | Partial | Magic bytes + MIME; GIF/HEIC allowed | LOW if bypass |
| Malicious SVG | Upload | Yes | Blocked | — |
| Oversized image | Upload | Yes | 5–10 MB caps | — |
| Decompression bomb | Upload | No | No dimension cap | LOW |
| Filename injection | Upload/download | Yes | Opaque keys; server filenames on PDF | — |
| Storage overwrite | Upload | Mostly | Random keys | INFO |
| Cross-tenant KYC | Storage | Yes | Path + auth ref | — |
| QR slug enumeration | QR | Partial | Rate limit + 403 oracle | LOW |
| QR IDOR (payment) | Checkout | Yes | Server validation | — |
| Open redirect | HTTP | Yes | No guest server redirects | — |
| SSRF | Backend fetch | Yes | Fixed hosts / no user URL fetch | — |
| DNS rebinding | N/A | N/A | No user URL fetch | — |
| Metadata SSRF | Cloud | N/A | Not applicable | — |
| Private IP via geo | Geo lookup | Yes | Skip private IPs | — |
| Redirect chain | Stripe client | Yes | Single-hop assign | — |
| Info disclosure | Errors | Mostly | Safe messages on guest paths | INFO |
| Rate-limit abuse | QR scan | Weak | No dedicated limit | LOW |

---

## 22. Files / Routes Audited (representative)

**Backend:** `index.ts`, `media.controller.ts`, `media.routes.ts`, `business.controller.ts`, `business.routes.ts`, `employee.controller.ts`, `employee.routes.ts`, `payment.controller.ts`, `payment.routes.ts`, `tippingContext.controller.ts`, `tippingContext.routes.ts`, `qrScan.controller.ts`, `qrScan.routes.ts`, `qr.controller.ts`, `legal.controller.ts`, `legal.routes.ts`, `physicalQr.controller.ts`, `physicalQr.routes.ts`, `platformPhysicalQr.controller.ts`, `platform.routes.ts`, `transactions.routes.ts`, `lifecycleExport.controller.ts`, `connect.controller.ts`, `employeeConnect.controller.ts`, `upload.service.ts`, `secureMedia.service.ts`, `supabaseStorageClient.ts`, `kycStorageReference.ts`, `kycDiskPath.ts`, `imageUploadValidation.ts`, `verificationUploadValidation.ts`, `stripe.service.ts`, `tipPaymentEligibility.service.ts`, `mobileWebHandoff.service.ts`, `loginGeoLookup.service.ts`, `blockSensitiveStaticUploads.middleware.ts`, `securityHeaders.middleware.ts`, `rateLimit.middleware.ts`, `tippingContextQrSlugRateLimit.middleware.ts`.

**Frontend:** `externalStripeRedirect.ts`.

**Scripts:** `file-upload-pentest.ts`, `kyc-disk-path-jail.ts`, `phase-14-ssrf-webhooks.ts`, `supabase-security-pentest.ts`.

---

## 23. Final Verdict

**SECURITY AUDIT STATUS: MEDIUM/LOW FINDINGS — REMEDIATION RECOMMENDED**

---

## Concise Summary (A–F)

**A. Confirmed vulnerabilities**  
None at CRITICAL/HIGH from this read-only pass.

**B. Existing controls verified**  
KYC private storage + auth refs; static KYC block; upload magic-byte validation; tip employee–business binding; Connect/handoff URL rejection; Stripe URL allowlist (client); guest checkout URLs server-built; QR slug HMAC option; scan ownership checks; cron secret on internal jobs.

**C. Hardening opportunities**  
QR scan rate limiting; optional CareTip-only `targetUrl` for manager QRs; image dimension limits; optional rate limits on tipping-context by UUID.

**D. Missing regression tests**  
QR scan limiter; branded QR URL policy; image dimension bomb.

**E. Highest-priority fixes**  
(1) Rate-limit `POST /api/qr/scan`. (2) Product/security review of manager arbitrary QR URLs. (3) Monitor public UUID endpoint scraping.

**F. Whether remediation should proceed**  
Yes for **low-cost abuse controls (H-1)**; **H-2** requires product input; no emergency blockers identified in code review alone. **Production Supabase bucket ACLs** should still be verified with `supabase-security-pentest` in each environment (**UNKNOWN** if not run recently).
