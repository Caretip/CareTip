import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router";
import {
  QrCode,
  Download,
  FileDown,
  Users,
  MapPin,
  LayoutGrid,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { logClientError } from "../../lib/clientLog";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { canUseProductionQr } from "../../lib/businessVerificationCapabilities";
import { onboardingStatusLabel } from "../../lib/verificationWorkflowUi";
import { fetchVenueCatalog } from "../../lib/businessVenueCatalog";
import {
  getEmployees,
  fetchBusinessProfile,
  regenerateBusinessSlug,
  regenerateEmployeeSlug,
  ensureMissingEmployeeSlugs,
  type EmployeeItem,
  type LocationDTO,
  type TableDTO,
} from "../../lib/api";
import { LoadingSpinner } from "../../components/ui/loading-spinner";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
  PAGE_CACHE_TTL_MEDIUM_MS,
} from "../../lib/pageSessionCache";
import { DashboardListSkeleton } from "../../components/dashboard/DashboardSectionLoading";
import { BusinessSubPageShellSkeleton } from "../../components/dashboard/BusinessSubPageShellSkeleton";
import { useBusinessPageBoot } from "../../lib/useBusinessPageBoot";
import { downloadQrDataUrlPng, printQrDataUrl } from "../../lib/qrExport";
import {
  PLAIN_QR_RENDER_VERSION,
  renderPlainQrUrlToDataUrl,
  validatePlainQrReliability,
} from "../../lib/plainQr";
import type { QrQualityGrade } from "../../lib/qrReliability";
import {
  isQrBusinessNamePlaceholder,
  pickRegisteredBusinessName,
} from "../../lib/businessBranding";
import {
  fallbackManagerQrRenderBranding,
  loadQrRenderBranding,
} from "../../lib/loadQrRenderBranding";
import { useBusinessBrandingOptional } from "../../contexts/BusinessBrandingContext";
import {
  normalizeQrTemplateId,
  QR_TEMPLATE_PRESETS,
} from "../../lib/qrTemplateStyles";
import { getEngineTemplate } from "../../lib/qrTemplateEngine";
import type { QrBrandingOptions } from "../../lib/businessBranding";
import {
  downloadBusinessQrPrintPdf,
  downloadEmployeeQrPrintPdf,
} from "../../lib/qrPrintPdf";
import {
  businessDirectoryUrl,
  qrLandingUrl,
  qrLocationUrl,
  qrTableUrl,
  resolveEmployeeQrUrl,
} from "../../lib/appPublicUrl";
import { downloadStaffQrPdf } from "../../lib/qrBulkPdf";
import {
  mapWithConcurrency,
  renderQrGalleryThumbnail,
  QR_GALLERY_META_CONCURRENCY,
} from "../../lib/qrStudioPerformance";
import { logQrStudioSync } from "../../lib/qrStudioSyncDiagnostics";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { TracingBeam } from "@/components/ui/tracing-beam";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DASH_BTN_PRIMARY, DASH_BTN_SECONDARY } from "@/components/ui/dashboard-styles";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import {
  QrManagementCard,
  formatQrAssetUpdatedAt,
  type QrManagementCardItem,
  type QrAssetMetadata,
} from "@/app/components/business/QrManagementCard";
import { BusinessConfirmDialog } from "@/app/components/business/BusinessConfirmDialog";
import { cn } from "@/lib/utils";

type QrStudioViewMode = "gallery" | "employees" | "locations";

function resolveEmbeddedQrMode(pathname: string): QrStudioViewMode {
  if (pathname.includes("/qr-studio/employees")) return "employees";
  if (pathname.includes("/qr-studio/locations")) return "locations";
  return "gallery";
}

type QRCodeManagementPageProps = {
  /** When true, parent QR Studio shell provides page chrome. */
  embedded?: boolean;
  /** Which QR collection to show when embedded in QR Studio. */
  mode?: "gallery" | "employees" | "locations";
};

export function QRCodeManagementPage({
  embedded = false,
  mode = "gallery",
}: QRCodeManagementPageProps = {}) {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const viewMode: QrStudioViewMode = embedded ? resolveEmbeddedQrMode(pathname) : mode;
  const needsEmployeeData = viewMode === "employees" || viewMode === "gallery";
  const needsVenueData = viewMode === "locations" || viewMode === "gallery";
  const { user, authHydrated, sessionValidated, isBusiness } = useRequireAuth();
  const { tier } = useSubscriptionEntitlements({
    enabled: isBusiness,
    role: "business",
  });
  const brandingTier = tier ?? "basic";
  /** QR Studio SSOT — never reconstruct branding when provider is present. */
  const studioBranding = useBusinessBrandingOptional();
  const usesStudioSsot = studioBranding != null;
  const [onboardingVerificationStatus, setOnboardingVerificationStatus] = useState<
    import("../../lib/api").OnboardingVerificationStatus | null
  >(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [storefrontQr, setStorefrontQr] = useState<string>("");
  const [storefrontQrGenerating, setStorefrontQrGenerating] = useState(false);
  const [qrScanMeta, setQrScanMeta] = useState<
    Record<string, { grade: QrQualityGrade; exportAllowed: boolean }>
  >({});
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<
    | { kind: "regenerate-business" }
    | { kind: "regenerate-employee"; employee: EmployeeItem }
    | null
  >(null);
  const [bulkPdfLoading, setBulkPdfLoading] = useState(false);
  const [businessSlug, setBusinessSlug] = useState<string | null>(null);
  const [businessDisplayName, setBusinessDisplayName] = useState<string | null>(null);
  const [businessLocation, setBusinessLocation] = useState<string | null>(null);
  const [venueLocations, setVenueLocations] = useState<LocationDTO[]>([]);
  const [venueTables, setVenueTables] = useState<TableDTO[]>([]);
  const [venueQrPreview, setVenueQrPreview] = useState<Record<string, string>>({});
  /** Stored API path for venue logo (PDF + print). */
  const [businessLogoPath, setBusinessLogoPath] = useState<string | null>(null);
  /** Legacy fallback only when rendered outside BusinessBrandingProvider. */
  const [legacyQrBrandingOpts, setLegacyQrBrandingOpts] = useState<QrBrandingOptions | null>(null);
  const [assetsSyncedAt, setAssetsSyncedAt] = useState<string | null>(null);
  const employeeQrCacheKeyRef = useRef("");
  const storefrontQrCacheKeyRef = useRef("");
  const venueQrCacheKeyRef = useRef("");
  const lastStudioVersionRef = useRef<number | null>(null);

  const qrBrandingOpts = studioBranding?.snapshot.branding ?? legacyQrBrandingOpts;

  // Sync non-branding profile meta from the Studio provider.
  useEffect(() => {
    if (!studioBranding || studioBranding.loading) return;
    setBusinessDisplayName(studioBranding.businessName || null);
    setBusinessLocation(studioBranding.profileLocation);
    setBusinessLogoPath(studioBranding.profileLogoPath);
    setOnboardingVerificationStatus(studioBranding.onboardingVerificationStatus);
    if (lastStudioVersionRef.current !== studioBranding.snapshot.version) {
      lastStudioVersionRef.current = studioBranding.snapshot.version;
      setAssetsSyncedAt(new Date(studioBranding.snapshot.updatedAt).toISOString());
      logQrStudioSync("branding_version", {
        brandingVersion: studioBranding.snapshot.version,
        updatedAt: studioBranding.snapshot.updatedAt,
        reason: "plain_qr_skips_visual_cache_bust",
      });
    }
  }, [
    studioBranding?.loading,
    studioBranding?.businessName,
    studioBranding?.profileLocation,
    studioBranding?.profileLogoPath,
    studioBranding?.onboardingVerificationStatus,
    studioBranding?.snapshot.version,
    studioBranding?.snapshot.updatedAt,
  ]);

  // Seed slug from provider once; regenerate handlers may override locally.
  useEffect(() => {
    if (!studioBranding?.profileSlug) return;
    setBusinessSlug((prev) => prev ?? studioBranding.profileSlug);
  }, [studioBranding?.profileSlug]);

  const loadLegacyQrBranding = useCallback(async () => {
    if (usesStudioSsot) return;
    if (!user?.businessId || user.role !== "business") return;
    try {
      const profile = await fetchBusinessProfile();
      setBusinessSlug(profile.slug?.trim() || null);
      const registeredName = pickRegisteredBusinessName(
        profile,
        user?.businessName,
        user?.name,
      );
      setBusinessDisplayName(registeredName || null);
      setBusinessLocation(String(profile.registeredAddress ?? profile.location ?? "").trim() || null);
      setBusinessLogoPath(profile.logo?.trim() ? profile.logo : null);
      setOnboardingVerificationStatus(profile.onboardingVerificationStatus ?? null);
      const branding = await loadQrRenderBranding({
        mode: "manager",
        businessId: user.businessId,
        tier: brandingTier,
        fallbackBusinessName:
          String(user?.businessName ?? "").trim() ||
          String(user?.name ?? "").trim() ||
          registeredName ||
          undefined,
        prefetchedProfile: profile,
      });
      if (branding) {
        const cardName =
          registeredName ||
          (!isQrBusinessNamePlaceholder(branding.businessName)
            ? branding.businessName.trim()
            : "") ||
          t("business.qrPage.fallbackBusinessName");
        setLegacyQrBrandingOpts({
          ...branding,
          businessName: cardName,
          templateProfile: {
            ...branding.templateProfile,
            name: registeredName || branding.templateProfile?.name || null,
            registeredAddress:
              branding.templateProfile?.registeredAddress ?? profile.registeredAddress ?? null,
            location: branding.templateProfile?.location ?? profile.location ?? null,
          },
        });
        return;
      }
      const name = registeredName || t("business.qrPage.fallbackBusinessName");
      setLegacyQrBrandingOpts(
        fallbackManagerQrRenderBranding(brandingTier, name, profile.logo, user.businessId),
      );
    } catch (err) {
      logClientError("QRCodeManagementPage.branding", err);
      setOnboardingVerificationStatus(user.onboardingVerificationStatus ?? null);
      setLegacyQrBrandingOpts(
        fallbackManagerQrRenderBranding(
          brandingTier,
          String(businessDisplayName ?? user?.businessName ?? user?.name ?? "").trim() || "Business",
          businessLogoPath,
          user?.businessId,
        ),
      );
    }
  }, [
    usesStudioSsot,
    user?.businessId,
    user?.role,
    user?.businessName,
    user?.name,
    user?.onboardingVerificationStatus,
    brandingTier,
    businessDisplayName,
    businessLogoPath,
    t,
  ]);

  useEffect(() => {
    void loadLegacyQrBranding();
  }, [loadLegacyQrBranding]);

  const venueName = useMemo(
    () =>
      String(businessDisplayName ?? "").trim() ||
      user?.businessName ||
      user?.name ||
      t("business.qrPage.fallbackBusinessName"),
    [businessDisplayName, user?.businessName, user?.name, t],
  );

  const storefrontQrItem = useMemo((): QrManagementCardItem | null => {
    if (!user?.businessId) return null;
    return {
      id: "storefront",
      name: venueName,
      qrUrl: businessSlug ? businessDirectoryUrl(businessSlug) : qrLandingUrl(user.businessId),
    };
  }, [businessSlug, user?.businessId, venueName]);

  const requestRegenerateEmployeeQr = (employee: EmployeeItem) => {
    setPendingDestructiveAction({ kind: "regenerate-employee", employee });
  };

  const requestRegenerateBusinessQr = () => {
    setPendingDestructiveAction({ kind: "regenerate-business" });
  };

  const handleRegenerateBusinessQr = async () => {
    if (!authHydrated || !sessionValidated) return;
    if (qrLocked) return;
    if (!user?.businessId) return;
    setRegeneratingId("storefront");
    try {
      const r = await regenerateBusinessSlug();
      setBusinessSlug(r.slug);
      storefrontQrCacheKeyRef.current = "";
    } catch (err) {
      logClientError("QRCodeManagementPage.regenerateBusinessQr", err);
      toast.error(t("business.qrPage.toastBusinessRegenerateFail"));
    } finally {
      setRegeneratingId(null);
    }
  };

  const loadEmployees = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!authHydrated || !sessionValidated) return;
    if (!user?.businessId) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    const cacheKey = `business:qr-employees:${user.businessId}`;
    const cached = getPageSessionCache<EmployeeItem[]>(cacheKey, PAGE_CACHE_TTL_MEDIUM_MS);
    const useCachedFirst = !quiet && Array.isArray(cached);
    if (useCachedFirst) {
      setEmployees(cached);
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
    }
    try {
      const list = await getEmployees(user.businessId);
      let normalized = Array.isArray(list) ? list : [];

      // QR Studio SSOT: repair missing slugs so branding never disappears for valid staff.
      const missingSlug = normalized.filter((e) => !e.slug?.trim());
      if (missingSlug.length > 0) {
        try {
          const result = await ensureMissingEmployeeSlugs();
          logQrStudioSync("slug_ensure", {
            brandingVersion: studioBranding?.snapshot.version ?? null,
            ensured: result.ensured,
            skipped: result.skipped,
          });
          if (result.ensured.length > 0) {
            const slugById = new Map(result.ensured.map((r) => [r.id, r.slug]));
            normalized = normalized.map((e) => {
              const nextSlug = slugById.get(e.id);
              return nextSlug ? { ...e, slug: nextSlug } : e;
            });
            employeeQrCacheKeyRef.current = "";
          }
        } catch (ensureErr) {
          logClientError("QRCodeManagementPage.ensureSlugs", ensureErr);
          for (const e of missingSlug) {
            logQrStudioSync("employee_skipped", {
              employeeId: e.id,
              slug: e.slug,
              reason: "slug_ensure_failed_using_legacy_url",
              fallbackUrl: resolveEmployeeQrUrl({
                employeeId: e.id,
                businessSlug,
                employeeSlug: e.slug,
              }),
            });
          }
        }
      }

      setEmployees(normalized);
      setPageSessionCache(cacheKey, normalized);
    } catch (err) {
      logClientError("QRCodeManagementPage", err);
      if (!useCachedFirst) {
        setEmployees([]);
        toast.error(t("business.qrPage.toastStaffListFail"));
      }
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, [authHydrated, sessionValidated, user?.businessId, t, studioBranding?.snapshot.version, businessSlug]);

  useEffect(() => {
    if (!needsEmployeeData) {
      setLoading(false);
      return;
    }
    loadEmployees();
  }, [loadEmployees, needsEmployeeData]);

  useEffect(() => {
    if (!authHydrated || !sessionValidated) return;
    if (!user?.businessId || !isBusiness || !needsVenueData) return;
    let cancelled = false;
    const venueCacheKey = `business:qr-venues:${user.businessId}`;
    const venueCached = getPageSessionCache<{ locations: LocationDTO[]; tables: TableDTO[] }>(
      venueCacheKey,
      PAGE_CACHE_TTL_LOW_MS,
    );
    if (venueCached) {
      setVenueLocations(Array.isArray(venueCached.locations) ? venueCached.locations : []);
      setVenueTables(Array.isArray(venueCached.tables) ? venueCached.tables : []);
    }
    void (async () => {
      try {
        const { locations, tables } = await fetchVenueCatalog({
          revalidate: Boolean(venueCached),
        });
        if (cancelled) return;
        setVenueLocations(Array.isArray(locations) ? locations : []);
        setVenueTables(Array.isArray(tables) ? tables : []);
        setPageSessionCache(venueCacheKey, { locations, tables });
      } catch (err) {
        if (cancelled) return;
        logClientError("QRCodeManagementPage.venues", err);
        if (!venueCached) {
          setVenueLocations([]);
          setVenueTables([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHydrated, sessionValidated, user?.businessId, isBusiness, needsVenueData]);

  const safeEmployees = Array.isArray(employees) ? employees : [];
  const safeVenueLocations = Array.isArray(venueLocations) ? venueLocations : [];
  const safeVenueTables = Array.isArray(venueTables) ? venueTables : [];

  const venueQrFingerprint = useMemo(
    () =>
      [
        ...safeVenueLocations.map((l) => `l:${l.id}`),
        ...safeVenueTables.map((t) => `t:${t.id}`),
      ].join("|"),
    [safeVenueLocations, safeVenueTables],
  );

  const employeeQrFingerprint = useMemo(
    () =>
      safeEmployees
        .map((e) => `${e.id}:${e.slug ?? ""}`)
        .sort()
        .join("|"),
    [safeEmployees],
  );

  useEffect(() => {
    if (studioBranding?.loading) return;
    if (!needsVenueData || !venueQrFingerprint) return;
    const cacheKey = `${venueQrFingerprint}|${PLAIN_QR_RENDER_VERSION}`;
    if (venueQrCacheKeyRef.current === cacheKey) return;
    let cancelled = false;
    (async () => {
      const tasks = [
        ...safeVenueLocations.map((loc) => ({
          key: `loc-${loc.id}`,
          url: qrLocationUrl(loc.id),
        })),
        ...safeVenueTables.map((tbl) => ({
          key: `tbl-${tbl.id}`,
          url: qrTableUrl(tbl.id),
        })),
      ];
      const thumbResults = await Promise.all(
        tasks.map(async ({ key, url }) => ({
          key,
          dataUrl: await renderQrGalleryThumbnail(url).catch(() => ""),
        })),
      );
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const { key, dataUrl } of thumbResults) {
        next[key] = dataUrl;
      }
      venueQrCacheKeyRef.current = cacheKey;
      setVenueQrPreview(next);
      setAssetsSyncedAt(new Date().toISOString());

      const metaResults = await mapWithConcurrency(tasks, QR_GALLERY_META_CONCURRENCY, async ({ key, url }) => {
        try {
          const { report } = await validatePlainQrReliability(url);
          return { key, report };
        } catch (err) {
          logClientError("QRCodeManagementPage", err);
          return { key, report: null };
        }
      });
      if (cancelled) return;
      const meta: Record<string, { grade: QrQualityGrade; exportAllowed: boolean }> = {};
      for (const { key, report } of metaResults) {
        if (report) meta[key] = { grade: report.grade, exportAllowed: report.exportAllowed };
      }
      setQrScanMeta((prev) => ({ ...prev, ...meta }));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    studioBranding?.loading,
    needsVenueData,
    venueQrFingerprint,
    safeVenueLocations,
    safeVenueTables,
  ]);

  useEffect(() => {
    if (studioBranding?.loading) return;
    if (viewMode !== "employees") return;
    const businessId = user?.businessId;
    if (!businessId) return;
    const cacheKey = `${businessId}|${businessSlug ?? ""}|${PLAIN_QR_RENDER_VERSION}`;
    if (storefrontQrCacheKeyRef.current === cacheKey) return;
    let cancelled = false;
    setStorefrontQrGenerating(true);
    (async () => {
      const storeUrl = businessSlug
        ? businessDirectoryUrl(businessSlug)
        : qrLandingUrl(businessId);
      try {
        const dataUrl = await renderQrGalleryThumbnail(storeUrl);
        if (!cancelled) {
          storefrontQrCacheKeyRef.current = cacheKey;
          setStorefrontQr(dataUrl);
        }
        const { report } = await validatePlainQrReliability(storeUrl);
        if (!cancelled && report) {
          setQrScanMeta((prev) => ({
            ...prev,
            storefront: { grade: report.grade, exportAllowed: report.exportAllowed },
          }));
        }
      } catch (err) {
        logClientError("QRCodeManagementPage.storefrontQr", err);
        if (!cancelled) setStorefrontQr("");
      } finally {
        if (!cancelled) setStorefrontQrGenerating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studioBranding?.loading, viewMode, user?.businessId, businessSlug]);

  useEffect(() => {
    if (studioBranding?.loading) return;
    if (!needsEmployeeData) return;
    const businessId = user?.businessId;
    if (!businessId) return;
    const cacheKey = `${businessId}|${businessSlug ?? ""}|${employeeQrFingerprint}|${PLAIN_QR_RENDER_VERSION}`;
    if (employeeQrCacheKeyRef.current === cacheKey) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      const meta: Record<string, { grade: QrQualityGrade; exportAllowed: boolean }> = {};

      // Every roster employee gets a resolvable QR URL (canonical slug or legacy id).
      const employeeTasks = safeEmployees
        .map((e) => {
          const url = resolveEmployeeQrUrl({
            employeeId: e.id,
            businessSlug,
            employeeSlug: e.slug,
          });
          if (!url) {
            logQrStudioSync("employee_skipped", {
              employeeId: e.id,
              slug: e.slug,
              reason: "no_employee_id",
            });
            return null;
          }
          return {
            id: e.id,
            name: e.name,
            slug: e.slug?.trim() || null,
            url,
          };
        })
        .filter((t): t is { id: string; name: string; slug: string | null; url: string } => t != null);

      const thumbResults = await Promise.all(
        employeeTasks.map(async (task) => {
          try {
            const dataUrl = await renderQrGalleryThumbnail(task.url);
            logQrStudioSync("preview_generation", {
              employeeId: task.id,
              slug: task.slug,
              url: task.url,
              success: Boolean(dataUrl),
            });
            return { id: task.id, dataUrl };
          } catch (err) {
            logClientError("QRCodeManagementPage.employeeThumb", err);
            logQrStudioSync("preview_generation", {
              employeeId: task.id,
              slug: task.slug,
              url: task.url,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
            return { id: task.id, dataUrl: "" };
          }
        }),
      );
      for (const { id, dataUrl } of thumbResults) {
        next[id] = dataUrl;
      }
      if (!cancelled) {
        employeeQrCacheKeyRef.current = cacheKey;
        setQrImages(next);
        setAssetsSyncedAt(new Date().toISOString());
        logQrStudioSync("regeneration_complete", {
          employeeCount: employeeTasks.length,
          renderedCount: thumbResults.filter((r) => Boolean(r.dataUrl)).length,
        });
      }

      if (employeeTasks.length > 0) {
        const restMeta = await mapWithConcurrency(
          employeeTasks,
          QR_GALLERY_META_CONCURRENCY,
          async (task) => {
            try {
              const { report } = await validatePlainQrReliability(task.url);
              return { id: task.id, report };
            } catch (err) {
              logClientError("QRCodeManagementPage", err);
              return { id: task.id, report: null };
            }
          },
        );
        for (const { id, report } of restMeta) {
          if (report) meta[id] = { grade: report.grade, exportAllowed: report.exportAllowed };
        }
      }

      if (!cancelled) {
        setQrScanMeta((prev) => ({ ...prev, ...meta }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    studioBranding?.loading,
    needsEmployeeData,
    safeEmployees,
    employeeQrFingerprint,
    user?.businessId,
    businessSlug,
  ]);

  const locations: Array<{ id: string; name: string; address: string; qrUrl: string }> =
    safeVenueLocations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      address: loc.description?.trim() || "N/A",
      qrUrl: qrLocationUrl(loc.id),
    }));

  type GalleryAssetEntry = {
    key: string;
    item: QrManagementCardItem;
    type: "storefront" | "employee" | "table" | "location";
    previewDataUrl?: string;
    metadata: QrAssetMetadata;
    exportKey: string;
  };

  const galleryAssets = useMemo((): GalleryAssetEntry[] => {
    if (!user?.businessId) return [];

    const templateId = normalizeQrTemplateId(qrBrandingOpts?.qrTemplate);
    const engineTpl = getEngineTemplate(templateId);
    const templateLabel = engineTpl
      ? t(engineTpl.labelKey)
      : t(QR_TEMPLATE_PRESETS[templateId].labelKey);
    const lastUpdatedLabel = formatQrAssetUpdatedAt(assetsSyncedAt, i18n.language);
    const venueName =
      String(businessDisplayName ?? "").trim() ||
      user.businessName ||
      t("business.qrPage.fallbackBusinessName");

    const assets: GalleryAssetEntry[] = [
      {
        key: "storefront",
        type: "storefront",
        item: {
          id: "storefront",
          name: venueName,
          qrUrl: businessSlug ? businessDirectoryUrl(businessSlug) : qrLandingUrl(user.businessId),
        },
        previewDataUrl: storefrontQr,
        exportKey: "storefront",
        metadata: {
          templateLabel,
          lastUpdatedLabel,
          typeLabel: t("business.qrStudio.gallery.assetType.storefront"),
          ownershipLabel: t("business.qrStudio.gallery.ownershipStorefront", { name: venueName }),
        },
      },
    ];

    for (const employee of safeEmployees) {
      assets.push({
        key: `emp-${employee.id}`,
        type: "employee",
        item: {
          id: employee.id,
          name: employee.name,
          role: employee.role,
          avatar: employee.avatar,
          slug: employee.slug,
          qrUrl: resolveEmployeeQrUrl({
            employeeId: employee.id,
            businessSlug,
            employeeSlug: employee.slug,
          }),
        },
        previewDataUrl: qrImages[employee.id],
        exportKey: employee.id,
        metadata: {
          templateLabel,
          lastUpdatedLabel,
          typeLabel: t("business.qrStudio.gallery.assetType.employee"),
          ownershipLabel: t("business.qrStudio.gallery.ownershipEmployee", { name: employee.name }),
        },
      });
    }

    for (const loc of safeVenueLocations) {
      assets.push({
        key: `loc-${loc.id}`,
        type: "location",
        item: {
          id: loc.id,
          name: loc.name,
          role: loc.description?.trim() || undefined,
          qrUrl: qrLocationUrl(loc.id),
        },
        previewDataUrl: venueQrPreview[`loc-${loc.id}`],
        exportKey: `loc-${loc.id}`,
        metadata: {
          templateLabel,
          lastUpdatedLabel,
          typeLabel: t("business.qrStudio.gallery.assetType.location"),
          ownershipLabel: loc.description?.trim()
            ? t("business.qrStudio.gallery.ownershipLocationNamed", {
                name: loc.name,
                area: loc.description,
              })
            : t("business.qrStudio.gallery.ownershipLocation", { name: loc.name }),
        },
      });
    }

    for (const tbl of safeVenueTables) {
      assets.push({
        key: `tbl-${tbl.id}`,
        type: "table",
        item: {
          id: tbl.id,
          name: tbl.name,
          role: tbl.location?.name,
          qrUrl: qrTableUrl(tbl.id),
        },
        previewDataUrl: venueQrPreview[`tbl-${tbl.id}`],
        exportKey: `tbl-${tbl.id}`,
        metadata: {
          templateLabel,
          lastUpdatedLabel,
          typeLabel: t("business.qrStudio.gallery.assetType.table"),
          ownershipLabel: t("business.qrStudio.gallery.ownershipTable", {
            table: tbl.name,
            location: tbl.location?.name ?? venueName,
          }),
        },
      });
    }

    return assets;
  }, [
    user?.businessId,
    user?.businessName,
    qrBrandingOpts?.qrTemplate,
    assetsSyncedAt,
    i18n.language,
    t,
    businessDisplayName,
    businessSlug,
    storefrontQr,
    safeEmployees,
    safeVenueLocations,
    safeVenueTables,
    qrImages,
    venueQrPreview,
  ]);

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const scanMetaForKey = (key: string) => qrScanMeta[key];
  const isQrExportBlocked = (key: string) => scanMetaForKey(key)?.exportAllowed === false;

  type CardItem = {
    id: string;
    name: string;
    role?: string;
    avatar?: string | null;
    qrUrl: string;
    slug?: string | null;
    employeeRow?: EmployeeItem;
    location?: string;
    address?: string;
  };

  const handleGenerateNew = async (employee: EmployeeItem) => {
    if (!authHydrated || !sessionValidated) return;
    if (!isBusiness) return;
    setRegeneratingId(employee.id);
    try {
      const updated = await regenerateEmployeeSlug(employee.id);
      setEmployees((prev) =>
        (Array.isArray(prev) ? prev : []).map((p) =>
          p.id === updated.id
            ? { ...p, slug: updated.slug, name: updated.name, role: updated.jobTitle }
            : p
        )
      );
      if (updated.slug || updated.id) {
        const url = resolveEmployeeQrUrl({
          employeeId: updated.id,
          businessSlug,
          employeeSlug: updated.slug,
        });
        const dataUrl = await renderPlainQrUrlToDataUrl(url);
        logQrStudioSync("png_generation", {
          mode: "regenerate_employee",
          employeeId: updated.id,
          slug: updated.slug,
          url,
          brandingVersion: studioBranding?.snapshot.version ?? null,
          success: Boolean(dataUrl),
        });
        setQrImages((prev) => ({ ...prev, [employee.id]: dataUrl }));
      }
    } catch (err) {
      logClientError("QRCodeManagementPage", err);
      toast.error(t("business.qrPage.toastQrGenerateFail"));
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleConfirmDestructiveAction = async () => {
    if (!pendingDestructiveAction) return;
    const action = pendingDestructiveAction;
    setPendingDestructiveAction(null);
    if (action.kind === "regenerate-business") {
      await handleRegenerateBusinessQr();
      return;
    }
    await handleGenerateNew(action.employee);
  };

  const buildVenueQrDataUrl = async (
    item: CardItem,
    previewDataUrl: string | undefined
  ): Promise<string | null> => {
    if (previewDataUrl) return previewDataUrl;
    if (!item.qrUrl) return null;
    try {
      return await renderPlainQrUrlToDataUrl(item.qrUrl);
    } catch (err) {
      logClientError("QRCodeManagementPage.buildVenueQr", err);
      return null;
    }
  };

  const handleVenueQrDownload = async (
    item: CardItem,
    type: "storefront" | "table" | "location",
    previewDataUrl?: string
  ) => {
    const metaKey =
      type === "storefront" ? "storefront" : type === "location" ? `loc-${item.id}` : `tbl-${item.id}`;
    if (isQrExportBlocked(metaKey)) {
      toast.error(t("business.qrReliability.exportBlocked"));
      return;
    }
    const dataUrl = await buildVenueQrDataUrl(item, previewDataUrl);
    if (!dataUrl) {
      toast.error(t("business.qrPage.toastQrNotReady"));
      return;
    }
    const safe = item.name.replace(/\s+/g, "-").toLowerCase();
    const prefix =
      type === "storefront"
        ? `caretip-${safe || "business"}`
        : type === "table"
          ? `caretip-table-${safe}-${item.id.slice(0, 8)}`
          : `caretip-location-${safe}-${item.id.slice(0, 8)}`;
    downloadQrDataUrlPng(dataUrl, `${prefix}.png`, { exportAllowed: true });
  };

  const handleVenueQrPrint = async (
    item: CardItem,
    type: "storefront" | "table" | "location",
    previewDataUrl?: string
  ) => {
    const metaKey =
      type === "storefront" ? "storefront" : type === "location" ? `loc-${item.id}` : `tbl-${item.id}`;
    if (isQrExportBlocked(metaKey)) {
      toast.error(t("business.qrReliability.exportBlocked"));
      return;
    }
    const dataUrl = await buildVenueQrDataUrl(item, previewDataUrl);
    if (!dataUrl) {
      toast.error(t("business.qrPage.toastQrNotReady"));
      return;
    }
    const heading =
      String(businessDisplayName ?? "").trim() ||
      String(item.name ?? "").trim() ||
      t("business.qrPage.fallbackBusinessName");
    if (!printQrDataUrl(dataUrl, heading, { exportAllowed: true })) {
      toast.error(t("business.qrPage.toastPopupsPdf"));
    }
  };

  const handleGenerateAllPdf = async () => {
    if (!authHydrated || !sessionValidated) return;
    const staff = safeEmployees
      .map((e) => ({
        id: e.id,
        name: e.name,
        businessSlug: businessSlug?.trim() || undefined,
        employeeSlug: e.slug?.trim() || undefined,
      }))
      .filter((e) => e.id?.trim());
    if (staff.length === 0) {
      toast.error(t("business.qrPage.toastBulkAddStaff"));
      return;
    }
    setBulkPdfLoading(true);
    try {
      const { venueLocalTodayKey, resolveBusinessTimezone } = await import("../../lib/businessVenueTime");
      const dateStr = venueLocalTodayKey(resolveBusinessTimezone());
      logQrStudioSync("pdf_generation", {
        mode: "bulk",
        brandingVersion: studioBranding?.snapshot.version ?? null,
        employeeCount: staff.length,
      });
      await downloadStaffQrPdf(staff, `CareTip_QR_All_${dateStr}`, {
        resolveCardDataUrl: (id) => qrImages[id] ?? null,
      });
    } catch (err) {
      logClientError("QRCodeManagementPage", err);
      toast.error(t("business.qrPage.toastPdfFail"));
    } finally {
      setBulkPdfLoading(false);
    }
  };

  const handleVenuePrintPdf = async (
    item: CardItem,
    type: "storefront" | "table" | "location",
    previewDataUrl?: string
  ) => {
    const dataUrl = await buildVenueQrDataUrl(item, previewDataUrl);
    if (!dataUrl) {
      toast.error(t("business.qrPage.toastQrNotReady"));
      return;
    }
    try {
      const displayBusinessName =
        String(businessDisplayName ?? "").trim() ||
        (type === "storefront" ? String(item.name ?? "").trim() : "") ||
        String(user?.businessName ?? "").trim() ||
        t("business.qrPage.fallbackBusinessName");
      await downloadBusinessQrPrintPdf({
        qrPngDataUrl: dataUrl,
        fileBaseName:
          type === "storefront"
            ? `CareTip_QR_${displayBusinessName}`
            : type === "table"
              ? `CareTip_QR_Table_${displayBusinessName}_${item.name}`
              : `CareTip_QR_Location_${displayBusinessName}_${item.name}`,
      });
    } catch (err) {
      logClientError("QRCodeManagementPage.printPdf", err);
      toast.error(t("business.qrPage.toastPdfFail"));
    }
  };

  const handleEmployeePrintPdf = async (item: CardItem) => {
    if (isQrExportBlocked(item.id)) {
      toast.error(t("business.qrReliability.exportBlocked"));
      return;
    }
    let dataUrl = qrImages[item.id]?.trim() || "";
    if (!dataUrl) {
      const url =
        item.qrUrl?.trim() ||
        resolveEmployeeQrUrl({
          employeeId: item.id,
          businessSlug,
          employeeSlug: item.slug,
        });
      if (!url) {
        toast.error(t("business.qrPage.toastQrNotReady"));
        return;
      }
      try {
        dataUrl = await renderPlainQrUrlToDataUrl(url);
        logQrStudioSync("pdf_generation", {
          mode: "lazy",
          employeeId: item.id,
          slug: item.slug ?? null,
          url,
          brandingVersion: studioBranding?.snapshot.version ?? null,
          success: Boolean(dataUrl),
        });
        if (dataUrl) {
          setQrImages((prev) => ({ ...prev, [item.id]: dataUrl }));
        }
      } catch (err) {
        logClientError("QRCodeManagementPage.employeePrintPdf.lazy", err);
        logQrStudioSync("pdf_generation", {
          mode: "lazy",
          employeeId: item.id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logQrStudioSync("pdf_generation", {
        mode: "cache",
        employeeId: item.id,
        slug: item.slug ?? null,
        brandingVersion: studioBranding?.snapshot.version ?? null,
        success: true,
      });
    }
    if (!dataUrl) {
      toast.error(t("business.qrPage.toastQrNotReady"));
      return;
    }
    try {
      await downloadEmployeeQrPrintPdf({
        qrPngDataUrl: dataUrl,
        fileBaseName: `CareTip_QR_${item.name}`,
      });
    } catch (err) {
      logClientError("QRCodeManagementPage.employeePrintPdf", err);
      toast.error(t("business.qrPage.toastPdfFail"));
    }
  };

  const handleEmployeePrint = async (item: CardItem, previewDataUrl?: string) => {
    if (isQrExportBlocked(item.id)) {
      toast.error(t("business.qrReliability.exportBlocked"));
      return;
    }
    let dataUrl = previewDataUrl || qrImages[item.id];
    if (!dataUrl) {
      const url =
        item.qrUrl?.trim() ||
        resolveEmployeeQrUrl({
          employeeId: item.id,
          businessSlug,
          employeeSlug: item.slug,
        });
      if (url) {
        try {
          dataUrl = await renderPlainQrUrlToDataUrl(url);
          if (dataUrl) setQrImages((prev) => ({ ...prev, [item.id]: dataUrl! }));
        } catch (err) {
          logClientError("QRCodeManagementPage.employeePrint.lazy", err);
        }
      }
    }
    if (!dataUrl) {
      toast.error(t("business.qrPage.toastQrNotReady"));
      return;
    }
    if (!printQrDataUrl(dataUrl, item.name, { exportAllowed: true })) {
      toast.error(t("business.qrPage.toastPopupsPdf"));
    }
  };

  const onEmployeeRegenerateCard = (item: QrManagementCardItem) => {
    const emp = safeEmployees.find((e) => e.id === item.id);
    if (emp) requestRegenerateEmployeeQr(emp);
  };

  const isInitialQrLoad = loading && safeEmployees.length === 0;
  const { showInitialSkeleton } = useBusinessPageBoot("qr", isInitialQrLoad);

  if (!user) return <BusinessSubPageShellSkeleton />;

  const canUseQr = canUseProductionQr(
    user?.onboardingVerificationStatus,
    Boolean(user.impersonation),
  );

  const qrLocked = !canUseQr;

  const resolvedOnboardingVerificationStatus =
    onboardingVerificationStatus ?? user.onboardingVerificationStatus;
  const awaitingOnboardingStatus =
    !user.impersonation &&
    user.role === "business" &&
    Boolean(user.businessId) &&
    resolvedOnboardingVerificationStatus == null;

  if (awaitingOnboardingStatus) {
    return <BusinessSubPageShellSkeleton />;
  }

  if (qrLocked && !embedded) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center text-foreground",
          embedded ? "py-12" : "min-h-screen bg-background px-6 pb-20",
        )}
      >
        <div className="max-w-lg space-y-4 text-center">
          <QrCode className="mx-auto h-14 w-14 opacity-40" />
          <h1 className="text-2xl font-bold">{t("business.qrPage.pendingTitle")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("business.qrPage.pendingBody")}</p>
          {!embedded ? (
            <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button asChild variant="outline">
                <Link to="/dashboard">{t("business.qrPage.backDashboard")}</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const statusLabel = onboardingStatusLabel(
    onboardingVerificationStatus ?? user?.onboardingVerificationStatus,
    t,
  );

  const atAGlanceCard = !embedded ? (
    <Card className={businessUi.atAGlanceCard}>
      <CardContent className={businessUi.atAGlanceContent}>
        <p className={businessUi.atAGlanceLabel}>{t("business.qrPage.atAGlance")}</p>
            <div className={businessUi.atAGlanceGrid}>
          <div>
            <p className={businessUi.atAGlanceStatLabel}>{t("business.qrPage.statStaff")}</p>
            <p className={businessUi.atAGlanceStatValue}>{safeEmployees.length}</p>
          </div>
          <div>
            <p className={businessUi.atAGlanceStatLabel}>{t("business.qrPage.statOnboardingVerification")}</p>
            <p className={businessUi.atAGlanceStatValue}>{statusLabel}</p>
          </div>
          <div>
            <p className={businessUi.atAGlanceStatLabel}>{t("business.qrPage.statSlug")}</p>
            <p className={businessUi.atAGlanceStatValue}>
              {businessSlug ? t("status.live") : t("business.qrPage.slugNa")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  ) : null;

  const galleryInventoryCard = embedded && viewMode === "gallery" ? (
    <Card className={businessUi.atAGlanceCard}>
      <CardContent className={businessUi.atAGlanceContent}>
        <p className={businessUi.atAGlanceLabel}>{t("business.qrStudio.gallery.inventoryTitle")}</p>
        <p className="mb-3 text-xs text-muted-foreground">{t("business.qrStudio.gallery.inventoryDesc")}</p>
            <div className={businessUi.atAGlanceGrid}>
          <div>
            <p className={businessUi.atAGlanceStatLabel}>{t("business.qrStudio.gallery.statEmployees")}</p>
            <p className={businessUi.atAGlanceStatValue}>{safeEmployees.length}</p>
          </div>
          <div>
            <p className={businessUi.atAGlanceStatLabel}>{t("business.qrStudio.gallery.statLocations")}</p>
            <p className={businessUi.atAGlanceStatValue}>{safeVenueLocations.length}</p>
          </div>
          <div>
            <p className={businessUi.atAGlanceStatLabel}>{t("business.qrStudio.gallery.statTables")}</p>
            <p className={businessUi.atAGlanceStatValue}>{safeVenueTables.length}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  ) : null;

  const quickAccessLinks = [
    {
      href: "/dashboard/qr-studio/employees",
      labelKey: "business.qrStudio.gallery.manageEmployees",
      icon: Users,
      count: safeEmployees.length,
    },
    {
      href: "/dashboard/qr-studio/locations",
      labelKey: "business.qrStudio.gallery.manageLocations",
      icon: MapPin,
      count: safeVenueLocations.length,
    },
    {
      href: "/dashboard/qr-studio/tables",
      labelKey: "business.qrStudio.gallery.manageTables",
      icon: LayoutGrid,
      count: safeVenueTables.length,
    },
  ] as const;

  return (
    <div className={cn(embedded ? "text-foreground" : "min-h-screen bg-background pb-20 text-foreground")}>
      <div className={embedded ? "space-y-6" : businessUi.subPageTop}>
        {!embedded ? (
          <>
            <div className={businessUi.subPageBreadcrumb}>
              <Button variant="outline" size="sm" asChild>
                <Link to="/dashboard">{t("business.qrPage.backDashboard")}</Link>
              </Button>
            </div>

            <DashboardHero
              stackHeroOnMobile
              hideTabs
              hideImage
              className={businessUi.subPageHero}
              badgeClassName={businessUi.heroBadge}
              badge={
                <>
                  <QrCode className="h-3.5 w-3.5 text-foreground" />
                  {qrLocked ? t("business.qrPage.badgePending") : t("business.qrPage.badgePrintable")}
                </>
              }
              title={t("business.qrPage.heroTitle")}
              description={businessSlug ? t("business.qrPage.heroDescWithSlug") : t("business.qrPage.heroDescNoSlug")}
              actions={
                <div className="dashboard-hero-actions dashboard-hero-actions--uniform">
                  <Button
                    type="button"
                    className={cn(businessUi.btnPrimary, businessUi.heroActionBtn)}
                    onClick={handleGenerateAllPdf}
                    disabled={qrLocked || bulkPdfLoading || safeEmployees.length === 0}
                  >
                    {bulkPdfLoading ? (
                      <LoadingSpinner size="sm" className="mr-2 shrink-0" />
                    ) : (
                      <FileDown className="mr-2 h-4 w-4 shrink-0" />
                    )}
                    {t("business.qrPage.allPdfs")}
                  </Button>
                </div>
              }
            />
          </>
        ) : null}

        {atAGlanceCard}
        {galleryInventoryCard}
      </div>

      {qrLocked ? (
        <div className="w-full px-4 sm:px-6">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
            <p className="font-semibold text-foreground">{t("business.qrPage.reviewBody")}</p>
            <p className="mt-1 text-muted-foreground">{t("business.qrPage.qrLockedSub")}</p>
          </div>
        </div>
      ) : null}

      <TracingBeam className={cn(embedded ? "mt-6" : businessUi.subPageMain, "pb-4")}>
        <div className="space-y-6">
          <div className="w-full min-w-0">
            {viewMode === "gallery" && user?.businessId ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {t("business.qrStudio.gallery.libraryTitle")}
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    {t("business.qrStudio.gallery.libraryDesc")}
                  </p>
                </div>

                {galleryAssets.length === 0 ? (
                  <div className={cn(businessUi.cardStatic, businessUi.chartEmpty, "py-12 text-center")}>
                    <p className="text-muted-foreground">{t("business.qrStudio.gallery.libraryEmpty")}</p>
                  </div>
                ) : (
                  <div className="qr-studio-employee-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {galleryAssets.map((asset) => (
                      <QrManagementCard
                        key={asset.key}
                        item={asset.item}
                        type={asset.type}
                        layout="library"
                        metadata={asset.metadata}
                        previewDataUrl={asset.previewDataUrl}
                        copiedId={copiedId}
                        qrLocked={qrLocked}
                        regeneratingId={regeneratingId}
                        onCopy={handleCopy}
                        onEmployeePrint={(item, url) => void handleEmployeePrint(item as CardItem, url)}
                        onEmployeePrintPdf={(item) => void handleEmployeePrintPdf(item as CardItem)}
                        onEmployeeRegenerate={onEmployeeRegenerateCard}
                        onVenuePrint={(item, venueType, url) =>
                          void handleVenueQrPrint(item as CardItem, venueType, url)
                        }
                        onVenuePrintPdf={(item, venueType, url) =>
                          void handleVenuePrintPdf(item as CardItem, venueType, url)
                        }
                        onRegenerateBusinessQr={requestRegenerateBusinessQr}
                        exportBlocked={isQrExportBlocked(asset.exportKey)}
                      />
                    ))}
                  </div>
                )}

                <Card className={businessUi.cardStatic}>
                  <CardContent className="space-y-3 pt-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {t("business.qrStudio.gallery.quickAccessTitle")}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("business.qrStudio.gallery.quickAccessDesc")}
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {quickAccessLinks.map((link) => {
                        const Icon = link.icon;
                        return (
                          <Link
                            key={link.href}
                            to={link.href}
                            className={cn(
                              businessUi.cardStatic,
                              "flex items-center justify-between gap-2 rounded-xl border px-3.5 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.04]",
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                              <span className="truncate">{t(link.labelKey)}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                              <span className="text-xs tabular-nums">{link.count}</span>
                              <ChevronRight className="h-4 w-4" aria-hidden />
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {viewMode === "employees" ? (
              <div className="space-y-8">
                {storefrontQrItem ? (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">
                        {t("business.qrPage.storefrontQrHeading", { name: venueName })}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("business.qrPage.storefrontQrDesc")}
                      </p>
                    </div>
                    {storefrontQrGenerating && !storefrontQr ? (
                      <div
                        className={cn(businessUi.cardStatic, businessUi.cardPad, "animate-pulse")}
                        aria-busy="true"
                        aria-label={t("business.qrPage.storefrontQrHeading", { name: venueName })}
                      >
                        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-6">
                          <div className="mx-auto aspect-square w-full max-w-[10.5rem] rounded-xl bg-muted sm:max-w-[12rem] lg:mx-0 lg:h-44 lg:w-44" />
                          <div className="flex-1 space-y-4">
                            <div className="space-y-2">
                              <div className="h-3 w-28 rounded bg-muted" />
                              <div className="h-4 w-full max-w-md rounded bg-muted" />
                            </div>
                            <div className="h-16 rounded-lg bg-muted" />
                            <div className="flex flex-wrap justify-end gap-2">
                              <div className="h-9 w-28 rounded bg-muted" />
                              <div className="h-9 w-24 rounded bg-muted" />
                              <div className="h-9 w-32 rounded bg-muted" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <QrManagementCard
                        item={storefrontQrItem}
                        type="storefront"
                        previewDataUrl={storefrontQr}
                        copiedId={copiedId}
                        qrLocked={qrLocked}
                        regeneratingId={regeneratingId}
                        onCopy={handleCopy}
                        onRegenerateBusinessQr={requestRegenerateBusinessQr}
                        onVenuePrint={(item, venueType, url) =>
                          void handleVenueQrPrint(item as CardItem, venueType, url)
                        }
                        onVenuePrintPdf={(item, venueType, url) =>
                          void handleVenuePrintPdf(item as CardItem, venueType, url)
                        }
                        exportBlocked={isQrExportBlocked("storefront")}
                      />
                    )}
                  </div>
                ) : null}

                {showInitialSkeleton ? (
                  <DashboardListSkeleton rows={5} minHeightClass="min-h-[240px]" />
                ) : (
                  <div>
                  <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">
                        {t("business.qrStudio.employees.pageTitle")}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("business.qrStudio.employees.pageDesc")}
                      </p>
                    </div>
                    {embedded ? (
                      <Button
                        type="button"
                        className={cn(businessUi.btnPrimary, "shrink-0")}
                        onClick={handleGenerateAllPdf}
                        disabled={qrLocked || bulkPdfLoading || safeEmployees.length === 0}
                      >
                        {bulkPdfLoading ? (
                          <LoadingSpinner size="sm" className="mr-2 shrink-0" />
                        ) : (
                          <FileDown className="mr-2 h-4 w-4 shrink-0" />
                        )}
                        {t("business.qrPage.allPdfs")}
                      </Button>
                    ) : null}
                  </div>
                  {safeEmployees.length === 0 ? (
                    <div className={cn(businessUi.cardStatic, businessUi.chartEmpty, "py-12 text-center")}>
                      <p className="mb-2 text-muted-foreground">{t("business.qrPage.noEmployees")}</p>
                      <Link
                        to="/dashboard/team/employees"
                        className="text-sm font-semibold text-foreground underline underline-offset-2"
                      >
                        {t("business.qrPage.addStaffInManagement")}
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {safeEmployees.map((employee) => (
                        <QrManagementCard
                          key={employee.id}
                          item={{
                            id: employee.id,
                            name: employee.name,
                            role: employee.role,
                            avatar: employee.avatar,
                            qrUrl: resolveEmployeeQrUrl({
                              employeeId: employee.id,
                              businessSlug,
                              employeeSlug: employee.slug,
                            }),
                            slug: employee.slug,
                          }}
                          type="employee"
                          previewDataUrl={qrImages[employee.id]}
                          copiedId={copiedId}
                          qrLocked={qrLocked}
                          regeneratingId={regeneratingId}
                          onCopy={handleCopy}
                          onEmployeePrint={(item, url) => void handleEmployeePrint(item as CardItem, url)}
                          onEmployeePrintPdf={(item) => void handleEmployeePrintPdf(item as CardItem)}
                          onEmployeeRegenerate={onEmployeeRegenerateCard}
                          exportBlocked={isQrExportBlocked(employee.id)}
                        />
                      ))}
                    </div>
                  )}
                  </div>
                )}
              </div>
            ) : null}

            {viewMode === "locations" ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {t("business.qrStudio.locations.pageTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("business.qrStudio.locations.pageDesc")}
                  </p>
                </div>
                {locations.length === 0 ? (
                  <div className="py-16 text-center text-muted-foreground">
                    <p className="mb-6">{t("business.qrPage.noLocations")}</p>
                    <Link
                      to="/dashboard/locations"
                      className="text-sm font-semibold text-foreground underline underline-offset-2"
                    >
                      {t("business.qrPage.addLocations")}
                    </Link>
                  </div>
                ) : (
                  locations.map((location) => (
                    <QrManagementCard
                      key={location.id}
                      item={{ ...location, role: location.address }}
                      type="location"
                      previewDataUrl={venueQrPreview[`loc-${location.id}`]}
                      copiedId={copiedId}
                      qrLocked={qrLocked}
                      regeneratingId={regeneratingId}
                      onCopy={handleCopy}
                      onVenuePrint={(item, venueType, url) =>
                        void handleVenueQrPrint(item as CardItem, venueType, url)
                      }
                      onVenuePrintPdf={(item, venueType, url) =>
                        void handleVenuePrintPdf(item as CardItem, venueType, url)
                      }
                      exportBlocked={isQrExportBlocked(`loc-${location.id}`)}
                    />
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      </TracingBeam>

      <BusinessConfirmDialog
        open={pendingDestructiveAction != null}
        title={
          pendingDestructiveAction?.kind === "regenerate-business"
            ? t("business.qrPage.regenerateBusinessConfirmTitle")
            : t("business.qrPage.regenerateEmployeeConfirmTitle")
        }
        body={
          pendingDestructiveAction?.kind === "regenerate-business"
            ? t("business.qrPage.regenerateBusinessConfirmBody")
            : t("business.qrPage.regenerateEmployeeConfirmBody", {
                name: pendingDestructiveAction?.kind === "regenerate-employee"
                  ? pendingDestructiveAction.employee.name
                  : "",
              })
        }
        cancelLabel={t("business.staffPage.modalCancel")}
        confirmLabel={
          pendingDestructiveAction?.kind === "regenerate-business"
            ? t("business.qrPage.regenerateBusinessQr")
            : t("business.qrPage.regenerateEmployeeQr")
        }
        confirming={regeneratingId != null}
        onCancel={() => setPendingDestructiveAction(null)}
        onConfirm={() => void handleConfirmDestructiveAction()}
      />
    </div>
  );
}
