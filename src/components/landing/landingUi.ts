import { landingType } from "@/components/landing/landingTypography";
import {
  caretipBtnPrimary,
  caretipBtnPrimaryCompact,
  caretipBtnSecondary,
} from "@/lib/caretipButtonSystem";

/** True when landing copy should render (non-empty after trim). */
export function landingCopyVisible(text: string | undefined): boolean {
  return Boolean(text?.trim());
}

/** Company CTA orange gradient — hero keyword + section headline emphasis. */
const brandAccentGradient =
  "caretip-hero-headline-accent bg-gradient-to-r from-[#ff9e2d] via-[#e9781c] to-[#d96810] bg-clip-text text-transparent dark:from-[#ffb04a] dark:via-[#e9781c] dark:to-[#ff9e2d]";

/**
 * Landing page design system — layout, spacing, typography (TipJar-inspired rhythm).
 *
 * Typography: Inter (UI/body); Roboto for landing hero/section H1–H2
 * via `font-hero-display` (see caretip-landing-trickyfresh-redesign.css).
 * Responsive rules:
 * - Phone (<md): left-aligned hero; centered section intros below lg
 * - clamp()-based type scale in `caretip-typography.css`
 */

/** Hero headline — Roboto display scale (weight refined in redesign CSS). */
const heroHeadlineTone =
  "font-hero-display font-medium text-foreground max-lg:text-left max-lg:text-wrap lg:text-pretty antialiased";
/** Below lg — size/rhythm from caretip-landing-hero.css */
const heroHeadlineMobile = "max-lg:tracking-[inherit]";
/** Desktop scale — fluid sizes in caretip-landing-hero.css */
const heroHeadlineDesktop = "caretip-hero-headline-desktop";

function cnHeroHeadline(layout: string) {
  return `${heroHeadlineTone} ${heroHeadlineMobile} ${heroHeadlineDesktop} ${layout}`;
}
/** Shared intro/lead copy — hero subtitle + section taglines. */
const landingLeadCopy =
  "font-sans text-body-copy font-normal text-pretty tracking-[-0.01em] leading-[1.62] text-muted-foreground";
function cnHeroSubtitle(layout: string) {
  return `${landingLeadCopy} ${layout}`;
}

/** Clears fixed nav + light breathing room (full-bleed hero; heavy pad lives in redesign CSS). */
const heroSectionPadTop =
  "max-lg:pt-[calc(5rem+env(safe-area-inset-top,0px))] max-lg:pb-3 lg:pt-[5.75rem] lg:pb-8 xl:pb-9";
/** Mobile-first stack rhythm between headline, lead, actions, and mockup. */
const heroStackGapMobile = "mt-6 md:mt-7";
/** Tighter gap above product shot on stacked mobile hero */
const heroStackGapMediaMobile = "max-md:mt-6";
/** Section H2 — premium weight + tight tracking (size from text-section-title). */
function cnSectionHeadline(layout: string) {
  return `font-sans text-section-title font-bold tracking-tight leading-[1.2] text-balance text-neutral-950 dark:text-neutral-50 ${layout}`;
}
/** Tagline / intro paragraph under section headlines — readable, not tiny. */
function cnSectionLead(layout: string) {
  return `${landingLeadCopy} ${layout}`;
}

/** Soft radial depth behind badge + H2 only (see caretip-landing-unified-polish.css). */
const sectionHeaderGroup = "caretip-landing-section-header relative";
/** Centered / split section intro — eyebrow → headline → lead rhythm. */
const sectionIntroStack =
  "caretip-section-intro flex w-full flex-col items-center space-y-0 px-0.5 text-center";
const sectionIntroChildRhythm =
  "[&>[data-landing-accent]]:mb-0 [&>h2]:mt-3.5 [&>h2:first-child]:mt-0 [&>div~h2]:mt-4 [&>motion.div]:mt-7 sm:[&>motion.div]:mt-8 [&>motion.div~*]:mt-0 [&>div.flex]:mt-7 sm:[&>div.flex]:mt-8";
/** Narrower centered body copy — ~55–65 character measure for effortless scanning. */
const sectionLeadReadable =
  "mx-auto w-full max-w-[min(100%,36rem)] sm:max-w-[min(100%,38rem)]";
function cnBodyLead(layout: string) {
  return `${landingType.bodyLead} ${layout}`;
}
function cnBodyLeadMuted(layout: string) {
  return `${landingType.bodyLeadMuted} ${layout}`;
}
function cnCardTitle(layout: string) {
  return `${landingType.cardTitle} ${layout}`;
}
function cnFeatureTitle(layout: string) {
  return `${landingType.featureTitle} ${layout}`;
}
function cnCtaPrimary(layout: string) {
  return `${landingType.cta} ${layout}`;
}
function cnCtaBold(layout: string) {
  return `${landingType.ctaBold} ${layout}`;
}
function cnCta(layout: string) {
  return `${landingType.cta} ${layout}`;
}

/**
 * Landing CTA footprint — one size for hero + every landing section/final button.
 * Height matches the label (text-sm / 0.9375rem); do not drift above or below.
 */
const landingCtaSize =
  "h-10 min-h-10 lg:h-11 lg:min-h-11 px-5 lg:px-6 text-sm lg:text-[0.9375rem] font-semibold";
const heroCtaPrimarySize = `${landingCtaSize} max-lg:min-w-[11.5rem] max-lg:max-w-[min(100%,16.5rem)] lg:min-w-[12.5rem]`;
const sectionCtaSize = landingCtaSize;
const sectionCtaWidth = "w-full min-w-0 max-w-full";
/** Showcase / legacy primary row — same height as hero, slightly wider min. */
const ctaPrimarySize = `${landingCtaSize} max-lg:min-w-[11.5rem] max-lg:max-w-[min(100%,17.5rem)] lg:min-w-[12.5rem]`;

export const landingUi = {
  /** Section surface — background from caretip-landing-section-flow.css (light). */
  landingSurface: "caretip-landing-surface relative",
  sectionShell: "mx-auto w-full min-w-0 max-w-7xl",
  section:
    "scroll-mt-[80px] w-full min-w-0 overflow-x-hidden px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-28",
  sectionMuted: "caretip-landing-surface relative bg-secondary/30 dark:bg-secondary/20",
  sectionWhite: "caretip-landing-surface relative",

  /** Eyebrow → headline → tagline stack (centered sections). */
  sectionIntro: `${sectionHeaderGroup} ${sectionIntroStack} ${sectionIntroChildRhythm} mb-12 w-full max-w-full sm:mb-14 lg:mb-16`,
  sectionAfterIntro: "mb-12 sm:mb-14 lg:mb-16",

  /** Mobile: intro (headline+tagline) → visual → after. Desktop unchanged. */
  mobileStackGrid: "caretip-landing-mobile-stack",
  mobileStackFlatten: "caretip-mobile-stack-flatten max-lg:contents",
  mobileStackIntro: "caretip-mobile-stack-intro w-full max-lg:items-center max-lg:text-center",
  mobileStackTagline: "caretip-mobile-stack-tagline",
  mobileStackVisual: "caretip-mobile-stack-visual",
  mobileStackAfter: "caretip-mobile-stack-after",
  mobileSectionHeadline: "caretip-mobile-section-headline",
  mobileStackCard: "caretip-landing-mobile-stack-card",
  /** Real-life scenario cards — mobile polish hooks (desktop unchanged). */
  realLifeCard: "caretip-real-life-card",
  realLifeCardIntro: "caretip-real-life-card-intro",
  realLifeCardTitle: "caretip-real-life-card-title font-bold",
  realLifeCardImage: "caretip-real-life-card-image",
  realLifeCardBody: "caretip-real-life-card-body",

  splitGrid:
    "caretip-split-section-grid caretip-landing-mobile-stack mx-auto grid w-full min-w-0 max-w-7xl grid-cols-1 items-start gap-8 overflow-x-hidden max-lg:gap-0 sm:gap-0 lg:grid-cols-2 lg:items-start lg:gap-16 xl:gap-[4.5rem]",
  copyColumn:
    "caretip-mobile-stack-flatten flex w-full min-w-0 flex-col items-start text-left max-lg:contents max-lg:text-center lg:max-w-none",
  visualColumn:
    "caretip-mobile-stack-visual flex w-full min-w-0 max-w-full flex-col items-center justify-center max-lg:mx-auto lg:order-none",

  /** Row of section eyebrows (dot + label). */
  sectionAccentRow:
    "flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 max-lg:justify-center lg:justify-start",
  /** Premium section eyebrow — glowing dot + text only. */
  sectionAccent:
    "relative inline-flex w-fit items-center gap-2 max-lg:mx-auto lg:mx-0",
  sectionAccentMuted:
    "relative inline-flex w-fit items-center gap-2 max-lg:mx-auto lg:mx-0",
  sectionAccentDot:
    "h-1.5 w-1.5 shrink-0 rounded-full bg-[#e9781c] shadow-[0_0_0_3px_rgba(233,120,28,0.16)]",
  sectionAccentText:
    "text-xs font-medium tracking-normal text-muted-foreground",
  sectionAccentTextMuted:
    "text-xs font-medium tracking-normal text-muted-foreground",
  /** Feature-card label (not a section eyebrow). */
  sectionAccentCompact: "relative inline-flex w-fit items-center max-lg:mx-auto lg:mx-0",
  sectionAccentTextCompact:
    "text-[11px] font-medium tracking-normal text-muted-foreground",
  sectionAccentIcon:
    "h-3 w-3 shrink-0 text-primary caretip-brand-accent-icon",
  sectionAccentIconMuted:
    "h-3 w-3 shrink-0 text-muted-foreground/80",
  sectionAccentGlow:
    "pointer-events-none absolute -inset-x-3.5 -inset-y-1.5 -z-10 hidden",
  sectionAccentLine:
    "h-px w-6 shrink-0 bg-gradient-to-r from-primary/60 via-primary/35 to-transparent",
  brandAccentIconWrap:
    "caretip-brand-accent-icon inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",

  copyStack: `${sectionHeaderGroup} caretip-copy-stack flex w-full flex-col items-start max-lg:items-center max-lg:text-center lg:items-start lg:text-left ${sectionIntroChildRhythm}`,
  eyebrowSecondary: cnSectionLead(
    `${sectionLeadReadable} text-muted-foreground max-lg:text-center sm:text-left lg:mx-0 lg:max-w-md lg:text-left`,
  ),
  headline: cnSectionHeadline(
    "caretip-mobile-section-headline mx-auto max-w-[min(100%,22ch)] text-center max-lg:px-0 max-md:max-w-[min(100%,24ch)] lg:mx-0 lg:max-w-[26ch] lg:text-left",
  ),
  subtitle: cnSectionLead(
    `caretip-mobile-stack-tagline ${sectionLeadReadable} text-center max-lg:px-0 lg:mx-0 lg:max-w-md lg:text-left`,
  ),
  cardFeatureBody: `${landingType.featureBody} mt-2 leading-snug sm:mt-2.5 text-muted-foreground`,
  /** In-card body / quote — same scale as hero subtitle & section leads. */
  cardBodyLead: cnSectionLead("text-left"),
  cardCopyStack: "flex flex-col gap-2.5 text-left sm:gap-3",

  benefitList: "caretip-landing-benefit-list w-full space-y-4 max-lg:mt-1 max-lg:space-y-3.5 sm:space-y-4 lg:space-y-[1.125rem]",
  /** Section CTAs — premium centered width on sm+; full width on xs. */
  cta: cnCtaPrimary(
    `${caretipBtnPrimary} caretip-section-cta-button no-underline ${sectionCtaSize} ${sectionCtaWidth}`,
  ),

  sectionTitle: cnSectionHeadline(
    "mx-auto max-w-[min(100%,22ch)] text-center max-lg:px-0 max-md:max-w-[min(100%,24ch)] sm:max-w-2xl lg:max-w-3xl",
  ),
  sectionSubtitle: cnSectionLead(
    `${sectionLeadReadable} text-center max-lg:px-0`,
  ),

  showcaseSection:
    "caretip-landing-surface scroll-mt-[80px] relative w-full min-w-0 overflow-x-clip px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-28",
  showcaseSectionToneWarm: "caretip-showcase-section-tone-warm",
  showcaseSectionToneMuted: "caretip-showcase-section-tone-muted",
  showcaseGrid:
    "caretip-split-section-grid caretip-landing-mobile-stack relative mx-auto grid w-full min-w-0 max-w-7xl grid-cols-1 items-start gap-8 overflow-x-clip max-lg:gap-0 sm:gap-0 lg:grid-cols-2 lg:items-start lg:gap-16 xl:gap-[4.5rem]",
  showcaseCopy:
    "caretip-mobile-stack-flatten flex w-full min-w-0 max-w-xl flex-col items-start max-lg:contents max-lg:mx-auto lg:max-w-2xl lg:items-start lg:text-left lg:self-start lg:caretip-split-showcase-content-panel lg:caretip-split-showcase-content-panel--copy",
  showcaseIntro: `${sectionHeaderGroup} caretip-mobile-stack-intro flex w-full flex-col items-start max-lg:items-center max-lg:text-center lg:items-start lg:text-left ${sectionIntroChildRhythm}`,
  showcaseHeadline: cnSectionHeadline(
    "caretip-mobile-section-headline mx-auto max-w-[min(100%,22ch)] text-center max-lg:px-0 max-md:max-w-[min(100%,24ch)] lg:mx-0 lg:max-w-[26ch] lg:text-left",
  ),
  showcaseHeadlineAccent: `mt-1 block font-bold tracking-tight ${brandAccentGradient} max-md:mt-1 sm:mt-1.5 lg:mt-2`,
  showcaseSubtitle: cnSectionLead(
    `caretip-mobile-stack-tagline ${sectionLeadReadable} text-center max-lg:px-0 lg:mx-0 lg:max-w-md lg:text-left`,
  ),
  showcaseActionCluster:
    "caretip-showcase-action-cluster mt-5 flex w-full min-w-0 flex-col max-lg:items-start lg:mx-0 lg:max-w-none",
  showcaseBenefitsPanel:
    "caretip-hospitality-feature-panel caretip-landing-feature-rhythm w-full flex flex-col gap-7 sm:gap-9",
  showcaseBenefits: "mt-0 w-full max-lg:self-start",
  showcaseCta: cnCtaPrimary(
    `${caretipBtnPrimary} caretip-cta-primary caretip-section-cta-button mt-0 inline-flex self-start transition-[transform,box-shadow,background-color] duration-200 active:scale-[0.99] lg:inline-flex ${ctaPrimarySize}`,
  ),
  showcaseVisualCol:
    "flex w-full min-w-0 max-w-full flex-col items-center justify-center max-lg:max-w-lg lg:max-w-none lg:justify-self-center",
  showcaseVisualGlow: "hidden",
  showcaseVisualFrame:
    "caretip-showcase-visual-frame relative mx-auto w-full overflow-hidden rounded-lg border border-border bg-card",
  showcaseVisualImg: "aspect-[5/4] w-full object-cover",

  visualFrame:
    "mx-auto w-full overflow-hidden rounded-lg border border-border bg-card sm:rounded-xl",
  visualImgContain:
    "mx-auto block h-auto max-h-[min(40vh,320px)] w-full max-w-full object-contain object-center sm:max-h-[min(48vh,420px)] lg:max-h-none",

  hospitalitySection:
    "caretip-landing-surface scroll-mt-[80px] w-full min-w-0 overflow-x-hidden px-4 sm:px-6 lg:px-8",
  hospitalityIntro: `${sectionHeaderGroup} ${sectionIntroStack} ${sectionIntroChildRhythm} w-full min-w-0`,
  hospitalityTitle: cnSectionHeadline("caretip-mobile-section-headline w-full min-w-0"),
  hospitalitySubtitle: cnSectionLead("w-full min-w-0 text-muted-foreground"),
  hospitalityGrid: "w-full min-w-0",

  heroSectionCinematic: heroSectionPadTop,
  heroShell:
    "mx-auto relative z-[1] grid w-full min-w-0 max-w-7xl grid-cols-1 gap-9 overflow-x-hidden px-4 pb-8 pt-6 max-md:gap-y-0 sm:gap-10 sm:px-6 sm:pb-10 md:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] md:items-center md:gap-x-6 md:gap-y-0 md:px-8 md:pb-12 md:pt-7 lg:gap-x-7 xl:gap-x-8",
  heroCopy:
    "caretip-hero-copy-block relative z-10 order-1 flex min-w-0 w-full max-w-full flex-col items-start text-left max-md:space-y-0 max-md:pt-0 md:max-w-[540px] md:space-y-0",
  heroTagline:
    "caretip-hero-brand-tagline caretip-hero-message__tagline inline-flex w-fit max-w-full items-center gap-2.5 text-left",
  heroTaglineText:
    "caretip-hero-brand-tagline__text font-sans font-medium text-[0.8125rem] leading-snug tracking-normal text-primary dark:text-primary sm:text-[0.875rem]",
  heroTaglineAccent:
    "caretip-hero-brand-tagline__accent size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_rgba(233,120,28,0.16)]",
  heroHeadline: cnHeroHeadline(
    "caretip-hero-headline caretip-hero-headline-anchor w-full antialiased text-left max-lg:mx-0",
  ),
  /** @deprecated Use heroHeadline — kept for FeatureShowcase cinematic variant */
  heroHeadlineEn: cnHeroHeadline(
    "caretip-hero-headline caretip-hero-headline--en caretip-hero-headline-anchor w-full antialiased text-left max-lg:mx-auto lg:mx-0 lg:max-w-[30ch] xl:max-w-[32ch]",
  ),
  /** @deprecated Use heroHeadline — kept for FeatureShowcase cinematic variant */
  heroHeadlineDe: cnHeroHeadline(
    "caretip-hero-headline caretip-hero-headline--de caretip-hero-headline-anchor w-full antialiased text-left max-lg:mx-0",
  ),
  /** Hero animated keyword — same gradient as section accents (see `.caretip-hero-headline-accent`). */
  heroHeadlineEmphasis: `font-inherit font-medium italic max-lg:tracking-[inherit] ${brandAccentGradient}`,
  heroHeadlineLine:
    "caretip-hero-headline-line block text-foreground max-lg:[&:not(:first-child)]:mt-0 [&:not(:first-child)]:mt-1 md:[&:not(:first-child)]:mt-1.25 lg:[&:not(:first-child)]:mt-1",
  heroSubtitle: cnHeroSubtitle(
    "caretip-hero-subtitle w-full text-left",
  ),
  heroActionCluster:
    `relative z-10 flex w-full flex-col items-start ${heroStackGapMobile} max-md:gap-0 max-md:pb-0 md:!mt-4 md:max-w-none md:gap-4`,
  heroBenefits:
    "caretip-hero-benefits !mt-0 w-full",
  heroTrust:
    "caretip-hero-trust",
  heroCtaRow:
    "caretip-hero-cta-row caretip-landing-cta-row relative z-10 flex w-full flex-col gap-2 [&_a]:no-underline max-lg:items-start max-lg:justify-start lg:items-start",
  heroCtaUnit:
    "caretip-hero-cta-unit caretip-landing-cta-unit flex w-full max-w-[min(100%,18.5rem)] flex-col items-stretch gap-0.5 max-lg:mx-0 lg:max-w-[16.5rem]",
  heroCtaHint:
    "caretip-hero-cta-hint caretip-landing-cta-hint w-full text-center text-[10px] font-medium leading-[1.25] tracking-[0.02em] text-muted-foreground sm:text-[11px] sm:leading-[1.3]",
  sectionCtaCluster:
    "caretip-landing-section-cta flex w-full max-lg:justify-center lg:justify-start",
  sectionCtaUnit:
    "caretip-landing-cta-unit caretip-landing-cta-unit--section flex w-full max-w-[min(100%,17.5rem)] flex-col items-stretch sm:min-w-[16.25rem] sm:max-w-[18.75rem] sm:w-[17.5rem]",
  sectionCtaPrimary: cnCtaPrimary(
    `${caretipBtnPrimary} caretip-section-cta-button inline-flex items-center justify-center text-center no-underline ${sectionCtaSize} ${sectionCtaWidth}`,
  ),
  sectionCtaSecondary: cnCta(
    `${caretipBtnSecondary} caretip-section-cta-button inline-flex items-center justify-center gap-1.5 text-center no-underline ${sectionCtaSize} ${sectionCtaWidth}`,
  ),
  heroCtaPrimary: cnCtaPrimary(
    `${caretipBtnPrimary} caretip-hero-cta-button w-full min-w-0 items-center justify-center text-center no-underline ${heroCtaPrimarySize} max-lg:mx-0 max-lg:max-w-[min(100%,16.5rem)] lg:max-w-none`,
  ),
  navCtaPrimary: cnCtaPrimary(`${caretipBtnPrimaryCompact} no-underline`),
  heroCtaSecondary: cnCta(
    `${caretipBtnSecondary} caretip-hero-cta-button w-full min-w-0 items-center justify-center gap-1.5 text-center no-underline ${ctaPrimarySize} max-lg:mx-0 max-lg:max-w-[min(100%,17.5rem)] lg:max-w-none`,
  ),
  heroMediaCol:
    `relative z-0 order-2 flex min-h-0 w-full min-w-0 max-w-full items-stretch justify-center px-0 ${heroStackGapMediaMobile} max-md:pt-0 max-md:pb-0 md:mt-0 md:justify-center md:self-center`,
  heroMediaColShowcase:
    `relative z-0 order-2 flex min-h-0 w-full min-w-0 max-w-full items-stretch justify-center px-0 max-md:mt-8 max-md:pt-0 max-md:pb-0 md:mt-0 md:justify-end md:self-center`,
  /** Outer shell — shrink-wraps to showcase card / image size. */
  heroMediaShell:
    "caretip-hero-media-shell relative mx-auto w-fit min-w-0 max-w-full overflow-visible md:ml-auto md:mr-0 lg:ml-auto lg:mr-auto",
  heroMediaShellLegacy:
    "relative mx-auto w-full max-md:max-w-[min(100%,320px)] sm:max-w-[360px] md:max-w-[380px] lg:max-w-[400px]",
  /** Premium product showcase card (Stripe / Linear / fintech hero). */
  heroShowcaseFrame:
    "caretip-hero-showcase-frame relative w-fit max-w-full overflow-visible mx-auto",
  heroShowcaseStack: "hero-showcase-stack relative z-[1] w-fit max-w-full overflow-visible",
  /** Float stats — out of flow; anchored to showcase column in CareTipLandingHero. */
  heroFloatLayer:
    "caretip-hero-float-layer pointer-events-none absolute inset-0 z-30 overflow-visible",
  heroShowcaseMobileShell: "",
  heroShowcaseCard: "hero-showcase-card contents",
  /** @deprecated Use heroMediaClip */
  heroShowcaseUnit: "caretip-hero-media-clip",
  heroShowcaseCardMedia: "caretip-hero-media-clip",
  /** Wrap holds elevation shadow; clip owns radius (see caretip-landing-hero-media.css) */
  heroMediaWrap: "caretip-hero-media-wrap",
  heroMediaClip: "caretip-hero-media-clip",
  heroShowcaseGlow: "caretip-hero-showcase-ambient",
  heroShowcaseImg:
    "caretip-hero-showcase-img block h-full w-full select-none object-cover object-center m-0 p-0 border-0",
  heroShowcaseDesktopCol:
    "relative lg:flex lg:min-h-0 lg:flex-1 lg:self-start lg:min-w-0 lg:overflow-visible",
  heroShowcaseDesktopStage:
    "caretip-hero-showcase-stage flex w-full items-center justify-center max-lg:relative max-lg:px-4 max-lg:pt-1 max-lg:pb-1 sm:max-lg:px-6 sm:max-lg:pt-2 sm:max-lg:pb-2 lg:relative lg:mx-auto lg:px-2 lg:py-0",
  heroShowcaseDesktopShell:
    "lg:mx-auto lg:flex lg:w-fit lg:max-w-full lg:flex-col lg:items-center lg:justify-center",
  heroSplitRowDesktop: "max-lg:flex max-lg:flex-col max-lg:gap-0",
  heroCopyDesktop:
    "max-lg:items-start max-lg:text-left max-lg:pb-0 max-lg:pt-0 lg:min-w-0 lg:px-0",
  heroShowcaseColDesktop:
    "relative z-0 w-full max-lg:mt-0 max-lg:pb-0 lg:mt-0 lg:min-w-0 lg:flex-1 lg:px-0",
  heroPhoneFrame:
    "relative mx-auto aspect-[2/3] w-full max-w-[min(92vw,360px)] overflow-hidden rounded-[clamp(18px,3.8vw,26px)] border border-neutral-200/95 bg-white py-0 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.14),0_6px_20px_-12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.94)] ring-1 ring-black/[0.04] max-md:aspect-[3/4] dark:border-neutral-600/90 dark:bg-neutral-900 dark:shadow-[0_22px_52px_-20px_rgba(0,0,0,0.4)] dark:ring-white/[0.06] sm:max-w-[380px] sm:rounded-[clamp(22px,4.5vw,40px)] md:aspect-[2/3] md:max-w-full md:rounded-[clamp(22px,4.5vw,40px)]",
  /** 1:1 frame for square hero art (German glassy mockup) — cover fills without crop. */
  heroPhoneFrameSquare:
    "relative mx-auto aspect-square w-full max-w-[min(92vw,420px)] overflow-hidden rounded-[clamp(18px,3.8vw,28px)] border border-neutral-200/95 bg-[linear-gradient(180deg,#faf9f7_0%,#ffffff_42%,#f3f1ed_100%)] py-0 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.14),0_6px_20px_-12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.94)] ring-1 ring-black/[0.04] dark:border-neutral-600/90 dark:bg-neutral-900 dark:shadow-[0_22px_52px_-20px_rgba(0,0,0,0.4)] dark:ring-white/[0.06] sm:max-w-[420px] sm:rounded-[clamp(22px,4.5vw,40px)] md:max-w-full md:rounded-[clamp(22px,4.5vw,40px)]",
  /** Wide frame for cinematic hero art — cover fills card at default scale. */
  heroPhoneFrameCinematic:
    "relative mx-auto aspect-[16/10] w-full max-w-[min(92vw,400px)] overflow-hidden rounded-[clamp(18px,3.8vw,28px)] border border-neutral-200/90 bg-neutral-950 py-0 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.14),0_6px_20px_-12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-black/[0.06] dark:border-neutral-700/90 dark:bg-neutral-950 dark:shadow-[0_22px_52px_-20px_rgba(0,0,0,0.45)] dark:ring-white/[0.06] sm:max-w-[380px] sm:rounded-[clamp(22px,4.5vw,40px)] md:max-w-[380px] lg:max-w-[400px]",
  heroPhoneFrameCinematicImg:
    "block h-full w-full origin-center object-cover object-center [object-position:var(--hero-object-position,center)] max-md:scale-[0.97] md:scale-[0.91]",
} as const;
