# CareTip — Customer language switch blank screen (second forensic pass)

**Date:** 2026-10-03  
**Scope:** Guest customer journey EN ↔ DE — **visual** blank / white state (not locale JSON theory alone)  
**Status:** **ROOT CAUSE CONFIRMED — READY FOR MINIMAL REMEDIATION**  
**Not fixed in this pass:** no product code changes; remediation is proposed only.

---

## Executive summary

Manual screenshots (visible journey → language toggle → **almost empty white page** → German content returns) are **reproducible in automation** on the **business team QR** route (`/:businessSlug` → `BusinessStaffDirectoryPage`), not on the `/staff/:slug` → `/tip-amount` path used by existing E2E.

**Primary root cause:** `BusinessStaffDirectoryPage` refetches directory data whenever the i18n `t` function identity changes. That sets `loading=true`, which **unmounts** the team picker and renders `CareTipPageLoader` (`variant="wait"`). On an interactive shell (`isAppShellInteractive()`), that is a **full-viewport `bg-background` surface** with little or no visible copy — matching “almost completely white / empty.”

The first remediation report (`CARETIP_CUSTOMER_LANGUAGE_SWITCH_WHITE_SPACE_REGRESSION_REPORT.md`, **STATUS: READY**) addressed locale prefetch and landing-hero i18n subscriptions. Those changes are **necessary but insufficient**: they do not stop **route-level loading flags** from tearing down customer UI on language change.

---

## 1. Symptom sequence (confirmed)

```
Customer journey visible (team list / tip UI)
        ↓
User toggles EN ↔ DE
        ↓
Customer chrome + content replaced by empty / near-empty viewport
        ↓
WHITE or near-white screen (seconds possible on slow network)
        ↓
Content returns in new locale
```

---

## 2. Browser evidence (production-equivalent build)

**Environment:** `vite` production `dist` served with `vite preview` on `http://localhost:4173` (same bundles as production build; API mocked).

| Step | Command / artifact |
|------|-------------------|
| Serve build | `npx vite preview --port 4173` |
| Playwright (tip path) | `E2E_BASE_URL=http://localhost:4173 npx playwright test e2e/customer-journey-language-switch.spec.ts e2e/customer-journey-language-switch-forensic.spec.ts --trace on` → **3/3 passed** |
| Ad-hoc DOM probe (16 ms polling) | Programmatic Chromium against preview (same mocks as forensic spec) |

### 2.1 Tip amount path (`/staff/forensic-lang` → `/tip-amount`) — **no visual gap**

| Metric | Before switch | During switch (min) |
|--------|---------------|---------------------|
| `[data-caretip-route-ready]` | true | stayed true |
| `.customer-flow` | true | stayed true |
| `#root` text length | 197 | **197** (no drop) |
| `soft-spa-route-hold` | false | false |

### 2.2 Business team QR (`/cafe-forensic` → `BusinessStaffDirectoryPage`) — **blank reproduced**

| Metric | Before switch | During switch (min) |
|--------|---------------|---------------------|
| `[data-caretip-route-ready]` | false (page never sets marker; uses `cf.pageTeam` only) | — |
| `.customer-flow` | true | **lost for multiple frames** |
| `#root` innerText length | 150 | **0** |
| Soft / chunk hold | false | false |

**Interpretation:** The customer tree is **unmounted** (not merely `opacity: 0`). This is not `LanguageChangeLoadingRegistrar` hiding the outlet, not `SoftSpaRouteHold`, and not `beginAppLanguageChange` / global overlay (`keepPageVisible: true` on customer switch).

**Gap duration:** At least one polled frame at 16 ms with **zero** root text; in practice until `getBusinessStaffDirectory` resolves (network-bound; can be **hundreds of ms to multiple seconds**).

Screenshots from forensic spec (when gaps fire): `test-results/customer-lang-forensic/01-before-en.png`, `02-during-gap.png`, `03-after-de.png` (tip path often has no `02` because no gap).

---

## 3. Timing model (business directory repro)

| Marker | Business directory EN→DE |
|--------|---------------------------|
| **T0** | Language button click |
| **T1** | `.customer-flow` disappears, `loading=true` → loader branch mounts |
| **T2** | `GET /api/staff/directory/business/:slug` starts (unnecessary refetch) |
| **T3** | API completes |
| **T4** | `i18n.changeLanguage` already ran in parallel from switcher; locale may already be DE |
| **T5** | React commits team list with German strings |
| **T6** | User sees full journey again |

**Does content disappear before i18n finishes?** **Yes** — disappearance is tied to **`setLoading(true)`**, not to `ensureLocaleBundle` / `changeLanguage`.

**Does i18n finish but React unmount the page?** Unmount happens **before** refetch completes; locale switch can finish while the white loader is showing.

**CSS-only hide?** **No** on this repro — DOM text length hits **0**; primary mechanism is **conditional render → loader replaces page**.

---

## 4. DOM / shell checklist during blank state

| Question | Business directory repro | Tip amount (E2E) |
|----------|--------------------------|------------------|
| A. Customer DOM present? | Briefly **no** (loader-only subtree) | Yes |
| B. Route component unmounted? | **Effective yes** — list UI not in tree | No |
| C. Suspense fallback? | Not observed (`navigation.state` idle) | No |
| D. Outlet empty? | No — outlet renders loader component | No |
| E. Customer shell mounted? | **CustomerFlowShell not used**; `CareTipPageLoader` instead | `CustomerFlowShell` |
| F. Full-screen cover? | **Loader** `min-h-[100dvh] bg-background` (reads as white) | No |
| G–H. opacity / display:none on content? | N/A — content unmounted | N/A |
| I. CSS background cover? | Loader + `bg-background` | No |
| J. Height collapsed? | Full viewport loader, not collapse | No |

---

## 5. Suspense boundaries

Customer root uses `RouteChunkBoundary variant="minimal"` → `MinimalRouteFallback` → `SoftSpaRouteHold` when **lazy** route suspends and `navigation.state === "loading"`.

**Language-only switch** on an already-mounted page does **not** suspend the active route component. Blank state on business directory is **not** Suspense-driven.

`react-i18next` is initialized with `react: { useSuspense: false }` (`src/i18n/i18n.ts`).

---

## 6. SoftSpaRouteHold

Requires `useNavigation().state === "loading"` (`RootSpaRouteHold.tsx`). Locale toggle does not navigate.

**Probe:** `softHold: false` throughout business-directory repro.

**Conclusion:** Not the trigger for this bug (still a valid white surface for **real** SPA navigations — do not remove globally).

---

## 7. LanguageChangeLoadingRegistrar

Always renders `children` (`return <>{children}</>`). `changeCustomerJourneyLanguage` keeps `isAppLanguageChangeActive()` false.

**Runtime:** Outlet remains mounted; blank state is **inside** the matched route element swapping to loader.

---

## 8. `changeCustomerJourneyLanguage` chain

`CustomerJourneyLanguageSwitcher` → `ensureLocaleBundle` → `changeCustomerJourneyLanguage` → `changeAppLanguage({ keepPageVisible: true })` → `i18n.changeLanguage`.

- No `beginAppLanguageChange` on customer path.
- No route navigation from i18n layer.
- **`keepPageVisible` is honored** for global loader — but **does not** inhibit page-level `loading` flags in individual customer pages.

---

## 9. React `key` / remount

No `key={i18n.language}` / `key={locale}` on customer shell, outlet, or `TipAmountPage`.

Remount on business directory is **logical** (parent chooses loader vs list), not keyed remount.

---

## 10. CSS visibility

Not the primary mechanism on confirmed repro. Loader uses full-viewport flex center + `bg-background` — screenshot reads as empty white especially if branded mark is small or slow to paint.

---

## 11. Prefetch / cache matrix

| Scenario | Tip amount E2E | Business directory probe |
|----------|----------------|---------------------------|
| Locales cached | No gap | **Gap** (refetch, not locale) |
| Slow locale bundle | Forensic test passed on preview | Not the limiting factor |
| First visit vs return | Same | Same |

Prefetching EN+DE **does not** fix business-directory blank — refetch is independent of locale chunks.

---

## 12. Directions / rapid toggle

Business-directory bug fires on **both** EN→DE and DE→EN (any `t` identity change). Rapid toggles can **stack** refetches and extend white time.

---

## 13. Route map (actual app routes)

| User step | App path | Language switch surface |
|-----------|----------|-------------------------|
| Staff QR | `/staff/:slug` → redirect `/tip-amount` | Header switcher |
| Business QR | `/:businessSlug` | **Broken repro** |
| QR landing | `/qr-landing/:businessId`, `/table/:qrSlug` | Switcher; fetch effect **without** `t` dep |
| Tip amount | `/tip-amount` | E2E clean |
| Checkout | Stripe (external) | N/A in-app |
| Success | `/success` | Switcher; verify `useCustomerVenueBrand` only (no loading flip) |

*(There is no `/customer/[qr]` prefix in this codebase.)*

---

## 14. Why the first fix failed

| First-fix item | Stops business-directory blank? |
|----------------|----------------------------------|
| `prefetchCustomerJourneyLocaleBundles` | No |
| Hero persistence split off `/` | No |
| `keepPageVisible` / registrar | No — correct for **global** overlay only |
| Route nav / boot tagline guards | No |

---

## 15. Why existing tests pass

| Test | What it asserts | What it misses |
|------|-----------------|----------------|
| `test:customer-language-switch-white-flash` | Static source patterns | No browser |
| `test:customer-journey-flicker` | Tip context / shell contracts | No language toggle |
| `e2e/customer-journey-language-switch.spec.ts` | `/staff/lang-demo` → tip page; text visible **after** switch; holds **count 0** | Never visits `/:businessSlug`; no **continuous** visibility during switch |
| `e2e/customer-journey-language-switch-forensic.spec.ts` | 16 ms probe on **tip amount only** | Same route bias; threshold `outletTextLen < 40` never fails on tip path |

---

## 16. Diagnosis Q&A

1. **What disappears?** Team picker / customer flow UI (business directory); tip chrome if any page sets `loading` on shell.
2. **Customer DOM unmounted?** **Yes** on business-directory repro (`innerText` → 0).
3. **Which component?** `BusinessStaffDirectoryPage` loading branch → `CareTipPageLoader`; same **pattern** via `CustomerFlowShell` when `loading={true}` on soft nav.
4. **Suspense?** No on confirmed repro.
5. **SoftSpaRouteHold?** No.
6. **LanguageChangeLoadingRegistrar?** No — outlet stays mounted.
7. **`changeCustomerJourneyLanguage` remount?** No direct remount; indirect via page effects.
8. **Locale `key`?** No.
9. **Locale bundle request responsible?** **Secondary** on tip path only if uncached; **not** on business-directory repro.
10. **Present but hidden?** No on repro — **replace** semantics.
11. **Why tests pass?** Tip-only E2E + static guards.
12. **Runtime sequence (business QR)?** Click DE → `t` changes → `useEffect` deps fire → `setLoading(true)` → `CareTipPageLoader` full viewport → API → list returns with DE strings.

---

## 17. Secondary risks (not reproduced on tip E2E)

| Location | Issue |
|----------|--------|
| `BusinessStaffDirectoryPage.tsx` | `useEffect(..., [businessSlug, setBusinessId, **t**])` — **confirmed** |
| `PaymentPage.tsx` | `useEffect(..., [..., **t**])` re-runs `navigate('/tip-amount')` on language change — possible brief navigation / loader on legacy `/payment` URL |
| `CustomerFlowShell` / `CareTipPageLoader` | Any spurious `loading=true` after `isAppShellInteractive()` **replaces** children with full-viewport `bg-background` (architectural amplifier) |
| `usePublicHtmlBootHandoff(!loading)` | Removing `[data-caretip-route-ready]` while loading can interact with HTML boot retain on customer paths if boot node still exists |

---

## 18. Minimal proposed fix (not implemented)

**P0 — business directory**

- Remove `t` from the directory fetch `useEffect` dependency array.
- For the empty-slug error path, use a stable error key or read `t` inside the branch without refetching on every language change.
- Do **not** call `setLoading(true)` when `data` is already loaded and only locale changed (optional guard: `if (data) return` at top of effect).

**P1 — defensive UX (optional, same invariant)**

- On soft nav, `CustomerFlowShell` / `CareTipPageLoader` `variant="wait"`: keep last painted children under a light overlay instead of swapping to empty `bg-background` (preserves `data-caretip-route-ready`).

**Tests to add after fix**

- E2E: `/:businessSlug` mocked directory — poll `#root` text / `.customer-flow` during EN→DE; fail if min length drops below threshold for >50 ms.
- Re-run both directions and DE→EN→DE on directory + `/qr-landing` + `/tip-amount`.

**Preserve:** locale prefetch, `changeCustomerJourneyLanguage`, `keepPageVisible`, `SoftSpaRouteHold` for real navigations, marketing shell, dashboard loader work, lazy customer routes, SEO.

---

## 19. Regression risks of fix

| Change | Risk |
|--------|------|
| Remove `t` from fetch deps | Stale error string if slug invalid and language changes — mitigated by reading `t` at render for error UI only |
| Overlay-not-replace loader | Must not block clicks indefinitely; only for transient loading |

---

## 20. Status gate

| Criterion | Met? |
|-----------|------|
| Visual repro on production build | **Yes** (`/:businessSlug`) |
| Root cause identified | **Yes** |
| Issue fixed in code | **No** |
| Manual screenshot shows fix | **No** |

**Do not** mark **STATUS: READY** (issue fixed) until post-remediation browser verification on business QR and tip paths.

---

## Appendix — code references

**Loading swap on soft nav (`CustomerFlowShell`):**

```91:110:src/app/pages/customer/CustomerFlowShell.tsx
  if (loading) {
    if (holdUnderHtmlBoot) {
      return null;
    }
    if (!softNav) {
      return <GlobalAppLoadingHold className={className} />;
    }
    return (
      <div
        className={cn(
          "flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6",
          className,
        )}
        ...
      >
        <CareTipBrandedLoaderMark tagline={overlayMessage} showTagline />
      </div>
    );
  }
```

**Business directory refetch on `t` change:**

```37:71:src/app/pages/customer/BusinessStaffDirectoryPage.tsx
  useEffect(() => {
    const raw = businessSlug?.trim().toLowerCase();
    if (!raw) {
      setError(t("tipFlow.errors.invalidLink"));
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      ...
    })();
    return () => {
      cancelled = true;
    };
  }, [businessSlug, setBusinessId, t]);
```

**Customer language switch (no global loader):**

```107:131:src/i18n/i18n.ts
export async function changeAppLanguage(
  lng: AppLanguage,
  options?: ChangeAppLanguageOptions,
): Promise<void> {
  ...
  const keepPageVisible = options?.keepPageVisible === true;
  if (!keepPageVisible) {
    beginAppLanguageChange();
  }
  ...
}

export async function changeCustomerJourneyLanguage(lng: AppLanguage): Promise<void> {
  await changeAppLanguage(lng, { keepPageVisible: true });
}
```
