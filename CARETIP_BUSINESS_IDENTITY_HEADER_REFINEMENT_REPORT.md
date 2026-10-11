# CareTip — Business Identity Header / Sidebar Refinement Report

## 1. Current component structure

| Element | Component | Data source |
|--------|-----------|-------------|
| CareTip logo + wordmark (sidebar) | `BusinessSidebar` → `CareTipLogo` (`size="sidebar"`) | Static brand assets |
| Business name (sidebar) | `BusinessSidebarNavShell` → `BusinessSidebarSubscriptionStatus` | `useAuth().user.businessName` |
| Navigation | `BusinessSidebarNavShell` / `BusinessSidebarNavTree` | Route config + entitlements |
| Top header shell | `DashboardHeader` → `DashboardHeaderBar` | Role-based |
| CareTip brand (mobile header only) | `DashboardHeader` leading cluster (`lg:hidden`) | `CareTipLogo` wordmark / mark |
| Business logo (header, managers) | `DashboardHeader` → `Link` + `BusinessLogoMark` (`size="dashboardHeader"`) | `useBusinessVenueBrand()` → `fetchBusinessProfile()` (`logo`, `name`) |
| Mobile drawer identity | `BusinessMobileSidebar` | `useBusinessVenueBrand().venueName` + type label (text only, no logo) |

`useBusinessVenueBrand` listens for `caretip-business-profile-changed` so logo updates after settings uploads without a full reload.

## 2. Root cause of visual imbalance

- The business logo link used `max-w-[2.75rem]` on small viewports, which fought `BusinessLogoMark` `dashboardHeader` bounds (`max-w-[4.25rem]`) and made rectangular logos feel cropped or arbitrary.
- The header mark had no stable container or desktop separation from global controls, so it read as a floating image next to icon buttons rather than an account/business identity affordance (unlike the employee profile cluster’s `border-l` treatment).
- Sidebar business name padding did not align horizontally with the CareTip brand block at `lg` (`px-5` vs `px-4`).

## 3. Changes made

- Added `src/styles/business-dashboard-identity-header.css` and imported it from `src/styles/bundles/dashboard.css`.
- `DashboardHeader`: `caretip-dashboard-header-business-identity` wrapper on the settings link; removed mobile `max-w-[2.75rem]` clip; `imageLoading="eager"` and `rounded-lg` fallback for header mark; improved `aria-label` via i18n.
- `BusinessSidebarSubscriptionStatus`: `business-sidebar-venue-name` classes; horizontal padding aligned with sidebar brand at large breakpoints.
- `BusinessLogoMark`: optional `imageLoading` prop (default `lazy`; header uses `eager`).
- i18n: `shell.header.businessLogoSettingsAria` (EN/DE).
- Regression: `scripts/business-identity-header-refinement-runtime.ts` → `npm run test:business-identity-header-refinement`.

No navigation, API, auth, or upload logic changes.

## 4. Business logo behavior

- URL: `profile.logo` from `fetchBusinessProfile()`, resolved with `resolveMediaUrl`.
- Render: `object-contain` within `dashboardHeader` size presets; square and wide logos stay within max bounds.
- Missing / broken: initials fallback (`fallbackTone="muted"`), `onError` → fallback; stable min dimensions on link + fallback classes prevent header jump.
- Interactive: link to `/dashboard/settings?section=business`.

## 5. Desktop behavior (≥1024px)

- Sidebar: CareTip brand block unchanged; business name directly above nav.
- Header: search + notifications + theme + language; business logo at trailing edge with subtle left rule and hover surface matching control polish.
- No duplicate business name in header.

## 6. Mobile behavior (&lt;1024px)

- CareTip wordmark/mark remains in leading cluster (existing `caretip-dashboard-mobile.css` rules).
- Business logo stays in trailing cluster with capped `max-width` (4.5rem mobile, scaling up at `sm`) so it does not crowd notifications/search.
- Drawer: venue name + type only (logo not duplicated).

## 7. Missing-logo fallback

- `BusinessLogoMark` shows bordered initials from `venueName` (or auth name via hook fallback string).
- No broken `<img>`; no new placeholder artwork.

## 8. Accessibility

- Link: `aria-label` = “Business settings for {name}” / DE equivalent.
- Logo image: `alt=""` with `aria-label` on image when shown; fallback mark `aria-hidden` (name conveyed by link label).
- Focus: `focus-visible` ring on identity link.
- Keyboard: standard link focus order in trailing cluster.

## 9. Performance / layout shift

- Sidebar name is synchronous from auth (no extra fetch).
- Header logo shares existing `useBusinessVenueBrand` fetch (one hook instance in header; second instance only when mobile drawer is mounted open).
- Stable `min-height` / `min-width` on identity link; logo bounds unchanged in spirit.
- Header image `loading="eager"` only for manager header mark to reduce identity flicker (no preload link).

## 10. Tests / build results

Run locally:

```bash
npm run test:business-identity-header-refinement
npm run test:dashboard-mobile-ui
npm run test:dashboard-header-identity
npm run typecheck
```

| Command | Result |
|---------|--------|
| `npm run test:business-identity-header-refinement` | Pass |
| `npm run test:dashboard-header-identity` | Pass |
| `npm run test:dashboard-mobile-ui` | 2 unrelated failures (staff page flattening, Stripe ready copy) — business drawer/header checks pass |
| `npm run typecheck` | Pass |

---

## Final status

**READY — BUSINESS IDENTITY HEADER REFINEMENT COMPLETE**
