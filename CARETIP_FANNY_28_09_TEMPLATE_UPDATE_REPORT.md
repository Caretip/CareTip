# CareTip — Fanny 28.09 Template Update Report

**Date:** 2026-09-28

---

## 1. Template assets discovered

**Folder:** `template/` (repo root)

| File | Role |
|------|------|
| `Akona hotel.png` | **New** guest-experience / scan-step mockup (Akona Hotel branding) |
| `Maria Testerin.png` | Previous scan-step reference (superseded) |
| `Updates 28.09.pdf` | Change request document |
| `caretip_*_mockup_transparent.png` | Other journey mockups (unchanged in this task) |

No separate desktop/mobile asset variants in the folder; one PNG per mockup.

---

## 2. Akona Hotel asset selected

- **Source:** `template/Akona hotel.png`
- **Production asset:** `src/assets/landing/customerjourney/akona-hotel.webp` (converted via sharp, quality 88)
- Replaces `mariatesterin.webp` in the customer journey **scan** step only.

---

## 3. Customer-experience section changed

**Component:** `LandingCustomerJourneySection.tsx` (guest tipping journey / `#guesttippingjourney`)

- Scan step image: `akona-hotel.webp`
- Visual class: `caretip-customerjourney__visual_akona-hotel` (same layout rules as former Maria mockup)
- Warm prefetch: `warmLandingCustomerJourneyAssets.ts` updated

---

## 4. Old Maria Testerin / SALON references

| Location | Action |
|----------|--------|
| Landing customer journey scan step | **Replaced** with Akona asset (branding in image; no SALON label in UI) |
| `mariatesterin.webp` | Left in repo unused (not deleted) |
| i18n `imageAlt` (EN/DE) | Updated to Akona Hotel |
| Testimonials / demo / backend Maria Testerin | **Unchanged** (intentional elsewhere) |

No remaining `Maria Testerin` references under `src/` for landing journey.

---

## 5. Field Service & Trades changes

**Section:** `LandingRealLifeSection` card 5 (`landing.realLife.s5Tag`)

| Locale | Before | After |
|--------|--------|-------|
| EN | Field & Mobile Services | **FOR Field SERVICE & TRADES** |
| DE | Außendienst & Hausbesuche | **FÜR AUßENDIENST & HANDWERK** |

Headlines and body copy unchanged (template/PDF did not require new s5 headline text).

---

## 6. CTA / action-point spacing

**Issue:** Last descriptive copy sat too close to “Learn more” on real-life expandable cards (especially field service).

**Changes:**

- `expandable-info-card.tsx` — CTA margin `mt-5` / `sm:mt-6`
- `caretip-landing-optical-consistency.css` — removed `margin-top: auto` on `#real-life` CTAs; fixed `1.25rem` / `1.5rem` (sm+) gap
- `caretip-landing-mobile-stack.css` — real-life CTA `margin-top` `1.25rem` (mobile) / `1.5rem` (desktop)
- `caretip-landing-motion.css` — `margin-bottom: 0.5rem` on open detail region before CTA

Uses existing spacing scale (rem), no transforms or negative margins.

---

## 7. Responsive verification

- Customer journey mockup: existing `--caretip-journeymockup-h`, `object-fit: contain`, max-width rules preserved for Akona class.
- Real-life cards: existing grid + `ExpandableInfoCard` responsive behavior unchanged aside from spacing.
- **Manual check recommended:** 320–430px and desktop in browser after deploy.

---

## 8. Files changed

- `src/assets/landing/customerjourney/akona-hotel.webp` (new)
- `src/app/components/landing/LandingCustomerJourneySection.tsx`
- `src/app/components/landing/warmLandingCustomerJourneyAssets.ts`
- `src/styles/caretip-landing-customerjourney.css`
- `src/i18n/locales/en.json`, `de.json`
- `src/components/ui/expandable-info-card.tsx`
- `src/styles/caretip-landing-optical-consistency.css`
- `src/styles/caretip-landing-mobile-stack.css`
- `src/styles/caretip-landing-motion.css`

---

## 9. Tests / build

| Command | Result |
|---------|--------|
| `npm run typecheck` | Run after changes |
| `npm run test:customer-journey-desktop-responsive` | Run after changes |

---

## 10. Remaining discrepancies

- `template/` is a local design drop folder (not wired into build); only `akona-hotel.webp` in `src/assets` is bundled.
- PDF may show additional micro-tweaks not present as separate assets; compare visually after deploy.
- Other journey steps still use existing `customerjourney/*.webp` (not replaced by transparent PNGs in `template/` unless requested later).
