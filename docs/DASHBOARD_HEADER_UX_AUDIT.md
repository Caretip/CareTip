# CareTip Dashboard Mobile Header — Logo/Branding UX Audit

**Date:** 2026-08-27  
**Scope:** Authenticated dashboard top bar (`DashboardHeader`), mobile branding especially  
**Status:** Mobile branding layout improved; desktop header structure preserved

---

## 1. Current issue

On mobile (`< lg` / &lt;1024px), the header showed:

**Hamburger | App-Icon (orange rounded square) | Search | Notifications | Profile**

The CareTip mark used `variant="icon"` (`App-Icon_S.svg`), which is an orange rounded plate **with a baked-in drop shadow**. Placed beside the hamburger in the left cluster, it read as a floating app tile / third control rather than integrated navigation branding.

---

## 2. Components audited

| Component / asset | Path | Notes |
|-------------------|------|--------|
| `DashboardHeader` | `src/app/components/DashboardHeader.tsx` | Shared shell header |
| `CareTipLogo` | `src/app/components/CareTipLogo.tsx` | Brand renderer |
| Logo size tokens | `src/lib/caretipLogoSizes.ts` | Added `headerMobile` |
| Brand assets | `src/lib/caretipBrandAssets.ts` | Primary wordmark + App-Icon |
| Mobile header CSS | `src/styles/caretip-dashboard-mobile.css` | Layout + responsive brand swap |
| Brand base CSS | `src/styles/caretip-brand.css` | Transparent plate rules (already correct) |
| Search / profile | `DashboardHeaderSearch*`, `BusinessDashboardSearch*`, `DashboardHeaderMobileProfile` | Unchanged behavior |
| Layouts using header | `BusinessLayout`, `EmployeeLayout`, `SuperAdminLayout` (+ legacy admin pages) | Same shared component |

**Desktop:** CareTip does not appear in the top bar (branding lives in sidebars). That structure was left as-is.

---

## 3. Changes made

1. **Three-zone mobile row**  
   `grid-cols-[1fr_auto_1fr]`: hamburger (start) · CareTip brand (center) · actions (end).  
   At `lg+`, reverts to the previous flex layout with desktop search.

2. **Branding asset**  
   - **≥360px:** Primary **wordmark** (`variant="wordmark"`, `tone="auto"`) via new `headerMobile` size (~96–112px).  
   - **&lt;360px:** Compact **mark** only (`variant="icon"`), with CSS crop to reduce the App-Icon SVG drop-shadow so it sits flush in the bar.

3. **Not a control**  
   Brand slot uses `pointer-events-none`, no hover/button chrome, `role="img"` + `aria-label="CareTip"`.

4. **Actions remain grouped** on the right (search, notifications, profile / venue logo).

5. **No functional changes** to menu, search, notifications, auth, or routing.

---

## 4. Responsive behavior

| Width | Expected branding |
|-------|-------------------|
| 320px | Mark-only (clipped), centered; hamburger + actions remain tappable |
| 360–389px | Compact wordmark (~104px) |
| 390–412px+ | Slightly wider wordmark (~112px) |
| ≥1024px (`lg`) | No CareTip in top bar (desktop sidebars unchanged) |

Verified by layout math / CSS review for 320 / 360 / 375 / 390 / 412: equal side columns keep brand centered; `max-width: min(42vw, 7.25rem)` prevents brand from colliding with actions.

---

## 5. Files changed

| File | Change |
|------|--------|
| `src/app/components/DashboardHeader.tsx` | Centered brand slot; wordmark + mark swap |
| `src/lib/caretipLogoSizes.ts` | `headerMobile` token; `DASHBOARD_HEADER_LOGO_CLASS` points to it |
| `src/styles/caretip-dashboard-mobile.css` | Brand centering, wordmark/mark media rules, icon shadow clip |
| `docs/DASHBOARD_HEADER_UX_AUDIT.md` | This document |

---

## 6. Tests performed

| Check | Result |
|-------|--------|
| Code review — shared header consumers | Same `DashboardHeader`; layout change is CSS/`lg:` gated |
| Browser device emulation at listed widths | **Not run in this session** (dev server may be available locally) |
| Automated suite | No dedicated dashboard-header visual test found; no payment/auth tests required for this change |

---

## 7. Remaining UX concerns

1. **App-Icon still used under 360px** — official brand mark, but plate is intrinsic to the asset. Shadow is clipped via CSS; a future flat “mark without plate” SVG would be cleaner if design provides one.
2. **Business managers** still show venue logo in the trailing actions (intentional, not CareTip). Center CareTip wordmark + right venue mark can feel like two brands on one bar — product may later prefer one or the other on mobile.
3. **Legacy admin pages** that mount `DashboardHeader` directly pick up the same mobile branding (desired consistency).
4. **Live visual QA** at 320–412px in Chrome/Safari (light + dark) still recommended after deploy.

---

## Visual UX review (vs prior screenshot)

| Before | After |
|--------|--------|
| Orange app tile next to hamburger | Leading Primary wordmark (or quiet mark) |
| Brand read as a third button | Non-interactive, bar-integrated |
| Centered brand overlapping search | Logo in leading cluster; search grouped with actions |
| Icon shadow / floating plate | Wordmark flush; mark clipped when used |
| Welcome badge orange wash | Transparent; muted text, no colored pill |
