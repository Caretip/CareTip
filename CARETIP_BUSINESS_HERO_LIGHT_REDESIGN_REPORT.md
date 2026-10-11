# CareTip Business & Employee Dashboard Hero — Light UI Redesign Report

**Date:** 2026-09-27  
**Scope:** Business `/dashboard` and employee dashboard overview heroes (`BusinessDashboard`, `EmployeeDashboard`, shared `DashboardHeroFinancialLayout`)  
**Intent:** Visual refinement only — structure, data, APIs, routing, and calculations unchanged.

---

## 1. Files / components changed

| File | Change type |
|------|-------------|
| `src/app/pages/business/BusinessDashboard.tsx` | Presentation class names + `dashboard-hero-financial-panel` on metrics |
| `src/app/pages/employee/EmployeeDashboard.tsx` | Same typography/spacing classes + `dashboard-hero-financial-panel` on metrics |
| `src/app/components/business/BusinessDashboardMobileHero.tsx` | Same panel class on metrics (shared mobile hero component) |
| `src/styles/dashboard-hero-financial.css` | Shared `.dashboard-hero-financial-panel` (business + employee) |
| `src/styles/business-dashboard-hierarchy.css` | Business + employee hero typography, spacing, CTA strip, illustration frame |
| `src/styles/dashboard-workspace.css` | Employee hero photo frame on mobile |
| `src/styles/business-web-design.css` | Hero image border radius + restrained shadow (aligned with hierarchy) |

**Not changed:** `BusinessHeroFinancialMetrics.tsx` / `EmployeeHeroFinancialPanel.tsx` logic, CTA actions/routes, hooks, backend, i18n keys, hero image assets, `DashboardHero` grid structure.

### Employee-specific
- Same financial strip treatment for earnings + four supporting metrics (paid, pending, gross, supporters).
- QR signature block separated with the same hairline as business CTAs; button heights aligned.
- Employee photo hero (`object-contain`) gets matching border/radius/shadow on desktop and mobile (not cropped larger).

---

## 2. Visual changes made

### Left hierarchy
- Greeting: slightly tighter padding and muted tone.
- Headline: improved line-height (1.12 desktop), letter-spacing, wider max width (`22ch` on large screens) so “Ihr Betrieb auf einen Blick” breathes.
- Subtitle: small top margin, slightly softer muted color, wider max width on desktop.
- Text column: `business-hero-text-column` with `max-width: 36rem` and more right padding on xl.

### Main KPI (Trinkgeld gesamt)
- Panel class `dashboard-hero-financial-panel` on the financial block (business and employee).
- Primary label smaller; period meta (`· Gesamt`) stacks as a secondary line.
- Primary € value: refined clamp sizing and letter-spacing (prominent but not oversized).

### Four supporting Stripe metrics
- Unified light surface: muted background, hairline border, rounded container (not four separate cards).
- 2×2 grid with subtle internal dividers on `sm+` (column/row separators).
- Smaller labels; stronger payout values (700 weight).

### CTAs
- Metrics + buttons grouped: top border above CTA row, consistent vertical rhythm.
- Slightly taller tap targets (`2.8125rem` min-height) on business quick-access buttons.
- Desktop hero column gap increased slightly for less cramped left column.

### Right visual
- Same `finalbizzy-hero` image.
- `0.625rem` radius, light border, soft shadow (no gradient, no size increase).
- Media column alignment unchanged (stretch / center via existing grid).

### Container
- No full-hero card wrapper; background remains dashboard shell.
- Whitespace and typography carry hierarchy.

---

## 3. Business logic / data / API — confirmation

| Area | Status |
|------|--------|
| API calls | Unchanged (`useBusinessFinancialSummary`, stats hooks) |
| Metric calculations | Unchanged (`BusinessHeroFinancialMetrics`, Stripe cents, distribution rules) |
| CTA routes | Unchanged (`businessDashboardQuickAccessItems`) |
| Preview / entitlements behavior | Unchanged |
| German / English copy | Unchanged (same i18n keys) |
| Financial values displayed | Same fields and formatters (`formatEur`, `CountUpMetric`) |

---

## 4. Responsive verification

| Viewport | Expected behavior | How verified |
|----------|-------------------|--------------|
| Desktop (≥1024px) | Two-column hero; left stack + image right; 2×2 metrics in unified strip; CTAs in row from `480px` | CSS scoped to `.business-dashboard-hero`; existing `DashboardHero` `stackHeroOnMobile` unchanged |
| Mobile (&lt;1024px) | Stacked hero (image after content per `DashboardHero`); metrics strip + full-width CTAs; page padding via `caretip-container` | Mobile-specific payout padding rules; no `transform` positioning added |
| Small mobile | Metrics remain 2-column grid inside strip; edge padding via shell/container | `@media (max-width: 639px)` panel rules |

**Manual check recommended:** Load `/dashboard` as business user in DE + EN, resize 375px / 768px / 1280px.

---

## 5. Tests / build

| Command | Result |
|---------|--------|
| `npm run typecheck` | **Passed** (exit 0) |
| `npx vite build` | **Passed** (exit 0) — validates CSS bundling and TS compile via Vite |

Full `npm run build` (includes prebuild image/SEO scripts) was not required for this CSS-only change; Vite production build is the relevant frontend compile check.

Existing E2E selectors (`.business-dashboard-hero`, `.dashboard-hero-financial`) remain valid; no class removals.

---

## Summary

The business dashboard hero is the same information architecture with clearer typographic hierarchy, a single financial metric strip for Stripe fields, tighter CTA integration, and a slightly refined hero image frame — within existing CareTip tokens and without new dependencies.
