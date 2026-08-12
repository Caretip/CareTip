/** QR thank-you copy helpers — kept free of template/asset imports for Node tests. */

/** Plan-aware QR fallback when custom branding is unavailable or unset. */
export const DEFAULT_QR_THANK_YOU_MESSAGE =
  "Your appreciation means the world to our team.";

/** Guest tip completion fallback (Basic or Premium without custom copy). */
export const DEFAULT_GUEST_THANK_YOU_MESSAGE = "Thank you for your kindness.";

/**
 * Detect unresolved i18n keys (e.g. `business.branding.defaultThankYouMessage`)
 * so they never appear on customer-facing QR cards.
 */
export function looksLikeUnresolvedI18nKey(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v) return true;
  if (/\s/.test(v)) return false;
  return /^[A-Za-z0-9]+(\.[A-Za-z0-9_]+)+$/.test(v);
}

/** Resolve thank-you copy for QR rendering — never surface raw translation keys. */
export function resolveQrThankYouMessage(
  tierAllowsCustomBranding: boolean,
  customMessage: string | null | undefined,
  fallbackMessage: string = DEFAULT_QR_THANK_YOU_MESSAGE,
): string {
  if (tierAllowsCustomBranding) {
    const trimmed = customMessage?.trim();
    if (trimmed && !looksLikeUnresolvedI18nKey(trimmed)) return trimmed;
  }
  const fallback = fallbackMessage.trim();
  if (fallback && !looksLikeUnresolvedI18nKey(fallback)) return fallback;
  return DEFAULT_QR_THANK_YOU_MESSAGE;
}

/** Thank-you copy for guest tip completion — uses Branding page message when Premium/Enterprise. */
export function resolveGuestThankYouMessage(
  branding: { premium?: boolean; thankYouMessage?: string | null } | null | undefined,
  fallbackMessage: string = DEFAULT_GUEST_THANK_YOU_MESSAGE,
): string {
  if (branding?.premium) {
    const trimmed = branding.thankYouMessage?.trim();
    if (trimmed && !looksLikeUnresolvedI18nKey(trimmed)) return trimmed;
  }
  const fallback = fallbackMessage.trim();
  if (fallback && !looksLikeUnresolvedI18nKey(fallback)) return fallback;
  return DEFAULT_GUEST_THANK_YOU_MESSAGE;
}
