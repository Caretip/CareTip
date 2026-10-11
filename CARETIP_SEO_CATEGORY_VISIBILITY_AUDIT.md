# CareTip SEO — Category Visibility & Search Intent Audit

**Date:** 2026-09-25  
**Scope:** Read-only strategic audit — category discoverability for digital tipping / hospitality tipping searches  
**Baseline:** Sprint 1 technical SEO production-verified (`69d28df0`); head reconciliation verified in Chrome DevTools  
**Constraints:** No code changes; no SSR/SSG; no hreflang; no architecture redesign

---

## Strategic objective (audit lens)

CareTip should become **genuinely discoverable** for legitimate searches around digital tipping platforms, QR tipping, and hospitality tipping — through **clear positioning**, **useful content**, **technical accessibility** (already largely solved), and **earned authority** — not keyword stuffing or thin landing-page sprawl.

This audit evaluates **semantic clarity** and **search-intent coverage**, not promised rankings.

---

## Executive summary

| Dimension | Assessment |
|-----------|------------|
| **Category clarity (overall)** | **Good but uneven** — metadata and `platformLead` say “digital tipping platform”; hero H1 is outcome-led (“More tips for your team”) |
| **Strongest intents today** | Digital tipping platform, QR code tipping, hospitality tipping, restaurant/hotel verticals |
| **Weakest intents today** | Tipping **app** (guest no-app positioning conflicts), tip distribution **software**, employee tipping **software** as head terms |
| **Best existing assets** | Homepage, `/how-it-works`, `/features`, `/industries/gastronomy`, `/industries/hotels`, `/faq` |
| **Technical blockers** | **None material** post Sprint 1 |
| **Authority gap** | **Significant** for competitive category terms — cannot be closed by on-site copy alone |

**Core recommendation:** Deepen **2–3 existing indexable pages** + **operational GSC** + **earned links/case studies** — not a large new page fleet.

---

## 1. Current category positioning

### What CareTip communicates today (public site)

| Question | Clarity | Primary evidence |
|----------|---------|------------------|
| **What is CareTip?** | **Clear in metadata & supporting copy** | SEO titles/descriptions; `landing.showcase.platformLead`; static `#caretip-static-summary` |
| **Who is it for?** | **Clear** | Hospitality, restaurants, hotels, service teams; industry pages broaden to logistics, midwives, events, field service |
| **What problem?** | **Clear** | Cashless tipping, staff recognition, manager transparency, payout friction |
| **Digital tipping** | **Strong** | Homepage lead, FAQ, how-it-works, legal copy |
| **Tipping platform** | **Strong in SEO layer**; **moderate in visible H1** | `platformLead`, features section “tipping platform”, `/features` landing block |
| **Tipping app** | **Ambiguous / weak** | Guest flow = **no app**; `/mobile-app` placeholder noindex; no store-led positioning |
| **QR code tipping** | **Strong** | Hero, features, how-it-works, industries, FAQ |
| **Hospitality tipping** | **Strong** | Repeated across homepage, features, industries, FAQ |
| **Restaurant / hotel tipping** | **Strong on vertical pages** | `/industries/gastronomy`, `/industries/hotels`; homepage marquee mentions venues |
| **Employee tip management** | **Moderate** | Employee dashboards, notifications, wallets — more **product** than **category** language |
| **Tip distribution** | **Moderate–weak (marketing)** | Detailed in `/how-it-works` step 8 and product UI strings; not a homepage category phrase |

### Homepage — first impression test

**Visible hero (EN):**

- **H1:** “More tips for your team. Zero effort for your business.” — compelling outcome; **does not name the category**
- **Tagline:** “Caring is Tipping” — brand, not category
- **Description:** “QR code tips, fast, cashless, and tax free.” — technology + benefit
- **`platformLead` (below H1):** “CareTip is the digital tipping platform for hospitality teams — QR code tipping, employee tip management, and secure payouts.” — **explicit category definition**

**Verdict:** A first-time visitor (or crawler executing JS) **can** understand “digital tipping platform” **if they read `platformLead` or meta title** — not from the H1 alone.

**Search engine without JS on `/`:** Static `index.html` title + description + `#caretip-static-summary` **do** communicate digital tipping platform (DE primary, EN paragraph).

### Strong copy zones

- `seo.pages.*` metadata (all indexable routes)
- `landing.showcase.platformLead`
- `/how-it-works` 9-step journey (especially steps 5–8: digital tips, payouts, distribution)
- `/features` landing block: “One connected tipping platform”
- Industry pages: concrete QR + hospitality scenarios
- FAQ: operational answers about QR safety, no guest app, setup speed

### Ambiguous or thin zones

| Area | Issue |
|------|-------|
| Hero H1 | Outcome-first; category deferred to `platformLead` |
| “Tipping app” | Product reality = web QR + optional staff mobile; category term may attract wrong intent |
| “Tip distribution software” | Lived in product/dashboard copy more than marketing |
| `/about` | Founder story; weak category reinforcement |
| Placeholder `/blog`, `/careers`, `/mobile-app` | Would dilute trust if indexed |

### Could a searcher understand “CareTip is a digital tipping platform”?

**Yes** — with high confidence from SEO metadata, `platformLead`, static summary, and `/how-it-works`. **Partially** from hero H1 alone.

---

## 2. Search intent map

Legend: **Coverage** = None / Weak / Moderate / Strong · **Action** = Improve existing / Dedicated page / Defer

### A. Category searches

| Intent | Best existing page | Coverage | Intent match | Action |
|--------|-------------------|----------|--------------|--------|
| tipping app | `/` (weak), `/mobile-app` (noindex placeholder) | **Weak** | **Mismatch** — guests don’t need an app; B2B buyers may still use term | **Improve** `/features` + FAQ gloss (“web-based, no guest app”); **do not** chase app-store intent |
| tipping platform | `/`, `/features` | **Strong** | High | **Maintain** metadata + `platformLead` |
| digital tipping platform | `/`, `/how-it-works` | **Strong** | High | **Maintain**; optional one FAQ entry |
| digital tipping app | Same as tipping app | **Weak** | Mixed | **Defer** dedicated page; clarify web platform in copy |

### B. Restaurant / hospitality searches

| Intent | Best existing page | Coverage | Intent match | Action |
|--------|-------------------|----------|--------------|--------|
| restaurant tipping app | `/industries/gastronomy` | **Moderate** | Medium — “app” wording | **Improve** gastronomy H2/body with “restaurant tipping” naturally |
| restaurant tipping platform | `/industries/gastronomy` | **Moderate–strong** | High | **Improve** industry page + internal links from homepage restaurant marquee |
| hospitality tipping | `/`, `/features`, `/faq` | **Strong** | High | Maintain |
| hotel tipping app | `/industries/hotels` | **Moderate** | Medium | **Improve** hotels copy for “hotel tipping” phrasing |
| digital tipping for restaurants | `/industries/gastronomy`, `/how-it-works` | **Moderate–strong** | High | Improve gastronomy; link from how-it-works |

### C. Technology / use-case searches

| Intent | Best existing page | Coverage | Intent match | Action |
|--------|-------------------|----------|--------------|--------|
| QR code tipping | `/`, `/features`, `/how-it-works`, `/faq` | **Strong** | High | Maintain |
| QR tipping | Same | **Strong** | High | Maintain |
| cashless tipping | `/`, hero, industries | **Strong** | High | Maintain |
| contactless tipping | Hero trust chips (“Contactless tipping”) | **Moderate** | High | Optional synonym in one features bullet |
| digital tip distribution | `/how-it-works` (step 8), dashboard product | **Moderate** | Medium | **Improve** how-it-works + features distribution wording |
| employee tipping software | `/features` (employee dashboards) | **Weak–moderate** | Medium | **Improve** features section — one clear sentence on employee visibility/payouts |
| tip distribution software | Product/dashboard strings only | **Weak** | Medium | **Improve** `/how-it-works` + `/features`; no new URL yet |

### D. Informational searches

| Intent | Best existing page | Coverage | Intent match | Action |
|--------|-------------------|----------|--------------|--------|
| how digital tipping works | `/how-it-works` | **Strong** | High | **Primary informational asset** — link prominently |
| what is QR tipping | `/faq`, `/how-it-works` | **Moderate** | High | Optional FAQ question; defer standalone article |
| how restaurants distribute digital tips | `/how-it-works` (step 8), `/faq` | **Moderate** | High | Strengthen step 8 + FAQ cross-link |
| digital tipping vs cash tipping | **None dedicated** | **Weak** | Medium | **Defer** blog article until content program exists |

---

## 3. Content gap analysis

**Principle:** Reject pages that duplicate `/`, `/how-it-works`, or industry templates.

### Recommended: improve existing pages only (no new URLs required for phase 1)

| Gap | Target intent | Why existing pages insufficient | Unique value to add | Index? |
|-----|---------------|--------------------------------|---------------------|--------|
| Category head terms on hero path | digital tipping platform | H1 is outcome-only | 1–2 sentences in hero support copy (already partially in `platformLead`) | N/A (same URL) |
| Restaurant commercial intent | restaurant tipping platform | Gastronomy page strong but not explicit on “platform” | Short “for restaurants” sub-block + internal links | `/industries/gastronomy` — **yes** |
| Distribution intent | tip distribution / employee tipping | Buried in step 8 | Visible section on `/how-it-works` or `/features` | **yes** — existing URLs |
| Informational long-tail | digital tipping vs cash | No comparison content | **Defer** — needs careful legal/tax tone | Future `/blog/...` only |

### Conditionally justified new pages (phase 2 — only if metrics justify)

| Proposed URL | Target intent | Justification | Reject if |
|--------------|---------------|---------------|-----------|
| `/blog/how-qr-tipping-works` (example) | what is QR tipping | `/how-it-works` + FAQ may saturate | GSC shows impressions on how-it-works already |
| `/blog/digital-tipping-restaurants` | digital tipping for restaurants | Gastronomy + how-it-works may be enough | No unique stats, case studies, or DE legal nuance to add |

**Rejected (would duplicate or harm quality):**

- `/digital-tipping-platform` — duplicates `/`
- `/qr-tipping` — duplicates `/features` + `/how-it-works`
- `/tipping-app` — conflicts with product positioning
- `/tip-distribution-software` — premature without product marketing depth + case studies

---

## 4. Homepage category signal

### Signal checklist

| Signal | Sufficient? | Evidence |
|--------|-------------|----------|
| CareTip = digital tipping platform | **Yes** (supporting copy + meta) | `platformLead`, SEO title, static summary |
| Target customers | **Yes** | “business”, hospitality marquee, CTAs for owners vs staff |
| Hospitality focus | **Yes** | Industries teaser, hospitality sections, copy |
| QR tipping | **Yes** | Hero, steps, showcase |
| Employee tip management | **Moderate** | `platformLead`, audience benefits section |
| Digital / cashless tipping | **Yes** | Hero description, trust chips |
| Payouts / distribution | **Moderate** | Less prominent above fold; stronger below fold / other pages |
| Locations / use cases | **Yes** | Industry showcase, real-life section on landing below fold |

### Recommended copy directions (do not implement here)

Only changes that **materially** improve category clarity:

1. **Optional:** Add one short clause to hero description (not H1) bridging outcome → category — e.g. reinforce “digital tipping platform” **once** where `platformLead` already sits (avoid duplication in adjacent lines).
2. **Below-fold:** Ensure one hospitality section explicitly links to `/how-it-works` with anchor text like “how digital tipping works” (partially present via CTAs).
3. **Do not rewrite H1** to stuff “digital tipping platform” — current outcome H1 is commercially strong; category is covered in `platformLead` + title tag.

---

## 5. Industry pages audit

| Page | Search demand (est.) | Uniqueness | Depth | Metadata | JSON-LD | Thin-content risk | Index? |
|------|---------------------|------------|-------|----------|---------|-------------------|--------|
| `/industries/gastronomy` | **High** (DE/EN restaurant) | High — table QR, waiter pooling | Good — steps, benefits, FAQ | Strong vertical title | BreadcrumbList | **Low** | **Yes — priority** |
| `/industries/hotels` | **High** | High — housekeeping, reception | Good | Strong | BreadcrumbList | Low | **Yes — priority** |
| `/industries/logistics` | **Medium** | High — delivery doorstep | Good | Adequate | BreadcrumbList | Low | **Yes** |
| `/industries/midwives` | **Low–medium** (niche DE) | High — freelance care | Good | Adequate | BreadcrumbList | Low for niche | **Yes** — valid differentiator |
| `/industries/fairs` | **Low–medium** | High — events staff | Good | Adequate | BreadcrumbList | Medium if generic | **Yes** — keep if sales targets events |
| `/industries/field-service` | **Low–medium** | High — trades van QR | Good | Adequate | BreadcrumbList | Low | **Yes** |

**Cross-cutting notes:**

- All six share a solid template (hero, steps, benefits, mini-FAQ, trust row) — **not thin** relative to typical SaaS vertical pages.
- `industries.shared.moreIndustriesTitle` exists in i18n but **cross-industry links are not prominent** in `IndustryPageTemplate` — missed internal linking opportunity (future UX, not this audit).
- Some copy uses strong tax claims (“100% tax-free”) — legal/compliance review separate from SEO; do not amplify in SEO sprint without legal sign-off.

**Do not de-index** any current industry URL without traffic/GSC data showing zero value — all have **distinct** copy and commercial relevance.

---

## 6. Topical authority / content strategy

**Goal:** Small **initial cluster** (3–4 pieces max over time) supporting commercial pages — not a content farm.

| Proposed article (future) | Target intent | Unique value vs existing | Links to | Links from | Create |
|---------------------------|---------------|--------------------------|----------|------------|--------|
| **How QR code tipping works** (guide) | what is QR tipping | Step-by-step guest journey + security; could include diagrams | `/how-it-works`, `/features`, `/signup` | FAQ, gastronomy | **Later** — `/how-it-works` covers 80% today |
| **Digital tipping for restaurants** | digital tipping for restaurants | DE/EU tax context, table QR placement, pooling | `/industries/gastronomy`, `/pricing` | Gastronomy, homepage | **Later** — enhance gastronomy first |
| **Digital tipping for hotels** | hotel tipping | Departments, housekeeping, discreet tipping | `/industries/hotels` | Hotels, FAQ | **Later** |
| **How employees receive digital tips** | employee tipping | Payout flow, Stripe, notifications | `/features`, `/how-it-works` | FAQ | **Phase 2 blog** |
| **Cashless vs cash tipping** | digital tipping vs cash | Honest comparison, hospitality trends | `/`, `/how-it-works` | Blog index | **Defer** — needs legal nuance |
| **How restaurants manage tip distribution** | tip distribution | Manager workflows, audit trail | `/how-it-works`, `/features` | How-it-works | **Phase 2** — or expand step 8 |

**Create now:** **None** — strengthen existing URLs first.

**First blog when ready:** **“How employees receive digital tips”** or **restaurant guide** — tied to sales motion, not abstract SEO.

---

## 7. Internal link authority

### Current link graph (simplified)

```
index.html static summary ──► /features, /pricing, /how-it-works, /faq, /contact

Homepage (React)
  ├── Nav ──► /features, /pricing, /faq, /contact, /industries/*
  ├── Industry showcase/grid ──► /industries/*
  ├── CTAs ──► /how-it-works, /signup, /pricing
  └── Footer ──► product, industries, about, contact, legal

/how-it-works ◄── footer, CTAs, static summary (NOT main nav)
/about ◄── footer only
/faq ◄── nav, static summary (NOT footer)
/industries/* ◄── nav, footer, homepage (strong)
```

### Commercial page link sufficiency

| Page | Inbound strength | Gap |
|------|------------------|-----|
| `/` | Hub | — |
| `/features` | Strong | — |
| `/pricing` | Strong | — |
| `/how-it-works` | Moderate | Not in main nav |
| `/faq` | Moderate | Missing footer link |
| `/industries/*` | Strong | Weak cross-links between industries |
| `/about` | Weak | Footer only |

### Simple linking opportunities (future, no code in this audit)

1. Footer → `/faq`
2. `/how-it-works` → `/industries/gastronomy` + `/industries/hotels` in body copy
3. `/features` → `/how-it-works` with “how digital tipping works” anchor
4. Industry template → “Explore other industries” block (i18n already exists)
5. FAQ answers → deep link to relevant industry pages where natural

---

## 8. External authority requirements

**Category-level terms** (e.g. “digital tipping platform”, “restaurant tipping app”) typically require **off-site signals** CareTip cannot manufacture in code:

| Opportunity type | Realistic for CareTip | Notes |
|------------------|----------------------|-------|
| **Customer case studies** | **High value** | Restaurants/hotels with named outcomes (tip volume, staff satisfaction) |
| **Hospitality media (DE)** | **High** | Gastronomie/hotel trade press, POS/hospitality tech blogs |
| **Stripe / payments ecosystem** | **Medium** | Partner pages, marketplace listings if applicable |
| **Product directories** | **Medium** | Curated B2B SaaS/hospitality tech lists (quality over quantity) |
| **German startup/company profiles** | **Medium** | Berlin startup ecosystem, Handelsregister-linked profiles |
| **Industry associations** | **Low–medium** | DEHOGA-class bodies — relationship-dependent |
| **Integrations / POS partners** | **Medium** | When real integrations exist |
| **Founder interviews / podcasts** | **Medium** | About page story supports this |

**Explicitly out of scope:** paid link schemes, PBNs, mass directories, keyword-stuffed guest posts.

**Reality:** CareTip can be **technically indexable and semantically clear** yet still **not rank** on head terms without **earned mentions, reviews, and customer proof**.

---

## 9. Brand / entity signals

### Consistent today

| Signal | Value |
|--------|-------|
| Product name | **CareTip** (dominant) |
| Legal entity | **CareTip UG**, Berlin (imprint) |
| Website | **https://caretip.de** |
| Category | Digital tipping / hospitality platform (metadata + copy) |
| Social | Instagram `@caretipde`, Facebook, TikTok (`caretipSocialLinks.ts`) |

### Inconsistencies (minor)

| Issue | Where | SEO impact |
|-------|-------|------------|
| “Caretip” vs “CareTip” | Privacy intro (`Caretip`), some blog/careers hardcoded strings | Low — normalize over time |
| Organization JSON-LD | Minimal — no `sameAs` to social profiles | Low–medium entity clarity |
| LinkedIn | Empty unless `VITE_SOCIAL_LINKEDIN_URL` set | Missed B2B entity signal |
| `/mobile-app` claims “Mobile Apps Available” with inert download buttons | Placeholder page (noindex) | None while noindex |

**Do not invent** register numbers or VAT IDs left blank in imprint i18n.

---

## 10. Google Search Console readiness

### Configure / submit

| Item | Action |
|------|--------|
| Property | Add **Domain** or **URL-prefix** `https://caretip.de` |
| Ownership | DNS or HTML verification |
| Sitemap | Submit `https://caretip.de/sitemap.xml` |
| URL inspection | Test `/`, `/features`, `/industries/gastronomy`, `/faq`, `/login` (noindex check) |

### Monitor (weekly → monthly)

| Report | What to learn |
|--------|---------------|
| **Pages indexing** | Which of 19 URLs indexed; soft 404 noise |
| **Search results** | Queries: digital tipping, QR tipping, restaurant tipping, CareTip brand |
| **Impressions / clicks / CTR / position** | Category term traction — **only evidence of visibility progress** |
| **Core Web Vitals** | Mobile LCP (likely poor in lab — see §11) |
| **Rich results** | FAQPage eligibility on `/faq` |
| **Manual actions / security** | Should be none |

### Generative / AI search (where available)

- Monitor branded queries and referral traffic separately
- No claim of AI overview inclusion without data

**Unknown without GSC:** actual rankings, index coverage %, query share for category terms.

---

## 11. Technical SEO (category visibility blockers only)

| Area | Status | Blocks category visibility? |
|------|--------|----------------------------|
| robots.txt / sitemap | **Pass** | No |
| Crawlability of 19 URLs | **Pass** | No |
| JS-rendered metadata | **Pass** (post-reconciliation) | No |
| Canonical / robots duplicates | **Fixed** | No |
| Internal discovery | **Adequate** | Minor — not a blocker |
| HTTP 200 soft 404 | **Partial** | **Low** blocker with noindex |
| Mobile LCP ~15.2s (lab, forensic audit) | **Poor** | **Moderate** — UX/ranking signal, not crawl blocking |
| hreflang | Not implemented | **Not a blocker** at current stage |

**Conclusion:** No remaining technical issue **materially prevents** Google from crawling, indexing, and understanding CareTip’s category positioning.

---

## 12. Prioritization

### P0 — Search/indexing blockers

**None identified** post Sprint 1 + head reconciliation.

### P1 — High-value category visibility

| ID | Recommendation | Expected benefit | Complexity | Content effort | Maintenance | Dependency | Risk |
|----|----------------|------------------|------------|----------------|-------------|------------|------|
| P1-1 | **GSC live + sitemap** | Measurement baseline | Low | None | Low | DNS access | None |
| P1-2 | **Strengthen `/industries/gastronomy` + `/hotels`** for “restaurant/hotel tipping” phrasing | Vertical SERP relevance | Low | **Small** copy | Low | Marketing/legal for tax claims | Overclaiming |
| P1-3 | **Expand distribution narrative on `/how-it-works` + `/features`** | tip distribution / employee tipping intents | Low | **Small** | Low | Product accuracy | Jargon |
| P1-4 | **Internal links** (footer FAQ, industry cross-links, features↔how-it-works) | PageRank flow to commercial URLs | Low | None | Low | UX review | Nav clutter |
| P1-5 | **1–2 customer case studies (off-site + on-site quotes)** | Authority for category terms | Medium | **Medium** | Per customer | Customer consent | None |
| P1-6 | **Mobile LCP improvement** (separate perf sprint) | CWV / engagement | Medium–high | N/A | Ongoing | Engineering | Regression |

### P2 — Useful later

- Organization `sameAs` social URLs in JSON-LD
- First real blog article (employee tips or restaurant guide)
- `/about` title + category sentence
- EN locale production spot-check
- Curated DE hospitality/tech directory listings

### P3 — Do not currently pursue

- SSR/prerender for marketing routes
- hreflang / locale URLs
- Index `/blog`, `/careers`, `/mobile-app` placeholders
- Dedicated `/tipping-app` landing
- Mass informational articles
- Buying links / spam directories
- Page-specific OG images for every route

---

## 13. Final recommendation

### A. BUILD NOW

*(Smallest set with material category impact — mostly copy, links, ops; no architecture change)*

1. **Submit sitemap + configure GSC** — without this, category progress is invisible.
2. **Targeted copy additions** on **`/industries/gastronomy`**, **`/industries/hotels`**, and **`/how-it-works`** for restaurant/hotel tipping and tip distribution language (natural, not stuffed).
3. **Internal links:** footer → `/faq`; contextual links between `/features` ↔ `/how-it-works` ↔ top industries.
4. **Keep placeholder routes noindex.**

### B. CREATE CONTENT NEXT

1. **First real case study** (restaurant or hotel) — unique proof, linkable asset.
2. **One blog article** when `/blog` is ready for indexing — prefer **“How employees receive digital tips”** or **“Digital tipping for restaurants (DE)”** over generic glossary posts.
3. **Defer** cash-vs-digital comparison until legal review.

### C. BUILD AUTHORITY

1. Publish **customer stories** on site + pitch to **hospitality trade media (DE)**.
2. Pursue **curated** listings (hospitality tech, Stripe ecosystem) — not mass submission.
3. **Founder/company profiles** consistent with imprint (CareTip UG, Berlin).
4. Encourage **organic social** (`@caretipde`) — entity signals, not link spam.

### D. MEASURE

In **Google Search Console** (minimum 4–8 weeks after sitemap):

| Metric | Category terms to watch |
|--------|-------------------------|
| Impressions | digital tipping, tipping platform, QR tipping, restaurant tipping, hotel tipping, Trinkgeld digital (DE) |
| Clicks & CTR | Same + branded “CareTip” |
| Average position | Track trend, not absolute promises |
| Indexed pages | 19 sitemap URLs |
| FAQ rich results | `/faq` |
| Core Web Vitals | Mobile LCP on `/` |

Supplement with: branded analytics, referral traffic from PR/directories, manual spot checks of rendered `<head>` after deploys.

---

## Appendix: Target keyword ↔ page quick reference

| Keyword cluster | Primary URL(s) | Secondary |
|-----------------|----------------|-----------|
| digital tipping platform | `/` | `/features`, `/how-it-works` |
| tipping platform | `/`, `/features` | `/pricing` |
| QR code / QR tipping | `/`, `/features`, `/how-it-works` | `/faq` |
| cashless / contactless tipping | `/`, `/industries/*` | `/faq` |
| restaurant tipping | `/industries/gastronomy` | `/how-it-works` |
| hotel tipping | `/industries/hotels` | `/how-it-works` |
| hospitality tipping | `/`, `/features` | industries |
| employee tipping / tip management | `/features` | `/how-it-works`, `/faq` |
| tip distribution | `/how-it-works` | `/features` |
| tipping app | **Weak fit** — clarify web platform | `/faq` (“no guest app”) |

---

*Read-only audit. No application code was modified. `npm run test:seo-remediation` — ok (sanity check).*
