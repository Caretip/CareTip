/**
 * CareTip typography tokens.
 *
 * Sizes live in `src/styles/caretip-typography.css` (`--caretip-*` / `--type-*`).
 *
 * Role scale:
 * Display | H1 | H2 | H3 | H4 | Large Body | Body | Small Body |
 * Caption | Button | Label | Input | Helper | Badge | Overline
 *
 * @see docs/TYPOGRAPHY_SCALE.md
 */
export const caretipType = {
  sans: "font-sans",

  /** Display — marketing hero only (Manrope). */
  heroTitle:
    "font-hero-display text-hero-title font-bold text-balance text-neutral-950 dark:text-neutral-50",
  heroTitleDe:
    "font-hero-display text-hero-title-de font-bold text-balance text-neutral-950 dark:text-neutral-50",
  /** Marketing section = H2-scale display. */
  sectionTitle:
    "font-sans text-section-title font-semibold text-balance text-neutral-950 dark:text-neutral-50",
  /** H1 — app / dashboard page titles. */
  appTitle:
    "font-sans text-app-title font-bold text-neutral-950 dark:text-neutral-50",
  /** H2 — page subtitles / module titles. */
  appSubtitle:
    "font-sans text-app-subtitle font-semibold text-neutral-900 dark:text-neutral-50",
  /** H3 — cards, dialogs. */
  cardTitle:
    "font-sans text-card-title font-semibold text-neutral-900 dark:text-neutral-50",
  /** H4 — dense subsection titles. */
  h4: "font-sans text-feature-copy font-semibold text-neutral-900 dark:text-neutral-50",

  /** Large Body — leads, hero descriptions. */
  largeBody:
    "font-sans text-large-body font-normal text-pretty text-neutral-600 dark:text-neutral-400",
  /** Body — default reading. */
  bodyCopy:
    "font-sans text-body-copy font-normal text-pretty text-neutral-600 dark:text-neutral-400",
  bodyCopyMuted:
    "font-sans text-body-copy font-normal text-pretty text-neutral-600 dark:text-neutral-400",
  /** Feature / emphasis line (between body and small body). */
  featureCopy:
    "font-sans text-feature-copy font-medium text-neutral-900 dark:text-neutral-50",
  featureCopySemibold:
    "font-sans text-feature-copy font-semibold text-neutral-900 dark:text-neutral-50",
  /** Small Body — dense UI paragraphs, card/dialog descriptions. */
  smallBody:
    "font-sans text-small-body font-normal text-pretty text-muted-foreground",
  caption: "font-sans text-caption font-normal",
  buttonText: "font-sans text-button-text font-semibold",
  /** Form labels — slightly stronger than caption. */
  label: "font-sans text-label font-semibold text-foreground",
  /** Inputs — match body size for readability. */
  input: "font-sans text-type-input font-normal text-foreground",
  /** Helper / field hints / validation (secondary). */
  helper: "font-sans text-helper font-medium text-muted-foreground",
  /** Badge / chip chrome (11px). */
  badge: "font-sans text-badge font-semibold",
  /** Overline / eyebrow. */
  overline:
    "font-sans text-overline font-semibold uppercase tracking-widest text-neutral-800 dark:text-neutral-200",
  tagline:
    "font-sans text-tagline font-semibold uppercase tracking-widest text-neutral-800 dark:text-neutral-200",
  meta: "font-sans text-meta font-semibold uppercase text-neutral-500 dark:text-neutral-400",
  pill: "font-sans text-meta font-semibold uppercase",
  micro: "font-sans text-micro font-semibold uppercase",

  /** Dashboard KPI label — 11px (`text-kpi-label`), uppercase in layout. */
  kpiLabel: "font-sans text-kpi-label font-medium uppercase tracking-wide text-muted-foreground",
  /**
   * Dashboard KPI value — uses Tailwind theme steps (no custom utility size).
   * @see src/styles/tailwind.css `--text-lg` / `--text-xl` / `--text-2xl`
   */
  kpiValue:
    "shrink-0 hyphens-auto break-words text-balance text-lg font-bold tabular-nums leading-snug text-foreground sm:text-xl md:text-2xl",
} as const;

/**
 * Semantic role aliases — preferred names for new code and audits.
 */
export const type = {
  display: caretipType.heroTitle,
  displayDe: caretipType.heroTitleDe,
  displayHero: caretipType.heroTitle,
  displayHeroDe: caretipType.heroTitleDe,
  h1: caretipType.appTitle,
  h2: caretipType.appSubtitle,
  h3: caretipType.cardTitle,
  h4: caretipType.h4,
  section: caretipType.sectionTitle,
  appTitle: caretipType.appTitle,
  appSubtitle: caretipType.appSubtitle,
  cardTitle: caretipType.cardTitle,
  largeBody: caretipType.largeBody,
  body: caretipType.bodyCopy,
  bodyMuted: caretipType.bodyCopyMuted,
  smallBody: caretipType.smallBody,
  feature: caretipType.featureCopy,
  featureSemibold: caretipType.featureCopySemibold,
  caption: caretipType.caption,
  button: caretipType.buttonText,
  label: caretipType.label,
  input: caretipType.input,
  helper: caretipType.helper,
  badge: caretipType.badge,
  overline: caretipType.overline,
  tagline: caretipType.tagline,
  meta: caretipType.meta,
  micro: caretipType.micro,
  kpiLabel: caretipType.kpiLabel,
  kpiValue: caretipType.kpiValue,
} as const;

/** @deprecated Use `caretipType` — kept for landing imports */
export const landingType = {
  display: caretipType.sans,
  body: caretipType.sans,
  heroHeadline: caretipType.heroTitle,
  heroHeadlineDe: caretipType.heroTitleDe,
  sectionHeadline: caretipType.sectionTitle,
  bodyLead: caretipType.largeBody,
  bodyLeadMuted: caretipType.largeBody,
  cardTitle: caretipType.cardTitle,
  featureTitle: caretipType.cardTitle,
  featureCopy: caretipType.featureCopy,
  featureCopySemibold: caretipType.featureCopySemibold,
  bodyCopyMuted: caretipType.bodyCopyMuted,
  featureLine: caretipType.featureCopy,
  featureBody: caretipType.bodyCopyMuted,
  pill: caretipType.pill,
  tagline: caretipType.tagline,
  meta: caretipType.meta,
  cta: caretipType.buttonText,
  ctaBold: `${caretipType.buttonText} font-bold`,
} as const;
