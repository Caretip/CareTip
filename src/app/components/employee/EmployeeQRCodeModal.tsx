import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Check, Download, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { publicEmployeeTipUrl, qrEmployeeLegacyUrl } from "../../lib/appPublicUrl";
import {
  downloadPlainEmployeeQr,
  downloadPlainEmployeeQrLegacy,
  renderPlainEmployeeQrToDataUrl,
  renderPlainEmployeeQrToDataUrlLegacy,
} from "../../lib/plainQr";
import { logClientError } from "../../lib/clientLog";
import { useCopyFeedback } from "../../hooks/useCopyFeedback";

type EmployeeQRCodeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stable id — used for legacy `/qr/employee/:id` when slugs are missing */
  employeeId: string;
  employeeName: string;
  /** Venue public slug + staff slug for canonical `/{businessSlug}/{employeeSlug}` */
  businessSlug?: string | null;
  employeeSlug?: string | null;
};

export function EmployeeQRCodeModal({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  businessSlug,
  employeeSlug,
}: EmployeeQRCodeModalProps) {
  const { t } = useTranslation();
  const { copy, isCopied } = useCopyFeedback();
  const [dataUrl, setDataUrl] = useState("");
  const [imgLoading, setImgLoading] = useState(false);

  const bs = businessSlug?.trim();
  const es = employeeSlug?.trim();
  const useSlugPair = Boolean(bs && es);

  useEffect(() => {
    if (!open || !employeeId) return;
    let cancelled = false;
    setImgLoading(true);
    setDataUrl("");
    const render = useSlugPair
      ? renderPlainEmployeeQrToDataUrl(bs!, es!)
      : renderPlainEmployeeQrToDataUrlLegacy(employeeId);
    render
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err) => {
        logClientError("EmployeeQRCodeModal", err);
      })
      .finally(() => {
        if (!cancelled) setImgLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, employeeId, bs, es, useSlugPair]);

  const shareUrl = useSlugPair ? publicEmployeeTipUrl(bs!, es!) : qrEmployeeLegacyUrl(employeeId);

  const copyLink = async () => {
    const ok = await copy("share", shareUrl);
    if (!ok) {
      toast.error(t("employee.qrModal.toastCopyFailed"));
    }
  };

  const download = () => {
    if (useSlugPair) void downloadPlainEmployeeQr(bs!, es!, employeeName);
    else void downloadPlainEmployeeQrLegacy(employeeId, employeeName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("employee.qrModal.title")}</DialogTitle>
          <DialogDescription>
            {t("employee.qrModal.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="flex min-h-[280px] w-full items-center justify-center rounded-md border border-border bg-white p-4">
            {imgLoading ? (
              <div className="w-full max-w-[280px]">
                <div className="aspect-square w-full animate-pulse rounded-xl bg-muted" />
                <p className="mt-3 text-center text-xs font-medium text-muted-foreground">
                  {t("employee.qrModal.loadingQr")}
                </p>
              </div>
            ) : dataUrl ? (
              <img
                src={dataUrl}
                alt={`QR code for ${employeeName}`}
                className="max-w-full h-auto rounded-lg"
              />
            ) : null}
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={download}
              disabled={imgLoading || !dataUrl}
              className="caretip-btn-primary inline-flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-50"
            >
              <Download className="h-4 w-4 shrink-0" />
              {t("employee.qrModal.downloadImage")}
            </button>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="caretip-btn-secondary inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50"
            >
              {isCopied("share") ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <LinkIcon className="w-4 h-4 shrink-0" />
              )}
              {isCopied("share") ? t("common.copied") : t("employee.qrModal.copyLinkButton")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground text-center break-all px-2">
            {shareUrl}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
