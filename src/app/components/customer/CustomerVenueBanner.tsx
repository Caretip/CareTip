import type { ImgHTMLAttributes } from "react";

import type { PublicGuestBranding } from "../../lib/businessBranding";
import { DEFAULT_BRAND_PRIMARY_COLOR } from "../../lib/businessBranding";
import { cn } from "@/lib/utils";
import { resolveMediaUrl } from "../../lib/mediaUrl";

type CustomerVenueBannerProps = {
  branding?: PublicGuestBranding | null;
  className?: string;
};

/**
 * Premium guest hero — venue banner with gradient fallback.
 */
export function CustomerVenueBanner({ branding, className }: CustomerVenueBannerProps) {
  const bannerSrc =
    branding?.premium && branding.bannerImagePath
      ? resolveMediaUrl(branding.bannerImagePath)
      : null;
  const accent = branding?.premium ? branding.brandPrimaryColor : DEFAULT_BRAND_PRIMARY_COLOR;

  if (!bannerSrc) {
    return (
      <div
        className={cn(
          "customer-venue-banner customer-venue-banner--gradient h-28 w-full sm:h-32",
          className,
        )}
        style={{
          background: `linear-gradient(135deg, ${accent}22 0%, ${accent}44 48%, ${accent}18 100%)`,
        }}
        aria-hidden
      />
    );
  }

  return (
    <div className={cn("customer-venue-banner relative h-28 w-full overflow-hidden sm:h-32", className)}>
      <img
        src={bannerSrc}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        {...({ fetchpriority: "low" } as ImgHTMLAttributes<HTMLImageElement>)}
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20"
        aria-hidden
      />
    </div>
  );
}
