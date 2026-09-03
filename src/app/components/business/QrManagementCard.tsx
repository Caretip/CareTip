import { memo, useState } from "react";
import {
  QrCode,
  Copy,
  Check,
  MapPin,
  Printer,
  FileDown,
  RefreshCw,
  Eye,
  Download,
  User,
  LayoutGrid,
  Store,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileAvatar } from "../ui/profile-avatar";
import { LoadingSpinner } from "../ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { formatVenueDateTime, resolveBusinessTimezone } from "../../lib/businessVenueTime";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { downloadQrDataUrlPng } from "../../lib/qrExport";
import { cn } from "@/lib/utils";

export type QrManagementCardItem = {
  id: string;
  name: string;
  role?: string;
  avatar?: string | null;
  qrUrl: string;
  slug?: string | null;
};

export type QrAssetMetadata = {
  templateLabel: string;
  lastUpdatedLabel: string;
  ownershipLabel: string;
  typeLabel: string;
};

type QrManagementCardProps = {
  item: QrManagementCardItem;
  type: "storefront" | "employee" | "table" | "location";
  previewDataUrl?: string;
  copiedId: string | null;
  qrLocked: boolean;
  regeneratingId: string | null;
  onCopy: (id: string, url: string) => void;
  onEmployeePrint?: (item: QrManagementCardItem, previewDataUrl?: string) => void;
  onEmployeePrintPdf?: (item: QrManagementCardItem) => void;
  onEmployeeRegenerate?: (item: QrManagementCardItem) => void;
  onVenuePrint?: (
    item: QrManagementCardItem,
    type: "storefront" | "table" | "location",
    previewDataUrl?: string,
  ) => void;
  onVenuePrintPdf?: (
    item: QrManagementCardItem,
    type: "storefront" | "table" | "location",
    previewDataUrl?: string,
  ) => void;
  onRegenerateBusinessQr?: () => void;
  exportBlocked?: boolean;
  layout?: "default" | "library";
  metadata?: QrAssetMetadata;
};

function QrTypeIcon({ type }: { type: QrManagementCardProps["type"] }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (type === "employee") return <User className={className} aria-hidden />;
  if (type === "table") return <LayoutGrid className={className} aria-hidden />;
  if (type === "location") return <MapPin className={className} aria-hidden />;
  return <Store className={className} aria-hidden />;
}

function QrPreviewImage({
  dataUrl,
  hasQrUrl,
  onPreview,
  library,
}: {
  dataUrl?: string;
  /** When true and dataUrl is empty, show loading frame — never the Lucide placeholder. */
  hasQrUrl?: boolean;
  onPreview?: () => void;
  library?: boolean;
}) {
  const { t } = useTranslation();
  const frame = (
    <div
      className={cn(
        "qr-preview-frame relative flex aspect-square w-full items-center justify-center rounded-xl border border-black/[0.10] bg-white p-2",
        library ? "max-w-none" : "mx-auto max-w-[10.5rem] sm:max-w-[12rem] lg:mx-0 lg:w-44 lg:max-w-[11rem]",
      )}
    >
      {dataUrl ? (
        <img src={dataUrl} alt="" className="h-full w-full object-contain" decoding="async" />
      ) : hasQrUrl ? (
        <LoadingSpinner size="sm" className="text-muted-foreground" />
      ) : (
        <QrCode className="h-16 w-16 text-foreground sm:h-20 sm:w-20" />
      )}
    </div>
  );

  if (!onPreview || !dataUrl) return frame;

  return (
    <button
      type="button"
      onClick={onPreview}
      className="group relative w-full rounded-xl text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("business.qrStudio.gallery.previewAssetAria")}
    >
      {frame}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100">
        <Eye className="h-6 w-6 text-white" aria-hidden />
      </span>
    </button>
  );
}

function QrAssetMetadataGrid({ metadata }: { metadata: QrAssetMetadata }) {
  const { t } = useTranslation();
  const rows = [
    { label: t("business.qrStudio.gallery.metaType"), value: metadata.typeLabel },
    { label: t("business.qrStudio.gallery.metaOwnership"), value: metadata.ownershipLabel },
    { label: t("business.qrStudio.gallery.metaTemplate"), value: metadata.templateLabel },
    { label: t("business.qrStudio.gallery.metaUpdated"), value: metadata.lastUpdatedLabel },
  ];

  return (
    <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0 rounded-lg border border-border/60 bg-muted/25 px-2.5 py-2">
          <dt className="font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const QrManagementCard = memo(function QrManagementCard({
  item,
  type,
  previewDataUrl,
  copiedId,
  qrLocked,
  regeneratingId,
  onCopy,
  onEmployeePrint,
  onEmployeePrintPdf,
  onEmployeeRegenerate,
  onVenuePrint,
  onVenuePrintPdf,
  onRegenerateBusinessQr,
  exportBlocked = false,
  layout = "default",
  metadata,
}: QrManagementCardProps) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const isLibrary = layout === "library";
  const showPreviewActions = Boolean(previewDataUrl);

  const handleDownloadPng = () => {
    if (!previewDataUrl) return;
    const slug = item.name.replace(/\s+/g, "-").toLowerCase();
    downloadQrDataUrlPng(previewDataUrl, `caretip-${type}-${slug}.png`, {
      exportAllowed: !exportBlocked,
    });
  };

  const actionButtons = (
    <div className="flex flex-wrap gap-2">
      {showPreviewActions ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            className={cn(businessUi.btnSecondary, "h-9")}
          >
            <Eye className="mr-2 h-4 w-4" />
            {t("business.qrStudio.gallery.preview")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleDownloadPng}
            disabled={qrLocked || exportBlocked}
            className={cn(businessUi.btnSecondary, "h-9")}
          >
            <Download className="mr-2 h-4 w-4" />
            {t("business.qrStudio.gallery.downloadPng")}
          </Button>
        </>
      ) : null}
      {type === "employee" && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onEmployeePrint?.(item, previewDataUrl)}
            disabled={qrLocked || exportBlocked}
            className={cn(businessUi.btnSecondary, "h-9")}
          >
            <Printer className="mr-2 h-4 w-4" />
            {t("business.qrPage.print")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onEmployeePrintPdf?.(item)}
            disabled={qrLocked || !item.qrUrl?.trim() || exportBlocked}
            className={cn(businessUi.btnPrimary, "h-9")}
          >
            <FileDown className="mr-2 h-4 w-4" />
            {t("business.qrPage.downloadPdfLayout")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={item.slug ? "outline" : "default"}
            onClick={() => onEmployeeRegenerate?.(item)}
            disabled={qrLocked || regeneratingId === item.id}
            className={cn(item.slug ? businessUi.btnSecondary : businessUi.btnPrimary, "h-9")}
          >
            {regeneratingId === item.id ? (
              <LoadingSpinner size="sm" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {item.slug ? t("business.qrPage.regenerateEmployeeQr") : t("business.qrPage.generateProfileLink")}
          </Button>
        </>
      )}
      {(type === "storefront" || type === "table" || type === "location") && (
        <>
          {type === "storefront" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRegenerateBusinessQr}
              disabled={qrLocked || regeneratingId === "storefront"}
              className={cn(businessUi.btnSecondary, "h-9")}
            >
              {regeneratingId === "storefront" ? (
                <LoadingSpinner size="sm" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t("business.qrPage.regenerateBusinessQr")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onVenuePrint?.(item, type, previewDataUrl)}
            disabled={qrLocked || exportBlocked}
            className={cn(businessUi.btnSecondary, "h-9")}
          >
            <Printer className="mr-2 h-4 w-4" />
            {t("business.qrPage.print")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onVenuePrintPdf?.(item, type, previewDataUrl)}
            disabled={qrLocked || !previewDataUrl || exportBlocked}
            className={cn(businessUi.btnPrimary, "h-9")}
          >
            <FileDown className="mr-2 h-4 w-4" />
            {t("business.qrPage.downloadPdfLayout")}
          </Button>
        </>
      )}
    </div>
  );

  const previewDialog = showPreviewActions ? (
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>
            {metadata?.ownershipLabel ??
              (type === "storefront"
                ? t("business.qrStudio.gallery.ownershipStorefront", { name: item.name })
                : item.role ?? item.name)}
          </DialogDescription>
        </DialogHeader>
        {previewDataUrl ? (
          <div className="flex justify-center rounded-xl border bg-white p-4">
            <img src={previewDataUrl} alt="" className="max-h-[min(60vh,420px)] w-full object-contain" />
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void onCopy(item.id, item.qrUrl)}>
            {copiedId === item.id ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <Copy className="mr-2 h-4 w-4" />
            )}
            {copiedId === item.id ? t("common.copied") : t("business.qrPage.copyUrlAria")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleDownloadPng}
            disabled={qrLocked || exportBlocked || !previewDataUrl}
          >
            <Download className="mr-2 h-4 w-4" />
            {t("business.qrStudio.gallery.downloadPng")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  ) : null;

  if (isLibrary && metadata) {
    return (
      <>
        <article className={cn(businessUi.cardStatic, "flex h-full min-w-0 flex-col overflow-hidden")}>
          <div className="border-b border-neutral-100/90 p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2.5">
                {type === "employee" ? (
                  <ProfileAvatar src={item.avatar} displayName={item.name} className="h-9 w-9 shrink-0" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <QrTypeIcon type={type} />
                  </span>
                )}
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-foreground">{item.name}</h3>
                  {item.role ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.role}</p>
                  ) : null}
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                <QrTypeIcon type={type} />
                {metadata.typeLabel}
              </span>
            </div>
            <QrPreviewImage
              dataUrl={previewDataUrl}
              hasQrUrl={Boolean(item.qrUrl?.trim())}
              library
              onPreview={showPreviewActions ? () => setPreviewOpen(true) : undefined}
            />
          </div>
          <div className="flex flex-1 flex-col gap-3 p-4">
            <QrAssetMetadataGrid metadata={metadata} />
            <div className="rounded-lg border border-black/[0.08] bg-muted/30 p-3">
              <p className="mb-1 text-xs text-muted-foreground">{t("business.qrPage.labelQrUrl")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate font-mono text-xs text-foreground">{item.qrUrl}</code>
                <button
                  type="button"
                  onClick={() => void onCopy(item.id, item.qrUrl)}
                  className="flex-shrink-0 rounded-lg p-2 transition-colors hover:bg-background"
                  aria-label={copiedId === item.id ? t("common.copied") : t("business.qrPage.copyUrlAria")}
                >
                  {copiedId === item.id ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : (
                    <Copy className="h-4 w-4 opacity-60" />
                  )}
                </button>
              </div>
            </div>
            {exportBlocked ? (
              <p className="text-[10px] font-medium text-destructive">
                {t("business.qrReliability.exportBlockedShort")}
              </p>
            ) : null}
            <div className="mt-auto pt-1">{actionButtons}</div>
          </div>
        </article>

        {previewDialog}
      </>
    );
  }

  return (
    <>
    <div className={cn(businessUi.cardStatic, businessUi.cardPad, "min-w-0 text-foreground")}>
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-6">
        <div className="flex w-full min-w-0 shrink-0 justify-center sm:w-auto sm:justify-start">
          <QrPreviewImage
            dataUrl={previewDataUrl}
            hasQrUrl={Boolean(item.qrUrl?.trim())}
            onPreview={showPreviewActions ? () => setPreviewOpen(true) : undefined}
          />
          {exportBlocked ? (
            <p className="mt-2 text-center text-[10px] font-medium text-destructive">
              {t("business.qrReliability.exportBlockedShort")}
            </p>
          ) : null}
        </div>

        <div className="flex-1 space-y-4">
          <div>
            {type === "storefront" && (
              <div className="mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("business.qrStudio.gallery.mainVenueTitle")}
                </p>
                <p className="text-sm text-muted-foreground">{t("business.qrPage.storefrontCardHint")}</p>
              </div>
            )}
            {type === "employee" && (
              <div className="mb-2 flex items-center gap-3">
                <ProfileAvatar src={item.avatar} displayName={item.name} className="h-10 w-10" />
                <div>
                  <h3 className="font-semibold text-foreground">{item.name}</h3>
                  <p className="text-sm text-muted-foreground">{item.role}</p>
                </div>
              </div>
            )}
            {type === "table" && (
              <div>
                <h3 className="mb-1 font-semibold text-foreground">{item.name}</h3>
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {item.role}
                </p>
              </div>
            )}
            {type === "location" && (
              <div>
                <h3 className="mb-1 font-semibold text-foreground">{item.name}</h3>
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {item.role}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-black/[0.08] bg-muted/30 p-3">
            <p className="mb-1 text-xs text-muted-foreground">{t("business.qrPage.labelQrUrl")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-xs text-foreground">{item.qrUrl}</code>
              <button
                type="button"
                onClick={() => void onCopy(item.id, item.qrUrl)}
                className="flex-shrink-0 rounded-lg p-2 transition-colors hover:bg-background"
                aria-label={copiedId === item.id ? t("common.copied") : t("business.qrPage.copyUrlAria")}
              >
                {copiedId === item.id ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : (
                  <Copy className="h-4 w-4 opacity-60" />
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex flex-wrap gap-2">{actionButtons}</div>
          </div>
        </div>
      </div>
    </div>
    {previewDialog}
    </>
  );
});

export function formatQrAssetUpdatedAt(iso: string | null | undefined, language: string): string {
  if (!iso) return "—";
  try {
    return formatVenueDateTime(iso, resolveBusinessTimezone(), language);
  } catch {
    return "—";
  }
}
