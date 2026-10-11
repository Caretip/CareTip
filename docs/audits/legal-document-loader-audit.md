# Legal Document Loader — Forensic Audit & Remediation

**Date:** 2026-09-23  
**Status:** Root cause confirmed; surgical fix applied  
**Scope:** All CareTip flows that open, load, preview, download, or navigate to legal/compliance documents

---

## 1. Problem statement

When a user performs a **legal document action** (e.g. clicks **Datenschutzerklärung** / Privacy Policy), the global loading UI could display an unrelated message such as:

> **Preparing your tipping experience…**

The loader must describe the **actual event** (opening the specific legal document), not a customer tipping journey.

---

## 2. Legal document entry points

| Event | Entry point | Component | Route | Navigation type |
|-------|-------------|-----------|-------|-----------------|
| Privacy Policy (footer) | Public footer | `Footer.tsx` | `/privacy` | SPA `Link` |
| Terms of Service (footer) | Public footer | `Footer.tsx` | `/terms` | SPA `Link` |
| Cookie Policy (footer) | Public footer | `Footer.tsx` | `/cookies` | SPA `Link` |
| Legal Notice / Impressum (footer) | Public footer | `Footer.tsx` | `/imprint` | SPA `Link` |
| DPA / AVV (footer) | Public footer | `Footer.tsx` | `/avv` | SPA `Link` |
| PLV (footer) | Public footer | `Footer.tsx` | `/plv` | SPA `Link` |
| Privacy (cookie banner) | Cookie consent | `CookieConsentBanner.tsx` | `/privacy` | SPA `Link` |
| Privacy (cookie settings) | Cookie modal | `CookieConsentSettingsModal.tsx` | `/privacy` | SPA `Link` |
| Legal sidebar cross-nav | Legal pages | `LegalDocumentsSidebar.tsx` | `/privacy`, `/terms`, etc. | SPA `Link` |
| Privacy page | Route | `PrivacyPage.tsx` → `ApiLegalDocumentPage` | `/privacy` | Lazy route |
| Terms page | Route | `TermsPage.tsx` → `ApiLegalDocumentPage` | `/terms` | Lazy route |
| Imprint page | Route | `ImprintPage.tsx` → `ApiLegalDocumentPage` | `/imprint` | Lazy route |
| Cookies page | Route | `CookiesPage` (lazy) | `/cookies` | Lazy route |
| DPA / AVV PDF | Route | `AvvPage.tsx` → `ControlledLegalPdfPage` | `/avv`, `/dpa` → `/avv` | Lazy route |
| PLV PDF | Route | `PlvPage.tsx` → `ControlledLegalPdfPage` | `/plv` | Lazy route |
| Signup / onboarding acceptance | Auth & checkout | `MerchantLegalAcceptanceCheckbox.tsx` | `/terms`, `/privacy`, `/avv`, `/plv` | `target="_blank"` (cold load) |
| Instant payout terms | Payout UI | `InstantPayoutTermsCheckbox.tsx` | `/terms` (configurable) | In-page link |
| Business settings legal panel | Dashboard settings | `BusinessSettingsPrivacyLegalPanel.tsx` | terms/privacy SPA paths; DPA/PLV API PDF URLs | `openUrlInNewTab` (new tab) |
| Cold direct URL | Browser | HTML boot | any legal path above | Full page load |

**Not in scope for global loader:** Platform admin legal-hold (`/platform-admin/.../legal-hold`) — internal ops tool, not public legal document viewer.

---

## 3. Loader ownership matrix (before fix)

| Event | Loader owner | Loader key / context | Current message (buggy cases) | Correct message |
|-------|--------------|------------------------|-------------------------------|-----------------|
| Cold load `/privacy` | `boot-locale.js` → `#caretip-html-boot-tagline` | HTML boot | `Just a moment…` (generic) | Opening Privacy Policy… |
| SPA nav tip journey → `/privacy` (boot retained) | Stale HTML boot tagline | *(none updates boot)* | **Preparing your tipping experience…** ❌ | Opening Privacy Policy… |
| Lazy legal chunk (SPA) | `PublicRouteChunkHold` | `common.gettingReady` | Just a moment… (generic) | Document-specific opening message |
| Cold entry route guard | `RouteNavigationLoadingRegistrar` | `route-navigation` | `landing` / `workspace` fallback | Document-specific opening message |
| In-page API fetch | `ApiLegalDocumentPage` inline | N/A (page body) | `legal.loading` | *(unchanged — not global loader)* |
| New-tab legal link | `boot-locale.js` cold boot | HTML boot | generic `gettingReady` | Document-specific opening message |

---

## 4. Root cause (confirmed)

**Primary:** Stale HTML boot tagline during SPA navigation from a **customer tipping journey** to a **legal document route**.

### Call chain (buggy path)

```
User on /qr-landing/... or /{businessSlug}
  → boot-locale.js sets #caretip-html-boot-tagline = tipPage
  → Customer page registers tipPage via CareTipPageLoader (AppLoadingManager)
User clicks Footer "Datenschutzerklärung" (SPA Link to /privacy)
  → React Router begins lazy route load
  → HTML boot node RETAINED (shouldRetainHtmlBootUntilLandingCommit / PublicPageShell handoff)
  → RouteNavigationLoadingRegistrar: softNav=true → NO route-navigation registration
  → AppLoadingManager: htmlBootOwnsVisual=true but displayOverlayMessage may be empty
  → boot tagline NOT updated (boot-locale.js does not re-run on SPA nav)
  → User sees stale "Preparing your tipping experience…" until legal page commits
```

**Contributing factors:**

1. `resolveRouteLoadingMessage` had **no legal-document branch** — legal paths fell through to `isPublicMarketingPath` → `landing` (generic, not document-specific).
2. `boot-locale.js` `resolveBootTagline` had **no legal paths** — cold legal loads showed generic `gettingReady`.
3. `PublicRouteChunkHold` always used `common.gettingReady` during lazy chunk loads.

**Not the cause:** Global replacement of tipPage strings; incorrect AppLoadingManager priority; auth/Stripe/billing loader bleed.

---

## 5. Loader semantic categories

| Category | Example message | Must not appear during |
|----------|-----------------|------------------------|
| LEGAL DOCUMENT | Opening Privacy Policy… | Tip journey, billing, auth |
| TIP JOURNEY | Preparing your tipping experience… | Legal document open |
| AUTHENTICATION | Preparing your account… | Public legal nav |
| DASHBOARD | Preparing your workspace… | Legal document open |
| BILLING | Preparing billing… | Legal document open |
| STRIPE EXTERNAL | Taking you to secure checkout… | Legal document open |
| GENERIC PUBLIC | Just a moment… | When document type is known |

---

## 6. Implementation (surgical fix)

### Files modified

| File | Change |
|------|--------|
| `src/app/lib/appLoadingContexts.ts` | `resolveLegalDocumentLoadingKind`, `resolveLegalDocumentLoadingMessage`; wired into `resolveRouteLoadingMessage` and `resolveInitialBootLoadingMessage` |
| `src/app/components/RouteNavigationLoadingRegistrar.tsx` | Sync HTML boot tagline when pathname is a legal document (SPA + cold) |
| `src/app/routing/PublicRouteChunkHold.tsx` | Document-specific tagline for legal lazy routes |
| `public/boot-locale.js` | Legal cold-boot taglines in `resolveBootTagline` |
| `src/i18n/locales/en.json` | `common.loading.legal.*` keys |
| `src/i18n/locales/de.json` | `common.loading.legal.*` keys |
| `scripts/legal-document-loading-runtime.ts` | Regression tests |
| `package.json` | `test:legal-document-loading` script |

### EN loader messages

| Document | Message |
|----------|---------|
| Privacy | Opening Privacy Policy… |
| Terms | Opening Terms of Service… |
| Cookies | Opening Cookie Policy… |
| Imprint | Opening Legal Notice… |
| DPA/AVV | Opening Data Processing Agreement… |
| PLV | Opening Price & Services List… |

### DE loader messages

| Document | Message |
|----------|---------|
| Privacy | Datenschutzerklärung wird geöffnet… |
| Terms | Allgemeine Geschäftsbedingungen werden geöffnet… |
| Cookies | Cookie-Richtlinie wird geöffnet… |
| Imprint | Impressum wird geöffnet… |
| DPA/AVV | Auftragsverarbeitungsvertrag wird geöffnet… |
| PLV | Preis- und Leistungsverzeichnis wird geöffnet… |

### What was NOT changed

- `AppLoadingManager` architecture, priorities, deduplication
- `ProtectedRoute`, auth bootstrap, session handling
- Stripe navigation holds, billing loaders
- Customer tipping journey `tipPage` registrations
- `PublicRouteChunkHold` / HTML boot white-screen protections
- No artificial timeouts or global string replacement

---

## 7. Confirmed mismatches (fixed)

| Scenario | Before | After |
|----------|--------|-------|
| Tip journey → Privacy (SPA, boot retained) | Preparing your tipping experience… | Opening Privacy Policy… / DE equivalent |
| Cold load `/terms` | Just a moment… | Opening Terms of Service… |
| Lazy legal chunk hold | Just a moment… | Document-specific message |

## 8. Remaining non-bugs

- In-page `legal.loading` ("Loading document…") inside `ApiLegalDocumentPage` after shell paint — correct inline fetch state, not global loader.
- Business settings "View" opening new tab — no in-app global loader (browser chrome only).
- Generic `gettingReady` for non-legal lazy marketing routes (`/pricing`, `/blog`, etc.) — unchanged and correct.

---

## 9. Tests run

```bash
npm run test:legal-document-loading
npm run typecheck
npm run build
npm run test:navigation-transition-stability
npm run test:white-screen-architecture
```

| Test | Result |
|------|--------|
| `npm run test:legal-document-loading` | **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** (built in ~2m 10s) |
| `npm run test:navigation-transition-stability` | **PASS** |
| `npm run test:white-screen-architecture` | **PASS** |

---

## 10. Manual browser validation checklist

| # | Scenario | EN | DE | Mobile | Desktop |
|---|----------|----|----|--------|---------|
| 1 | Footer → Privacy | ☐ | ☐ | ☐ | ☐ |
| 2 | Footer → Terms | ☐ | ☐ | ☐ | ☐ |
| 3 | Footer → Cookies | ☐ | ☐ | ☐ | ☐ |
| 4 | Footer → Imprint | ☐ | ☐ | ☐ | ☐ |
| 5 | Cookie banner → Privacy | ☐ | ☐ | ☐ | ☐ |
| 6 | Signup legal links (new tab) | ☐ | ☐ | ☐ | ☐ |
| 7 | QR journey → footer Privacy | ☐ | ☐ | ☐ | ☐ |
| 8 | Legal sidebar cross-nav | ☐ | ☐ | ☐ | ☐ |
| 9 | Tip journey still shows tip loader | ☐ | ☐ | ☐ | ☐ |
| 10 | No white screen on any above | ☐ | ☐ | ☐ | ☐ |

---

## 11. Regression confirmation

| System | Status |
|--------|--------|
| Tipping journey loaders (`tipPage`) | Unchanged |
| Authentication / ProtectedRoute | Not modified |
| Stripe / billing loaders | Not modified |
| White-screen protections | Preserved |
| AppLoadingManager rewrite | Not performed |
