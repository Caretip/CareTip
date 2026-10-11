import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Building2, CheckCircle, ClipboardList, Shield, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router";
import {
  fetchPlatformBusinesses,
  fetchKycQueueMetrics,
  fetchOnboardingQueueMetrics,
  updatePlatformBusinessKycStatus,
  updatePlatformBusinessOnboardingStatus,
  updatePlatformBusinessKyc,
  softDeletePlatformBusiness,
  updatePlatformBusinessOperationalStatus,
  uploadPlatformBusinessLogo,
  uploadPlatformBusinessVerification,
  fetchAuthedObjectUrl,
  type KycQueueMetrics,
  type OnboardingQueueMetrics,
  type PlatformBusinessRow,
  type PlatformVerificationAction,
  type PlatformOnboardingVerificationAction,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { PlatformKycComingSoonPage } from "./PlatformKycComingSoonPage";
import {
  DashboardListSkeleton,
  PlatformAdminTableSkeleton,
} from "../../components/dashboard/DashboardSectionLoading";
import { formatEur } from "../../lib/formatEur";
import { useAuth } from "../../hooks/useAuth";
import { useSocket } from "../../hooks/useSocket";
import { useRealtimeFallback } from "../../hooks/useRealtimeFallback";
import {
  PlatformPage,
  PlatformPageHeader,
  PlatformResponsiveData,
} from "../../components/platform/PlatformPageChrome";
import { BusinessVerificationFilters } from "../../components/platform/BusinessVerificationFilters";
import { BusinessVerificationKpiCards } from "../../components/platform/BusinessVerificationKpiCards";
import { BusinessOnboardingKpiCards } from "../../components/platform/BusinessOnboardingKpiCards";
import { PlatformBusinessVerificationMobileCard } from "../../components/platform/platformAdminMobileCards";
import { platformUi } from "../../components/platform/platformDashboardUi";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListFilterLoadError } from "../../components/shared/ListFilterLoadError";
import {
  buildBusinessVerificationFilterSummary,
  resolveBusinessVerificationEmptyState,
} from "../../lib/businessVerificationFilterUx";
import { classifyFetchError } from "../../lib/listFilterUx";
import {
  BUSINESS_VERIFICATION_PAGE_SIZE,
  useBusinessVerificationFilters,
} from "../../hooks/useBusinessVerificationFilters";

export type BusinessVerificationWorkflow = "kyc" | "onboarding";

function BusinessVerificationQueuePage({ workflow }: { workflow: BusinessVerificationWorkflow }) {
  const isKyc = workflow === "kyc";
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    filters,
    debouncedQ,
    setFilters,
    clearAllFilters,
    removeFilter,
    toggleStatusFilter,
    applyKpiStatusFilter,
    hasActiveFilters,
  } = useBusinessVerificationFilters(workflow, {
    defaultStatus: workflow === "onboarding" ? "submitted" : "all",
  });
  const [rows, setRows] = useState<PlatformBusinessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [kycMetrics, setKycMetrics] = useState<KycQueueMetrics | null>(null);
  const [onboardingMetrics, setOnboardingMetrics] = useState<OnboardingQueueMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<ReturnType<typeof classifyFetchError>>("api");
  const loadGenRef = useRef(0);
  const [processingIds, setProcessingIds] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<PlatformBusinessRow | null>(null);
  const [form, setForm] = useState({
    legalContactName: "",
    contactEmail: "",
    contactPhone: "",
    website: "",
    registeredAddress: "",
  });

  const listParams = useMemo(
    () => ({
      q: debouncedQ || undefined,
      status: filters.status,
      workflow,
      date: filters.date,
      dateFrom: filters.date === "custom" ? filters.dateFrom || undefined : undefined,
      dateTo: filters.date === "custom" ? filters.dateTo || undefined : undefined,
      tips: filters.tips,
      sort: filters.sort,
      take: BUSINESS_VERIFICATION_PAGE_SIZE,
      page: filters.page,
    }),
    [debouncedQ, filters, workflow],
  );

  const refreshKycMetrics = useCallback(async () => {
    if (isKyc) {
      try {
        const metrics = await fetchKycQueueMetrics();
        setKycMetrics(metrics);
      } catch (e) {
        logClientError("BusinessVerificationPage.kycMetrics", e);
      }
    }
  }, [isKyc]);

  const refreshOnboardingMetrics = useCallback(async () => {
    if (!isKyc) {
      try {
        const metrics = await fetchOnboardingQueueMetrics();
        setOnboardingMetrics(metrics);
      } catch (e) {
        logClientError("BusinessVerificationPage.onboardingMetrics", e);
      }
    }
  }, [isKyc]);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet === true;
      const gen = ++loadGenRef.current;
      if (!quiet) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const res = await fetchPlatformBusinesses(listParams);
        if (gen !== loadGenRef.current) return;
        if (res.warning) {
          throw new Error(res.warning);
        }
        setRows(res.businesses);
        setTotal(res.total ?? res.businesses.length);
        if (!isKyc) {
          void refreshOnboardingMetrics();
        } else {
          void refreshKycMetrics();
        }
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        logClientError("BusinessVerificationPage.load", e);
        if (!quiet) {
          const message = toUserFriendlyMessage(e);
          setLoadError(message);
          setLoadErrorKind(classifyFetchError(e));
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (!quiet && gen === loadGenRef.current) setLoading(false);
      }
    },
    [listParams, isKyc, refreshOnboardingMetrics, refreshKycMetrics],
  );

  const loadQuiet = useCallback(async () => {
    const gen = ++loadGenRef.current;
    try {
      const res = await fetchPlatformBusinesses(listParams);
      if (gen !== loadGenRef.current) return;
      if (res.warning) return;
      setRows(res.businesses);
      setTotal(res.total ?? res.businesses.length);
      setLoadError(null);
      if (!isKyc) {
        void refreshOnboardingMetrics();
      } else {
        void refreshKycMetrics();
      }
    } catch (e) {
      logClientError("BusinessVerificationPage.loadQuiet", e);
    }
  }, [listParams, isKyc, refreshOnboardingMetrics, refreshKycMetrics]);

  const { socket, connected } = useSocket(user?.role === "platform_admin");

  useRealtimeFallback(connected, loadQuiet, 60000);

  useEffect(() => {
    if (!socket || user?.role !== "platform_admin") return;
    const s = () => void loadQuiet();
    socket.on("platform_data_updated", s);
    socket.on("platform_verification_updated", s);
    return () => {
      socket.off("platform_data_updated", s);
      socket.off("platform_verification_updated", s);
    };
  }, [socket, user?.role, loadQuiet]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isKyc) {
      void fetchKycQueueMetrics()
        .then(setKycMetrics)
        .catch((e) => logClientError("BusinessVerificationPage.kycMetrics", e));
    } else {
      void fetchOnboardingQueueMetrics()
        .then(setOnboardingMetrics)
        .catch((e) => logClientError("BusinessVerificationPage.onboardingMetrics", e));
    }
  }, [isKyc]);

  const runWithProcessing = useCallback(async (businessId: string, action: () => Promise<void>) => {
    if (processingIds.has(businessId)) return;
    setProcessingIds((prev) => new Set(prev).add(businessId));
    try {
      await action();
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(businessId);
        return next;
      });
    }
  }, [processingIds]);

  const handleKycStatusUpdate = async (businessId: string, status: PlatformVerificationAction) => {
    await runWithProcessing(businessId, async () => {
      let reviewNote: string | undefined;
      if (status === "rejected") {
        reviewNote = window.prompt(t("admin.businessVerificationPage.rejectNotePrompt")) ?? undefined;
      }
      try {
        await updatePlatformBusinessKycStatus(businessId, status, reviewNote);
        if (status === "verified") {
          toast.success(t("admin.businessVerificationPage.toastApproved"));
        } else if (status === "rejected") {
          toast.success(t("admin.businessVerificationPage.toastRejected"));
        } else {
          toast.success(t("admin.businessVerificationPage.toastStatusUpdated"));
        }
        await load();
      } catch (e) {
        logClientError("BusinessVerificationPage.handleKycStatusUpdate", e);
        toast.error(toUserFriendlyMessage(e));
      }
    });
  };

  const handleOnboardingStatusUpdate = async (
    businessId: string,
    status: PlatformOnboardingVerificationAction,
  ) => {
    await runWithProcessing(businessId, async () => {
      let reviewNote: string | undefined;
      if (status === "rejected") {
        reviewNote = window.prompt(t("admin.businessVerificationPage.rejectNotePrompt")) ?? undefined;
      }
      try {
        await updatePlatformBusinessOnboardingStatus(businessId, status, reviewNote);
        toast.success(
          status === "approved"
            ? t("admin.onboardingVerificationPage.toastApproved")
            : status === "rejected"
              ? t("admin.onboardingVerificationPage.toastRejected")
              : t("admin.businessVerificationPage.toastStatusUpdated"),
        );
        await load();
      } catch (e) {
        logClientError("BusinessVerificationPage.handleOnboardingStatusUpdate", e);
        toast.error(toUserFriendlyMessage(e));
      }
    });
  };

  const handleSoftDelete = async (businessId: string) => {
    if (!window.confirm(t("admin.onboardingVerificationPage.deleteConfirm"))) return;
    await runWithProcessing(businessId, async () => {
      try {
        await softDeletePlatformBusiness(businessId);
        toast.success(t("admin.onboardingVerificationPage.toastDeleted"));
        await load();
      } catch (e) {
        logClientError("BusinessVerificationPage.handleSoftDelete", e);
        toast.error(toUserFriendlyMessage(e));
      }
    });
  };

  const openEdit = (b: PlatformBusinessRow) => {
    setEditing(b);
    setForm({
      legalContactName: b.legalContactName ?? "",
      contactEmail: b.contactEmail ?? "",
      contactPhone: b.contactPhone ?? "",
      website: b.website ?? "",
      registeredAddress: b.registeredAddress ?? "",
    });
  };

  const saveKyc = async () => {
    if (!editing) return;
    try {
      const { business } = await updatePlatformBusinessKyc(editing.id, {
        legalContactName: form.legalContactName || null,
        contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null,
        website: form.website || null,
        registeredAddress: form.registeredAddress || null,
      });
      setRows((prev) => prev.map((r) => (r.id === business.id ? { ...r, ...business } : r)));
      toast.success(t("admin.businessVerificationPage.toastDetailsSaved"));
      setEditing(null);
    } catch (e) {
      logClientError("BusinessVerificationPage.saveKyc", e);
      toast.error(toUserFriendlyMessage(e));
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !editing) return;
    try {
      await uploadPlatformBusinessLogo(editing.id, f);
      toast.success(t("admin.businessVerificationPage.toastLogoUploaded"));
      await load();
      e.target.value = "";
    } catch (err) {
      logClientError("BusinessVerificationPage.handleLogoUpload", err);
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const handleVerificationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !editing) return;
    try {
      await uploadPlatformBusinessVerification(editing.id, f);
      toast.success(t("admin.businessVerificationPage.toastDocUploaded"));
      await load();
      e.target.value = "";
    } catch (err) {
      logClientError("BusinessVerificationPage.handleVerificationUpload", err);
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const openAuthedFile = async (path: string) => {
    try {
      const objUrl = await fetchAuthedObjectUrl(path);
      window.open(objUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / BUSINESS_VERIFICATION_PAGE_SIZE));
  const emptyCopy = useMemo(
    () => resolveBusinessVerificationEmptyState(filters, debouncedQ, t, workflow),
    [filters, debouncedQ, t, workflow],
  );
  const filterSummary = useMemo(
    () => buildBusinessVerificationFilterSummary(filters, debouncedQ, total, t, workflow),
    [filters, debouncedQ, total, t, workflow],
  );
  const emptyStateIcon = isKyc ? (
    <Shield className="h-8 w-8 text-muted-foreground" aria-hidden />
  ) : (
    <ClipboardList className="h-8 w-8 text-muted-foreground" aria-hidden />
  );
  const showTableLoading = loading;

  const renderWorkflowStatus = (b: PlatformBusinessRow) => {
    if (!isKyc) {
      const s = b.onboardingVerificationStatus ?? "draft";
      if (s === "approved") {
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs font-medium text-success-foreground">
            <CheckCircle className="h-3.5 w-3.5" /> {t("admin.onboardingVerificationPage.statusApproved")}
          </span>
        );
      }
      if (s === "rejected") {
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
            <XCircle className="h-3.5 w-3.5" /> {t("admin.onboardingVerificationPage.statusRejected")}
          </span>
        );
      }
      if (s === "submitted") {
        return (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {t("admin.onboardingVerificationPage.statusSubmitted")}
          </span>
        );
      }
      return (
        <span className="text-xs font-medium text-muted-foreground">
          {t("admin.onboardingVerificationPage.statusDraft")}
        </span>
      );
    }

  const kyc = b.kycVerificationStatus ?? "not_started";
    if (kyc === "verified") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs font-medium text-success-foreground">
          <CheckCircle className="h-3.5 w-3.5" /> {t("admin.businessVerificationPage.statusVerified")}
        </span>
      );
    }
    if (kyc === "rejected") {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
          <XCircle className="h-3.5 w-3.5" /> {t("admin.businessVerificationPage.statusRejected")}
        </span>
      );
    }
    if (b.ownerIsActive === false) {
      return (
        <span className="text-xs font-medium text-red-600 dark:text-red-400">
          {t("admin.businessVerificationPage.filters.status.suspended")}
        </span>
      );
    }
    return (
      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
        {kyc === "awaiting_upload"
          ? t("admin.businessVerificationPage.filters.status.awaiting_upload")
          : kyc === "not_started"
            ? t("admin.businessVerificationPage.filters.status.not_started")
            : t("admin.businessVerificationPage.statusPending")}
        {b.kycSlaBreached ? (
          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            SLA
          </span>
        ) : null}
      </span>
    );
  };

  const approveBusiness = (businessId: string) => {
    if (isKyc) void handleKycStatusUpdate(businessId, "verified");
    else void handleOnboardingStatusUpdate(businessId, "approved");
  };

  const rejectBusiness = (businessId: string) => {
    if (isKyc) void handleKycStatusUpdate(businessId, "rejected");
    else void handleOnboardingStatusUpdate(businessId, "rejected");
  };

  const canApproveRow = (b: PlatformBusinessRow) =>
    isKyc ? b.kycVerificationStatus !== "verified" : b.onboardingVerificationStatus !== "approved";

  const canRejectRow = (b: PlatformBusinessRow) =>
    isKyc
      ? b.kycVerificationStatus === "pending_review"
      : b.onboardingVerificationStatus === "submitted";

  const canDeleteRow = (b: PlatformBusinessRow) => {
    if (isKyc) return false;
    const onboarding = b.onboardingVerificationStatus ?? "draft";
    if (onboarding !== "draft" && onboarding !== "rejected") return false;
    return (b.totalTipsEur ?? 0) === 0 && (b.successTipCount ?? 0) === 0;
  };

  const isRowProcessing = (businessId: string) => processingIds.has(businessId);

  const tableColCount = isKyc ? 7 : 6;

  const paginationFooter =
    total > BUSINESS_VERIFICATION_PAGE_SIZE ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("admin.businessVerificationPage.pagination", {
            from: total === 0 ? 0 : filters.page * BUSINESS_VERIFICATION_PAGE_SIZE + 1,
            to: Math.min((filters.page + 1) * BUSINESS_VERIFICATION_PAGE_SIZE, total),
            total,
          })}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={filters.page === 0 || loading}
            onClick={() => setFilters({ page: filters.page - 1 }, { resetPage: false })}
            className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
          >
            {t("admin.businessVerificationPage.prevPage")}
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {filters.page + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={filters.page + 1 >= pageCount || loading}
            onClick={() => setFilters({ page: filters.page + 1 }, { resetPage: false })}
            className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
          >
            {t("admin.businessVerificationPage.nextPage")}
          </button>
        </div>
      </div>
    ) : total > 0 ? (
      <p className="text-xs text-muted-foreground">
        {t("admin.businessVerificationPage.pagination", {
          from: 1,
          to: total,
          total,
        })}
      </p>
    ) : null;

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Shield}
        title={
          isKyc
            ? t("admin.businessVerificationPage.title")
            : t("admin.onboardingVerificationPage.title")
        }
        subtitle={
          isKyc
            ? t("admin.businessVerificationPage.subtitle")
            : t("admin.onboardingVerificationPage.subtitle")
        }
      />

      {isKyc && kycMetrics ? (
        <BusinessVerificationKpiCards
          metrics={kycMetrics}
          activeStatus={filters.status}
          onToggleStatus={applyKpiStatusFilter}
        />
      ) : null}
      {!isKyc && onboardingMetrics ? (
        <BusinessOnboardingKpiCards
          metrics={onboardingMetrics}
          activeStatus={filters.status}
          onToggleStatus={applyKpiStatusFilter}
        />
      ) : null}

      <BusinessVerificationFilters
        workflow={workflow}
        filters={filters}
        onChange={(patch) => setFilters(patch)}
        onClearAll={clearAllFilters}
        onRemoveChip={removeFilter}
        hasActiveFilters={hasActiveFilters}
        searchValue={filters.q}
        onSearchChange={(q) => setFilters({ q })}
      />

      {!loadError && !showTableLoading ? (
        <p className="mb-4 text-sm font-medium text-foreground" role="status">
          {filterSummary}
        </p>
      ) : null}

      <PlatformResponsiveData
        footer={paginationFooter}
        mobile={
          showTableLoading ? (
            <DashboardListSkeleton rows={6} minHeightClass="min-h-0" />
          ) : loadError ? (
            <ListFilterLoadError message={loadError} kind={loadErrorKind} onRetry={() => void load()} />
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              icon={emptyStateIcon}
              title={emptyCopy.title}
              description={emptyCopy.description}
              action={
                hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {t("admin.businessVerificationPage.filters.clearAll")}
                  </button>
                ) : undefined
              }
            />
          ) : (
            rows.map((b) => (
              <PlatformBusinessVerificationMobileCard
                key={b.id}
                business={b}
                busy={isRowProcessing(b.id)}
                onApprove={() => approveBusiness(b.id)}
                onReject={() => rejectBusiness(b.id)}
                onDelete={canDeleteRow(b) ? () => void handleSoftDelete(b.id) : undefined}
                onEdit={() => openEdit(b)}
                onOpenFile={(path) => void openAuthedFile(path)}
              />
            ))
          )
        }
        desktop={
          <div className="min-w-0 w-full overflow-x-auto">
            <table className={`${platformUi.table} min-w-[56rem] table-fixed`}>
              <colgroup>
                <col className="w-[19%]" />
                <col className="w-[17%]" />
                <col className="w-[17%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                {isKyc ? <col className="w-[11%]" /> : null}
                <col className={isKyc ? "w-[10%]" : "w-[21%]"} />
              </colgroup>
              <thead>
                <tr className={platformUi.tableHeadRow}>
                  <th className={platformUi.tableTh}>{t("admin.businessVerificationPage.colBusiness")}</th>
                  <th className={platformUi.tableTh}>{t("admin.businessVerificationPage.colOwner")}</th>
                  <th className={platformUi.tableTh}>{t("admin.businessVerificationPage.colContact")}</th>
                  <th className={platformUi.tableTh}>{t("admin.businessVerificationPage.colLiveTips")}</th>
                  <th className={platformUi.tableTh}>{t("admin.businessVerificationPage.colStatus")}</th>
                  {isKyc ? <th className={platformUi.tableTh}>{t("admin.businessVerificationPage.colFiles")}</th> : null}
                  <th className={`${platformUi.tableTh} text-right`}>
                    {t("admin.businessVerificationPage.colActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
              {showTableLoading ? (
                <PlatformAdminTableSkeleton rows={8} cols={tableColCount} />
              ) : loadError ? (
                <tr>
                  <td colSpan={tableColCount} className="p-0">
                    <ListFilterLoadError
                      message={loadError}
                      kind={loadErrorKind}
                      onRetry={() => void load()}
                      compact
                    />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={tableColCount} className="p-0">
                    <EmptyState
                      compact
                      icon={emptyStateIcon}
                      title={emptyCopy.title}
                      description={emptyCopy.description}
                      action={
                        hasActiveFilters ? (
                          <button
                            type="button"
                            onClick={clearAllFilters}
                            className="text-sm font-medium text-accent hover:underline"
                          >
                            {t("admin.businessVerificationPage.filters.clearAll")}
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((b) => (
                  <tr key={b.id} className={platformUi.tableRow}>
                    <td className={`${platformUi.tableTd} align-top py-3`}>
                      <div className="flex min-w-0 items-start gap-2">
                        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="break-words font-medium text-foreground">{b.name}</div>
                          <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground" title={b.slug}>
                            {b.slug}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={`${platformUi.tableTd} align-top py-3 text-xs`}>
                      <span className="block min-w-0 break-all text-foreground" title={b.ownerEmail ?? undefined}>
                        {b.ownerEmail}
                      </span>
                    </td>
                    <td className={`${platformUi.tableTd} align-top py-3 text-xs`}>
                      <div className="min-w-0 break-all text-foreground" title={b.contactEmail ?? undefined}>
                        {b.contactEmail ?? t("format.notAvailable")}
                      </div>
                      {b.contactPhone ? (
                        <div className="mt-0.5 break-all text-muted-foreground" title={b.contactPhone}>
                          {b.contactPhone}
                        </div>
                      ) : null}
                    </td>
                    <td className={`${platformUi.tableTd} align-top py-3 text-xs`}>
                      <div className="font-medium tabular-nums">{formatEur(b.totalTipsEur ?? 0)}</div>
                      <div className="mt-0.5 text-muted-foreground">
                        {t("admin.businessVerificationPage.tipsStaffSummary", {
                          tips: b.successTipCount ?? 0,
                          staff: b.staffCount ?? 0,
                        })}
                      </div>
                    </td>
                    <td className={`${platformUi.tableTd} align-top py-3`}>{renderWorkflowStatus(b)}</td>
                    {isKyc ? (
                    <td className={`${platformUi.tableTd} space-y-1 py-3 text-xs align-top`}>
                      {b.logoPath ? (
                        <button
                          type="button"
                          onClick={() => void openAuthedFile(b.logoPath!)}
                          className="block text-left text-accent hover:underline"
                        >
                          {t("admin.businessVerificationPage.fileLogo")}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{t("admin.businessVerificationPage.filesNone")}</span>
                      )}
                      {b.verificationDocumentPath ? (
                        <button
                          type="button"
                          onClick={() => void openAuthedFile(b.verificationDocumentPath!)}
                          className="block text-left text-accent hover:underline"
                        >
                          {t("admin.businessVerificationPage.fileKycDoc")}
                        </button>
                      ) : null}
                      {b.kycDocuments?.registration ? (
                        <button type="button" onClick={() => void openAuthedFile(b.kycDocuments!.registration!)} className="block text-left text-accent hover:underline">
                          Registration
                        </button>
                      ) : null}
                      {b.kycDocuments?.address ? (
                        <button type="button" onClick={() => void openAuthedFile(b.kycDocuments!.address!)} className="block text-left text-accent hover:underline">
                          Address proof
                        </button>
                      ) : null}
                      {b.kycDocuments?.governmentId ? (
                        <button type="button" onClick={() => void openAuthedFile(b.kycDocuments!.governmentId!)} className="block text-left text-accent hover:underline">
                          Government ID
                        </button>
                      ) : null}
                      {(b.kycDocuments?.additional ?? []).map((path, i) => (
                        <button key={`${path}-${i}`} type="button" onClick={() => void openAuthedFile(path)} className="block text-left text-accent hover:underline">
                          Additional {i + 1}
                        </button>
                      ))}
                    </td>
                    ) : null}
                    <td className={`${platformUi.tableTd} align-top py-3 text-right`}>
                      <div className="flex min-w-[10.5rem] flex-col items-stretch gap-1.5 sm:items-end lg:min-w-0 lg:flex-row lg:flex-wrap lg:justify-end lg:gap-2">
                        <Link
                          to={`/platform-admin/businesses/${b.id}`}
                          className="text-xs text-accent hover:underline"
                        >
                          {t("admin.businessVerificationPage.linkViewDetails")}
                        </Link>
                        <button
                          type="button"
                          onClick={() => openEdit(b)}
                          className="text-xs text-accent hover:underline"
                        >
                          {t("admin.businessVerificationPage.linkEditDetails")}
                        </button>
                        {canApproveRow(b) ? (
                          <button
                            type="button"
                            disabled={isRowProcessing(b.id)}
                            onClick={() => approveBusiness(b.id)}
                            className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                          >
                            {isKyc
                              ? t("admin.businessVerificationPage.btnApprove")
                              : t("admin.onboardingVerificationPage.btnApprove")}
                          </button>
                        ) : null}
                        {canRejectRow(b) ? (
                          <button
                            type="button"
                            disabled={isRowProcessing(b.id)}
                            onClick={() => rejectBusiness(b.id)}
                            className="rounded border border-destructive px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          >
                            {isKyc
                              ? t("admin.businessVerificationPage.btnReject")
                              : t("admin.onboardingVerificationPage.btnReject")}
                          </button>
                        ) : null}
                        {canDeleteRow(b) ? (
                          <button
                            type="button"
                            disabled={isRowProcessing(b.id)}
                            onClick={() => void handleSoftDelete(b.id)}
                            className="rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {t("admin.onboardingVerificationPage.btnDelete")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
              </tbody>
            </table>
          </div>
        }
      />

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6"
          >
            <h2 className="mb-1 text-lg font-semibold text-foreground">
              {t("admin.businessVerificationPage.modalTitle", { name: editing.name })}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">{t("admin.businessVerificationPage.sectionContactInfo")}</p>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelLegalName")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.legalContactName}
                  onChange={(e) => setForm((f) => ({ ...f, legalContactName: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelContactEmail")}</span>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.contactEmail}
                  onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelContactPhone")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.contactPhone}
                  onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelRegisteredAddress")}</span>
                <textarea
                  className="mt-1 min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.registeredAddress}
                  onChange={(e) => setForm((f) => ({ ...f, registeredAddress: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 space-y-3 border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">{t("admin.businessVerificationPage.sectionUploads")}</p>
              <p className="text-xs text-muted-foreground">
                <code className="text-[10px]">{t("admin.businessVerificationPage.uploadsHint")}</code>
              </p>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelLogoUpload")}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1 block w-full text-sm text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1"
                  onChange={(e) => void handleLogoUpload(e)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelVerificationDoc")}</span>
                <input
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,application/pdf"
                  className="mt-1 block w-full text-sm text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1"
                  onChange={(e) => void handleVerificationUpload(e)}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                {t("admin.businessVerificationPage.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void saveKyc()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                {t("admin.businessVerificationPage.save")}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </PlatformPage>
  );
}

export function BusinessKycVerificationPage() {
  return <PlatformKycComingSoonPage />;
}

export function BusinessOnboardingVerificationPage() {
  return <BusinessVerificationQueuePage workflow="onboarding" />;
}

/** @deprecated Use PlatformKycComingSoonPage */
export function BusinessVerificationPage() {
  return <PlatformKycComingSoonPage />;
}
