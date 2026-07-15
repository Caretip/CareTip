/**
 * CareTip logo sizing — width-based tokens; always h-auto / object-contain.
 * New package viewBox 958×298 (wordmark & tagline); icon 1:1.
 */
export const CARETIP_LOGO_WIDTH_PX = {
  navMobile: 112,
  navDesktop: 148,
  sidebar: 128,
  drawer: 104,
  authMobile: 96,
  authDesktop: 120,
  authContainerMobile: 112,
  authContainerDesktop: 140,
  customer: 100,
  badge: 72,
  badgeMax: 80,
  iconSm: 28,
  iconMd: 36,
  iconLg: 48,
  iconSplash: 64,
} as const;

export const CARETIP_LOGO_ASPECT = 958 / 298;

export function caretipLogoHeightPx(widthPx: number): number {
  return Math.round(widthPx / CARETIP_LOGO_ASPECT);
}

/** Tailwind width classes — responsive, never stretch. */
export const CARETIP_LOGO_SIZE_CLASS = {
  small: "w-[72px] max-w-[80px] h-auto",
  medium: "w-[112px] h-auto max-w-full",
  large: "w-[148px] h-auto max-w-full",
  nav: "w-[118px] lg:w-[156px] h-auto max-w-full",
  /** Marketing nav with tagline — slightly wider for legibility */
  navTagline: "w-[132px] lg:w-[172px] h-auto max-w-full",
  sidebar: "w-[128px] h-auto max-w-full",
  drawer: "w-[104px] h-auto max-w-full",
  auth: "w-[96px] max-w-[112px] md:w-[120px] md:max-w-[132px] h-auto",
  customer: "w-[100px] h-auto max-w-full",
  badge: "w-[72px] max-w-[80px] h-auto",
  /** Icon-only sizes (square) */
  iconSm: "h-7 w-7",
  iconMd: "h-9 w-9",
  iconLg: "h-12 w-12",
  iconSplash: "h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]",
} as const;

export type CareTipLogoSizeToken = keyof typeof CARETIP_LOGO_SIZE_CLASS;

/** @deprecated Prefer semantic tokens (`nav`, `sidebar`, …). */
export const CARETIP_LOGO_LEGACY_SIZE_MAP: Record<string, CareTipLogoSizeToken> = {
  xs: "badge",
  sm: "sidebar",
  md: "sidebar",
  lg: "large",
  hero: "large",
  header: "nav",
  bar: "drawer",
  customerHeader: "customer",
  customerFooter: "badge",
};

export function resolveCareTipLogoSizeToken(size: string): CareTipLogoSizeToken {
  if (size in CARETIP_LOGO_SIZE_CLASS) {
    return size as CareTipLogoSizeToken;
  }
  return CARETIP_LOGO_LEGACY_SIZE_MAP[size] ?? "sidebar";
}

export const DASHBOARD_HEADER_LOGO_CLASS = CARETIP_LOGO_SIZE_CLASS.drawer;
export const DASHBOARD_DRAWER_LOGO_CLASS = CARETIP_LOGO_SIZE_CLASS.drawer;
export const CUSTOMER_JOURNEY_HEADER_LOGO_CLASS = CARETIP_LOGO_SIZE_CLASS.customer;
