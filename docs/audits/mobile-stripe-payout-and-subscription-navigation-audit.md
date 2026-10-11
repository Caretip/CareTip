# CareTip — Mobile Stripe Payout + Mobile→Web Subscription Forensic Audit

**Date:** 2026-09-22  
**Scope:** READ-ONLY investigation — no product code modified  
**Evidence basis:** Source-code trace, static regression scripts, screenshot-guided hypotheses (not runtime device capture)

---

## 1. Executive summary

Two separate mobile UX problems were investigated:

### Problem 1 — Red “Keine Verbindung zu CareTip” banner alongside valid Stripe payout amounts

**Root cause classification:** **Global transport-error state (Request A) overlaid on successful/cached payout data (Request B)** — not a single failed payout fetch.

The red banner is the app-wide `ErrorBanner`, driven by `uiStore.globalError`. It is set by the Axios response interceptor when **any** protected API call fails **without an HTTP status** (network transport failure). It is **not** wired to the instant-payout eligibility query specifically. The payout amounts on the “Stripe Payment” screen come from a **separate** TanStack Query (`instantQuery`) backed by `GET /api/me/employee-connect/instant-payout`, which calls Stripe balance APIs on the backend. Those queries can succeed (or serve **cached** data under `offlineFirst`) while another in-flight request trips the global banner.

Screenshot A (history tabs + skeletons + red banner) and Screenshot B (full payout amounts) are consistent with **different screens or different moments** in the same session: history list loading (`payablesQuery`) under a **persistent** global error, versus the main payout screen rendering cached/successful eligibility data.

### Problem 2 — Mobile app → web subscription handoff stuck on loading

**Root cause classification (most likely):** **Multi-layer web bootstrap loading** after handoff — not a single “billing bug.” The handoff path crosses:

1. In-app browser (`expo-web-browser` Custom Tab / SFSafariViewController)
2. `/mobile-auth?token=…` (lazy route + `AuthBootstrapShell`)
3. `POST /api/auth/mobile-web-handoff/consume` (one-time token → HttpOnly refresh cookie + access JWT)
4. Redirect to `/dashboard/billing/subscription` (protected dashboard shell + lazy billing chunks)
5. `fetchBillingStatus()` + `AppLoadingManager` / `useExtendGlobalLoaderUntilReady` overlay latch

A user can appear “stuck” when **any** of these layers never releases: handoff consume failure (expired token, IP/UA mismatch), `ProtectedRoute` guard blocking, global overlay latched through billing boot, or `GET /api/me/billing` never settling `loading=false`.

**Language flicker** is a separate, evidenced issue: mobile locale, browser `localStorage`, HTML `boot-locale.js`, and multiple loader owners (`#caretip-html-boot`, `AppLoadingManager`, `AuthBootstrapShell`, route guards) can each paint different languages/messages in sequence.

**Severity:** Problem 1 — **Medium** (misleading global error, confusing concurrent loading states). Problem 2 — **High** (blocks subscription management; revenue-impacting).

---

## 2. Problem 1 — Stripe payout error

### 2.1 Screens mapped to code

| Screenshot | Likely screen | Route (mobile) | Component |
|------------|---------------|----------------|-----------|
| A — tabs “CareTip-Überweisungen” / “Bankauszahlungen”, skeleton rows, red banner | Payout **history** | `/(app)/employee/payouts/history` | `EmployeePayoutHistoryScreen` |
| B — “Stripe Payment”, Sofortfähiger Betrag, Sofortauszahlung block | Payout **connect / withdraw** | `/(app)/employee/payouts` | `EmployeePaymentsConnectScreen` |

German copy in Screenshot B matches `mobile/i18n/locales/de.ts` keys under `employeePayouts.*` (e.g. `availableLabel`, `pendingLabel`, `instantTitle`).

---

## 3. Exact source of the red connection error

| Property | Value |
|----------|-------|
| **UI component** | `mobile/components/layout/ErrorBanner.tsx` |
| **State owner** | `mobile/store/uiStore.ts` → `globalError: NormalizedApiError \| null` |
| **i18n key** | `errors.offline` |
| **German string** | `"Keine Verbindung zu CareTip. Bitte Internetverbindung prüfen und erneut versuchen."` (`mobile/i18n/locales/de.ts` ~L870–871) |
| **Formatter** | `formatUserFacingError()` → `pick("errors.offline")` when `normalized.isNetworkError` (`mobile/utils/userFacingError.ts` ~L227–228) |
| **Reporter** | `reportGlobalError()` (`mobile/utils/errors.ts` ~L12–24) |
| **Trigger** | Axios response interceptor (`mobile/services/api/client.ts` ~L289–291): `if (!status && !isPublicApiPath(original?.url)) { reportGlobalError(error); }` |
| **Also triggers on** | Failed access-token refresh while `authStatus === "authenticated"` (~L219–221) |

**This is not the screen-level `ErrorState`** used for payout queries. Screen errors use `employeePayouts.loadPayoutInfoTitle` / `loadPayoutInfoBody` — different copy.

`OfflineBanner` (`mobile/components/layout/OfflineBanner.tsx`) is a **separate** yellow warning tied to `NetInfo` (`isOnline`), not the red destructive banner in the screenshots.

---

## 4. Exact request that triggers the error

The banner does **not** identify which request failed. **Any** protected request that returns Axios `Network Error` / `ERR_NETWORK` / `ECONNREFUSED` / `ENOTFOUND` **without** `response.status` can set `globalError`.

### Requests on payout main screen mount (`EmployeePaymentsConnectScreen`)

| # | Query key | Service function | Endpoint | Method | Auth |
|---|-----------|------------------|----------|--------|------|
| 1 | `keys.employeeMe` | `fetchEmployeeProfile` | `/api/employees/me` | GET | Bearer + refresh on 401 |
| 2 | `[...keys.employeeMe, "connect-status"]` | `fetchEmployeeConnectStatus` | `/api/me/employee-connect/status` | GET | Bearer |
| 3 | `[...keys.employeeMe, "instant-payout"]` | `fetchEmployeeInstantPayoutEligibility` | `/api/me/employee-connect/instant-payout` | GET | Bearer |

### Requests on payout history screen mount (`EmployeePayoutHistoryScreen`)

| # | Query key | Endpoint | Method |
|---|-----------|----------|--------|
| 4 | `[...keys.employeeMe, "payables"]` | `/api/me/employee-connect/payables?take=50&skip=0` | GET |
| 5 | `[...keys.employeeMe, "stripe-payouts"]` | `/api/me/employee-connect/stripe-payouts?take=50` | GET |

### Background (employee tab layout)

| # | Source | Endpoint | Notes |
|---|--------|----------|-------|
| 6 | `useUnreadNotificationCount` in `employee/_layout.tsx` | `/api/me/notifications/unread-count` | Polls every 120s when socket disconnected |

**Most likely banner trigger on an otherwise-working payout screen:** request **#1, #2, #4, #5, or #6** (or refresh retry) suffers a **transient transport failure**, while **#3** already succeeded or is served from TanStack Query cache.

---

## 5. Request/response lifecycle (instant payout path)

```
Mobile EmployeePaymentsConnectScreen
  └─ instantQuery (TanStack Query)
       └─ fetchEmployeeInstantPayoutEligibility()
            └─ apiClient.get("/api/me/employee-connect/instant-payout")
                 ├─ Request interceptor: attach Bearer access token
                 ├─ Backend: employeeConnect.controller.getMyEmployeeInstantPayout
                 │    └─ getEmployeeInstantPayoutEligibilityForUser(userId)
                 │         └─ evaluateInstantPayoutForStripeAccount({ stripeAccountId, ... })
                 │              ├─ Stripe accounts.retrieve
                 │              ├─ Stripe balance.retrieve (expand instant_available.net_available)
                 │              └─ Stripe accounts.listExternalAccounts
                 ├─ withInstantPayoutTerms(...) appended to JSON
                 └─ Response → eligibility DTO → UI renders amounts
```

**Parallel global error path (any protected call):**

```
apiClient response interceptor
  └─ error.response?.status is undefined (transport failure)
       └─ reportGlobalError(error)
            └─ uiStore.setGlobalError(normalized)
                 └─ ErrorBanner renders errors.offline (red)
```

**Retry behavior:**

- TanStack Query: `retry: shouldRetryQuery`, `networkMode: "offlineFirst"`, default `staleTime: 45_000` (`mobile/services/api/queryClient.ts`)
- Axios: 401 → single silent refresh + retry (`client.ts` ~L264–284)
- Transport errors: **no** automatic global retry; banner persists until user taps “Schließen” (`ErrorBanner` → `clearGlobalError`)

**Cache layer:** Successful `instantQuery` data remains in cache for `gcTime` 10 minutes; `offlineFirst` can show stale eligibility while a refetch fails globally.

---

## 6. Why payout data can appear simultaneously with the connection error

**Confirmed mechanism: REQUEST A (global transport failure) + REQUEST B (instant eligibility success or cache).**

Evidence in `EmployeePaymentsConnectScreen.tsx`:

```182:184:mobile/features/employee/payouts/EmployeePaymentsConnectScreen.tsx
  const moneyLoading = instantQuery.isLoading && !instantQuery.data && !businessDistribution;
  const moneyError = instantQuery.isError && !instantQuery.data && !businessDistribution;
```

- If `instantQuery.data` exists (fresh or cached), **`moneyError` is false** — amounts render.
- `ErrorBanner` is rendered unconditionally by `Screen` (`mobile/components/ui/Screen.tsx` ~L79–80) from **global** state, independent of `instantQuery`.

Therefore the UI can show:

- Red global banner ← failed **unrelated** transport request
- €98,02 / €95,62 ← successful **instant-payout** GET (or cache)

This is **not** “Stripe succeeded but CareTip failed for the same call.” It is **cross-request state composition**.

---

## 7. Loading/skeleton state analysis

### Main payout screen (`EmployeePaymentsConnectScreen`)

| State | Condition | UI |
|-------|-----------|-----|
| Skeleton block | `moneyLoading` = `instantQuery.isLoading && !instantQuery.data && !businessDistribution` | `Skeleton` placeholders (~L257–263) |
| Screen error | `moneyError` = `instantQuery.isError && !instantQuery.data` | `ErrorState` (~L264–269) |
| Global red banner | `globalError != null` | Always above scroll content |

**`loading=true` + `globalError=true` is possible** when:

- `instantQuery` is still in initial load (skeleton), and
- Another request already called `reportGlobalError`

**`loading=false` + data visible + globalError=true` is possible** when:

- `instantQuery` has data (including cache), and
- A later parallel/refetch/background request fails at transport layer

Global error is **not** cleared on navigation or query success — only `clearGlobalError()` on banner dismiss or auth cache boundary (`mobile/services/auth/authCacheBoundary.ts` ~L78–79).

### History screen (`EmployeePayoutHistoryScreen`) — Screenshot A match

CareTip tab skeleton:

```147:149:mobile/features/employee/payouts/EmployeePayoutHistoryScreen.tsx
      {tab === "caretip" ? (
        payablesQuery.isLoading && !payablesQuery.data ? (
          <SkeletonListRows count={4} />
```

Tabs match screenshot: `caretipTab` / `bankTab` (~L141–142).

**Simultaneous skeleton + red banner:** `payablesQuery` loading while `globalError` already set from any prior/current transport failure. **Independent state machines.**

---

## 8. Source of every displayed payout amount (Screenshot B)

All amounts on the main screen are derived from `EmployeeInstantEligibility` returned by `GET /api/me/employee-connect/instant-payout`, ultimately from Stripe via backend.

| UI label (DE) | UI field | Mobile source | Backend / Stripe source |
|---------------|----------|---------------|-------------------------|
| Sofortfähiger Betrag **€98,02** | `formatCentsEur(availableCents)` | `availableCents = gross > 0 ? gross : net` (~L89–91) | `instantAvailableGrossCents` ← Stripe `balance.instant_available[].amount` |
| Ausstehend **€98,02** | `eligibility.pendingCents` (~L300) | Shown when `balancesRetrieved === true` | Stripe `balance.pending` for currency (`stripeConnectInstantPayout.service.ts` ~L393, `balanceAmount`) |
| Sofortauszahlung **€95,62** (you receive) | `formatCentsEur(net)` (~L411) | `net = eligibility.instantAvailableNetCents` | Stripe `instant_available.net_available[].amount` (Platform Pricing net) |
| Gebühr **€2,40** | `platformFeeCents` (~L422–425) | `feeCents = eligibility.platformFeeCents` | Backend: `platformFeeCents = gross - net` (~L370) |
| **2.5%** | `employeeInstantFeePercentLabel` | Shown when `targetTotalFeeBps === 250` | `CARETIP_INSTANT_PAYOUT_TARGET_TOTAL_FEE_BPS = 250` (configured target, not recomputed from net) |
| An **•••• 3000** | `formatMaskedLast4(destinationLast4)` | From eligibility DTO | Stripe external account `last4` |

**Fresh vs cached:** TanStack Query `staleTime` default 45s, `networkMode: "offlineFirst"`. Amounts may be **cached** up to stale window / gcTime while banner reflects a **new** failure.

---

## 9. Financial calculation / Stripe semantics

### Can “available” and “pending” both be €98,02?

**Yes — legitimately, not automatically a bug.**

They measure **different Stripe balance buckets**:

- **Sofortfähiger Betrag (gross instant available):** funds in `balance.instant_available` eligible for Instant Payout (gross, before platform pricing net).
- **Ausstehend (pending):** funds in `balance.pending` still settling — **not** instant-available per Stripe semantics (`pendingHint` copy explains this).

The same nominal value in both buckets can occur when Stripe reports equal cent amounts in `instant_available` and `pending` for the connected account (common when recent charges are still in pending settlement while instant pool mirrors available gross).

### Fee math (screenshot values)

| Field | Cents | Euros |
|-------|-------|-------|
| Gross instant (`instantAvailableGrossCents`) | 9802 | €98,02 |
| Net instant (`instantAvailableNetCents`) | 9562 | €95,62 |
| Platform fee (`platformFeeCents`) | 240 | €2,40 |
| Implied fee rate on gross | 240/9802 ≈ 2.45% | UI shows **2.5%** as configured target (`targetTotalFeeBps: 250`) per `employeeInstantFeePercentLabel` — **not** recomputed from displayed net |

Backend comment (`employeeInstantPayout.service.ts` ~L4–6): fee is **Stripe Platform Pricing / net_available**, not a second CareTip-subtracted fee.

### Withdrawal amount

`POST /api/me/employee-connect/instant-payout` uses `amountCents = snap.instantAvailableNetCents` (~L183) — user receives **net**, not gross.

---

## 10. Global vs request-specific error-state analysis

| Layer | Owner | Scope | Payout screen behavior |
|-------|-------|-------|------------------------|
| **Global transport** | `uiStore.globalError` + `ErrorBanner` | App-wide, any protected transport failure | Red “Keine Verbindung…” — **misleading if payout data loaded** |
| **Query-level** | TanStack Query `isError` per query | Per endpoint | `ErrorState` only if `!instantQuery.data` |
| **Submit-level** | `submitError` local state | Instant POST only | Inline red text under CTA |
| **Offline** | `isOnline` + `OfflineBanner` | NetInfo | Yellow hint — different from screenshot |
| **Auth** | Session expiry toast / `AccessErrorState` | 401 / profile hard fail | Full-screen if `profileQuery` fails with no data |

**Design gap:** Global banner cannot distinguish:

1. CareTip API unavailable  
2. Stripe balance unavailable (backend returns 502 with message — **has** HTTP status → **no** global banner)  
3. Stripe payout POST failure  
4. Temporary network blip on **unrelated** endpoint  
5. Auth/session failure  
6. Stripe account not connected  
7. Payout not available (eligibility `reason`)  
8. Loading  

Stripe eligibility failure with HTTP 502 surfaces as **query** `ErrorState`, not the global offline banner.

---

## 11. Mobile Stripe payout UX audit (current structure)

### Information blocks (top → bottom)

1. Screen header — “Stripe Payment” + subtitle  
2. Optional — receiving paused notice  
3. Optional — business distribution card (venue-held tips)  
4. **Balance block** — Sofortfähiger Betrag + hint  
5. **Pending block** — Ausstehend + long explanatory hint  
6. **Instant card** — title, lead, you’ll receive, destination, fee, terms toggle, CTA  
7. **Stripe account block** — connection status, dashboard/update actions  
8. History navigation link  

### UX issues (observed from code + screenshots)

- **English product title “Stripe Payment”** in German locale (`de.ts` L446) — mixed language chrome.  
- **Duplicate numeric presentation** — hero amount at top, then again inside instant card (`threshold` mode shows KV rows; `ready` mode shows net again).  
- **Long sequential scroll** — pending explanation + instant lead + terms + helper text.  
- **Global error banner** unrelated to payout section — erodes trust in displayed Stripe numbers.  
- **History vs withdraw split** — two routes; screenshot A/B may confuse users about which surface is “truth.”  

---

## 12. Recommended mobile payout information hierarchy (recommendations only)

Proposed **conceptual** hierarchy grounded in existing data fields (no new business rules):

```
┌─────────────────────────────────────────┐
│  VERFÜGBAR JETZT (instant net or gross) │  ← primary hero: instantAvailableNetCents when eligible, else gross with label
│  €95,62                                 │
│  “Bereit zur Sofortauszahlung”          │
│  [ €95,62 auszahlen ]                   │  ← single CTA when mode === ready
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│  AUSZAHLUNGSKONTO                       │  ← destinationLast4 + kind
│  •••• 3000                              │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│  GEBÜHR / SIE ERHALTEN                  │  ← platformFeeCents + net (collapsed when equal to hero)
│  Gebühr €2,40 (2,5%) · Sie erhalten €95,62 │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│  AUSSTEHEND (collapsible)               │  ← pendingCents + pendingHint (secondary)
│  €98,02 — noch in Abwicklung bei Stripe │
└─────────────────────────────────────────┘
```

**Principles:** one primary money story, account + fee adjacent to CTA, pending de-emphasized, **global errors scoped** to the failing section (not app-wide banner for non-blocking failures).

---

## 13. Problem 2 — Mobile → web subscription

Managers upgrade/manage plan via **CareTip Web Billing**, not in-app Stripe checkout.

---

## 14. Exact mobile entry points

| Location | Trigger |
|----------|---------|
| `mobile/features/settings/settingsMenuConfig.ts` | Settings → billing menu `onPress: openAuthenticatedBillingWeb()` |
| `mobile/features/business/BusinessDashboardScreen.tsx` | Subscription upgrade `EmptyState` actions |
| `mobile/features/business/BusinessAnalyticsScreen.tsx` | Premium gate upgrade |
| `mobile/components/ui/AccessErrorState.tsx` | Subscription required CTA |
| `mobile/components/business/CustomerFeedbackPanel.tsx` | Premium feedback gate |

All call `openAuthenticatedBillingWeb()` (`mobile/utils/openBillingWeb.ts`).

---

## 15. Exact navigation URL

**Creation:** `POST /api/mobile/create-billing-session` with body `{ purpose: "billing" }`  
(`mobile/services/api/billingHandoffService.ts`, `API_ENDPOINTS.mobile.createBillingSession`)

**Backend URL format** (`backend/src/services/mobileWebHandoff.service.ts` ~L318–321):

```
{FRONTEND_URL}/mobile-auth?token={base64url_plain_token}&purpose=billing
```

- `FRONTEND_URL` from env (production: deployed web origin)  
- Token TTL: **90 seconds** (`MOBILE_WEB_HANDOFF_TTL_MS = 90_000`)  
- Server-fixed destination: `/dashboard/billing/subscription` (`PURPOSE_DESTINATIONS.billing`)

**Browser mechanism:** `WebBrowser.openBrowserAsync(session.url, { presentationStyle: FULL_SCREEN, dismissButtonStyle: "close" })` — Android Custom Tab / iOS SFSafariViewController (`openBillingWeb.ts` ~L167–173). **Not** embedded WebView; **not** passing mobile JWT in URL.

---

## 16. Authentication / session handoff analysis

### Mobile session (before handoff)

- Access JWT in secure store + memory (`mobile/services/api/client.ts`)  
- Refresh token in secure store; sent as Cookie on refresh  
- `createBillingHandoffSession` uses **authenticated** `apiClient.post` — requires valid mobile session  

### Web session (after handoff)

1. `MobileAuthHandoffPage` reads `?token=` (`src/app/pages/MobileAuthHandoffPage.tsx` ~L39–43)  
2. `POST /api/auth/mobile-web-handoff/consume` with `{ token }`, `credentials: "include"` (`src/app/lib/api.ts` ~L3503–3514)  
3. Backend validates token hash, expiry, purpose, role=MANAGER, IP/UA policy; mints **new web refresh session** (does **not** revoke mobile refresh)  
4. `setRefreshCookie` HttpOnly + returns `AuthResponse` with access JWT  
5. `establishExternalSession(session)` → `persistAuthResponse` → localStorage user + in-memory access token (`useAuth.ts` ~L625–631, ~L114–124)  
6. `navigate("/dashboard/billing/subscription", { replace: true })`  

**Mobile auth is NOT directly shared** — it is **bridged** via one-time token → new web cookie session.

---

## 17. Cookie / token analysis

| Store | Mobile app | In-app browser (web) |
|-------|------------|----------------------|
| Access JWT | Secure store + Axios memory | In-memory (`setMemoryAccessToken`) + not in URL |
| Refresh token | Secure store → Cookie header | HttpOnly cookie set by consume response |
| User snapshot | Zustand | `localStorage` `caretip_user` |
| Locale | Mobile i18n store | `localStorage` `caretip_i18n_language` + `document.documentElement.lang` |

**Cookie isolation:** Custom Tab / SFSafariViewController uses **system browser cookie jar** for the web origin — correct for handoff consume, but **separate** from mobile secure store. If consume fails, web has **no** session.

**Handoff security checks that can fail consume:**

- Token expired (>90s)  
- `MOBILE_WEB_HANDOFF_BIND_IP` default **on** — IP mismatch (`ip_mismatch`)  
- UA policy — `ua_suspicious` if consume UA not browser-like  
- Token replay (`already_consumed`)  
- User not MANAGER / onboarding incomplete / email unverified at create time  

---

## 18. Web bootstrap lifecycle

```
Mobile: openAuthenticatedBillingWeb()
  ↓ Alert confirm (DE/EN mobile i18n)
  ↓ POST /api/mobile/create-billing-session
  ↓ WebBrowser.openBrowserAsync(handoff URL)
Web: GET /mobile-auth?token=…
  ↓ HTML #caretip-html-boot (boot-locale.js tagline)
  ↓ React hydrate + lazy chunk MobileAuthHandoffPage
  ↓ AuthBootstrapShell (branded loader)
  ↓ POST /api/auth/mobile-web-handoff/consume
  ↓ establishExternalSession + markMobileBillingHandoffBanner()
  ↓ navigate → /dashboard/billing/subscription
  ↓ ProtectedRoute (business) — may register APP_LOADING_PRIORITY.ROUTE_GUARD
  ↓ Lazy BusinessLayout + BusinessBillingLayout + BusinessBillingSubscriptionPage
  ↓ useBillingStatus → GET /api/me/billing
  ↓ useBusinessPageBoot + useExtendGlobalLoaderUntilReady
  ↓ Global overlay dismiss when billing data ready + shell paint ready
```

---

## 19. Exact points where loading can become stuck

| Step | Stuck symptom | Mechanism |
|------|---------------|-----------|
| **Handoff consume** | `AuthBootstrapShell` forever / error | Token expired, IP/UA mismatch, network failure on consume, 400 response |
| **Lazy route load** | Blank/boot if chunk fails | `/mobile-auth` is `routeLazy` — network failure loading JS |
| **ProtectedRoute** | `AppRouteGateShell` / global overlay | `authStatus === "initializing"`, `storedSessionSync`, or guard `wait` decision |
| **Dashboard shell commit** | HTML boot retained | `shouldRetainHtmlBootUntilLandingCommit()` until `[data-caretip-dashboard-ready]` (`htmlMarketingBootBridge.ts`) |
| **Billing boot latch** | `GlobalAppLoadingHold` empty placeholder under overlay | `useExtendGlobalLoaderUntilReady("business-billing-subscription-boot", isInitialBillingLoad)` stays true if `fetchBillingStatus` never completes |
| **Billing fetch hang** | Overlay + hold | `useBillingStatus` `loading` stuck true if `fetchBillingStatus` promise never settles (timeout, hung connection) |
| **Overlay re-entry lock** | 600ms re-entry lock after dismiss (`AppLoadingManager` OVERLAY_REENTRY_LOCK_MS) | Less common “stuck”, but can extend perceived load |

**If consume succeeds but billing GET fails:** user may see dashboard shell with billing error alert (not infinite loader) — unless global overlay latch still active from cold boot.

---

## 20. Subscription / billing synchronization analysis

After browser close, mobile runs `syncSubscriptionAfterBillingReturn()` (`openBillingWeb.ts` ~L67–131):

- Polls `GET /api/me/billing/sync-status`  
- Fallback `fetchBusinessProfile()` for `subscriptionTier`  
- Bounded: `BILLING_RETURN_SYNC_MAX_ATTEMPTS` × `BILLING_RETURN_SYNC_INTERVAL_MS` (≤30s per `billing-handoff-runtime.ts`)  
- Shows `BillingReturnSyncOverlay` with `billingHandoff.updatingPlan`  

**Web-side:** `BusinessBillingLayout` handles `?billing=success` checkout return via `processBillingCheckoutSuccess` — separate from mobile handoff entry.

Mobile handoff does **not** auto-start Stripe Checkout — it lands on plan management UI (`BusinessSettingsBillingPanel`).

---

## 21. Loader ownership analysis

| # | Owner | When | Message source |
|---|-------|------|----------------|
| 1 | HTML `#caretip-html-boot` | First paint | `public/boot-locale.js` → `gettingReady` / journey copy |
| 2 | `AppLoadingManager` overlay | Cold boot, route guards, billing boot latch | `resolveRouteLoadingMessage`, registrars |
| 3 | `AuthBootstrapShell` | `/mobile-auth` consume | Default branded tagline (`common.gettingReady` via `CareTipBrandedLoaderMark`) |
| 4 | `ProtectedRoute` | Dashboard guard blocking | `resolveRouteLoadingMessage(pathname)` → dashboard / billing strings |
| 5 | `AppRouteGateShell` | Guard placeholder | Empty hold under global overlay |
| 6 | `BusinessSettingsBillingPanel` | Soft nav skeleton | `Loader2` spinner + `business.billing.loading` (sr-only) |
| 7 | `GlobalAppLoadingHold` | Under overlay during billing initial load | No text (aria-hidden) |
| 8 | Mobile `BillingReturnSyncOverlay` | After browser dismiss | `billingHandoff.updatingPlan` |

**Multiple loaders can chain** during one user journey — user may perceive “stuck” on loader #2–4 even while #6 would be sufficient.

---

## 22. Loader language / i18n lifecycle

### Mobile (pre-handoff)

- `useI18n()` — device/stored locale  
- Confirm alert: `billingHandoff.confirmTitle/confirmBody` (localized)  

### Web (in-app browser)

1. **HTML boot** (`boot-locale.js`): reads `localStorage.caretip_i18n_language`, default **`de`**  
   - `/mobile-auth` is **not** listed in `RESERVED_TOP` segments in `boot-locale.js` — may fall through to generic `gettingReady`  
2. **React i18n init** (`src/i18n/i18n.ts`): `readDocumentOrStoredLanguage()` — syncs with `document.documentElement.lang` set by boot script  
3. **AuthBootstrapShell**: English default tagline if i18n not ready — uses `CareTipBrandedLoaderMark` + `t("common.gettingReady")` when wired  
4. **Post-navigation** `/dashboard/billing/subscription`:  
   - `resolveRouteLoadingMessage` → `common.syncingAccountStatus` (“Abrechnung wird vorbereitet…”) for paths containing `/billing`  
   - Dashboard paths → `common.loading.dashboard`  

### Why language may change during navigation

| Transition | Example |
|------------|---------|
| Mobile DE → Web boot | Browser `localStorage` may be **empty** or **en** from prior web visit → boot language differs from mobile app language |
| Boot DE → React EN flash | Theoretically if `document.lang` and i18n init race (mitigated by `readDocumentOrStoredLanguage`) |
| Dashboard loader → billing loader | Message key changes (`loading.dashboard` → `syncingAccountStatus`) — **copy change**, possibly different language if bundles load async |
| Handoff error page | Hard-coded **English** strings in `MobileAuthHandoffPage` error UI (~L41–42, L66–72) |

**Mobile app locale is not passed in handoff URL** — web cannot know mobile language before first paint except via shared `localStorage` on same origin/browser profile.

---

## 23. Runtime reproduction results

| Test | Command | Result |
|------|---------|--------|
| Billing handoff policy | `mobile: npm run test:billing-handoff` | **PASS** — entitlement sync policy + EN copy assertions |
| Payout presentation | `mobile: npm run test:employee-payouts` | **PASS** — instant UI mode, fee label 2.5%, routing visibility |

**Not performed (no device/emulator in this audit):**

- Live network capture on payout screen mount  
- Live mobile → web handoff with production Custom Tab  
- Stripe sandbox balance manipulation for €98,02 scenario  

---

## 24. Severity classification

| Issue | Severity | Rationale |
|-------|----------|-----------|
| Global offline banner over valid payout data | **Medium** | Misleading; undermines trust; does not block payout |
| Skeleton + global error on history tab | **Low–Medium** | Confusing; may be transient |
| Subscription handoff stuck on loader | **High** | Blocks plan upgrade/management |
| Handoff token 90s TTL | **Medium** | Slow users / double confirm → expired link |
| Loader language mismatch mobile→web | **Low** | UX polish; not functional block |
| English error copy on handoff failure | **Low** | DE users see English error page |

---

## 25. Root cause classification

| ID | Problem | Classification |
|----|---------|----------------|
| **P1-A** | Red banner + payout amounts | **Shared global error state** — transport failure on request A; payout request B succeeded or cached |
| **P1-B** | Skeleton + banner | **Independent per-query loading** + persistent global error |
| **P1-C** | Equal available/pending € | **Expected Stripe balance semantics** — different buckets, not calculation bug |
| **P2-A** | Stuck loading | **Web bootstrap / loader latch** — most likely billing cold boot overlay + `fetchBillingStatus` or shell paint gate |
| **P2-B** | Stuck loading (alt) | **Handoff consume failure** — user stays on `AuthBootstrapShell` until error surfaces |
| **P2-C** | Language change | **Disconnected locale stores** — mobile i18n ≠ browser localStorage; multiple loader message keys |

---

## 26. Recommended remediation (implementation phase — not done here)

### Problem 1

1. **Stop reporting transport errors globally** for non-critical background endpoints, or scope `ErrorBanner` to a “session critical” subset (auth refresh only).  
2. **Clear or supersede `globalError`** when the visible screen’s primary query succeeds.  
3. **Per-section error** on payout screen: connect / instant / payables independent banners.  
4. **UX hierarchy** per §12 — single hero amount, collapsible pending.  
5. Localize screen title `"Stripe Payment"` → German product copy.

### Problem 2

1. **Instrument handoff** — client timings for create → consume → billing status; surface consume failure distinctly (localized), not infinite loader.  
2. **Extend TTL** or refresh token on browser open if legally/securely viable.  
3. **Pass locale hint** as query param (e.g. `?lang=de`) honored by boot-locale for first paint.  
4. **Release global overlay** on handoff route after `establishExternalSession` before heavy dashboard lazy tree.  
5. **Review IP binding** for carrier NAT false positives (`MOBILE_WEB_HANDOFF_BIND_IP`).  
6. Localize `MobileAuthHandoffPage` error strings via i18n.

---

## 27. Risks of each proposed remediation

| Remediation | Risk |
|-------------|------|
| Remove global transport banner | Users may miss true offline state on critical flows |
| Clear global error on query success | May hide persistent connectivity problems |
| Extend handoff TTL | Larger replay window if token leaked |
| Disable IP binding | Security regression for token theft |
| Pass locale in URL | Cache/log leakage of preference; must not carry secrets |
| Skip dashboard overlay on handoff | Flash of unauthenticated shell if session not committed |
| Payout UX hierarchy change | User re-learning; must not alter fee math |

---

## 28. What MUST NOT be changed (per product constraints)

- JWT architecture, refresh rotation, Web Locks  
- Authentication security model  
- Stripe webhook / payment verification architecture  
- Subscription activation truth / entitlement logic  
- GDPR / deletion logic  
- Existing Stripe stale-state remediation (`externalStripeNavigationHold`)  
- Protected dashboard paint handoff attributes  
- Idle session timeout  
- Mobile authentication security headers  
- Instant payout **calculation** semantics (Stripe-authoritative net/gross)  

---

## 29. Tests performed

| Test | Result |
|------|--------|
| `npm run test:billing-handoff` (mobile) | PASS |
| `npm run test:employee-payouts` (mobile) | PASS |

---

## 30. Tests that still need real-device validation

1. **Payout screen** — simultaneous Charles/Proxyman trace: map which request sets `globalError` while instant-payout returns 200.  
2. **Payout cache** — airplane mode toggle after successful load; confirm cached amounts + banner behavior.  
3. **Handoff happy path** — iOS SFSafariViewController + Android Custom Tab → billing page interactive < N seconds.  
4. **Handoff failure paths** — expired token, IP change VPN, slow network >90s.  
5. **Loader language** — mobile DE → web first paint language recorded screen recording.  
6. **Billing API hang** — throttle `GET /api/me/billing` to confirm overlay stuck behavior.  

---

## 31. Exact files for future implementation phase

### Problem 1 — payout error + UX

| File | Likely change |
|------|----------------|
| `mobile/services/api/client.ts` | Scope `reportGlobalError` |
| `mobile/components/layout/ErrorBanner.tsx` | Context-aware banner or severity |
| `mobile/store/uiStore.ts` | Optional per-screen error channel |
| `mobile/features/employee/payouts/EmployeePaymentsConnectScreen.tsx` | Error/loading ownership, hierarchy |
| `mobile/features/employee/payouts/EmployeePayoutHistoryScreen.tsx` | Tab-level errors vs global |
| `mobile/components/ui/Screen.tsx` | Optional: don’t mount global banner on finance screens |
| `mobile/i18n/locales/de.ts` | Title localization |

### Problem 2 — subscription handoff

| File | Likely change |
|------|----------------|
| `mobile/utils/openBillingWeb.ts` | Locale hint, timing telemetry |
| `backend/src/services/mobileWebHandoff.service.ts` | TTL / IP policy tuning |
| `src/app/pages/MobileAuthHandoffPage.tsx` | i18n errors, loader exit timing |
| `src/app/context/AppLoadingManager.tsx` | Handoff fast-path overlay release |
| `src/app/lib/useBusinessPageBoot.ts` | Handoff-aware soft boot |
| `src/app/components/ProtectedRoute.tsx` | Handoff guard fast path |
| `public/boot-locale.js` | `mobile-auth` journey + `?lang=` support |
| `src/app/lib/appLoadingContexts.ts` | Handoff-specific loader copy |

---

## 32. Source-code evidence index (key paths)

| Topic | File | Lines (approx.) |
|-------|------|-----------------|
| Global error trigger | `mobile/services/api/client.ts` | 289–291, 219–221 |
| Error banner UI | `mobile/components/layout/ErrorBanner.tsx` | 10–27 |
| Offline i18n | `mobile/i18n/locales/de.ts` | 866–871, 445–467 |
| Payout screen queries | `mobile/features/employee/payouts/EmployeePaymentsConnectScreen.tsx` | 65–80, 182–184, 257–306 |
| History tabs/skeleton | `mobile/features/employee/payouts/EmployeePayoutHistoryScreen.tsx` | 58–68, 147–149 |
| Instant payout API | `mobile/services/api/employeePayoutService.ts` | 115–117 |
| Backend instant eligibility | `backend/src/controllers/employeeConnect.controller.ts` | 169–188 |
| Stripe balance evaluation | `backend/src/services/stripeConnectInstantPayout.service.ts` | 257–405 |
| Fee computation | `backend/src/services/stripeConnectInstantPayout.service.ts` | 370–371 |
| Billing handoff open | `mobile/utils/openBillingWeb.ts` | 146–201 |
| Handoff URL | `backend/src/services/mobileWebHandoff.service.ts` | 297–321 |
| Web consume page | `src/app/pages/MobileAuthHandoffPage.tsx` | 28–79 |
| Web billing load | `src/app/components/business/settings/BusinessSettingsBillingPanel.tsx` | 27–32, 83–86 |
| Billing status hook | `src/app/hooks/useBillingStatus.ts` | 10–31 |
| Route loading messages | `src/app/lib/appLoadingContexts.ts` | 125–136, 186–188 |
| Query cache policy | `mobile/services/api/queryClient.ts` | 7–24 |

---

## 33. Final conclusion

**Problem 1** is explained by **architectural separation of concerns**: Stripe payout amounts are served by a dedicated eligibility endpoint and TanStack Query cache, while the red “Keine Verbindung zu CareTip” banner reflects a **global, request-agnostic transport error** from the Axios interceptor. The screenshots are consistent with this model — not with total payout API failure.

**Problem 2** is a **multi-stage cross-app authentication and web cold-boot** problem. The mobile app correctly refuses to put JWTs in URLs and uses a one-time handoff, but the web side stacks HTML boot, auth consume loader, protected-route overlay, dashboard shell paint gates, and billing status fetch. Failure or slow completion at **any** stage presents as “stuck loading.” Language changes are expected when mobile locale is not propagated to the in-app browser’s web locale chain.

**NO PRODUCT CODE WAS MODIFIED DURING THIS AUDIT.**
