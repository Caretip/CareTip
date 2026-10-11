# CareTip — Business main QR initial white state (P0 remediation)

**Date:** 2026-10-03  
**Forensic reference:** `CARETIP_BUSINESS_QR_INITIAL_WHITE_STATE_FORENSIC_REPORT.md`  
**Status:** **READY**

---

## 1. Confirmed root cause

`/{businessSlug}` → `BusinessStaffDirectoryPage` rendered the team UI but did not set `[data-caretip-route-ready]` or call `usePublicHtmlBootHandoff`, so `#caretip-html-boot` could remain over painted content (`isGuestSlugPath` / `publicLandingRouteCommitted` contract).

---

## 2. Files changed

| File | Change |
|------|--------|
| `src/app/pages/customer/BusinessStaffDirectoryPage.tsx` | `data-caretip-route-ready` on success root; `usePublicHtmlBootHandoff(...)` |
| `e2e/customer-business-qr-boot-handoff.spec.ts` | **New** — boot handoff regression |
| `scripts/customer-journey-flicker-runtime.ts` | Static guard for business directory handoff + no `t` fetch dep |

**Unchanged:** route lazy loading, directory API, global loaders, language-switch P0 (`t` not in fetch deps).

---

## 3. Boot-handoff change

**Marker (success branch only):**

```tsx
<div className={`${cf.pageTeam} pb-10 sm:pb-12`} data-caretip-route-ready="">
```

**Handoff predicate (mirrors `TableQrLandingPage` / `LocationQrLandingPage`):**

```tsx
usePublicHtmlBootHandoff(!loading && !invalidLink && !error && Boolean(data));
```

---

## 4. Readiness predicate

| State | Handoff | `route-ready` |
|-------|---------|---------------|
| `loading` | No | No |
| `invalidLink` | No | No |
| `error` / no `data` | No | No |
| Directory loaded, team UI | **Yes** | **Yes** |

Terminal error UI matches table/location (no marker on error div; handoff off while error).

---

## 5. Before / after lifecycle

**Before:** Team DOM committed → boot stayed active → cream overlay over UI.

**After:** Team DOM commits → `[data-caretip-route-ready]` → `usePublicHtmlBootHandoff` → boot dismissed → team remains visible.

---

## 6–10. QR regression (preview `http://localhost:4173`, mocked APIs)

| Route | Result |
|-------|--------|
| **Business `/{slug}`** | Boot handoff E2E **pass**; route-ready visible; boot not covering team |
| **Employee `/staff/…`** | Existing language-switch E2E **pass** (unchanged code) |
| **Table / location** | No code changes; control paths unchanged |

Cold/warm: E2E uses production `dist` via preview; handoff within **500ms** of route-ready marker (dedicated test).

---

## 11. Language-switch regression

`e2e/customer-business-directory-language-switch.spec.ts` — **2/2 pass** (no directory refetch; continuous visibility).

---

## 12. Directory request count

Unchanged: **one** `GET /api/staff/directory/business/:slug` per slug navigation; locale toggles do not add requests.

---

## 13. Tests

| Command | Result |
|---------|--------|
| `npm run test:customer-language-switch-white-flash` | ok |
| `npm run test:customer-journey-flicker` | ok (includes new business-directory assertion) |
| Playwright boot + language + tip (5 tests) | **5/5 pass** |
| `npm run typecheck` | pass |
| `npm run build` | pass |

---

## 14. Diff scope

Customer business directory page boot contract + E2E + one static script assertion only.

---

## 15. Preserved architecture

`AppLoadingManager`, `SoftSpaRouteHold`, marketing shell, auth, dashboard loaders, `changeCustomerJourneyLanguage` / `keepPageVisible`, locale prefetch, lazy `/:businessSlug`, single directory fetch.

---

## Ready gate

| Criterion | Met |
|-----------|-----|
| Boot dismisses after team UI | Yes (E2E) |
| No new post-render blank | Yes |
| Language switch without refetch | Yes |
| Other QR types untouched | Yes |
| Build + tests | Yes |

**STATUS: READY**
