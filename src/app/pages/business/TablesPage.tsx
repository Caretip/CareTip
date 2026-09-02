import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download, Eye, LayoutGrid, Printer } from "lucide-react";
import { toast } from "sonner";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useCopyFeedback } from "../../hooks/useCopyFeedback";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { LockedFeatureCard } from "../../components/subscription/LockedFeatureCard";
import { resolveTablesPageMainSurface } from "../../lib/tablesPageQuotaUi";
import { fetchVenueCatalog, writeVenueCatalogTables } from "../../lib/businessVenueCatalog";
import { type LocationDTO, type TableDTO } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { qrTableUrl } from "../../lib/appPublicUrl";
import { PLAIN_QR_PREVIEW_WIDTH_PX, renderPlainQrUrlToDataUrl } from "../../lib/plainQr";
import { downloadQrDataUrlPng, printQrDataUrl } from "../../lib/qrExport";
import { canUseProductionQr } from "../../lib/businessVerificationCapabilities";
import { LoadingSpinner } from "../../components/ui/loading-spinner";
import { TablesListSkeleton } from "../../components/dashboard/DashboardSectionLoading";
import { useBusinessPageBoot } from "../../lib/useBusinessPageBoot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { BusinessResponsiveData } from "@/app/components/business/BusinessResponsiveData";
import { TableItemMobileCard } from "@/app/components/business/businessDashboardMobileCards";
import { QrStudioOrderPrintButton } from "@/app/components/business/qr-studio/QrStudioOrderPrintButton";
import { VENUE_MANAGEMENT_HREF } from "@/app/components/business/businessDashboardNav";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
} from "../../lib/pageSessionCache";

type TablesPageCache = { locations: LocationDTO[]; tables: TableDTO[] };

export function TablesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { user, isBusiness } = useRequireAuth();
  const { copy, isCopied } = useCopyFeedback();
  const { tier, ready, hasFeature } = useSubscriptionEntitlements({
    enabled: isBusiness,
    role: "business",
  });
  const tableQrEnabled = hasFeature("tableQr");
  const [tables, setTables] = useState<TableDTO[]>([]);
  const [locations, setLocations] = useState<LocationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [previewTableId, setPreviewTableId] = useState<string | null>(null);
  const qrLocked = !canUseProductionQr(
    user?.onboardingVerificationStatus,
    Boolean(user?.impersonation),
  );

  const applyTablesBundle = useCallback((next: TablesPageCache) => {
    setLocations(next.locations);
    setTables(next.tables);
    setPageSessionCache("business:tables-bundle", next);
    writeVenueCatalogTables(next.tables, next.locations);
  }, []);

  const loadAll = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!isBusiness) {
      setLocations([]);
      setTables([]);
      setLoading(false);
      return;
    }
    const cacheKey = "business:tables-bundle";
    const cached = getPageSessionCache<TablesPageCache>(cacheKey, PAGE_CACHE_TTL_LOW_MS);
    const useCachedFirst = !quiet && cached !== null;
    if (useCachedFirst) {
      setLocations(cached.locations);
      setTables(cached.tables);
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
    }
    try {
      const { locations: locList, tables: tblList } = await fetchVenueCatalog({
        revalidate: quiet || !useCachedFirst,
      });
      applyTablesBundle({ locations: locList, tables: tblList });
    } catch (e) {
      logClientError("TablesPage", e);
      if (!useCachedFirst) {
        toast.error(toUserFriendlyMessage(e));
        setLocations([]);
        setTables([]);
      }
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, [applyTablesBundle, isBusiness]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (tables.length === 0) {
      setQrImages({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        tables.map(async (row) => {
          try {
            next[row.id] = await renderPlainQrUrlToDataUrl(qrTableUrl(row.id), {
              width: PLAIN_QR_PREVIEW_WIDTH_PX,
            });
          } catch (err) {
            logClientError("TablesPage.plainQr", err);
            next[row.id] = "";
          }
        }),
      );
      if (!cancelled) setQrImages(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tables]);

  const tableUrl = (tableId: string) => qrTableUrl(tableId);

  const copyLink = async (tableId: string) => {
    const ok = await copy(tableId, tableUrl(tableId));
    if (!ok) toast.error(t("common.unableToCopy"));
  };

  const copyButtonLabel = (tableId: string) =>
    isCopied(tableId) ? t("common.copied") : t("business.tablesPage.copy");

  const copyButtonIcon = (tableId: string) =>
    isCopied(tableId) ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />;

  const previewTable = previewTableId ? tables.find((row) => row.id === previewTableId) : null;

  const downloadTablePng = (row: TableDTO) => {
    if (qrLocked) return;
    const dataUrl = qrImages[row.id];
    if (!dataUrl) {
      toast.error(t("business.qrPage.toastQrNotReady"));
      return;
    }
    const safe = row.name.replace(/\s+/g, "-").toLowerCase();
    downloadQrDataUrlPng(dataUrl, `caretip-table-${safe}-${row.id.slice(0, 8)}.png`, {
      exportAllowed: true,
    });
  };

  const printTableQr = (row: TableDTO) => {
    if (qrLocked) return;
    const dataUrl = qrImages[row.id];
    if (!dataUrl) {
      toast.error(t("business.qrPage.toastQrNotReady"));
      return;
    }
    if (!printQrDataUrl(dataUrl, row.name, { exportAllowed: true })) {
      toast.error(t("business.qrPage.toastPopupsPdf"));
    }
  };

  const tableQrActions = (row: TableDTO) => (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setPreviewTableId(row.id)}
        disabled={!qrImages[row.id]}
        className="h-8"
      >
        <Eye className="mr-1.5 h-3.5 w-3.5" />
        {t("business.qrStudio.gallery.preview")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => downloadTablePng(row)}
        disabled={qrLocked || !qrImages[row.id]}
        className="h-8"
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        {t("business.qrStudio.gallery.downloadPng")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => printTableQr(row)}
        disabled={qrLocked || !qrImages[row.id]}
        className="h-8"
      >
        <Printer className="mr-1.5 h-3.5 w-3.5" />
        {t("business.qrPage.print")}
      </Button>
    </>
  );

  const isInitialTablesLoad = !ready || loading;
  const { showInitialSkeleton } = useBusinessPageBoot("tables", isInitialTablesLoad);
  const mainSurface = resolveTablesPageMainSurface({
    ready,
    tableQrEnabled,
    showInitialSkeleton,
    locationCount: locations.length,
    tableCount: tables.length,
  });

  const manageTablesCta = (
    <Link
      to={VENUE_MANAGEMENT_HREF}
      className="text-sm font-medium text-primary underline underline-offset-2"
    >
      {t("business.qrStudio.tables.manageCta")}
    </Link>
  );

  return (
    <div className={cn(embedded ? "text-foreground" : "min-h-screen bg-background")}>
      {!embedded ? (
        <div className="bg-card border-b border-border sticky top-0 z-10 backdrop-blur-xl bg-card/80">
          <div className="dashboard-page-contained mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 flex-col gap-2 sm:gap-3">
              <Link
                to="/dashboard"
                className="w-fit shrink-0 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t("business.tablesPage.backAria")}
              </Link>
              <div className="min-w-0 space-y-1">
                <h1 className="truncate text-xl font-bold text-foreground sm:text-2xl">
                  {t("business.qrStudio.tables.pageTitle")}
                </h1>
                <p className="text-sm text-muted-foreground">{t("business.qrStudio.tables.pageDesc")}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {t("business.qrStudio.tables.pageTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("business.qrStudio.tables.pageDesc")}</p>
          </div>
          <QrStudioOrderPrintButton category="tables" className="w-full shrink-0 sm:w-auto" />
        </div>
      )}

      <div
        className={cn(
          embedded
            ? "w-full"
            : "dashboard-page-contained mx-auto w-full max-w-5xl px-4 py-8 sm:px-6",
        )}
      >
        {mainSurface === "capability-lock" ? (
          <LockedFeatureCard featureKey="tableQr" tier={tier} />
        ) : mainSurface === "loading" ? (
          <div className={cn(businessUi.tablePanel, "-mx-4 px-4 sm:mx-0 sm:px-0")}>
            <TablesListSkeleton />
          </div>
        ) : mainSurface === "need-location" ? (
          <div className={cn(businessUi.cardStatic, "py-16 text-center text-muted-foreground border-dashed")}>
            <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="mb-4">{t("business.qrStudio.tables.emptyNeedLocation")}</p>
            {manageTablesCta}
          </div>
        ) : mainSurface === "empty" ? (
          <div className={cn(businessUi.cardStatic, "py-16 text-center text-muted-foreground border-dashed")}>
            <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="mb-4">{t("business.qrStudio.tables.emptyNoTables")}</p>
            {manageTablesCta}
          </div>
        ) : (
          <BusinessResponsiveData
            panelClassName="-mx-4 px-0 sm:mx-0"
            mobile={
              <>
                {tables.map((row) => (
                  <TableItemMobileCard
                    key={row.id}
                    name={row.name}
                    locationName={row.location?.name ?? ""}
                    guestUrl={tableUrl(row.id)}
                    qrDataUrl={qrImages[row.id]}
                    onCopy={() => void copyLink(row.id)}
                    copyLabel={copyButtonLabel(row.id)}
                    copied={isCopied(row.id)}
                    extraActions={tableQrActions(row)}
                  />
                ))}
              </>
            }
            desktop={
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-4 py-3 font-medium text-foreground">{t("business.tablesPage.thTable")}</th>
                    <th className="px-4 py-3 font-medium text-foreground">{t("business.tablesPage.thLocation")}</th>
                    <th className="px-4 py-3 font-medium text-foreground">{t("business.tablesPage.thGuestLink")}</th>
                    <th className="px-4 py-3 font-medium text-foreground">{t("business.qrStudio.gallery.preview")}</th>
                    <th className="px-4 py-3 w-48" />
                  </tr>
                </thead>
                <tbody>
                  {tables.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.location?.name ?? ""}</td>
                      <td className="px-4 py-3">
                        <code className="text-xs break-all text-muted-foreground">{tableUrl(row.id)}</code>
                      </td>
                      <td className="px-4 py-3">
                        {qrImages[row.id] ? (
                          <button
                            type="button"
                            onClick={() => setPreviewTableId(row.id)}
                            className="block rounded-lg border border-black/[0.08] bg-white p-1"
                            aria-label={t("business.qrStudio.gallery.previewAssetAria")}
                          >
                            <img src={qrImages[row.id]} alt="" className="h-14 w-14 object-contain" />
                          </button>
                        ) : (
                          <LoadingSpinner size="sm" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void copyLink(row.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md border border-border hover:bg-muted"
                          >
                            {copyButtonIcon(row.id)}
                            {copyButtonLabel(row.id)}
                          </button>
                          {tableQrActions(row)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
        )}
      </div>

      <Dialog open={previewTableId != null} onOpenChange={(open) => !open && setPreviewTableId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{previewTable?.name ?? t("business.tablesPage.title")}</DialogTitle>
            <DialogDescription>
              {previewTable?.location.name}
            </DialogDescription>
          </DialogHeader>
          {previewTable && qrImages[previewTable.id] ? (
            <div className="flex justify-center rounded-xl border bg-white p-4">
              <img
                src={qrImages[previewTable.id]}
                alt=""
                className="max-h-[min(60vh,360px)] w-full object-contain"
              />
            </div>
          ) : null}
          {previewTable ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void copyLink(previewTable.id)}>
                {isCopied(previewTable.id) ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copyButtonLabel(previewTable.id)}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => downloadTablePng(previewTable)}
                disabled={qrLocked}
              >
                <Download className="mr-2 h-4 w-4" />
                {t("business.qrStudio.gallery.downloadPng")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => printTableQr(previewTable)}
                disabled={qrLocked}
              >
                <Printer className="mr-2 h-4 w-4" />
                {t("business.qrPage.print")}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
