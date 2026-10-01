import { useTranslation } from "react-i18next";
import { LayoutGrid, MapPin } from "lucide-react";
import { QrStudioPreviewFrame } from "./QrStudioPreviewFrame";
import { QrStudioDestinationField } from "./QrStudioDestinationField";
import { QrStudioAssetActions } from "./QrStudioAssetActions";
import { cn } from "@/lib/utils";

type QrStudioTableWorkspaceCardProps = {
  tableName: string;
  locationName: string;
  guestUrl: string;
  qrDataUrl?: string;
  copied: boolean;
  qrLocked: boolean;
  onCopy: () => void;
  onDownloadPdf: () => void;
  onPrint?: () => void;
  onDownloadPng?: () => void;
  className?: string;
};

export function QrStudioTableWorkspaceCard({
  tableName,
  locationName,
  guestUrl,
  qrDataUrl,
  copied,
  qrLocked,
  onCopy,
  onDownloadPdf,
  onPrint,
  onDownloadPng,
  className,
}: QrStudioTableWorkspaceCardProps) {
  const { t } = useTranslation();
  const showPreviewActions = Boolean(qrDataUrl);

  return (
    <article className={cn("qr-studio-asset-card qr-studio-asset-card--table", className)}>
      <div className="qr-studio-asset-card__grid qr-studio-asset-card__grid--management">
        <div className="qr-studio-asset-card__qr-col shrink-0">
          <QrStudioPreviewFrame
            dataUrl={qrDataUrl}
            hasQrUrl={Boolean(guestUrl)}
            size="default"
          />
        </div>
        <div className="qr-studio-asset-card__body">
          <header className="qr-studio-asset-card__identity">
            <p className="qr-studio-asset-card__eyebrow">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              {t("business.qrStudio.typeLabel.table")}
            </p>
            <h3 className="qr-studio-asset-card__title">{tableName}</h3>
            <p className="qr-studio-asset-card__meta">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="qr-studio-asset-card__meta-label">
                  {t("business.qrStudio.typeLabel.location")}
                </span>
                {locationName}
              </span>
            </p>
          </header>
          <p className="qr-studio-asset-card__hint">{t("business.qrStudio.tableGuestHint")}</p>
          <QrStudioDestinationField url={guestUrl} copied={copied} onCopy={onCopy} />
          <QrStudioAssetActions
            qrLocked={qrLocked}
            showPreviewActions={showPreviewActions}
            onDownloadPdf={onDownloadPdf}
            pdfDisabled={!showPreviewActions}
            onPrint={onPrint}
            onDownloadPng={onDownloadPng}
          />
        </div>
      </div>
    </article>
  );
}
