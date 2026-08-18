import { useEffect, useState } from "react";
import type { PhysicalQrColorTokens } from "@/app/lib/physicalQrTemplate";
import artworkUrl from "@/assets/physical-qr/caretip-a5-artwork.png";

const ART_W = 1410;
const ART_H = 2000;
const QR = { x: 401, y: 792, w: 609, h: 613 };

type PhysicalQrPreviewProps = {
  businessName: string;
  address: string | null;
  supportsAddress: boolean;
  colorTokens: PhysicalQrColorTokens;
  targetUrl: string;
  compact?: boolean;
};

export function PhysicalQrPreview({
  businessName,
  address,
  supportsAddress,
  colorTokens,
  targetUrl,
  compact = false,
}: PhysicalQrPreviewProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = targetUrl.trim();
    if (!url || url.startsWith("https://caretip.app/qr-studio-scan-check")) {
      setQrDataUrl(null);
      return;
    }
    void import("qrcode").then(({ toDataURL }) =>
      toDataURL(url, {
        errorCorrectionLevel: "H",
        margin: 4,
        width: compact ? 320 : 640,
        color: { dark: "#111111", light: "#FFFFFF" },
      }).then((data) => {
        if (!cancelled) setQrDataUrl(data);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [targetUrl, compact]);

  const showAddress = Boolean(supportsAddress && address?.trim());
  const name = businessName.trim();

  return (
    <div
      className={
        compact
          ? "overflow-hidden rounded-lg border border-border bg-muted/20"
          : "overflow-hidden rounded-xl border border-border bg-muted/30 shadow-sm"
      }
    >
      <div className="relative w-full" style={{ aspectRatio: `${ART_W} / ${ART_H}` }}>
        <img
          src={artworkUrl}
          alt=""
          width={ART_W}
          height={ART_H}
          className="absolute inset-0 h-full w-full object-cover"
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
            className="absolute left-[8%] right-[8%] text-center font-bold leading-tight"
            style={{
              top: `${(1478 / ART_H) * 100}%`,
              color: colorTokens.secondaryTextColor,
              fontSize: compact ? "0.65rem" : "0.95rem",
            }}
          >
            {name}
          </p>
        ) : null}
        {showAddress ? (
          <p
            className="absolute left-[8%] right-[8%] text-center leading-snug"
            style={{
              top: `${(1534 / ART_H) * 100}%`,
              color: colorTokens.secondaryTextColor,
              fontSize: compact ? "0.55rem" : "0.8rem",
            }}
          >
            {address}
          </p>
        ) : null}
      </div>
    </div>
  );
}
