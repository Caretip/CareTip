import type { ImgHTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  resolveCareTipBrandSrc,
  type CareTipLogoTone,
  type CareTipLogoVariant,
} from "@/lib/caretipBrandAssets";
import {
  CARETIP_LOGO_SIZE_CLASS,
  resolveCareTipLogoSizeToken,
  type CareTipLogoSizeToken,
} from "@/lib/caretipLogoSizes";

/**
 * ARCHITECTURE — CareTip brand mark
 * ---------------------------------
 * Official package (images/ → src/assets/brand/):
 *   Primary / TagLine / Black / White / Orange (+ plate) SVGs + App-Icon.
 * Prefer SVG. Do not use deprecated company_logo.* for UI.
 * See docs/BRANDING_LOGO_MIGRATION_REPORT.md
 */

export type CareTipLogoSize =
  | CareTipLogoSizeToken
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "hero"
  | "header"
  | "auth"
  | "bar"
  | "drawer"
  | "customerHeader"
  | "customerFooter";

export type CareTipLogoAlign = "left" | "center";

export const CARE_TIP_LOGO_SURFACE_CLASS =
  "bg-background border-b border-border/80";

export const DASHBOARD_SIDEBAR_BRAND_CLASS =
  "flex shrink-0 items-center border-b border-sidebar-border bg-sidebar px-4 py-2.5 lg:px-5 lg:py-3";

export const DASHBOARD_SIDEBAR_NAV_CLASS =
  "flex-1 min-h-0 overflow-y-auto px-3 pt-1.5 pb-4";

export const DASHBOARD_SIDEBAR_MOBILE_BRAND_CLASS = cn(
  DASHBOARD_SIDEBAR_BRAND_CLASS,
  "justify-between gap-2 min-h-[3.25rem]",
);

export {
  DASHBOARD_HEADER_LOGO_CLASS,
  DASHBOARD_DRAWER_LOGO_CLASS,
  CUSTOMER_JOURNEY_HEADER_LOGO_CLASS,
} from "@/lib/caretipLogoSizes";

export const CARE_TIP_LOGO_AUTH_SURFACE_CLASS = "caretip-auth-logo-surface";

const alignClass: Record<CareTipLogoAlign, string> = {
  left: "object-left object-contain",
  center: "object-center object-contain",
};

export type CareTipLogoProps = {
  className?: string;
  size?: CareTipLogoSize;
  align?: CareTipLogoAlign;
  alt?: string;
  /**
   * wordmark — CareTip without tagline (default app logo)
   * tagline — + “Caring is tipping” (marketing)
   * icon — app icon mark only (compact / splash / favicon contexts)
   */
  variant?: CareTipLogoVariant;
  /** Color treatment; `auto` swaps primary ↔ white for light/dark. */
  tone?: CareTipLogoTone;
  /** @deprecated */
  layoutIsolatedDouble?: boolean;
  /** @deprecated */
  visualScale?: number;
  /** @deprecated */
  scale?: number;
};

const imgBase =
  "block shrink-0 object-contain h-auto max-w-full select-none w-full";

type LogoImgProps = {
  src: string;
  alt: string;
  className?: string;
  loading?: ImgHTMLAttributes<HTMLImageElement>["loading"];
  priority?: boolean;
  decorative?: boolean;
};

function CareTipLogoImg({
  src,
  alt,
  className,
  loading = "lazy",
  priority = false,
  decorative = false,
}: LogoImgProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(priority);

  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setReady(true);
    }
  }, [src]);

  return (
    <img
      ref={imgRef}
      src={src}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
      className={cn(
        imgBase,
        "caretip-marketing-img relative z-[2]",
        ready && "caretip-marketing-img--ready",
        className,
      )}
      loading={priority ? "eager" : loading}
      decoding="async"
      draggable={false}
      onLoad={() => setReady(true)}
      {...(priority ? ({ fetchpriority: "high" } as ImgHTMLAttributes<HTMLImageElement>) : {})}
    />
  );
}

/**
 * Official CareTip logo. Defaults to Primary wordmark (no tagline).
 */
export function CareTipLogo({
  className,
  size = "sidebar",
  align = "left",
  alt = "CareTip",
  variant = "wordmark",
  tone = "auto",
  layoutIsolatedDouble: _layoutIsolatedDouble,
}: CareTipLogoProps) {
  const token = resolveCareTipLogoSizeToken(size);
  const sizeClass =
    variant === "tagline" && token === "nav"
      ? CARETIP_LOGO_SIZE_CLASS.navTagline
      : CARETIP_LOGO_SIZE_CLASS[token];
  const priority =
    token === "nav" ||
    token === "navTagline" ||
    token === "large" ||
    token === "iconSplash";

  /* Brand marks must stay plate-free — never use caretip-image-frame (muted gradient box). */
  const frameClass = cn(
    "caretip-brand-logo block max-w-full bg-transparent",
    align === "center" && "mx-auto",
    alignClass[align],
    sizeClass,
    className,
  );

  if (variant === "icon") {
    return (
      <span className={frameClass}>
        <CareTipLogoImg
          src={resolveCareTipBrandSrc("icon", "primary")}
          alt={alt}
          priority={priority}
        />
      </span>
    );
  }

  if (tone === "auto") {
    return (
      <span className={frameClass}>
        <CareTipLogoImg
          src={resolveCareTipBrandSrc(variant, "primary")}
          alt={alt}
          priority={priority}
          className="dark:hidden"
        />
        <CareTipLogoImg
          src={resolveCareTipBrandSrc(variant, "white")}
          alt={alt}
          priority={priority}
          decorative
          className="hidden dark:block"
        />
      </span>
    );
  }

  return (
    <span className={frameClass}>
      <CareTipLogoImg
        src={resolveCareTipBrandSrc(variant, tone)}
        alt={alt}
        priority={priority}
      />
    </span>
  );
}
