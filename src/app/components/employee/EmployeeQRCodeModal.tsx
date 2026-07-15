import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Download, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { getEmployeeProfile } from "../../lib/api";
import { qrBrandingFingerprint } from "../../lib/businessBranding";
import { loadQrRenderBranding } from "../../lib/loadQrRenderBranding";
import {
  renderBrandedQRToDataUrl,
  renderBrandedQRToDataUrlLegacy,
  downloadBrandedQR,
  downloadBrandedQRLegacy,
  getEmployeeQrShareUrl,
  getEmployeeQrLegacyShareUrl,
} from "../../lib/qrBranded";
import { logClientError } from "../../lib/clientLog";

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
  const [dataUrl, setDataUrl] = useState("");
  const [imgLoading, setImgLoading] = useState(false);
  const [brandingReady, setBrandingReady] = useState(false);
  const [qrBranding, setQrBranding] = useState<Awaited<ReturnType<typeof loadQrRenderBranding>>>(null);

  const bs = businessSlug?.trim();
  const es = employeeSlug?.trim();
  const useSlugPair = Boolean(bs && es);
  const brandingFingerprint = useMemo(() => qrBrandingFingerprint(qrBranding), [qrBranding]);

  useEffect(() => {
    if (!open) {
      setQrBranding(null);
      setBrandingReady(false);
      return;
    }
    let cancelled = false;
    setBrandingReady(false);
    void (async () => {
      try {
        const profile = await getEmployeeProfile();
        if (cancelled) return;
        const branding = await loadQrRenderBranding({
          mode: "employee",
          businessId: profile.businessId,
        });
        if (cancelled) return;
        setQrBranding(branding);
      } catch (err) {
        logClientError("EmployeeQRCodeModal.branding", err);
        if (!cancelled) setQrBranding(null);
      } finally {
        if (!cancelled) setBrandingReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !employeeId || !brandingReady) return;
    let cancelled = false;
    setImgLoading(true);
    setDataUrl("");
    const render = useSlugPair
      ? renderBrandedQRToDataUrl(bs!, es!, qrBranding ?? undefined)
      : renderBrandedQRToDataUrlLegacy(employeeId, qrBranding ?? undefined);
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
  }, [open, employeeId, bs, es, useSlugPair, brandingReady, brandingFingerprint, qrBranding]);

  const shareUrl = useSlugPair ? getEmployeeQrShareUrl(bs!, es!) : getEmployeeQrLegacyShareUrl(employeeId);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch (err) {
      logClientError("EmployeeQRCodeModal", err);
      toast.error(t("employee.qrModal.toastCopyFailed"));
    }
  };

  const download = () => {
    const branding = qrBranding ?? undefined;
    if (useSlugPair) void downloadBrandedQR(bs!, es!, employeeName, branding);
    else void downloadBrandedQRLegacy(employeeId, employeeName, branding);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("employee.qrModal.title")}</DialogTitle>
          <DialogDescription>
            {t("employee.qrModal.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="flex min-h-[400px] w-full items-center justify-center rounded-2xl border border-border bg-muted/35 p-4">
            {imgLoading ? (
              <div className="w-full max-w-[340px]">
                <div className="h-[360px] w-full animate-pulse rounded-xl bg-muted" />
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
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <button
              type="button"
              onClick={download}
              disabled={imgLoading || !dataUrl}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm disabled:pointer-events-none disabled:opacity-50"
            >
              <Download className="w-4 h-4 shrink-0" />
              {t("employee.qrModal.downloadImage")}
            </button>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-50"
            >
              <LinkIcon className="w-4 h-4 shrink-0" />
              {t("employee.qrModal.copyLinkButton")}
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
