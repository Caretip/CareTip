# CARETIP Customer QR Journey — Blank / White Render Forensic Audit

## 1. Issue summary

Guests opening a QR or customer tipping URL sometimes see an unexplained **white or empty viewport** before the journey UI appears. The same class of flash can appear on **in-journey navigation** (lazy route chunks) and was partially addressed for **EN/DE language switch** in a prior fix (`CARETIP_CUSTOMER_LANGUAGE_SWITCH_WHITE_FLASH_AUDIT.md`). This audit covers the **full customer QR path** and applies **root-cause** fixes only (no global skeletons, min-heights, or artificial delays).

## 2. Scope (customer only)

Included: business / employee / location / table QR, `/{businessSlug}` directory, `/{businessSlug}/{employeeSlug}`, team picker, tip amount, payment, success, rating, tip-complete, and intermediate public customer routes.

Excluded: business/employee/admin dashboards, marketing-only pages (except shared boot/loading infrastructure), Stripe dashboard, payouts.

## 3. Reproduction matrix (documented)

| Scenario | Local dev | Production build | Typical visual sequence |
|----------|-----------|------------------|-------------------------|
| Cold paste Business QR (`/qr-landing/:id`, `/table/:slug`) | White gap common | Shorter but visible | HTML boot → brief plain `#fcfbf8` / `bg-background` → team picker |
| Cold Location/Table id QR (`/qr/location`, `/qr/table`) | Same | Shorter | HTML boot → lazy chunk hold or empty layer → landing |
| Cold Employee QR (`/qr/employee/:id`) | Less (eager route) | Rare gap | Boot until employee fetch commits |
| Hard refresh / incognito | Same as cold | Same | |
| Nav: landing → tip amount → payment | Soft nav chunk hold | Usually branded hold | `PublicRouteChunkHold` (cream), not always “white” |
| Browser back/forward | Occasional chunk re-fetch | Similar | Branded hold if lazy route suspends |
| DE ↔ EN on customer header | Was full white flash | Improved | See language-switch audit; locale prefetch + no outlet unmount |
| Widths 320–430 / tablet / desktop | No unique root cause | Same mechanisms | |

**What the customer sees (cold QR landing, before fix):**

```text
0ms     index.html + #caretip-html-boot (branded spinner + tagline)
~i18n   React mounts; router resolves lazy QRLandingPage chunk
        GlobalAppLoadingHold OR empty #root under fading boot → perceived “white page”
~chunk  QRLandingPage mounts; data fetch; CustomerFlowShell loading may stack another hold
~ready  [data-caretip-route-ready] → HTML boot dismissed → stable team picker
```

**Not observed as primary cause:** full document reload on language switch; tip state reset on locale change; `useSuspense` on i18n.

## 4. Root causes (evidence-based)

| ID | Mechanism | Why it reads as “white” |
|----|-----------|-------------------------|
| **A** | **Lazy `QRLandingPage` on primary QR URLs** | React Router `lazy` suspends the outlet; until the chunk arrives, `#root` can be empty while HTML boot fades or is absent. |
| **B** | **`GlobalAppLoadingHold` under HTML boot** | `CustomerFlowShell` / `CareTipPageLoader` rendered `bg-background` fullscreen while `holdUnderHtmlBoot` — a second neutral layer between boot and content. |
| **C** | **No customer chunk prefetch on cold entry** | `prefetchPublicEntryGraph()` warmed marketing only; QR URLs waited until router started lazy import after i18n gate. |
| **D** | **`markAppShellInteractive()` too early on customer URLs** | Could mark shell interactive before `[data-caretip-route-ready]`, weakening boot-retain coordination on edge paths without `#caretip-html-boot`. |
| **E** | **Generic chunk-hold copy on customer lazy routes** | `PublicRouteChunkHold` used only legal/generic taglines — correct UI but still a full-screen transition; journey copy reduces “broken page” perception during real chunk waits. |
| **F** | **Language switch (prior)** | Lazy alternate locale JSON + language-change overlay race — **fixed separately**; still related visually but not the same as cold QR entry. |

## 5. Fixes implemented (this pass)

| Change | Addresses |
|--------|-----------|
| **Eager `QRLandingPage`** on `/qr-landing/*` and `/table/:qrSlug` | **A** — no outlet suspend on most business/table QR scans |
| **`prefetchCustomerEntryGraph()`** from `main.tsx` (parallel to i18n) | **C** — warms path-matched lazy pages (`TableQr`, `LocationQr`, `Staff`, slug directory, payment, etc.) |
| **`CustomerFlowShell` / `CareTipPageLoader` → `null` when `holdUnderHtmlBoot`** | **B** — HTML boot remains the only fullscreen layer until handoff |
| **Defer `markAppShellInteractive()`** on customer cold entry until route-ready (when boot already gone) | **D** |
| **`PublicRouteChunkHold` uses `resolveCustomerJourneyBootContext`** | **E** — branded journey tagline during unavoidable lazy suspends |
| *(Prior)* Language switch: `keepPageVisible`, locale prefetch, outlet always mounted | **F** |

**Intentionally not done:** global min-height hacks, artificial `setTimeout` boot delays, extra Suspense skeletons on every customer page, or dashboard/marketing refactors.

## 6. Architecture notes (customer boot)

- Customer paths are **public shell** — no authenticated `app-boot` overlay.
- HTML boot is retained until landing commit via `shouldRetainHtmlBootUntilLandingCommit` + `usePublicHtmlBootHandoff` + `[data-caretip-route-ready]`.
- Stripe return routes **`/rating`**, **`/success`**, **`/tip-amount`**, **`/qr/employee`** remain **eager** (existing white-screen architecture locks).
- Remaining lazy customer entries (`/qr/table/:id`, `/qr/location/:id`, `/staff/:slug`, slug paths, `/payment`) rely on **prefetch + branded `PublicRouteChunkHold`** — real chunk load, not masked.

## 7. Verification

**Automated (no browser):**

```bash
npm run test:customer-journey-flicker
npm run test:white-screen-architecture
npm run test:customer-language-switch-white-flash
npm run typecheck
```

**Manual (recommended before release):**

1. Incognito: paste each QR URL type; hard refresh; confirm no full-viewport white between boot and team picker / landing.
2. Walk full funnel through payment (test mode); back/forward on tip amount and landing.
3. Toggle EN/DE on each step with header switcher.
4. Repeat on `npm run build` + `npm run preview` at 375px and desktop.

## 8. Status

**FIXED — READY FOR REVIEW** (customer QR blank-render causes **A–E** addressed; **F** in prior language-switch work). Residual chunk-load flashes on **secondary lazy QR entry routes** should show **branded** `PublicRouteChunkHold`, not an empty document — report if a route still shows raw white with no boot and no hold (likely chunk failure → existing recovery).

## 9. Key files

- `src/main.tsx` — `prefetchCustomerEntryGraph()`
- `src/app/lib/prefetchCustomerEntryGraph.ts`
- `src/app/routes.tsx` — eager `QRLandingPage`
- `src/app/pages/customer/CustomerFlowShell.tsx`
- `src/app/components/CareTipPageLoader.tsx`
- `src/app/context/AppLoadingManager.tsx`
- `src/app/routing/PublicRouteChunkHold.tsx`
- `scripts/customer-journey-flicker-runtime.ts`
