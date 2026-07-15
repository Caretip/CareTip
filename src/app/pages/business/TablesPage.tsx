import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { LockedFeatureCard } from "../../components/subscription/LockedFeatureCard";
import { fetchVenueCatalog, invalidateVenueCatalog } from "../../lib/businessVenueCatalog";
import {
  createTableAPI,
  type LocationDTO,
  type TableDTO,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { qrTableUrl } from "../../lib/appPublicUrl";
import { LoadingSpinner } from "../../components/ui/loading-spinner";
import { TablesListSkeleton } from "../../components/dashboard/DashboardSectionLoading";
import { useBusinessPageBoot } from "../../lib/useBusinessPageBoot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { BusinessResponsiveData } from "@/app/components/business/BusinessResponsiveData";
import { TableItemMobileCard } from "@/app/components/business/businessDashboardMobileCards";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
} from "../../lib/pageSessionCache";

type TablesPageCache = { locations: LocationDTO[]; tables: TableDTO[] };

export function TablesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { isBusiness } = useRequireAuth();
  const { tier, ready, hasFeature, limits } = useSubscriptionEntitlements({
    enabled: isBusiness,
    role: "business",
  });
  const tableQrEnabled = hasFeature("tableQr");
  const [tables, setTables] = useState<TableDTO[]>([]);
  const [locations, setLocations] = useState<LocationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tableName, setTableName] = useState("");
  const [locationId, setLocationId] = useState("");
  const atTableCap =
    ready &&
    tableQrEnabled &&
    limits.maxTables != null &&
    tables.length >= limits.maxTables;

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
      setLocationId((prev) => {
        if (prev && cached.locations.some((l) => l.id === prev)) return prev;
        return cached.locations[0]?.id ?? "";
      });
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
    }
    try {
      const { locations: locList, tables: tblList } = await fetchVenueCatalog({
        revalidate: useCachedFirst,
      });
      setLocations(locList);
      setTables(tblList);
      setPageSessionCache(cacheKey, { locations: locList, tables: tblList });
      setLocationId((prev) => {
        if (prev && locList.some((l) => l.id === prev)) return prev;
        return locList[0]?.id ?? "";
      });
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
  }, [isBusiness]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const tableUrl = (tableId: string) => qrTableUrl(tableId);

  const copyLink = (tableId: string) => {
    void navigator.clipboard.writeText(tableUrl(tableId));
  };

  const handleSave = async () => {
    const trimmed = tableName.trim();
    if (!trimmed) {
      toast.error(t("business.tablesPage.toastNameRequired"));
      return;
    }
    if (!locationId) {
      toast.error(t("business.tablesPage.toastNeedLocation"));
      return;
    }
    setSaving(true);
    try {
      await createTableAPI({ name: trimmed, locationId });
      setModalOpen(false);
      setTableName("");
      invalidateVenueCatalog();
      await loadAll();
    } catch (e) {
      logClientError("TablesPage", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const isInitialTablesLoad = !ready || loading;
  const { showInitialSkeleton } = useBusinessPageBoot("tables", isInitialTablesLoad);

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
                  {t("business.tablesPage.title")}
                </h1>
                {t("business.tablesPage.subtitle").trim() ? (
                  <p className="text-sm text-muted-foreground">{t("business.tablesPage.subtitle")}</p>
                ) : null}
              </div>
            </div>
            <Button
              type="button"
              onClick={() => setModalOpen(true)}
              disabled={!isBusiness || (ready && (!tableQrEnabled || atTableCap))}
              className="w-full shrink-0 sm:w-auto"
            >
              {t("business.tablesPage.create")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{t("business.tablesPage.subtitle")}</p>
          <Button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={!isBusiness || (ready && (!tableQrEnabled || atTableCap))}
            className="w-full shrink-0 sm:w-auto"
          >
            {t("business.tablesPage.create")}
          </Button>
        </div>
      )}

      <div
        className={cn(
          embedded
            ? "w-full"
            : "dashboard-page-contained mx-auto w-full max-w-5xl px-4 py-8 sm:px-6",
        )}
      >
        {ready && !tableQrEnabled ? (
          <LockedFeatureCard featureKey="tableQr" tier={tier} />
        ) : ready && atTableCap ? (
          <div className="mb-6">
            <LockedFeatureCard featureKey="multiLocation" tier={tier} />
          </div>
        ) : showInitialSkeleton ? (
          <div className={cn(businessUi.tablePanel, "-mx-4 px-4 sm:mx-0 sm:px-0")}>
            <TablesListSkeleton />
          </div>
        ) : locations.length === 0 ? (
          <div className={cn(businessUi.cardStatic, "py-16 text-center text-muted-foreground border-dashed")}>
            <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="mb-4">{t("business.tablesPage.emptyNeedLocation")}</p>
            <Link
              to="/dashboard/locations"
              className="text-sm font-medium text-primary underline underline-offset-2"
            >
              {t("business.tablesPage.goToLocations")}
            </Link>
          </div>
        ) : tables.length === 0 ? (
          <div className={cn(businessUi.cardStatic, "py-16 text-center text-muted-foreground border-dashed")}>
            <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t("business.tablesPage.emptyNoTables")}</p>
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
                    locationName={row.location.name}
                    guestUrl={tableUrl(row.id)}
                    onCopy={() => copyLink(row.id)}
                    copyLabel={t("business.tablesPage.copy")}
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
                    <th className="px-4 py-3 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {tables.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.location.name}</td>
                      <td className="px-4 py-3">
                        <code className="text-xs break-all text-muted-foreground">{tableUrl(row.id)}</code>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => copyLink(row.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md border border-border hover:bg-muted"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {t("business.tablesPage.copy")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("business.tablesPage.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("business.tablesPage.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="table-loc">{t("business.tablesPage.labelLocation")}</Label>
              <select
                id="table-loc"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-name">{t("business.tablesPage.labelTableName")}</Label>
              <input
                id="table-name"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t("business.tablesPage.placeholderTable")}
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              {t("business.tablesPage.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || locations.length === 0}
              style={{ backgroundColor: "#e9932f" }}
            >
              {saving ? <LoadingSpinner size="sm" /> : t("business.tablesPage.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
