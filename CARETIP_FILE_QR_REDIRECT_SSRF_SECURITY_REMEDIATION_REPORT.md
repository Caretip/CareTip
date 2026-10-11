# CARETIP — File / QR / Redirect / SSRF Security Remediation Report

**Source audit:** `CARETIP_FILE_QR_REDIRECT_SSRF_SECURITY_FORENSIC_AUDIT.md`  
**Date:** 2026-09-30

---

## 1. Findings addressed

| Audit item | Status | Notes |
|------------|--------|-------|
| H-1: `POST /api/qr/scan` no rate limit | **FIXED** | Dedicated IP limiter on scan route only |
| H-2: Manager branded QR arbitrary `targetUrl` | **FIXED** | CareTip guest URL allowlist (product-aligned) |
| H-3: No image dimension / decompression cap | **FIXED** | Header-based limits; HEIC/AVIF documented exception |
| Upload abuse (no upload-specific limit) | **FIXED** | Layered IP + user limits on upload routes |
| H-4: Public UUID enumeration | **ACCEPTED** | Opaque IDs; limited public DTO; no response oracle change |
| Error disclosure exhaustive audit | **ACCEPTED** | Spot-check: upload/KYC/QR/tipping use `clientSafeMessage` / generic JSON; no change required |
| SSRF / payment / KYC / tenant controls | **NOT APPLICABLE** | Preserved; no new outbound fetch |

---

## 2. Changes made

### 2.1 QR scan rate limit (H-1)

- **Limit:** **90 requests / 15 minutes / IP** (default).
- **Env:** `SEC_QR_SCAN_IP_MAX_PER_15M` (override).
- **Mechanism:** `express-rate-limit` — same pattern as `tippingContextQrSlugLimiter`.
- **Response:** `{ message: "Too many requests. Please try again later." }` + standard rate-limit headers.
- **UX:** Normal scanning (1–few events per guest per visit) stays well under cap; only affects automated spam or misconfigured clients hammering analytics.

### 2.2 Image dimensions (H-3)

- **Max edge:** 4096 px (`MAX_IMAGE_EDGE_PX`).
- **Max pixels:** 16,777,216 (`MAX_IMAGE_PIXELS`).
- **Formats checked:** PNG, JPEG, GIF, WebP via header parsing (no full decode, no Sharp).
- **HEIC / AVIF:** Dimension probe **not implemented** (ISO BMFF complexity); **byte limits + magic-byte kind check remain** — documented limitation.
- **Integration:** `validateImageBufferForUpload` (avatars, logos, banners).

### 2.3 Upload rate limits

- **Image uploads** (logo, banner, avatar, platform logo): IP **60** + user **25** / 15m (`SEC_UPLOAD_IMAGE_*`).
- **KYC uploads** (manager + platform verification): IP **30** + user **12** / 15m (`SEC_UPLOAD_KYC_*`).
- **Mechanism:** Existing `createAuthUserLimiter` in `securityRateLimit.middleware.ts` + `securityRateLimit.config.ts`.
- **Rationale:** Authenticated abuse / storage spam without throttling normal onboarding (few uploads per session).

### 2.4 Branded QR `targetUrl` (H-2)

- **Product decision:** CareTip-controlled guest destinations only (matches `resolvePhysicalQrContext` / `publicUrl.ts` URLs used in QR Studio).
- **Manager mode:** `assertCareTipBrandedQrTargetUrl` before render.
- **Employee mode:** Unchanged — server builds URL via `resolveEmployeePublicTipUrl` (no client `targetUrl`).
- **Validation:** HTTPS in production; allowed origins from `PUBLIC_APP_ORIGIN` / `APP_PUBLIC_URL` / `FRONTEND_URL`; guest path allowlist; rejects `javascript:`, `data:`, `file:`, etc.
- **Not SSRF:** Still encodes URL into QR matrix only — no HTTP fetch added.

---

## 3. Files changed

| File | Change |
|------|--------|
| `backend/src/middleware/qrScanRateLimit.middleware.ts` | New scan limiter |
| `backend/src/routes/qrScan.routes.ts` | Wire limiter on `POST /scan` |
| `backend/src/lib/imageDimensionValidation.ts` | Dimension readers + limits |
| `backend/src/lib/imageUploadValidation.ts` | Call dimension assert |
| `backend/src/lib/brandedQrTargetUrl.ts` | CareTip URL policy |
| `backend/src/services/qr/brandedQr.errors.ts` | `BrandedQrInvalidTargetUrlError` |
| `backend/src/services/qr/brandedQrRender.service.ts` | Manager URL assert |
| `backend/src/controllers/qr.controller.ts` | 400 mapping for invalid target |
| `backend/src/config/securityRateLimit.config.ts` | `uploadImage`, `uploadKyc` |
| `backend/src/middleware/securityRateLimit.middleware.ts` | Export upload limiters |
| `backend/src/routes/business.routes.ts` | Upload limiters on logo/banner/KYC |
| `backend/src/routes/employee.routes.ts` | Avatar upload limiter |
| `backend/src/routes/platform.routes.ts` | Platform logo/KYC limiters |
| `backend/scripts/security-remediation-runtime.ts` | New regression script |
| `backend/scripts/file-upload-pentest.ts` | PNG dimension tests |
| `backend/package.json` | `test:security-remediation` |

---

## 4. Why each change was necessary

See §2 — each maps directly to audit hardening items without altering payment, Connect, or guest journey routes.

---

## 5. Security controls preserved

All audit **VERIFIED** items unchanged: KYC auth + signed URLs, static KYC block, tip employee–business binding, Connect client URL rejection, Stripe checkout URL server build, SVG block, magic bytes, opaque storage keys, tenant isolation on scans, no user-controlled backend fetch.

---

## 6. Tests added

- `backend/scripts/security-remediation-runtime.ts` — wiring + branded URL + dimension smoke tests.
- Extended `file-upload-pentest.ts` — PNG dimension read + oversized rejection.

---

## 7. Tests executed

```text
npm run test:security-remediation     — ok
npm run test:file-upload-pentest      — 47 passed
npm run test:phase-14-ssrf-webhooks   — 19 passed
npx tsc --noEmit (backend)            — ok
```

Frontend not modified — root typecheck not required for this pass.

---

## 8. Build / typecheck

- **Backend:** `tsc --noEmit` — pass.

---

## 9. Remaining accepted risks

| Risk | Status |
|------|--------|
| HEIC/AVIF dimension bombs | **ACCEPTED** — 5 MB cap + kind sniff; no header dimension parser |
| Public UUID probing (employee/location/table/business) | **ACCEPTED DESIGN** — opaque identifiers; intentional public tipping data |
| Manager could historically encode external URLs in branded QR | **FIXED** — now CareTip URLs only |
| Production Supabase bucket ACLs | **UNKNOWN** — run `supabase-security-pentest` per environment |

---

## 10. Remaining hardening opportunities

- Optional rate limits on `GET /api/tipping-context/location|table/:id` (global `/api` cap already applies).
- HEIC/AVIF dimension probe if product volume justifies dependency or deeper BMFF parser.
- Monitor `SEC_QR_SCAN_IP_MAX_PER_15M` in production metrics.

---

## 11. Security regression checklist (post-implementation)

| Check | Result |
|-------|--------|
| A. Cross-tenant KYC blocked | Unchanged |
| B. Guest tip IDOR blocked | Unchanged |
| C. QR venue tenant-bound | Unchanged |
| D. Physical QR PDF scoped | Unchanged |
| E. Client Stripe redirect URLs rejected | Unchanged |
| F. Checkout URLs server-controlled | Unchanged |
| G. No new user-controlled fetch | Verified |
| H–L. KYC privacy, static block, SVG, magic bytes, opaque keys | Unchanged |
| M. CareTip guest QR URLs work for branded QR | Validated in remediation script |

---

**READY — SECURITY REMEDIATION COMPLETE**
