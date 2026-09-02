import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { LayoutGrid, MapPin, Pencil, QrCode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { LocationsMultiLocationUpgradeCard } from "../../components/business/LocationsMultiLocationUpgradeCard";
import {
  isAtLocationCap,
  shouldShowMultiLocationUpgradeCard,
} from "../../lib/locationsPageQuotaUi";
import {
  isAtTableCap,
  isTablesCreateDisabled,
  shouldShowTableQuotaNotice,
} from "../../lib/tablesPageQuotaUi";
import { fetchVenueCatalog, writeVenueCatalog } from "../../lib/businessVenueCatalog";
import {
  createLocationAPI,
  createTableAPI,
  deleteLocationAPI,
  updateLocationAPI,
  type LocationDTO,
  type TableDTO,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { LoadingSpinner } from "../../components/ui/loading-spinner";
import { LocationTablesWorkspaceSkeleton } from "../../components/dashboard/DashboardSectionLoading";
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
import { BusinessModuleWorkspaceHeader } from "../../components/business/BusinessModuleWorkspaceHeader";
import { QR_STUDIO_BASE } from "../../components/business/businessDashboardNav";
import { LockedFeatureCard } from "../../components/subscription/LockedFeatureCard";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
} from "../../lib/pageSessionCache";

const ACTION_TEAL = "#e9781c";
const TABLES_QR_HREF = `${QR_STUDIO_BASE}/tables`;

type VenueBundle = { locations: LocationDTO[]; tables: TableDTO[] };

function sortLocations(list: LocationDTO[]): LocationDTO[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function sortTables(list: TableDTO[]): TableDTO[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function LocationsPage() {
  const { t } = useTranslation();
  const { isBusiness } = useRequireAuth();
  const { ready, limits, hasFeature, tier } = useSubscriptionEntitlements({
    enabled: isBusiness,
    role: "business",
  });
  const tableQrEnabled = hasFeature("tableQr");
  const [locations, setLocations] = useState<LocationDTO[]>([]);
  const [tables, setTables] = useState<TableDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LocationDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocationDTO | null>(null);
  const [tableLocation, setTableLocation] = useState<LocationDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingTable, setSavingTable] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tableName, setTableName] = useState("");

  const applyVenue = useCallback((next: VenueBundle) => {
    const locationsNext = sortLocations(next.locations);
    const tablesNext = sortTables(next.tables);
    setLocations(locationsNext);
    setTables(tablesNext);
    setPageSessionCache("business:locations", locationsNext);
    setPageSessionCache("business:tables-bundle", { locations: locationsNext, tables: tablesNext });
    writeVenueCatalog({ locations: locationsNext, tables: tablesNext });
  }, []);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!isBusiness) {
      setLocations([]);
      setTables([]);
      setLoading(false);
      return;
    }
    const bundleCached = getPageSessionCache<VenueBundle>("business:tables-bundle", PAGE_CACHE_TTL_LOW_MS);
    const useCachedFirst = !quiet && bundleCached !== null;
    if (useCachedFirst && bundleCached) {
      setLocations(bundleCached.locations);
      setTables(bundleCached.tables);
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
    }
    try {
      const catalog = await fetchVenueCatalog({
        revalidate: quiet || !useCachedFirst,
      });
      applyVenue({ locations: catalog.locations, tables: catalog.tables });
    } catch (e) {
      logClientError("LocationsPage", e);
      if (!useCachedFirst) {
        toast.error(toUserFriendlyMessage(e));
        setLocations([]);
        setTables([]);
      }
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, [applyVenue, isBusiness]);

  useEffect(() => {
    void load();
  }, [load]);

  const atSingleLocationCap = isAtLocationCap({
    ready,
    maxLocations: limits.maxLocations,
    locationCount: locations.length,
  });
  const showBasicUpgradeCard = shouldShowMultiLocationUpgradeCard({
    ready,
    hasMultiLocation: hasFeature("multiLocation"),
    atLocationCap: atSingleLocationCap,
  });
  const atTableCap = isAtTableCap({
    ready,
    tableQrEnabled,
    maxTables: limits.maxTables,
    tableCount: tables.length,
  });
  const createTableDisabled = isTablesCreateDisabled({
    isBusiness,
    ready,
    tableQrEnabled,
    atTableCap,
  });
  const showTableQuotaNotice = shouldShowTableQuotaNotice({ tableQrEnabled, atTableCap });
  const showTableCapabilityLock = ready && !tableQrEnabled;

  const isInitialLocationsLoad = loading && locations.length === 0;
  const { showInitialSkeleton } = useBusinessPageBoot("locations", isInitialLocationsLoad);

  const tablesByLocation = useMemo(() => {
    const map = new Map<string, TableDTO[]>();
    for (const row of tables) {
      const key = row.locationId || row.location?.id;
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [tables]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setModalOpen(true);
  };

  const openEdit = (loc: LocationDTO) => {
    setEditing(loc);
    setName(loc.name);
    setDescription(loc.description ?? "");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setName("");
    setDescription("");
  };

  const openCreateTable = (loc: LocationDTO) => {
    if (createTableDisabled) return;
    setTableLocation(loc);
    setTableName("");
  };

  const closeTableModal = () => {
    if (savingTable) return;
    setTableLocation(null);
    setTableName("");
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("business.locationsPage.toastNameRequired"));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await updateLocationAPI(editing.id, {
          name: trimmed,
          description: description.trim() || null,
        });
        applyVenue({
          locations: locations.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
          tables: tables.map((row) =>
            row.locationId === updated.id
              ? { ...row, location: { id: updated.id, name: updated.name } }
              : row,
          ),
        });
        toast.success(t("business.locationsPage.toastUpdated"));
      } else {
        const created = await createLocationAPI({
          name: trimmed,
          description: description.trim() || undefined,
        });
        applyVenue({
          locations: [...locations, created],
          tables,
        });
        toast.success(t("business.locationsPage.toastCreated"));
      }
      setModalOpen(false);
      setEditing(null);
      setName("");
      setDescription("");
      void load({ quiet: true });
    } catch (e) {
      logClientError("LocationsPage", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLocationAPI(deleteTarget.id);
      const removedId = deleteTarget.id;
      applyVenue({
        locations: locations.filter((row) => row.id !== removedId),
        tables: tables.filter((row) => row.locationId !== removedId),
      });
      toast.success(t("business.locationsPage.toastDeleted"));
      setDeleteTarget(null);
      void load({ quiet: true });
    } catch (e) {
      logClientError("LocationsPage", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveTable = async () => {
    const trimmed = tableName.trim();
    if (!trimmed) {
      toast.error(t("business.tablesPage.toastNameRequired"));
      return;
    }
    if (!tableLocation) {
      toast.error(t("business.tablesPage.toastNeedLocation"));
      return;
    }
    if (atTableCap) {
      toast.error(t("business.tablesPage.quotaBody"));
      return;
    }
    const locationId = tableLocation.id;
    setSavingTable(true);
    try {
      const created = await createTableAPI({ name: trimmed, locationId });
      const loc =
        created.location ??
        locations.find((row) => row.id === created.locationId) ??
        tableLocation;
      const row: TableDTO = {
        id: created.id,
        name: created.name,
        qrSlug: created.qrSlug,
        locationId: created.locationId || loc.id,
        location: loc ? { id: loc.id, name: loc.name } : { id: locationId, name: tableLocation.name },
      };
      applyVenue({
        locations,
        tables: [...tables, row],
      });
      toast.success(t("business.tablesPage.toastCreated"));
      setTableLocation(null);
      setTableName("");
      void load({ quiet: true });
    } catch (e) {
      logClientError("LocationsPage", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSavingTable(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className={businessUi.subPageTop}>
        <div className="dashboard-page-contained mx-auto w-full max-w-5xl space-y-2.5">
          <div className={businessUi.subPageBreadcrumb}>
            <Button variant="outline" size="sm" asChild>
              <Link to="/dashboard">{t("business.locationsPage.backAria")}</Link>
            </Button>
          </div>
          <BusinessModuleWorkspaceHeader
            personality="locations"
            badge={t("business.locationsPage.eyebrow")}
            icon={MapPin}
            title={t("business.locationsPage.title")}
            subtitle={t("business.locationsPage.subtitle")}
            hideSubtitleOnMobile
            actions={
              <Button
                type="button"
                onClick={openCreate}
                disabled={!isBusiness || atSingleLocationCap}
                className={cn(businessUi.btnPrimary, "w-full sm:w-auto")}
              >
                {t("business.locationsPage.addNew")}
              </Button>
            }
          />
        </div>
      </div>

      <div className={cn(businessUi.subPageMain, "dashboard-page-contained max-w-5xl")}>
        {showTableQuotaNotice ? (
          <section
            id="tables-quota-notice"
            className={cn(businessUi.cardStatic, "mb-6 p-4 sm:p-5")}
            aria-labelledby="tables-quota-title"
          >
            <h2 id="tables-quota-title" className="text-sm font-semibold text-foreground">
              {t("business.tablesPage.quotaTitle")}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {t("business.tablesPage.quotaBody")}
            </p>
          </section>
        ) : null}

        {showInitialSkeleton ? (
          <LocationTablesWorkspaceSkeleton />
        ) : locations.length === 0 ? (
          <div className={cn(businessUi.cardStatic, "py-16 text-center text-muted-foreground border-dashed")}>
            <MapPin className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t("business.locationsPage.empty")}</p>
          </div>
        ) : (
          <ul className="space-y-4">
            {locations.map((loc) => {
              const locTables = tablesByLocation.get(loc.id) ?? [];
              return (
                <li key={loc.id} className={cn(businessUi.cardStatic, "overflow-visible p-4 sm:p-5")}>
                  <div className="flex gap-3 items-start">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${ACTION_TEAL}20` }}
                    >
                      <MapPin className="w-5 h-5" style={{ color: ACTION_TEAL }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">{loc.name}</p>
                      {loc.description ? (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{loc.description}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        aria-label={t("business.locationsPage.editAria", { name: loc.name })}
                        onClick={() => openEdit(loc)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        aria-label={t("business.locationsPage.deleteAria", { name: loc.name })}
                        onClick={() => setDeleteTarget(loc)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 border-t border-border/80 pt-4">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <h2 className="text-sm font-semibold text-foreground">
                        {t("business.locationsPage.tablesHeading")}
                        <span className="ms-2 font-normal text-muted-foreground tabular-nums">
                          {t("business.locationsPage.tableCount", { count: locTables.length })}
                        </span>
                      </h2>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openCreateTable(loc)}
                        disabled={createTableDisabled}
                        aria-disabled={createTableDisabled}
                        aria-describedby={showTableQuotaNotice ? "tables-quota-notice" : undefined}
                        title={
                          showTableQuotaNotice
                            ? t("business.tablesPage.createDisabledAtCapAria")
                            : undefined
                        }
                        className="w-full sm:w-auto"
                      >
                        {t("business.tablesPage.create")}
                      </Button>
                    </div>
                    {locTables.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("business.locationsPage.emptyTables")}
                      </p>
                    ) : (
                      <ul className="divide-y divide-border/80 rounded-lg border border-border/80">
                        {locTables.map((row) => (
                          <li
                            key={row.id}
                            className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                              <span className="truncate font-medium text-foreground">{row.name}</span>
                            </div>
                            <Link
                              to={TABLES_QR_HREF}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-2 hover:underline"
                            >
                              <QrCode className="h-3.5 w-3.5" aria-hidden />
                              {t("business.locationsPage.viewTableQr")}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {showTableCapabilityLock ? (
          <div className={showInitialSkeleton || locations.length > 0 ? "mt-8" : "mt-6"}>
            <LockedFeatureCard featureKey="tableQr" tier={tier} />
          </div>
        ) : null}

        {showBasicUpgradeCard ? (
          <div className={showInitialSkeleton || locations.length > 0 ? "mt-8" : undefined}>
            <LocationsMultiLocationUpgradeCard />
          </div>
        ) : null}
      </div>

      <Dialog open={modalOpen} onOpenChange={(open) => (open ? setModalOpen(true) : closeModal())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("business.locationsPage.editDialogTitle")
                : t("business.locationsPage.dialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? t("business.locationsPage.editDialogDesc")
                : t("business.locationsPage.dialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="loc-name">{t("business.locationsPage.labelName")}</Label>
              <input
                id="loc-name"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder={t("business.locationsPage.placeholderName")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-desc">{t("business.locationsPage.labelDescription")}</Label>
              <textarea
                id="loc-desc"
                className="w-full min-h-[88px] rounded-lg border border-border bg-background px-3 py-2 text-sm resize-y"
                placeholder={t("business.locationsPage.placeholderDescription")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeModal} disabled={saving}>
              {t("business.locationsPage.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              style={{ backgroundColor: ACTION_TEAL }}
            >
              {saving ? <LoadingSpinner size="sm" /> : t("business.locationsPage.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tableLocation != null}
        onOpenChange={(open) => {
          if (!open) closeTableModal();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("business.tablesPage.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("business.locationsPage.createTableDialogDesc", {
                name: tableLocation?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="table-loc-readonly">{t("business.tablesPage.labelLocation")}</Label>
              <p id="table-loc-readonly" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                {tableLocation?.name}
              </p>
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
            <Button type="button" variant="outline" onClick={closeTableModal} disabled={savingTable}>
              {t("business.tablesPage.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveTable()}
              disabled={savingTable || !tableLocation}
              style={{ backgroundColor: ACTION_TEAL }}
            >
              {savingTable ? <LoadingSpinner size="sm" /> : t("business.tablesPage.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("business.locationsPage.deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("business.locationsPage.deleteConfirmBody", {
                name: deleteTarget?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t("business.locationsPage.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleting}
            >
              {deleting ? <LoadingSpinner size="sm" /> : t("business.locationsPage.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
