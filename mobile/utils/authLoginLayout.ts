import { spacing, touchTarget } from "../theme/spacing";

/**
 * Login above-the-fold spacing. Sign in stays in the first viewport on
 * common phones by tightening gaps — not by shrinking inputs or the CTA.
 */
export const authLoginLayout = {
  formGap: spacing.lg,
  fieldsGap: spacing.md,
  headerGap: spacing.sm,
  brandRowGap: spacing.md,
  brandStackGap: spacing.sm,
  logoHeight: 40,
  logoHeightTablet: 44,
  signUpMinHeight: 40,
} as const;

/** Common phone heights used to lock the Sign in above-the-fold budget. */
export const AUTH_LOGIN_VIEWPORTS = {
  shortAndroid: 640,
  iPhoneSe: 667,
  commonAndroid: 780,
  iPhone14: 844,
  extremelyShort: 568,
} as const;

/**
 * Conservative estimate of the Y offset of the Sign in button's bottom edge.
 * Intentionally slightly high so regressions fail before a real device would clip.
 */
export function estimateLoginSignInBottom(safeAreaTop: number): number {
  const hero =
    safeAreaTop +
    spacing.sm +
    authLoginLayout.logoHeight +
    authLoginLayout.brandStackGap +
    18 +
    spacing.sm;
  const header = 16 + authLoginLayout.headerGap + 36 + authLoginLayout.headerGap + 21;
  const social = touchTarget;
  const divider = 20;
  const field = 20 + spacing.md + (touchTarget + 14);
  const fields = field * 2 + authLoginLayout.fieldsGap;
  const forgot = 32;
  const cta = touchTarget + 16;
  const sectionGaps = authLoginLayout.formGap * 4;
  const forgotToCta = spacing.sm;

  return hero + header + social + divider + fields + forgot + cta + sectionGaps + forgotToCta;
}

export function isLoginSignInAboveFold(viewportHeight: number, safeAreaTop: number): boolean {
  return estimateLoginSignInBottom(safeAreaTop) <= viewportHeight;
}
