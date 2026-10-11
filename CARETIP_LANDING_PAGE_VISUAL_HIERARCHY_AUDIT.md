# CareTip Landing Page — Visual Hierarchy, Spacing, Image & Scroll Audit

**Date:** 2025-09-25  
**Scope:** Full landing journey (hero → footer), with emphasis on the new guest customer-journey section.

---

## 1. Overall findings

The landing page already uses a coherent system: `landingUi` section shells, `caretip-section-intro` rhythm, ivory section flow, and lazy below-fold chunks. After adding **Guest experience** (`#guesttippingjourney`), the main risks were:

- **Stacked “full chapter” padding** (payments → guest journey → setup) inflating scroll.
- **Oversized lazy min-heights** reserving empty space before sections mount.
- **Customer journey mockups** at mixed optical scale (step 1 wider than steps 2–4).
- **Setup in minutes** (`#how-it-works`) carrying redesign-era `padding-block` and large desktop `padding-top` on the device column.
- **Intro blocks** with default `mb-12`–`mb-16` separating headings from their own supporting copy or from the content they introduce.

Fixes are **presentation-only** (spacing, max-heights, lazy reserves, grouping)—no copy, routing, or SEO changes.

---

## 2. Heavy-scroll findings

| Area | Issue | Severity |
|------|--------|----------|
| `#guesttippingjourney` | Default `py-16`–`py-28` + tall mockup slots + `52rem` lazy min-height | High |
| `#how-it-works` | `trickyfresh` `padding-block` up to `8rem`; desktop visual `padding-top` ~7–9rem | High |
| `#payments-trust` → journey → setup | Three narrative-weight sections in sequence | Medium |
| `#business-section` | Large dashboard + phone columns; `52rem` lazy reserve | Medium |
| Hero | Intentionally cinematic; **left unchanged** | — |
| `#industries` | Tall photo grid by design; hierarchy pass already softens mobile py | Low |

---

## 3. Image sizing & placement findings

| Asset / area | Finding |
|--------------|---------|
| Guest journey step 1 (`mariatesterin`) | `max-width: 20rem` vs `16.5rem` on other steps — broke grid optical weight |
| Guest journey slot | `--caretip-journeymockup-h` up to `20.5rem` — more empty band than information |
| Audience benefits | Dashboard + phone scales governed by existing matched-height JS — OK |
| Industries teaser | Photo grid owns height — OK |
| Setup onboarding preview | Mobile journey aspect ratio tall — partially addressed earlier via live-minutes refine |

**Intent:** Same **optical height band** and **max mockup width** for all four journey steps; `object-fit: contain` preserved.

---

## 4. Heading / subtext spacing findings

- Section intros use `sectionIntroChildRhythm` (`h2` mt ~3.5); some sections felt like the **grid below** was the first child of the *next* chapter.
- Guest journey: title + body split across loose stacks; step title not grouped with its paragraph.
- Global: centered sections benefit from a slightly tighter **h2 → subtitle** gap without changing type scale.

---

## 5. Hierarchy findings

**Intended scan path (unchanged):** Hero value → industries breadth → owner/employee benefits → payment trust → **guest flow** → **business setup** → recognition → final CTA.

- Guest journey correctly sits **after** payments and **before** setup (guest vs business story).
- Step numbers are appropriately **subordinate** (small orange chips on step titles).
- Risk was **visual weight** of mockup columns competing with section H2 — addressed by shorter mockup band and calmer section py.

---

## 6. Section rhythm findings

- Payments already tuned as a **trust bridge** (`optical-hierarchy-pass`).
- Guest journey needed **bridge pacing** (less py than default section).
- Setup needed **reduced chapter height** when following journey.
- Recognition + final CTA left on existing rhythm.

---

## 7. Customer journey findings (detailed)

- Four columns on desktop read left-to-right; 2×2 tablet; stack mobile — OK.
- Numbers on step titles — OK hierarchy.
- **Fixed:** unified mockup scale; `textblock` groups title + body; tighter step gaps; lower mockup CSS variable; reduced mobile track gap.
- **Not duplicated:** setup section remains business onboarding; journey remains guest QR flow.

---

## 8. Responsive findings

| Breakpoint | Actions taken |
|------------|----------------|
| Mobile | Lower journey py; smaller mockup height; tighter step stack gap; setup py + demo max-height (existing + chapter override) |
| Tablet | Journey 2×2 with reduced mockup clamp |
| Desktop | Setup visual `padding-top` override; journey intro margin; unified 4-col mockup scale |

---

## 9. Changes made

| File | Change |
|------|--------|
| `src/styles/caretip-landing-customerjourney.css` | Lower `--caretip-journeymockup-h`; unify step 1 width; `textblock` grouping; tighter gaps |
| `src/app/components/landing/LandingCustomerJourneySection.tsx` | Wrap title + body in `textblock` |
| `src/styles/caretip-marketing-pages-optical-balance.css` | §15: journey + setup py; intro margins; h2→p tighten; business mobile pb |
| `src/app/pages/LandingPageBelowFold.tsx` | Lazy min-heights: journey `36rem`, setup `40rem`, audience `48rem`, payments `14rem` |

**Earlier in same initiative (still in tree):** live-minutes mobile scroll (`touch-action: pan-y`), audience benefit checks aligned with recognition.

---

## 10. Shared components / tokens touched

- `caretip-marketing-pages-optical-balance.css` (landing-wide overrides)
- `caretip-landing-customerjourney.css` (journey-specific tokens)
- `LAZY_SECTION_MIN_HEIGHT` in `LandingPageBelowFold.tsx`
- Reused: `--caretip-feature-check-*`, `landingUi.sectionIntro`, `caretip-section-intro`

No new design system or dependencies.

---

## 11. Intentionally unchanged

- Hero cinematic min-height and full-bleed art
- Industry showcase / photo grid height
- Marketing copy and SEO metadata
- Routing, sitemap, canonical
- Industry page “How it works” templates
- Recognition section layout and imagery
- Typography scale (font sizes/weights except existing journey step title)

---

## 12. Tests and results

Run after pull:

```bash
npm run typecheck
npm run build
npm run test:seo-category-p1
npm run test:seo-remediation
npm run test:seo-head-reconciliation
```

| Command | Result |
|---------|--------|
| `npm run typecheck` | Pass |
| `npm run test:seo-category-p1` | Pass |
| `npm run test:seo-remediation` | Pass |
| `npm run test:seo-head-reconciliation` | Pass |
| `npm run build` | Pass |

---

## Verification checklist

- [ ] Full-page scroll feels shorter without feeling cramped
- [ ] Guest journey mockups share optical weight
- [ ] Section headings sit closer to their subtitles
- [ ] Setup section scrolls past step list without “sticky” feel on mobile
- [ ] Desktop setup device column not floating far below intro
- [ ] No horizontal overflow on mobile
