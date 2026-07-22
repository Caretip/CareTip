/** Branding change broadcast — kept separate to avoid circular imports. */

export const BUSINESS_BRANDING_CHANGED_EVENT = "caretip-business-branding-changed";

export function notifyBusinessBrandingChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BUSINESS_BRANDING_CHANGED_EVENT));
  }
}
