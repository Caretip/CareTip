# CareTip — Employee Management Premium UI Redesign Report

## Final status

**READY — EMPLOYEE MANAGEMENT REDESIGN COMPLETE**

---

## 1. Current UI problems found

- **Over-card layout:** Invite block, at-a-glance metrics, and search each lived in separate large `Card` surfaces, reading like a generic admin template.
- **Weak page hierarchy:** Module header had an empty subtitle; primary actions were buried inside the invite card instead of aligning with the page title.
- **Duplicate search:** Mobile flat section and desktop search card both bound to the same state.
- **Flat roster:** Desktop table used `min-w-[72rem]`, encouraging horizontal overflow; row motion animations and inline icon action clusters felt busy.
- **Dense contact column:** Email and phone with inline icons were hard to scan; QR assignment used `N/A` instead of a clear “no assignment” state.
- **Mobile:** Card list was functional but not aligned with the newer workspace typography, KPI strip, or compact action pattern.

---

## 2. Design decisions

- **Workspace shell:** Single `team-employees-workspace` column with spacing/dividers instead of stacked cards (spec §16).
- **Header actions:** Stripe-style `BusinessTeamHeaderActionsProvider` wires **Generate invite** / **Add employee** (and copy/regenerate when a code exists) into `BusinessModuleWorkspaceHeader` on `sm+`; mobile actions sit in the invite callout.
- **Invite callout:** Compact muted surface for title, description, optional pending-invite hint, and invite code block—no oversized empty card.
- **KPI strip:** Four metrics in one `team-employees-kpi-strip` group (labels + tabular numbers), matching tip-distribution / analytics rhythm.
- **Roster section:** “Team members” + count + unified search toolbar above the list.
- **Desktop table:** Bordered panel, refined typography, stacked contact, QR primary/secondary lines, monetary tips, compact star rating, activation toggle preserved, **⋯** overflow menu for QR / edit / delete.
- **Mobile:** Semantic `article` cards with the same data hierarchy, activation toggle, metrics row, and overflow menu—no shrunken desktop table.
- **Empty states:** Distinct copy when search filters return zero rows (`searchEmpty`) vs empty roster.
- **i18n:** EN/DE for page subtitle, roster section, search empty, and `noQrAssignment`.

---

## 3. Components / files changed

| File | Change |
|------|--------|
| `src/app/pages/business/StaffManagementPage.tsx` | Presentation refactor; helpers `staffQrAssignmentLabels`, `StaffEmployeeActionsMenu`; header actions effect |
| `src/app/pages/business/team/BusinessTeamLayout.tsx` | Subtitle on mobile for employees; header action slot + provider |
| `src/app/components/business/BusinessTeamHeaderActions.tsx` | **New** — outlet context for header actions |
| `src/app/components/business/StaffManagementPageSkeleton.tsx` | Matches new workspace layout |
| `src/styles/team-employees-workspace.css` | **New** — workspace, KPI, roster, table, mobile card styles |
| `src/styles/bundles/dashboard.css` | Import team employees CSS |
| `src/i18n/locales/en.json` | Team subtitle, roster/search/QR strings |
| `src/i18n/locales/de.json` | German equivalents |

**Unchanged:** APIs, permissions, modals, fetch/cache/socket logic, activation/deactivate/delete flows, Stripe badge component behavior, subscription gates.

---

## 4. Desktop redesign

- Module header: eyebrow **People**, title **Team**, subtitle from `business.team.employeesHeaderSubtitle`.
- KPI strip → invite callout (when team growth allowed) → roster with search → table panel.
- Table columns: Employee (name anchor, joined, roster notes, Stripe badge), Role, QR assignment, Contact, Tips, Rating, Active toggle, overflow actions.
- Subtle row hover; inactive rows use dashed muted treatment.

---

## 5. Mobile redesign

- Header actions duplicated in invite callout (`sm:hidden`).
- Roster search full width above card list.
- Each employee: avatar + name, role, Stripe badge, QR block, active switch, tips + rating footer, stacked email/phone, overflow menu.
- Empty/search-empty uses shared empty state styling with icon.

---

## 6. Loading / empty / error states

| State | Treatment |
|-------|-----------|
| Initial load | `StaffRosterTableSkeleton` + updated page skeleton |
| Background refresh | Existing inline spinner + `dashboard.refresh.updating` |
| API error | Existing error banner + try again |
| No employees | `emptyTitle` / `mobileEmpty` |
| Search no match | `searchEmpty` |
| No QR | `noQrAssignment` + `noTables` secondary |
| No rating | `newMember` |
| No team growth | `TeamGrowthUpgradeNotice` unchanged |

---

## 7. Localization

- **EN:** `business.team.employeesHeaderSubtitle`, `business.staffPage.rosterSectionTitle`, `rosterSectionMeta`, `searchEmpty`, `noQrAssignment`, updated `inviteTeamDesc`.
- **DE:** Matching keys under the same paths.
- All table headers, buttons, and statuses continue to use existing `business.staffPage.*` keys.

---

## 8. Performance impact

- No new API calls or employee queries.
- Removed per-row `motion` list animations on the roster (modals still use motion).
- Same `getBusinessStats` / page session cache / realtime refresh paths.
- One small CSS bundle import on dashboard styles.

---

## 9. Accessibility

- Table headers use `scope="col"`; actions column uses screen-reader-only label.
- Search input has `aria-label`; KPI group has `aria-label` from at-a-glance string.
- Roster section titled with `aria-labelledby`.
- Activation switches retain `role="switch"` and `aria-checked`.
- Dropdown trigger exposes `aria-label` for actions.

---

## 10. Tests performed

- `npm run typecheck` — pass
- `npm run build` — pass (exit 0)
- Manual verification checklist (recommended in browser): desktop 1280–1920, tablet 768–1024, mobile 320–430, search empty, long email/name, DE locale, action menus, modals, toggles.

No dedicated employee-management automated test package was found in `package.json`; no new tests added.

---

## 11. Regression results

| Check | Result |
|-------|--------|
| TypeScript | Pass |
| Production build | Pass |

---

## 12. Remaining limitations

- On viewports just above the mobile breakpoint (`lg` / 1024px), a wide roster may compress columns; horizontal scroll was removed intentionally per spec (no `min-w-[72rem]` hack). If truncation becomes an issue at specific widths, consider column hide priorities—not new data.
- Header primary actions are hidden below `sm` and shown only in the invite callout to avoid crowding the module header on very narrow screens.
