# Form Field Readability Audit

**Date:** 2026-08-27  
**Scope:** CareTip web frontend (+ shared mobile auth field tokens)  
**Objective:** Improve readability of typed values, selected values, labels, placeholders, and related form text without redesigning forms or changing behavior.

---

## Executive summary

Low-contrast form text was primarily caused by **shared primitives and theme rules**, not by one-off page bugs:

1. Shared `Input` / `Textarea` / `Select` relied on size utility `text-input` without always pairing an explicit **`text-foreground`** color for typed/selected content.
2. Placeholders stacked **extra alpha** (`placeholder:text-muted-foreground/80`, globals `muted-foreground / 0.82`) on top of an already secondary token.
3. **`disabled:opacity-50`** on text fields washed out existing values; better pattern is muted background + readable text at full opacity.
4. Select triggers used translucent **`dark:bg-input/30`**, weakening selected-value contrast on dark surfaces.
5. Browser **autofill** could override text fill color; theme now forces foreground + input background.
6. Mobile web auth labels shared the same muted color as placeholders; labels are now stronger and distinct.

Fixes prefer **shared components + theme tokens**. Page-specific overrides were limited to intentional surfaces (contact, onboarding, customer QR search).

**Functionality (validation, submit, APIs) was not changed.**

---

## Scope

### Audited surfaces (by category)

| Category | Coverage |
| --- | --- |
| Auth (login, signup, forgot/reset password, verify email, MFA) | Shared auth CSS + mobile web auth CSS + mobile `AuthField` tokens |
| Account / profile / settings | Shared `Input`/`Label`/`Form` + settings pages using them |
| Business registration / onboarding / settings | `businessOnboardingUi` + shared inputs |
| Employee forms / invitation | Shared inputs + employee settings |
| Tip goals / QR / customer tipping | `customerFlowUi`, QR landing search |
| Support / demo / contact | `contactPageUi` + contact forms |
| Payment / customer | Shared + customer flow field tokens |
| Search / filters / command palette | `CommandInput`, FAQ search CSS |
| Selects / textareas / OTP / checkboxes / radios | Shared UI primitives |
| Modals / drawers | Inherit shared primitives |
| Mobile native forms | `AuthField`, `TextField`, `SearchField` (readability tokens reviewed) |

### Contrast checklist (audited separately)

1. Field labels  
2. User-entered text  
3. Selected values  
4. Placeholder text  
5. Helper text  
6. Error messages  
7. Success messages  
8. Disabled / read-only values  
9. Input borders  
10. Focus states  
11. Select / dropdown text  
12. Textarea content  
13. Form-associated buttons (left as intentional `disabled:opacity-50` for inactive actions)

---

## Forms / components audited

### Shared primitives (root cause — primary)

- `src/app/components/ui/input.tsx`
- `src/app/components/ui/textarea.tsx`
- `src/app/components/ui/select.tsx`
- `src/app/components/ui/input-otp.tsx`
- `src/app/components/ui/label.tsx`
- `src/app/components/ui/form.tsx` (`FormDescription`, `FormMessage`)
- `src/app/components/ui/command.tsx` (`CommandInput`)
- `src/components/ui/input.tsx` (alternate Input export path)
- `src/app/components/ui/checkbox.tsx` / `radio-group.tsx` (control chrome only; opacity on disabled control is acceptable)

### Theme / global CSS

- `src/styles/theme.css` — base input/select color, placeholders, autofill
- `src/styles/globals.css` — placeholder alpha conflict resolved
- `src/styles/caretip-auth.css` — auth field placeholders
- `src/styles/caretip-mobile-web-auth.css` — mobile web labels/placeholders
- `src/styles/caretip-faq-page.css` — FAQ search (already foreground + muted placeholder)
- `src/styles/caretip-marketing-theme.css` — contact input dark hooks

### Page / product tokens

- `src/components/contact/contactPageUi.ts`
- `src/app/components/business/businessOnboardingUi.ts`
- `src/app/pages/customer/customerFlowUi.ts`
- `src/app/pages/customer/QRLandingPage.tsx`
- `mobile/theme/authBrand.ts` (native auth placeholder)

---

## Root causes discovered

| ID | Cause | Classification |
| --- | --- | --- |
| A | Shared Input/Textarea/Select missing explicit `text-foreground` for typed/selected text | Shared components |
| B | Placeholder utilities stacking `/80` (or globals `/ 0.82`) on muted token | Theme + Tailwind utilities |
| C | `disabled:opacity-50` on text controls made values hard to read | Shared components |
| D | Select `dark:bg-input/30` diluted contrast for selected values | Shared components |
| E | Autofill `-webkit-text-fill-color` could wash typed text | Browser / autofill styling |
| F | Mobile web auth labels used same muted color as placeholders | Mobile-specific CSS |
| G | Contact inputs used `bg-transparent` on light marketing surfaces | Page-specific styling |
| H | Onboarding placeholders `text-zinc-400` / hints too faint | Page-specific styling |

**Not treated as bugs (intentionally left):**

- Button `disabled:opacity-50` (inactive actions, not field values).
- Checkbox/radio control `disabled:opacity-50` and `dark:bg-input/30` on the **control glyph**, not typed text.
- Empty-state / marketing body copy using `text-gray-400` / `text-zinc-400` outside form fields.

---

## Files changed

- `src/app/components/ui/input.tsx`
- `src/app/components/ui/textarea.tsx`
- `src/app/components/ui/select.tsx`
- `src/app/components/ui/input-otp.tsx`
- `src/app/components/ui/label.tsx`
- `src/app/components/ui/form.tsx`
- `src/app/components/ui/command.tsx`
- `src/components/ui/input.tsx`
- `src/styles/theme.css`
- `src/styles/globals.css`
- `src/styles/caretip-auth.css`
- `src/styles/caretip-mobile-web-auth.css`
- `src/components/contact/contactPageUi.ts`
- `src/app/components/business/businessOnboardingUi.ts`
- `src/app/pages/customer/customerFlowUi.ts`
- `src/app/pages/customer/QRLandingPage.tsx`
- `mobile/theme/authBrand.ts`
- `docs/FORM_FIELD_READABILITY_AUDIT.md` (this report)

---

## Before / after styling approach

### Typed & selected values

| Before | After |
| --- | --- |
| Size class `text-input` without guaranteed foreground color | `text-foreground` + existing CareTip size tokens |
| Select may inherit muted / translucent dark fill | Solid `bg-input-background` + `text-foreground` |

### Placeholders

| Before | After |
| --- | --- |
| `placeholder:text-muted-foreground/80` or globals `muted / 0.82` | Full `muted-foreground` at `opacity: 1` (still secondary to typed text) |
| Auth placeholders translucent | Solid secondary greys (`rgb(82 82 82)` light / readable dark) |

### Disabled fields

| Before | After |
| --- | --- |
| `disabled:opacity-50` (washes entire control) | `disabled:bg-muted` + `disabled:text-foreground/75` + `disabled:opacity-100` |

### Autofill

| Before | After |
| --- | --- |
| Browser default fill / text | Forced `-webkit-text-fill-color: foreground` + inset `input-background` |

### Labels (mobile web)

| Before | After |
| --- | --- |
| Same muted color as placeholders | Ink color + `font-weight: 600`; placeholders remain secondary |

---

## Shared component fixes

1. **Input / Textarea / Select / OTP / CommandInput** — explicit `text-foreground`; readable disabled treatment; solid input background in dark mode for selects.
2. **Label** — peer/group disabled opacity `50 → 60` (still muted, less invisible).
3. **FormDescription / FormMessage** — `font-medium` so helper/error text is clearer without relying only on color.
4. **theme.css** — global `input/textarea/select` use `text-foreground`; placeholders at full muted; autofill rules for light/dark.
5. **globals.css** — remove conflicting `/0.82` placeholder alpha so it matches theme.

---

## Page-specific fixes

1. **Contact** (`contactPageUi`) — `bg-transparent` → `bg-input-background` for inputs/textareas (keeps border/focus language).
2. **Business onboarding** — stronger placeholders (`zinc-500` / dark `zinc-400`), clearer hints, readable disabled fields.
3. **Customer flow / QR search** — drop residual placeholder alpha cuts; keep secondary muted placeholder.
4. **Mobile web auth** — label hierarchy vs placeholder; slightly stronger muted label token.
5. **Native mobile auth** — `fieldPlaceholder` `0.74 → 0.82` white alpha on glass fields.

---

## Accessibility / readability considerations

- Typed and selected values use **foreground on input-background**, which is the design-system pairing for CareTip light/dark.
- Placeholders remain visually secondary but no longer double-faded.
- Labels (shared + auth) stay **semibold / foreground-family**, distinct from placeholders.
- Errors use **destructive + `font-medium`** (color + weight).
- Disabled values stay readable via reduced opacity on text color only, not the whole control.
- Focus rings unchanged (`ring-ring` / primary focus patterns).
- No new color tokens invented; reused `--foreground`, `--muted-foreground`, `--input-background`, existing zinc/auth greys.

---

## Tests performed and results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pre-existing errors unrelated to this change (`firebase/*`, `jspdf`, `@react-three/drei` exports). No new errors in edited form files. |
| `npm run test:contact-lead-frontend` | **17 passed, 0 failed** |
| `npm run test:dashboard-mobile-ui` | **22 passed** |
| Residual search for `placeholder:text-muted-foreground/` | **None remaining** in `src/` |
| Residual search for form placeholder opacity stacks | Cleared in shared + audited page tokens |
| Shared Input / Textarea / Select / Label / Form / Command | Verified in source |
| Behavior / submit / validation | Untouched by design |

Manual visual confirmation recommended on:

- Login / signup (desktop + `.mw-auth` mobile web)
- Contact demo/support forms
- Business onboarding inputs
- Customer QR search
- Autofilled email/password fields (Chrome)
- Light and dark theme

---

## Remaining observations

1. **Checkbox / radio** still use `dark:bg-input/30` and `disabled:opacity-50` on the **control** itself — appropriate chrome, not typed text.
2. **Buttons** keep `disabled:opacity-50` — intentional for inactive CTAs.
3. Some **non-form** empty-state / marketing copy still uses `text-gray-400` / `text-zinc-400`; out of scope for field readability.
4. **Native mobile** `TextField` / `SearchField` already use `colors.foreground` for typed text and `mutedForeground` for placeholders; no structural change required beyond auth placeholder alpha.
5. Full `npm run typecheck` cleanliness depends on fixing unrelated ambient module typing (firebase/jspdf/drei), not this audit.
6. This markdown file is gitignored by `*.md` (except `README.md`); force-add if it should be committed: `git add -f docs/FORM_FIELD_READABILITY_AUDIT.md`.
