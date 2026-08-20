import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { MapPin, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { LocationsMultiLocationUpgradeCard } from "../../components/business/LocationsMultiLocationUpgradeCard";
import { fetchLocationsCached, invalidateVenueCatalog } from "../../lib/businessVenueCatalog";
import {
  createLocationAPI,
  deleteLocationAPI,
  updateLocationAPI,
  type LocationDTO,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { LoadingSpinner } from "../../components/ui/loading-spinner";
import { LocationCardGridSkeleton } from "../../components/dashboard/DashboardSectionLoading";
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
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
} from "../../lib/pageSessionCache";

const ACTION_TEAL = "#e9781c";

export function LocationsPage() {
  const { t } = useTranslation();
  const { isBusiness } = useRequireAuth();
  const { ready, limits, hasFeature } = useSubscriptionEntitlements({
    enabled: isBusiness,
    role: "business",
  });
  const [locations, setLocations] = useState<LocationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LocationDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocationDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!isBusiness) {
      setLocations([]);
      setLoading(false);
      return;
    }
    const cacheKey = "business:locations";
    const cached = getPageSessionCache<LocationDTO[]>(cacheKey, PAGE_CACHE_TTL_LOW_MS);
    const useCachedFirst = !quiet && cached !== null;
    if (useCachedFirst) {
      setLocations(cached);
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
    }
    try {
      const list = await fetchLocationsCached({ revalidate: quiet });
      setLocations(list);
      setPageSessionCache(cacheKey, list);
    } catch (e) {
      logClientError("LocationsPage", e);
      if (!useCachedFirst) {
        toast.error(toUserFriendlyMessage(e));
        setLocations([]);
      }
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, [isBusiness]);

  useEffect(() => {
    void load();
  }, [load]);

  const atSingleLocationCap =
    ready && limits.maxLocations != null && locations.length >= limits.maxLocations;
  const showBasicUpgradeCard = ready && !hasFeature("multiLocation");

  const isInitialLocationsLoad = loading && locations.length === 0;
  const { showInitialSkeleton } = useBusinessPageBoot("locations", isInitialLocationsLoad);

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

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("business.locationsPage.toastNameRequired"));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateLocationAPI(editing.id, {
          name: trimmed,
          description: description.trim() || null,
        });
        toast.success(t("business.locationsPage.toastUpdated"));
      } else {
        await createLocationAPI({
          name: trimmed,
          description: description.trim() || undefined,
        });
        toast.success(t("business.locationsPage.toastCreated"));
      }
      setModalOpen(false);
      setEditing(null);
      setName("");
      setDescription("");
      invalidateVenueCatalog();
      await load();
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
      toast.success(t("business.locationsPage.toastDeleted"));
      setDeleteTarget(null);
      invalidateVenueCatalog();
      await load();
    } catch (e) {
      logClientError("LocationsPage", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setDeleting(false);
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
        {showInitialSkeleton ? (
          <LocationCardGridSkeleton />
        ) : locations.length === 0 ? (
          showBasicUpgradeCard ? null : (
            <div className={cn(businessUi.cardStatic, "py-16 text-center text-muted-foreground border-dashed")}>
              <MapPin className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>{t("business.locationsPage.empty")}</p>
            </div>
          )
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {locations.map((loc) => (
              <li
                key={loc.id}
                className={cn(businessUi.cardStatic, "flex gap-3 items-start p-4")}
              >
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
              </li>
            ))}
          </ul>
        )}
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
