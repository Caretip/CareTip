import { QrCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "../../ui/loading-spinner";
import { cn } from "@/lib/utils";

type QrStudioPreviewFrameProps = {
  dataUrl?: string;
  hasQrUrl?: boolean;
  size?: "default" | "hero" | "compact";
  className?: string;
  imageAlt?: string;
};

export function QrStudioPreviewFrame({
  dataUrl,
  hasQrUrl = false,
  size = "default",
  className,
  imageAlt,
}: QrStudioPreviewFrameProps) {
  const { t } = useTranslation();
  const alt = imageAlt ?? t("business.qrStudio.previewImageAlt");

  return (
    <div
      className={cn(
        "qr-studio-preview-frame",
        size === "hero" && "qr-studio-preview-frame--hero",
        size === "compact" && "qr-studio-preview-frame--compact",
        className,
      )}
    >
      {dataUrl ? (
        <img src={dataUrl} alt={alt} className="qr-studio-preview-frame__img" decoding="async" />
      ) : hasQrUrl ? (
        <LoadingSpinner size="sm" className="text-muted-foreground" />
      ) : (
        <QrCode className="qr-studio-preview-frame__placeholder" aria-hidden />
      )}
    </div>
  );
}
