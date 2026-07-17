/**
 * Official payment brand marks for the landing Payments Infrastructure section.
 * Assets live under /images — do not redraw or recolor.
 * Prefer official SVG for crisp Retina rendering.
 */

import applePayMarkUrl from "../../../../images/SVG/Apple_Pay_Mark_RGB_041619.svg?url";
import googlePayMarkUrl from "../../../../images/google-pay-mark_800.svg?url";
import mastercardMarkUrl from "../../../../images/ma_symbol.svg?url";
import poweredByStripeUrl from "../../../../images/powered-by-stripe-black.svg?url";

/** Optional Visa mark — include when `images/visa*.svg|png|webp` is added. */
const visaModules = import.meta.glob<string>("../../../../images/**/*[Vv][Ii][Ss][Aa]*.{svg,png,webp,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
});

function resolveVisaUrl(): string | undefined {
  const entries = Object.entries(visaModules);
  if (entries.length === 0) return undefined;
  // Prefer svg, then webp, then png
  const ranked = [...entries].sort(([a], [b]) => {
    const score = (p: string) => (p.endsWith(".svg") ? 0 : p.endsWith(".webp") ? 1 : 2);
    return score(a) - score(b);
  });
  return ranked[0]?.[1];
}

export type LandingPaymentBrandId = "visa" | "mastercard" | "apple-pay" | "google-pay";

export type LandingPaymentBrand = {
  id: LandingPaymentBrandId;
  label: string;
  src: string;
  /** Optical width hint relative to a shared mark height */
  aspect: "wide" | "square" | "mark";
};

export const poweredByStripeBadgeUrl = poweredByStripeUrl;

export function getLandingPaymentBrands(): LandingPaymentBrand[] {
  const brands: LandingPaymentBrand[] = [];
  const visa = resolveVisaUrl();
  if (visa) {
    brands.push({ id: "visa", label: "Visa", src: visa, aspect: "wide" });
  }
  brands.push(
    { id: "mastercard", label: "Mastercard", src: mastercardMarkUrl, aspect: "square" },
    { id: "apple-pay", label: "Apple Pay", src: applePayMarkUrl, aspect: "mark" },
    { id: "google-pay", label: "Google Pay", src: googlePayMarkUrl, aspect: "mark" },
  );
  return brands;
}
