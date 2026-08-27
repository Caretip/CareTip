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

/** Primary CTA on success page — CareTip / guest brand orange (matches pay CTA). */
export function guestSuccessPrimaryButtonStyle(branding?: PublicGuestBranding | null): CSSProperties {
  const accent = guestBrandAccentColor(branding);
  return {
    background: `linear-gradient(135deg, #ff9e2d 0%, ${accent} 52%, #d96810 100%)`,
    borderColor: "transparent",
    boxShadow: `0 8px 24px color-mix(in srgb, ${accent} 38%, transparent)`,
  };
}
