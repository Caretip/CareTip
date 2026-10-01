import { memo } from "react";
import { MapPin, User, LayoutGrid, Store } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmployeeProfilePhoto } from "../ui/profile-avatar";
import { formatVenueDateTime, resolveBusinessTimezone } from "../../lib/businessVenueTime";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { downloadQrDataUrlPng } from "../../lib/qrExport";
import { cn } from "@/lib/utils";
import { QrStudioPreviewFrame } from "./qr-studio/QrStudioPreviewFrame";
import { QrStudioDestinationField } from "./qr-studio/QrStudioDestinationField";
import { QrStudioAssetActions } from "./qr-studio/QrStudioAssetActions";

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
  layout?: "default" | "library" | "storefront";
  metadata?: QrAssetMetadata;
};

function QrTypeIcon({ type }: { type: QrManagementCardProps["type"] }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (type === "employee") return <User className={className} aria-hidden />;
  if (type === "table") return <LayoutGrid className={className} aria-hidden />;
  if (type === "location") return <MapPin className={className} aria-hidden />;
  return <Store className={className} aria-hidden />;
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
  const isLibrary = layout === "library";
  const isManagement = layout === "storefront" || layout === "default";
  const showPreviewActions = Boolean(previewDataUrl);
  const copied = copiedId === item.id;

  const handleDownloadPng = () => {
    if (!previewDataUrl) return;
    const slug = item.name.replace(/\s+/g, "-").toLowerCase();
    downloadQrDataUrlPng(previewDataUrl, `caretip-${type}-${slug}.png`, {
      exportAllowed: !exportBlocked,
    });
  };

  const typeEyebrowKey =
    type === "storefront"
      ? "business.qrStudio.typeLabel.storefront"
      : type === "employee"
        ? "business.qrStudio.typeLabel.employee"
        : type === "table"
          ? "business.qrStudio.typeLabel.table"
          : "business.qrStudio.typeLabel.location";

  const hintKey =
    type === "storefront"
      ? "business.qrStudio.storefrontPlacementHint"
      : type === "employee"
        ? "business.qrStudio.employeePersonalHint"
        : type === "table"
          ? "business.qrStudio.tableGuestHint"
          : "business.qrStudio.locationAreaHint";

  const pdfDisabled =
    type === "employee" ? !item.qrUrl?.trim() : !previewDataUrl;

  const moreActions = [];
  if (type === "employee") {
    moreActions.push({
      id: "regenerate",
      label: item.slug ? t("business.qrPage.regenerateEmployeeQr") : t("business.qrPage.generateProfileLink"),
      onClick: () => onEmployeeRegenerate?.(item),
      disabled: regeneratingId === item.id,
    });
  }
  if (type === "storefront" && onRegenerateBusinessQr) {
    moreActions.push({
      id: "regenerate-business",
      label: t("business.qrPage.regenerateBusinessQr"),
      onClick: () => onRegenerateBusinessQr(),
      disabled: regeneratingId === "storefront",
    });
  }

  const actionControls = (
    <QrStudioAssetActions
      qrLocked={qrLocked}
      exportBlocked={exportBlocked}
      showPreviewActions={showPreviewActions}
      onDownloadPdf={() => {
        if (type === "employee") onEmployeePrintPdf?.(item);
        else onVenuePrintPdf?.(item, type, previewDataUrl);
      }}
      pdfDisabled={pdfDisabled}
      onPrint={() => {
        if (type === "employee") onEmployeePrint?.(item, previewDataUrl);
        else onVenuePrint?.(item, type, previewDataUrl);
      }}
      onDownloadPng={showPreviewActions ? handleDownloadPng : undefined}
      moreActions={moreActions}
    />
  );

  if (isLibrary && metadata) {
    return (
      <>
        <article className={cn(businessUi.cardStatic, "qr-studio-asset-card flex h-full min-w-0 flex-col overflow-hidden p-0")}>
          <div className="border-b border-border/80 p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2.5">
                {type === "employee" ? (
                  <EmployeeProfilePhoto src={item.avatar} displayName={item.name} className="h-9 w-9 shrink-0" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
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
              <span className="qr-studio-asset-card__eyebrow !mt-0">
                <QrTypeIcon type={type} />
                {metadata.typeLabel}
              </span>
            </div>
            <QrStudioPreviewFrame
              dataUrl={previewDataUrl}
              hasQrUrl={Boolean(item.qrUrl?.trim())}
              size="default"
              className="mx-auto max-w-[10.5rem]"
            />
          </div>
          <div className="flex flex-1 flex-col gap-3 p-4">
            <QrAssetMetadataGrid metadata={metadata} />
            <QrStudioDestinationField
              url={item.qrUrl}
              copied={copied}
              onCopy={() => void onCopy(item.id, item.qrUrl)}
            />
            {exportBlocked ? (
              <p className="text-[10px] font-medium text-destructive">
                {t("business.qrReliability.exportBlockedShort")}
              </p>
            ) : null}
            <div className="mt-auto pt-1">{actionControls}</div>
          </div>
        </article>
      </>
    );
  }

  return (
    <article
        className={cn(
          "qr-studio-asset-card",
          layout === "storefront" && "qr-studio-asset-card--management",
          isManagement && businessUi.cardStatic,
        )}
      >
        <div className="qr-studio-asset-card__grid qr-studio-asset-card__grid--management">
          <div className="qr-studio-asset-card__qr-col shrink-0">
            <QrStudioPreviewFrame
              dataUrl={previewDataUrl}
              hasQrUrl={Boolean(item.qrUrl?.trim())}
              size="default"
            />
            {exportBlocked ? (
              <p className="mt-2 text-center text-[10px] font-medium text-destructive">
                {t("business.qrReliability.exportBlockedShort")}
              </p>
            ) : null}
          </div>

          <div className="qr-studio-asset-card__body">
            <header className="qr-studio-asset-card__identity">
              <p className="qr-studio-asset-card__eyebrow">
                <QrTypeIcon type={type} />
                {t(typeEyebrowKey)}
              </p>
              {type === "employee" ? (
                <div className="mt-2 flex items-center gap-3">
                  <EmployeeProfilePhoto src={item.avatar} displayName={item.name} className="h-10 w-10 shrink-0" />
                  <div className="min-w-0">
                    <h3 className="qr-studio-asset-card__title !mt-0">{item.name}</h3>
                    {item.role ? (
                      <p className="text-sm text-muted-foreground">{item.role}</p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="qr-studio-asset-card__title">{item.name}</h3>
                  {type === "location" && item.role ? (
                    <p className="qr-studio-asset-card__meta">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>{item.role}</span>
                    </p>
                  ) : null}
                </>
              )}
            </header>

            <p className="qr-studio-asset-card__hint">{t(hintKey)}</p>

            <QrStudioDestinationField
              url={item.qrUrl}
              copied={copied}
              onCopy={() => void onCopy(item.id, item.qrUrl)}
            />

            {actionControls}
          </div>
        </div>
      </article>
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
