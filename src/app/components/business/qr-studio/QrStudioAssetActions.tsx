import { FileDown, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { cn } from "@/lib/utils";

export type QrStudioMoreAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type QrStudioAssetActionsProps = {
  qrLocked: boolean;
  exportBlocked?: boolean;
  showPreviewActions: boolean;
  onDownloadPdf: () => void;
  pdfDisabled?: boolean;
  onPrint?: () => void;
  onDownloadPng?: () => void;
  moreActions?: QrStudioMoreAction[];
  className?: string;
};

function ActionSeparator() {
  return (
    <span className="qr-studio-action-links__sep" aria-hidden>
      ·
    </span>
  );
}

export function QrStudioAssetActions({
  qrLocked,
  exportBlocked = false,
  showPreviewActions,
  onDownloadPdf,
  pdfDisabled,
  onPrint,
  onDownloadPng,
  moreActions = [],
  className,
}: QrStudioAssetActionsProps) {
  const { t } = useTranslation();
  const blocked = qrLocked || exportBlocked;
  const secondary: Array<{ key: string; label: string; onClick: () => void; disabled?: boolean }> = [];

  if (onPrint) {
    secondary.push({
      key: "print",
      label: t("business.qrPage.print"),
      onClick: onPrint,
      disabled: blocked,
    });
  }
  if (showPreviewActions && onDownloadPng) {
    secondary.push({
      key: "png",
      label: t("business.qrStudio.gallery.downloadPng"),
      onClick: onDownloadPng,
      disabled: blocked,
    });
  }

  const visibleMore = moreActions.filter((a) => a.label);

  return (
    <div className={cn("qr-studio-action-controls", className)}>
      <Button
        type="button"
        size="sm"
        onClick={onDownloadPdf}
        disabled={blocked || pdfDisabled}
        className={cn(businessUi.btnPrimary, "qr-studio-action-controls__primary h-9")}
      >
        <FileDown className="mr-2 h-4 w-4 shrink-0" aria-hidden />
        {t("business.qrPage.downloadPdfLayout")}
      </Button>

      {secondary.length > 0 ? (
        <div className="qr-studio-action-links" role="group" aria-label={t("business.qrStudio.secondaryActionsAria")}>
          {secondary.map((item, index) => (
            <span key={item.key} className="inline-flex items-center">
              {index > 0 ? <ActionSeparator /> : null}
              <button
                type="button"
                className="qr-studio-action-link"
                disabled={item.disabled}
                onClick={item.onClick}
              >
                {item.label}
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {visibleMore.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="qr-studio-action-controls__more h-9 px-2"
              aria-label={t("business.qrStudio.moreActionsAria")}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
              <span className="ml-1.5 hidden sm:inline">{t("business.qrStudio.more")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {visibleMore.map((action) => (
              <DropdownMenuItem
                key={action.id}
                disabled={action.disabled || blocked}
                onClick={action.onClick}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
