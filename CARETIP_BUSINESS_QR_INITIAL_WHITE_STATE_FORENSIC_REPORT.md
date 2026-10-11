# CareTip — Business main QR initial white / empty state (forensic audit)

**Date:** 2026-10-03  
**Scope:** Guest **business team QR** cold load vs employee / table / location QR  
**Status:** **ROOT CAUSE CONFIRMED — READY FOR MINIMAL REMEDIATION**  
**No product code changed in this pass.**

**Separate from:** Business QR **language-switch** white screen (`BusinessStaffDirectoryPage` `t` in fetch deps — fixed in P0 remediation). This audit covers **initial load only**.

---

## Executive answer

**Why does business main QR show a white / empty region before the customer UI while employee, table, and location QR do not (as strongly)?**

The canonical business storefront URL is **`/{businessSlug}`** → lazy **`BusinessStaffDirectoryPage`**. That page is the **only** team-picker entry among the four that **never sets `[data-caretip-route-ready]`** and **does not call `usePublicHtmlBootHandoff`**. Guest slug paths are explicitly wired in `boot-locale.js` / `htmlMarketingBootBridge.ts` to keep **`#caretip-html-boot`** until `[data-caretip-route-ready]` exists. Table, location, and `/qr-landing/:id` set the marker when the team UI commits; business slug does not.

**Observed runtime (production `dist` + `vite preview`, mocked APIs):** After the team directory paints (`.customer-flow` + copy in `#root`), **`#caretip-html-boot` and `caretip-html-boot-active` can remain** with `routeReady: false`, so the user still sees the full-viewport boot layer (`z-index: 9997`, `#fcfbf8` background) over the real UI. Earlier in the timeline, short windows occur with **no boot, empty `#root`, no loader** (CareTipPageLoader returns `null` while boot node absent — see §4).

Employee QR (`/staff/:slug`) quickly **redirects** to `/tip-amount` (eager route + `CustomerFlowShell` + `data-caretip-route-ready`). Table/location QR pages **hand off boot** when data is ready. Business slug does not.

**Note on “QR rendering”:** Guest scan URLs do not paint a QR **image** on the customer page; “QR/customer experience” here means the **tipping / team-selection UI** after scan. Dashboard QR Studio PNG generation is out of scope unless reported separately.

---

## 1. Exact business main QR route

| Item | Value |
|------|--------|
| **Canonical URL** | `publicBusinessTipUrl(slug)` → `/{businessSlug}` (`src/app/lib/appPublicUrl.ts`) |
| **Route** | `path: '/:businessSlug'` (last child in `routes.tsx` — catch-all over reserved segments) |
| **Component** | `BusinessStaffDirectoryPage` — **`lazy: routeLazy(...)`** |
| **Legacy alias** | `/business/:businessSlug` → `RedirectLegacyBusinessDirectory` → `/{slug}` |
| **Alternate (no slug)** | `/qr/business/:id` → `/qr-landing/:id` → **eager** `QRLandingPage` |

**Lifecycle (business slug):**

```
Navigation to /{businessSlug}
  → index.html #caretip-html-boot (tipPage copy via isGuestSlugPath)
  → main.tsx prefetchCustomerEntryGraph() (imports BusinessStaffDirectory + QRLanding + StaffTipByPublicPath chunks)
  → React hydrate → RootLayout → RouteChunkBoundary (Suspense)
  → Lazy chunk BusinessStaffDirectoryPage
  → useEffect: GET /api/staff/directory/business/:slug
  → loading: CareTipPageLoader (wait)
  → success: team picker (CustomerTeamPicker) — NO data-caretip-route-ready
```

**Blocking API:** `getBusinessStaffDirectory` — single request; business + `employees[]` in one payload. No separate “QR config” or client QR library on this page.

---

## 2. Reproduction (production-equivalent)

**Commands:** `npm run build` → `vite preview` (port 4173).

**Steps:** Open `https://…/{businessSlug}` (or local preview with mocked `GET /api/staff/directory/business/:slug`).

**Forensic probe (Chromium, 25 ms polling, mocked JSON):**

| Path | first meaningful `.customer-flow` (~ms) | `whiteGapFrames`* | End state @ ~2.7s |
|------|----------------------------------------|-------------------|-------------------|
| **/{businessSlug}** | ~1722 | **8** | `htmlBoot: true`, `routeReady: **false**`, `customerFlow: true`, text in root |
| `/qr-landing/:id` | ~1753 | 7 | `htmlBoot: false`, `routeReady: **true**`, `customerFlow: true` |
| `/qr/table/:id` | ~1763 | 5 | boot off, `routeReady: true` |
| `/staff/:slug` | ~2194 | **0** | boot off, `routeReady: true` (then tip flow) |

\*`whiteGapFrames` = samples with no `#caretip-html-boot`, no `.customer-flow`, `rootText < 15`, no `.app-branded-loader` (empty / white `#root`).

**T0–T5 (business slug, qualitative):**

| Marker | Typical order |
|--------|----------------|
| T0 | Navigation |
| T1 | HTML boot visible (`#caretip-html-boot`) |
| T2 | React + lazy chunk; brief empty `#root` possible |
| T3 | `CareTipPageLoader` or `null` under boot (`holdUnderHtmlBoot`) |
| T4 | Directory API completes; team DOM in `#root` |
| T5 | User-visible team UI — **often still covered by boot** because `routeReady` never set |

**Hard refresh / cold cache:** More lazy-chunk + API latency; boot + empty-root windows lengthen. **Warm repeat:** Chunk cached; API may still block team UI until directory returns.

---

## 3. Comparison table (four QR types)

| QR type | Typical scan URL | Entry component | Lazy? | Primary API | Loader while waiting | `data-caretip-route-ready` | Boot handoff |
|---------|------------------|-----------------|-------|-------------|----------------------|----------------------------|--------------|
| **Business main** | `/{businessSlug}` | `BusinessStaffDirectoryPage` | **Yes** (catch-all) | `GET …/directory/business/:slug` | `CareTipPageLoader` | **Missing** | **Broken / stuck boot** |
| **Business (id)** | `/qr-landing/:businessId` | `QRLandingPage` | **No** (eager) | `GET /api/business/:id` (+ directory in **background** for pool) | `CustomerFlowShell` loading | **Yes** | **Works** |
| **Employee** | `/staff/:slug`, `/qr/employee/:id` | `StaffLandingPage` / `EmployeeQrEntryPage` | Yes | `GET /api/staff/:slug` or employee by id | `CareTipPageLoader` → redirect | **Yes** (profile or tip) | **Works** |
| **Table** | `/qr/table/:tableId` | `TableQrLandingPage` | Yes | `GET …/tipping-context/table/:id` | `CareTipPageLoader` | **Yes** | **Works** |
| **Location** | `/qr/location/:locationId` | `LocationQrLandingPage` | Yes | `GET …/location/:id` | `CareTipPageLoader` | **Yes** | **Works** |

**Prefetch (`prefetchCustomerEntryGraph`):** Slug path pulls **three** lazy modules (`BusinessStaffDirectoryPage`, `QRLandingPage`, `StaffTipByPublicPathPage`); table/location/staff each prefetch **one** targeted page.

---

## 4. What is actually white (DOM classification)

| Class | Business slug | Evidence |
|-------|---------------|----------|
| A. React not mounted | Briefly | Empty `#root` in gap frames |
| B. Route renders null | Yes during load | `CareTipPageLoader` + `isHtmlBootElementPresent()` → **returns `null`** |
| C. Loading component | Yes | `CareTipPageLoader` `variant="wait"` when boot gone |
| D. Suspense fallback | Possible | Lazy catch-all → `MinimalRouteFallback` / `SoftSpaRouteHold` after shell interactive |
| E. Global AppLoadingManager | Not primary | Customer directory uses page loader, not global overlay |
| F. CustomerFlowShell loader | **No** on slug path | Unlike `QRLandingPage` loading branch |
| G. Business data loading | **Yes** | Whole page waits on **one** directory GET (required for team list) |
| H. QR image / library | N/A | No guest QR canvas on this route |
| I. QR blank | N/A | |
| J. CSS cover | **Yes** | `#caretip-html-boot` fixed full viewport over content |
| K. HTML boot visible | **Yes — persists** without `route-ready` | Probe: boot active while `customerFlow` true |
| L. Route chunk loading | Yes | Lazy `BusinessStaffDirectoryPage` |

**Mandatory distinction:** The “white” is mostly **`#fcfbf8` boot / `bg-background` loaders**, not an unstyled document. The business-specific bug is **boot not handing off** after content exists because **`publicLandingRouteCommitted()`** requires `[data-caretip-route-ready]` (`boot-locale.js` + `isGuestSlugPath`).

---

## 5. QR / customer rendering lifecycle

Guest business page does not generate a scannable QR. Lifecycle is:

```
GET directory (business + employees)
  → React team picker
  → (no route-ready marker on slug path)
  → HTML boot retain / overlay blocks perceived “render complete”
```

`/qr-landing/:id` can show team UI after **`getBusinessById`**; staff directory for the pool is **non-blocking** (`QRLandingPage` comment: “do not block tip-page shell / HTML boot handoff”).

---

## 6. Network / blocking (business slug)

| Request | Blocks first paint? | Required for team UI? |
|---------|---------------------|------------------------|
| `GET /api/staff/directory/business/:slug` | **Yes** (page `loading` until done) | **Yes** (only data source for slug path) |
| i18n initial bundle | Parallel (boot) | No for structure |
| Lazy `BusinessStaffDirectoryPage` chunk | Yes until mounted | Yes |
| Socket / realtime | After `data` | No |
| Business logo in header | From directory payload | No extra request |

No evidence that a **non-critical** API blocks business slug beyond the one directory call (unlike qr-landing’s optional parallel directory).

---

## 7–9. Loading components & HTML boot

**Business slug loading UI:**

```135:142:src/app/pages/customer/BusinessStaffDirectoryPage.tsx
  if (loading) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="tipPage"
        registrationKey="business-staff-directory"
      />
    );
  }
```

**Success UI — no `data-caretip-route-ready`:**

```161:163:src/app/pages/customer/BusinessStaffDirectoryPage.tsx
  return (
    <div className={`${cf.pageTeam} pb-10 sm:pb-12`}>
```

**Table QR (contrast):**

```192:194:src/app/pages/customer/TableQrLandingPage.tsx
  return (
    <div className={`${cf.pageTeam} pb-8 sm:pb-10`} data-caretip-route-ready="">
```

**Boot contract (`boot-locale.js`):**

```302:304:public/boot-locale.js
    if (isCustomerBootPath(path)) {
      return Boolean(doc.querySelector("[data-caretip-route-ready]"));
    }
```

`isGuestSlugPath("/{slug}")` is true → same commit rule as `/qr-landing/…`.

**`CareTipPageLoader` under boot:** returns `null` when `#caretip-html-boot` present → if boot is dismissed early, **empty `#root`** until chunk/API (white gap frames).

---

## 10. Route lazy loading

| Route | Loading mode |
|-------|----------------|
| `/:businessSlug` | **Lazy** (catch-all) |
| `/qr-landing/:businessId` | **Eager** `QRLandingPage` |
| `/qr/table/:id`, `/qr/location/:id`, `/staff/:slug` | Lazy, **dedicated** prefetch on path prefix |

Business slug shares catch-all with `/:businessSlug/:employeeSlug` prefetch noise.

---

## 11. Directory dependency

Business **slug** path: **must** wait for full directory response before showing team list (product-correct).  
**Not** the same as qr-landing, which can paint business shell then fill employees asynchronously.

The white issue is **not** “waiting for directory” alone (table/location wait similarly) — it is **missing route-ready + boot handoff** and **less friendly loading chrome** vs `QRLandingPage`.

---

## 12. Images / branding

Team avatars load after list render; no gate on logo fetch beyond directory JSON. Not the primary delta vs other QR types.

---

## 13–14. Waterfall & cache

**Cold:** HTML → JS → (lazy chunk) → directory API → paint (under boot).  
**Warm:** Chunk cached; API still gates content; **boot stuck** until route-ready semantics satisfied.

---

## 15. Language-switch fix (out of scope)

Removing `t` from directory fetch deps fixes **EN ↔ DE refetch**, not initial boot/handoff.

---

## 16. Other `t`-dependent customer effects (review only)

| File | Risk on locale change |
|------|------------------------|
| `PaymentPage.tsx` | `navigate('/tip-amount')` on `t` change — legacy `/payment` only |
| `TipAmountPage.tsx` | canceled toast |
| `QRLandingPage.tsx` | `document.title` only |

No change recommended in this audit.

---

## Root cause

**`BusinessStaffDirectoryPage` omits the customer route commit marker and HTML boot handoff used by every other team-picker QR entry.** For `/{businessSlug}`, `boot-locale.js` treats the path as a customer boot path but `publicLandingRouteCommitted()` stays false, so **`#caretip-html-boot` remains over painted content** (probe: `htmlBoot: true`, `customerFlow: true`, `routeReady: false`). Combined with lazy catch-all chunk load and `CareTipPageLoader` returning **`null`** while the boot node exists / brief post-boot empty `#root`, the user sees a **white / empty** interval before the experience feels “rendered.”

---

## Minimal fix (proposed — not implemented)

1. On successful directory load (and error states that are terminal UI), set **`data-caretip-route-ready=""`** on the page root (mirror `TableQrLandingPage` / `QRLandingPage`).
2. Add **`usePublicHtmlBootHandoff(!loading && !invalidLink && !error && Boolean(data))`** (same pattern as table/location/qr-landing).
3. **Optional later:** align loading state with `CustomerFlowShell` + step title for parity with `/qr-landing` (P1 UX, not required for boot contract).

**Do not** remove directory fetch or mark ready before data exists.

---

## Regression risks

- Setting `route-ready` too early (before real team DOM) could reintroduce marketing-style boot gaps — mirror table/location predicates.
- Eager-loading the catch-all route is broader than needed if handoff is fixed.

---

## PRESERVE

`changeCustomerJourneyLanguage` / `keepPageVisible`, locale prefetch, `LanguageChangeLoadingRegistrar`, `SoftSpaRouteHold`, marketing shell, dashboard loaders, auth, Stripe, lazy architecture for other routes, business directory **single-fetch** semantics, recent language-switch P0.

---

## AFFECTED

- **Route:** `GET /{businessSlug}` → `BusinessStaffDirectoryPage`
- **State:** Cold / warm load until team picker visibly interactive and boot dismissed

---

**STATUS: ROOT CAUSE CONFIRMED — READY FOR MINIMAL REMEDIATION**
