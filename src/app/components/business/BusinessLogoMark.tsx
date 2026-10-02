import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveMediaUrl } from "../../lib/mediaUrl";

/**
 * Logo-friendly max bounds — aspect ratio preserved via object-contain.
 * When a logo image loads, only the image is shown (no border, background, or card chrome).
 */
const LOGO_BOUNDS = {
  sm: {
    frame: "max-h-9 max-w-[4.5rem] min-h-[2rem] min-w-[2rem]",
    fallback: "h-9 w-9 min-h-9 min-w-9 text-[10px]",
  },
  header: {
    frame: "max-h-11 max-w-[5.5rem] min-h-[2.25rem] min-w-[2.25rem]",
    fallback: "h-10 w-10 min-h-10 min-w-10 text-[11px]",
  },
  md: {
    frame: "max-h-11 max-w-[6.5rem] min-h-[2.25rem] min-w-[2.25rem]",
    fallback: "h-11 w-11 min-h-11 min-w-11 text-xs",
  },
  dashboard: {
    frame: "max-h-14 max-w-[9.5rem] min-h-[2.5rem] min-w-[2.5rem] sm:max-h-[3.5rem] sm:max-w-[11rem]",
    fallback: "h-12 w-12 min-h-12 min-w-12 text-sm",
  },
  /** Business manager header — smaller on phones, unchanged from `dashboard` at sm+. */
  dashboardHeader: {
    frame:
      "max-h-9 max-w-[4.25rem] min-h-[2rem] min-w-[2rem] sm:max-h-14 sm:max-w-[9.5rem] sm:min-h-[2.5rem] sm:min-w-[2.5rem] lg:max-h-[3.5rem] lg:max-w-[11rem]",
    fallback: "h-9 w-9 min-h-9 min-w-9 text-[10px] sm:h-12 sm:w-12 sm:min-h-12 sm:min-w-12 sm:text-sm",
  },
  lg: {
    frame: "max-h-16 max-w-[11rem] min-h-[2.75rem] min-w-[2.75rem]",
    fallback: "h-16 w-16 min-h-16 min-w-16 text-sm",
  },
  xl: {
    frame: "max-h-28 max-w-[16rem] min-h-[4rem] min-w-[4rem] sm:max-h-32 sm:max-w-[18rem]",
    fallback: "h-24 w-24 min-h-24 min-w-24 text-base",
  },
  customer: {
    frame: "max-h-12 max-w-[8.5rem] min-h-[2.5rem] min-w-[2.5rem] sm:max-h-14 sm:max-w-[10.5rem]",
    fallback: "h-11 w-11 min-h-11 min-w-11 text-xs",
  },
  hero: {
    frame: "max-h-24 max-w-[min(100%,14rem)] min-h-[3.5rem] min-w-[3.5rem] sm:max-h-28 sm:max-w-[min(100%,16rem)]",
    fallback: "h-20 w-20 min-h-20 min-w-20 text-lg",
  },
} as const;

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "B";
  if (parts.length === 1) return (parts[0]![0] ?? "B").toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase() || "B";
}

export type BusinessLogoMarkSize = keyof typeof LOGO_BOUNDS;

export function BusinessLogoMark({
  logoPathOrUrl,
  businessName,
  size = "md",
  className,
  rounded = "rounded-xl",
  fallbackTone = "brand",
  imageLoading = "lazy",
}: {
  logoPathOrUrl?: string | null;
  businessName: string;
  size?: BusinessLogoMarkSize;
  className?: string;
  /** Applied to initials fallback only. */
  rounded?: string;
  fallbackTone?: "brand" | "muted";
  /** Header marks benefit from eager load to avoid identity flicker. */
  imageLoading?: "lazy" | "eager";
}) {
  const src = resolveMediaUrl(logoPathOrUrl ?? undefined);
  const label = businessName.trim() || "Business";
  const [imgFailed, setImgFailed] = useState(false);
  const bounds = LOGO_BOUNDS[size];

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt=""
        role="img"
        aria-label={label}
        className={cn(
          "block shrink-0 h-auto w-auto max-h-full object-contain object-center",
          bounds.frame,
          className,
        )}
        loading={imageLoading}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border font-semibold tracking-tight",
        rounded.includes("full") ? "rounded-xl" : rounded,
        fallbackTone === "muted"
          ? "border-border/70 bg-muted text-muted-foreground"
          : "border-border bg-primary/10 font-bold text-primary",
        bounds.fallback,
        className,
      )}
      aria-hidden
    >
      <span>{initialsFromName(label)}</span>
    </div>
  );
}

/** Compact mark when name is unknown — building glyph. */
export function BusinessLogoPlaceholder({
  size = "md",
  className,
}: {
  size?: BusinessLogoMarkSize;
  className?: string;
}) {
  const bounds = LOGO_BOUNDS[size];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted text-muted-foreground",
        bounds.fallback,
        className,
      )}
      aria-hidden
    >
      <Building2 className="h-1/2 w-1/2" />
    </div>
  );
}
