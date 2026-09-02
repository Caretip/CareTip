import { useEffect, useState } from "react";
import type { PhysicalQrColorTokens } from "@/app/lib/physicalQrTemplate";
import { physicalQrArtworkSrc, physicalQrOverlayTextColor } from "@/app/lib/physicalQrTemplate";
import {
  getCachedPrintQrDataUrl,
  setCachedPrintQrDataUrl,
} from "@/app/lib/printQrStudioSessionCache";
import { cn } from "@/lib/utils";

const ART_W = 1410;
const ART_H = 2000;
const QR = { x: 401, y: 792, w: 609, h: 613 };
const NAME_TOP = 1478;
const ADDRESS_TOP = 1534;
/** 0.95rem / 0.8rem at the 22rem Preview width, expressed as container-relative type. */
const NAME_FONT_CQW = "4.32cqw";
const ADDRESS_FONT_CQW = "3.64cqw";

const QR_ENCODE_OPTIONS = {
  errorCorrectionLevel: "H" as const,
  margin: 4,
  color: { dark: "#111111", light: "#FFFFFF" },
};

function isPreviewPlaceholderUrl(url: string): boolean {
  return !url || url.startsWith("https://caretip.app/qr-studio-scan-check");
}

/** Encode the shared Print QR preview target once (640px) for every catalog card + dialog. */
export function useSharedPhysicalQrDataUrl(
  targetUrl: string,
  businessId?: string | null,
): string | null {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(() =>
    getCachedPrintQrDataUrl(businessId, targetUrl),
  );

  useEffect(() => {
    let cancelled = false;
    const url = targetUrl.trim();
    if (isPreviewPlaceholderUrl(url)) {
      setQrDataUrl(null);
      return;
    }
    const hit = getCachedPrintQrDataUrl(businessId, url);
    if (hit) {
      setQrDataUrl(hit);
      return;
    }
    void import("qrcode").then(({ toDataURL }) =>
      toDataURL(url, { ...QR_ENCODE_OPTIONS, width: 640 }).then((data) => {
        if (cancelled) return;
        setCachedPrintQrDataUrl(businessId, url, data);
        setQrDataUrl(data);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [targetUrl, businessId]);

  return qrDataUrl;
}

type PhysicalQrPreviewProps = {
  businessName: string;
  address: string | null;
  supportsAddress: boolean;
  colorTokens: PhysicalQrColorTokens;
  targetUrl: string;
  compact?: boolean;
  templateId?: string | null;
  className?: string;
  /** When set (including null), skip per-card encoding and reuse the shared data URL. */
  qrDataUrl?: string | null;
};

export function PhysicalQrPreview({
  businessName,
  address,
  supportsAddress,
  colorTokens,
  targetUrl,
  compact = false,
  templateId,
  className,
  qrDataUrl: providedQrDataUrl,
}: PhysicalQrPreviewProps) {
  const [selfQrDataUrl, setSelfQrDataUrl] = useState<string | null>(null);
  const artSrc = physicalQrArtworkSrc(templateId, compact ? "thumb" : "preview");
  const overlayTextColor = physicalQrOverlayTextColor(templateId, colorTokens.secondaryTextColor);
  const qrDataUrl = providedQrDataUrl !== undefined ? providedQrDataUrl : selfQrDataUrl;

  useEffect(() => {
    if (providedQrDataUrl !== undefined) return;
    let cancelled = false;
    const url = targetUrl.trim();
    if (isPreviewPlaceholderUrl(url)) {
      setSelfQrDataUrl(null);
      return;
    }
    void import("qrcode").then(({ toDataURL }) =>
      toDataURL(url, { ...QR_ENCODE_OPTIONS, width: compact ? 320 : 640 }).then((data) => {
        if (!cancelled) setSelfQrDataUrl(data);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [targetUrl, compact, providedQrDataUrl]);

  const showAddress = Boolean(supportsAddress && address?.trim());
  const name = businessName.trim();

  return (
    <div
      className={
        compact
          ? cn("overflow-hidden rounded-md border border-border bg-muted/20", className)
          : cn("overflow-hidden rounded-xl border border-border bg-muted/30 shadow-sm", className)
      }
    >
      <div
        className="relative w-full"
        style={{ aspectRatio: `${ART_W} / ${ART_H}`, containerType: "inline-size" }}
      >
        <img
          src={artSrc}
          alt=""
          width={compact ? 420 : 704}
          height={compact ? 596 : 999}
          className="absolute inset-0 h-full w-full object-contain"
          decoding="async"
          draggable={false}
        />
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt=""
            className="absolute"
            style={{
              left: `${(QR.x / ART_W) * 100}%`,
              top: `${(QR.y / ART_H) * 100}%`,
              width: `${(QR.w / ART_W) * 100}%`,
              height: `${(QR.h / ART_H) * 100}%`,
            }}
            draggable={false}
          />
        ) : null}
        {name ? (
          <p
            className="absolute left-[8%] right-[8%] break-words text-center font-bold leading-tight"
            style={{
              top: `${(NAME_TOP / ART_H) * 100}%`,
              color: overlayTextColor,
              fontSize: NAME_FONT_CQW,
            }}
          >
            {name}
          </p>
        ) : null}
        {showAddress ? (
          <p
            className="absolute left-[8%] right-[8%] break-words text-center leading-snug"
            style={{
              top: `${(ADDRESS_TOP / ART_H) * 100}%`,
              color: overlayTextColor,
              fontSize: ADDRESS_FONT_CQW,
            }}
          >
            {address}
          </p>
        ) : null}
      </div>
    </div>
  );
}
