import type { CSSProperties } from "react";
import type { PublicGuestBranding } from "../../lib/businessBranding";
import { guestBrandAccentColor } from "../../lib/businessBranding";

export function guestCompletionIconStyle(
  branding?: PublicGuestBranding | null,
): CSSProperties {
  const accent = guestBrandAccentColor(branding);
  return {
    background: `linear-gradient(135deg, ${accent}29 0%, ${accent}14 50%, transparent 100%)`,
    boxShadow: `0 0 0 10px ${accent}12`,
  };
}

/** Premium completion page canvas — accent wash via CSS; base canvas from `.customer-flow-success-page`. */
export function guestSuccessPageStyle(branding?: PublicGuestBranding | null): CSSProperties {
  const accent = guestBrandAccentColor(branding);
  return {
    ["--success-accent" as string]: accent,
  };
}

export function guestCompletionCardStyle(branding?: PublicGuestBranding | null): CSSProperties {
  const accent = guestBrandAccentColor(branding);
  return {
    borderColor: `${accent}26`,
  };
}

export function guestPrimaryButtonStyle(branding?: PublicGuestBranding | null): CSSProperties {
  const accent = guestBrandAccentColor(branding);
  return {
    backgroundColor: accent,
    borderColor: accent,
  };
}

/** Primary CTA on success page — CareTip orange gradient with depth. */
export function guestSuccessPrimaryButtonStyle(branding?: PublicGuestBranding | null): CSSProperties {
  const accent = guestBrandAccentColor(branding);
  return {
    background: `linear-gradient(135deg, #e9781c 0%, ${accent} 42%, #c45f12 78%, #1a1a1a 100%)`,
    borderColor: "transparent",
    boxShadow: `0 14px 32px -12px ${accent}66`,
  };
}
