# CareTip Landing — Customer Journey Mockup Section

**Date:** 2025-09-25

---

## Images in `template/`

| File | Represents | Decision |
|------|------------|----------|
| `stagecanner.png` | Guest scans CareTip QR on table stand (in-situ photo) | **Use — Step 1 Scan** (`stagecanner.webp`) |
| `caretip_team_selection_mockup_transparent.png` | Location/team member picker (Maria Testerin salon grid) | **Use — Step 2 Choose** |
| `caretip_tip_amount_mockup_transparent.png` | Tip amount for Felix Wagner + “Weiter zur Zahlung” | **Use — Step 3 Tip & pay** |
| `caretip_tip_success_mockup_transparent.png` | Thank-you / tip sent confirmation | **Use — Step 4 Team receives it** |
| `ChatGPT Image Sep 25, 2026, 08_07_08 PM.png` | Post-tip **rating/feedback** screen | **Excluded** — optional step after payment, not core journey; no business dashboard mockup available for “management” |

Steps 2–4 use transparent PNG sources converted to **WebP**; step 1 is the marble/table **stagecanner** photo (WebP). Consistent device framing and production UI copy (DE).

---

## Final journey sequence

1. **Scan** — QR at table/counter  
2. **Choose** — Select team member (when individual tipping applies)  
3. **Tip & pay** — Amount + Stripe checkout  
4. **Team receives it** — Confirmation + CareTip allocation (copy references business rules; visual is guest success screen)

Aligned with routes `/select-employee`, `/tip-amount`, Stripe guest checkout, and tip recording — not invented.

---

## Placement

**After** `#business-section` (Audience benefits)  
**Before** `#payments-trust` (PaymentsSection) and `#how-it-works` (SimpleSetupSection)

**Why:** Payments establishes trust methods; guest journey shows *how tipping feels*; Simple Setup remains the **business onboarding** story (account → team → QR → dashboard). No duplication of setup steps.

Section id: `#guesttippingjourney`

---

## Layout

| Breakpoint | Layout |
|------------|--------|
| **Desktop (≥1024px)** | 4-column row; editorial `01`–`04` labels; subtle horizontal connectors; left-aligned step copy |
| **Tablet (640–1023px)** | 2×2 grid |
| **Mobile (&lt;640px)** | Vertical stack; centered copy; mockups sized for legibility |

Mockups share a fixed optical height (`--caretip-journeymockup-h`) with `object-fit: contain` to balance visual weight.

---

## Copy

i18n keys: `landing.customerJourney.*` (EN + DE). Natural mentions of QR tipping, Stripe, team allocation — no keyword stuffing.

---

## Files changed

| File | Change |
|------|--------|
| `src/assets/landing/customerjourney/*.webp` | WebP from `template/` (stagecanner + 3 mockups) |
| `src/app/components/landing/LandingCustomerJourneySection.tsx` | Section (WebP imports) |
| `src/styles/caretip-landing-customerjourney.css` | Section styles |
| `src/styles/bundles/landing.css` | Import new CSS |
| `src/app/pages/LandingPageBelowFold.tsx` | Lazy-load section + prefetch |
| `src/i18n/locales/en.json`, `de.json` | Copy |

**Not changed:** hero, SimpleSetupSection content, industry pages, SEO metadata/routing, `/how-it-works` route (removed earlier).

---

## Tests

| Command | Result |
|---------|--------|
| `npm run test:seo-category-p1` | Pass |
| `npm run test:seo-remediation` | Pass |
| `npm run test:seo-head-reconciliation` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |

---

## Manual checks

- Desktop / tablet / mobile layout in browser at `/#guest-tipping-journey`
- All four bundled image URLs resolve in production build output
- Industry How It Works sections unchanged (`IndustryPageTemplate`)

---

## Intentionally excluded

- Rating/feedback mockup (5th image) — post-payment optional flow  
- Business dashboard mockup — not in `template/`; step 4 uses success screen + copy for allocation/management
