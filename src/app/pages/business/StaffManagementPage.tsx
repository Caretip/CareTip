import { motion } from "motion/react";
import { useState, useEffect, useCallback, useRef, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { toast } from "sonner";
import {
  Search,
  Star,
  Edit,
  QrCode,
  Mail,
  Phone,
  KeyRound,
  Copy,
  RefreshCw,
  Trash2,
  Users,
  MapPin,
  Plus,
} from "lucide-react";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useMinWidthMedia } from "@/lib/motionPerf";
import { useSocket } from "../../hooks/useSocket";
import { useRealtimeFallback } from "../../hooks/useRealtimeFallback";
import { fetchVenueCatalog, invalidateVenueCatalog } from "../../lib/businessVenueCatalog";
import {
  generateInviteCode,
  getBusinessStats,
  fetchBusinessProfile,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus,
  deleteEmployee,
  clearBusinessStatsClientCache,
  type LocationDTO,
  type TableDTO,
} from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { downloadBrandedQR, downloadBrandedQRLegacy } from "../../lib/qrBranded";
import type { QrBrandingOptions } from "../../lib/businessBranding";
import { loadQrRenderBranding } from "../../lib/loadQrRenderBranding";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { TeamGrowthUpgradeNotice } from "../../components/subscription/TeamGrowthUpgradeNotice";
import { isApiSubscriptionRequiredError } from "../../lib/apiError";
import { StaffRosterTableSkeleton, InlineSpinner } from "../../components/dashboard/DashboardSectionLoading";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { canUseProductionQr } from "../../lib/businessVerificationCapabilities";
import { logClientError } from "../../lib/clientLog";
import {
  getPageSessionCache,
  setPageSessionCache,
  invalidatePageSessionCache,
  PAGE_CACHE_TTL_MEDIUM_MS,
} from "../../lib/pageSessionCache";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DASH_BTN_PRIMARY,
  DASH_BTN_SECONDARY,
  DASH_EMPTY_ICON,
  DASH_EMPTY_STATE,
} from "@/components/ui/dashboard-styles";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import {
  STAFF_ROLE_OPTIONS,
  STAFF_ROLE_OTHER_VALUE,
  formatStaffRoleLabel,
  resolveStaffRoleForForm,
  resolveStaffRoleForSave,
} from "../../lib/businessVenueOptions";

const TOAST_OK = { style: { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" } } as const;
const TOAST_ERR = { style: { background: "#d4183d", color: "#ffffff" } } as const;

function toastOk(message: string) {
  toast.success(message, TOAST_OK);
}

function toastErr(message: string) {
  toast.error(message, TOAST_ERR);
}

/** Centers icon + label as one unit; full width on mobile, content-sized from sm+. */
function HeroPanelButton({
  className,
  children,
  contentSized = false,
  ...props
}: ComponentProps<typeof Button> & { contentSized?: boolean }) {
  return (
    <Button
      className={cn(
        "flex h-11 min-h-11 items-center justify-center gap-0 px-4 text-sm font-semibold leading-none whitespace-normal sm:px-5",
        contentSized ? "w-full max-w-full sm:w-auto sm:max-w-sm" : "w-full max-w-full",
        className,
      )}
      {...props}
    >
      <span className="inline-flex max-w-full items-center justify-center gap-2">{children}</span>
    </Button>
  );
}

function HeroPanelButtonIcon({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center [&>svg]:block [&>svg]:size-4">
      {children}
    </span>
  );
}

function StaffRoleSelectOptions() {
  const { t } = useTranslation();
  return STAFF_ROLE_OPTIONS.map((opt) => (
    <option key={opt.value} value={opt.value}>
      {t(opt.labelKey)}
    </option>
  ));
}

function StaffCustomRoleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="mb-1 block text-sm text-muted-foreground">
        {t("business.staffPage.labelCustomRole")}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("business.staffPage.phCustomRole")}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

type StaffRow = {
  id: string;
  slug: string | null;
  name: string;
  role: string;
  avatar: string | null;
  tips: number;
  rating: number | null;
  email: string;
  phone: string;
  joinedDate: string;
  growth: string;
  isActive: boolean;
  activationStatus?: "active" | "pending_activation" | "pending_verification";
  emailVerified?: boolean;
  /** From API: password or OAuth present on `User`. */
  passwordIsSet?: boolean;
  monthlyGoal: number | null;
  locationId: string | null;
  assignedTableIds: string[];
};

function isFullyOnboardedDashboardStaff(emp: StaffRow): boolean {
  return emp.isActive === true && emp.activationStatus === "active";
}

/**
 * Onboarding hints only when the database still indicates work left
 * (do not infer from `activation_status` alone — e.g. script-updated `email_verified` / password rows).
 */
type StaffRosterNoteKey = "deactivated" | "awaiting_email" | "pending_password";

function staffRosterNoteKey(emp: StaffRow): StaffRosterNoteKey | null {
  if (!emp.isActive) return "deactivated";
  if (isFullyOnboardedDashboardStaff(emp)) return null;
  const emailOk = emp.emailVerified === true;
  const pwdOk = emp.passwordIsSet === true;

  if (emp.activationStatus === "pending_verification") {
    if (!emailOk) return "awaiting_email";
    return null;
  }
  if (emp.activationStatus === "pending_activation") {
    if (!pwdOk) return "pending_password";
    return null;
  }
  return null;
}

function rosterNoteClassName(noteKey: StaffRosterNoteKey | null): string {
  if (!noteKey) return "";
  if (noteKey === "deactivated") return "text-xs font-medium text-muted-foreground mt-0.5";
  return "text-xs font-medium text-amber-700 dark:text-amber-500 mt-0.5";
}

function rosterNoteText(noteKey: StaffRosterNoteKey | null, t: (k: string) => string): string | null {
  if (!noteKey) return null;
  if (noteKey === "deactivated") return t("business.staffPage.rosterDeactivated");
  if (noteKey === "awaiting_email") return t("business.staffPage.rosterAwaitingEmail");
  return t("business.staffPage.rosterPendingPassword");
}

export function StaffManagementPage() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language?.toLowerCase().startsWith("de") ? de : enUS;
  const { user, isBusiness, authHydrated, sessionValidated } = useRequireAuth();
  const isLargeScreen = useMinWidthMedia(1024);
  const { tier, hasFeature, advancedAnalyticsEnabled } = useSubscriptionEntitlements({
    enabled: isBusiness,
    role: "business",
  });
  const brandingTier = tier ?? "basic";
  const canGrowTeam = hasFeature("teamManagement");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    role: "Server",
    customRole: "",
    email: "",
    phone: "",
    locationId: "",
    tableIds: [] as string[],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [employees, setEmployees] = useState<StaffRow[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    id: "",
    name: "",
    role: "Server",
    customRole: "",
    email: "",
    monthlyGoal: "" as string,
    isActive: true,
    locationId: "",
    tableIds: [] as string[],
  });
  const [venueOptions, setVenueOptions] = useState<LocationDTO[]>([]);
  const [tableOptions, setTableOptions] = useState<TableDTO[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<StaffRow | null>(null);
  const [deactivateAcknowledged, setDeactivateAcknowledged] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [businessPublicSlug, setBusinessPublicSlug] = useState<string | null>(null);
  const [qrBranding, setQrBranding] = useState<QrBrandingOptions | null>(null);
  const employeesRef = useRef(employees);
  employeesRef.current = employees;
  const togglingEmployeeIdsRef = useRef<Set<string>>(new Set());

  const invalidateStaffRosterCaches = useCallback(() => {
    clearBusinessStatsClientCache();
    if (user?.businessId) {
      invalidatePageSessionCache(`business:staff:${user.businessId}`);
    }
  }, [user?.businessId]);

  const canUseQr = canUseProductionQr(user?.onboardingVerificationStatus, Boolean(user?.impersonation));

  const fetchEmployees = useCallback(async (opts?: { quiet?: boolean; revalidate?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!authHydrated || !sessionValidated) {
      // Keep strict loading gate until auth is resolved to prevent UI flash/flicker.
      return;
    }
    if (!user?.businessId) {
      if (!quiet) {
        setLoading(false);
        setEmployees([]);
        setError(null);
      }
      return;
    }
    const cacheKey = user.businessId ? `business:staff:${user.businessId}` : null;
    const cached = cacheKey
      ? getPageSessionCache<StaffRow[]>(cacheKey, PAGE_CACHE_TTL_MEDIUM_MS)
      : null;
    const useCachedFirst = !quiet && cached !== null;
    if (useCachedFirst) {
      setEmployees(cached);
      setLoading(false);
      setError(null);
    } else if (!quiet && employeesRef.current.length === 0) {
      setLoading(true);
      setError(null);
    }
    try {
      const statsScope = advancedAnalyticsEnabled ? "analytics" : "roster";
      if (opts?.revalidate) {
        invalidateStaffRosterCaches();
      }
      const data = await getBusinessStats("all", {
        scope: statsScope,
        revalidate: opts?.revalidate === true,
      });
      const empList = data.employees ?? [];
      const mapped: StaffRow[] = empList.map((e) => ({
        id: e.id,
        slug: e.slug ?? null,
        name: e.name,
        role: e.jobTitle,
        avatar: e.avatar,
        tips: e.tipsTotal,
        rating: e.rating,
        email: e.email ?? "",
        phone: e.phone ?? "",
        joinedDate: "",
        growth: "",
        isActive: e.isActive ?? false,
        activationStatus: e.activationStatus,
        emailVerified: e.emailVerified,
        passwordIsSet: e.passwordIsSet,
        monthlyGoal: e.monthlyGoal ?? null,
        locationId: e.locationId ?? null,
        assignedTableIds: e.assignedTableIds ?? [],
      }));
      setEmployees(mapped);
      if (cacheKey) setPageSessionCache(cacheKey, mapped);
    } catch (err) {
      logClientError("StaffManagementPage", err);
      if (!quiet && !useCachedFirst) {
        if (isApiSubscriptionRequiredError(err)) {
          setError(null);
        } else {
          setError(toUserFriendlyMessage(err));
          setEmployees([]);
        }
      }
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, [user?.businessId, authHydrated, sessionValidated, advancedAnalyticsEnabled, invalidateStaffRosterCaches]);

  const { socket, connected } = useSocket(isBusiness && authHydrated && sessionValidated);

  useRealtimeFallback(connected, () => void fetchEmployees({ quiet: true, revalidate: true }));

  useEffect(() => {
    if (!socket || !isBusiness) return;
    const sync = () => void fetchEmployees({ quiet: true, revalidate: true });
    socket.on("business_data_updated", sync);
    socket.on("verification_updated", sync);
    return () => {
      socket.off("business_data_updated", sync);
      socket.off("verification_updated", sync);
    };
  }, [socket, isBusiness, fetchEmployees]);

  useEffect(() => {
    void fetchEmployees();
  }, [fetchEmployees]);

  /** Avoid an indefinite spinner if auth hydration never completes. */
  useEffect(() => {
    if (authHydrated && sessionValidated) return;
    const timer = window.setTimeout(() => {
      if (!authHydrated || !sessionValidated) setLoading(false);
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [authHydrated, sessionValidated]);

  useEffect(() => {
    if (!authHydrated || !sessionValidated || !isBusiness || !user?.businessId) return;
    let cancelled = false;
    void fetchBusinessProfile()
      .then((p) => {
        if (!cancelled) setBusinessPublicSlug(p.slug?.trim() || null);
      })
      .catch((err) => {
        logClientError("StaffManagementPage.businessSlug", err);
        if (!cancelled) setBusinessPublicSlug(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authHydrated, sessionValidated, isBusiness, user?.businessId]);

  useEffect(() => {
    if (!authHydrated || !sessionValidated || !isBusiness || !user?.businessId) return;
    let cancelled = false;
    void loadQrRenderBranding({
      mode: "manager",
      businessId: user.businessId,
      tier: brandingTier,
      fallbackBusinessName: user.businessName ?? undefined,
    })
      .then((branding) => {
        if (!cancelled) setQrBranding(branding);
      })
      .catch((err) => {
        logClientError("StaffManagementPage.qrBranding", err);
        if (!cancelled) setQrBranding(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authHydrated, sessionValidated, isBusiness, user?.businessId, user?.businessName, tier]);

  useEffect(() => {
    if (!authHydrated || !sessionValidated || !isBusiness) return;
    void (async () => {
      try {
        const { locations, tables } = await fetchVenueCatalog();
        setVenueOptions(Array.isArray(locations) ? locations : []);
        setTableOptions(Array.isArray(tables) ? tables : []);
      } catch (err) {
        logClientError("StaffManagementPage.venues", err);
        setVenueOptions([]);
        setTableOptions([]);
      }
    })();
  }, [authHydrated, sessionValidated, isBusiness]);

  const filteredEmployees = employees.filter(
    (emp) =>
      String(emp.name).toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(emp.role).toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(emp.email).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const safeTableOptions = Array.isArray(tableOptions) ? tableOptions : [];
  const tablesForAddPicker = safeTableOptions.filter(
    (t) => !addForm.locationId || t.locationId === addForm.locationId
  );
  const tablesForEditPicker = safeTableOptions.filter(
    (t) => !editForm.locationId || t.locationId === editForm.locationId
  );

  const handleGenerateInvite = async () => {
    if (!isBusiness) {
      toastErr(t("business.staffPage.toastOwnerOnlyInvite"));
      return;
    }
    setIsGenerating(true);
    try {
      const data = await generateInviteCode();
      setInviteCode(data.inviteCode);
      setInviteExpiresAt(data.expiresAt ?? null);
      toastOk(t("business.staffPage.toastInviteGenerated"));
    } catch (err) {
      logClientError("StaffManagementPage", err);
      toastErr(toUserFriendlyMessage(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!isBusiness) return;
    await handleGenerateInvite();
  };

  const handleCopyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      toastOk(t("business.staffPage.toastCopied"));
    } catch (err) {
      logClientError("StaffManagementPage", err);
      toastErr(t("business.staffPage.toastCopyFailed"));
    }
  };

  const handleAddEmployeeSubmit = async () => {
    if (!isBusiness || !user?.businessId) {
      toastErr(t("business.staffPage.toastOwnerOnlyAdd"));
      return;
    }
    const name = addForm.name.trim();
    const email = addForm.email.trim();
    const role = resolveStaffRoleForSave(addForm.role, addForm.customRole);
    if (!name || !email) {
      toastErr(t("business.staffPage.toastNameEmailRequired"));
      return;
    }
    if (!role) {
      toastErr(t("business.staffPage.toastCustomRoleRequired"));
      return;
    }
    setIsSubmitting(true);
    try {
      const inviteLocale = i18n.resolvedLanguage?.toLowerCase().startsWith("de") ? "de" : "en";
      const created = await createEmployee({
        name,
        role,
        email,
        phone: addForm.phone.trim() || undefined,
        locationId: addForm.locationId.trim() ? addForm.locationId : null,
        tableIds: addForm.tableIds,
        locale: inviteLocale,
      });
      setShowAddModal(false);
      setAddForm({
        name: "",
        role: "Server",
        customRole: "",
        email: "",
        phone: "",
        locationId: "",
        tableIds: [],
      });
      await fetchEmployees();
      toastOk(t("business.staffPage.toastInviteSent", { name: created.name }));
    } catch (err) {
      logClientError("StaffManagementPage", err);
      toastErr(toUserFriendlyMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEdit = (employee: StaffRow) => {
    const resolved = resolveStaffRoleForForm(employee.role);
    setEditForm({
      id: employee.id,
      name: employee.name,
      role: resolved.role,
      customRole: resolved.customRole,
      email: employee.email,
      monthlyGoal:
        employee.monthlyGoal != null ? String(employee.monthlyGoal) : "",
      isActive: employee.isActive,
      locationId: employee.locationId ?? "",
      tableIds: [...employee.assignedTableIds],
    });
    setShowEditModal(true);
  };

  const handleEditSave = async () => {
    if (!editForm.id) return;
    const name = editForm.name.trim();
    const email = editForm.email.trim();
    const role = resolveStaffRoleForSave(editForm.role, editForm.customRole);
    if (!name || !email) {
      toastErr(t("business.staffPage.toastNameEmailRequired"));
      return;
    }
    if (!role) {
      toastErr(t("business.staffPage.toastCustomRoleRequired"));
      return;
    }
    let monthlyGoal: number | null | undefined = undefined;
    if (editForm.monthlyGoal.trim() === "") {
      monthlyGoal = null;
    } else {
      const n = parseFloat(editForm.monthlyGoal);
      if (Number.isNaN(n) || n < 0) {
        toastErr(t("business.staffPage.toastMonthlyGoalInvalid"));
        return;
      }
      monthlyGoal = n;
    }
    setSavingEdit(true);
    try {
      await updateEmployee(editForm.id, {
        name,
        role,
        email,
        monthlyGoal,
        isActive: editForm.isActive,
        locationId: editForm.locationId.trim() ? editForm.locationId : null,
        tableIds: editForm.tableIds,
      });
      setShowEditModal(false);
      invalidateStaffRosterCaches();
      await fetchEmployees({ revalidate: true });
      toastOk(t("business.staffPage.toastStaffUpdated"));
    } catch (err) {
      logClientError("StaffManagementPage", err);
      toastErr(toUserFriendlyMessage(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const openDelete = (employee: StaffRow) => {
    setDeleteTarget(employee);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteEmployee(deleteTarget.id);
      setShowDeleteModal(false);
      setDeleteTarget(null);
      invalidateStaffRosterCaches();
      await fetchEmployees({ revalidate: true });
      toastOk(t("business.staffPage.toastStaffRemoved"));
    } catch (err) {
      logClientError("StaffManagementPage", err);
      toastErr(toUserFriendlyMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const openDeactivateConfirm = (employee: StaffRow) => {
    setDeactivateTarget(employee);
    setDeactivateAcknowledged(false);
    setShowDeactivateModal(true);
  };

  const closeDeactivateConfirm = () => {
    setShowDeactivateModal(false);
    setDeactivateTarget(null);
    setDeactivateAcknowledged(false);
  };

  const applyEmployeeActiveState = async (employee: StaffRow, next: boolean) => {
    if (togglingEmployeeIdsRef.current.has(employee.id)) return;
    togglingEmployeeIdsRef.current.add(employee.id);
    const previousActive = employee.isActive;
    try {
      setEmployees((prev) =>
        prev.map((e) => (e.id === employee.id ? { ...e, isActive: next } : e)),
      );

      const updated = await updateEmployeeStatus(employee.id, next);
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === employee.id
            ? {
                ...e,
                isActive: updated.isActive,
              }
            : e,
        ),
      );
      invalidateStaffRosterCaches();
      await fetchEmployees({ quiet: true, revalidate: true });
      toastOk(next ? t("business.staffPage.toastActiveOn") : t("business.staffPage.toastActiveOff"));
      return true;
    } catch (err) {
      logClientError("StaffManagementPage", err);
      setEmployees((prev) =>
        prev.map((e) => (e.id === employee.id ? { ...e, isActive: previousActive } : e)),
      );
      toastErr(toUserFriendlyMessage(err));
      return false;
    } finally {
      togglingEmployeeIdsRef.current.delete(employee.id);
    }
  };

  const handleActivationToggleRequest = (employee: StaffRow) => {
    if (togglingEmployeeIdsRef.current.has(employee.id)) return;
    if (employee.isActive) {
      openDeactivateConfirm(employee);
      return;
    }
    void applyEmployeeActiveState(employee, true);
  };

  const handleDeactivateConfirm = async () => {
    if (!deactivateTarget || !deactivateAcknowledged) return;
    setDeactivating(true);
    const ok = await applyEmployeeActiveState(deactivateTarget, false);
    setDeactivating(false);
    if (ok) closeDeactivateConfirm();
  };

  const handleQrDownload = async (employee: StaffRow) => {
    if (!employee.isActive) {
      toastErr(t("business.staffPage.toastActivateForQr"));
      return;
    }
    if (!canUseQr) {
      toastErr(t("business.staffPage.toastQrAfterVerification"));
      return;
    }
    try {
      const bs = businessPublicSlug?.trim();
      const es = employee.slug?.trim();
      if (bs && es) await downloadBrandedQR(bs, es, employee.name, qrBranding ?? undefined);
      else await downloadBrandedQRLegacy(employee.id, employee.name, qrBranding ?? undefined);
      toastOk(t("business.staffPage.toastQrDownloaded"));
    } catch (err) {
      logClientError("StaffManagementPage", err);
      toastErr(t("business.staffPage.toastQrDownloadFailed"));
    }
  };

  const formatExpiresAt = (iso: string) => {
    try {
      const d = new Date(iso);
      return format(d, "PPp", { locale: dateLocale });
    } catch (err) {
      logClientError("StaffManagementPage", err);
      return null;
    }
  };

  const isInitialStaffLoad = loading && employees.length === 0;
  const isBackgroundStaffRefresh = loading && employees.length > 0;

  if (!user) {
    return null;
  }

  const activeCount = employees.filter(isFullyOnboardedDashboardStaff).length;
  const tipsMonthTotal = employees.reduce((s, e) => s + (e.tips ?? 0), 0);
  const pendingInviteCount = employees.filter(
    (e) =>
      e.activationStatus === "pending_activation" ||
      e.activationStatus === "pending_verification",
  ).length;

  return (
    <div className="space-y-4 pt-2 sm:space-y-5 sm:pt-4">
      {!canGrowTeam ? (
        <TeamGrowthUpgradeNotice />
      ) : (
      <Card className={cn(businessUi.cardStatic, "w-full")}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("business.staffPage.inviteTeamTitle")}
              </p>
              <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
                {t("business.staffPage.inviteTeamDesc")}
              </p>
              {inviteCode ? (
                <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 px-3 py-3 sm:px-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("business.staffPage.inviteCodeLabel")}
                  </p>
                  <p className="mt-1.5 select-all break-all font-mono text-xl font-bold tracking-[0.2em] text-foreground sm:text-2xl">
                    {inviteCode}
                  </p>
                  {inviteExpiresAt ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t("business.staffPage.inviteExpires", {
                        date: formatExpiresAt(inviteExpiresAt) ?? "",
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end">
              <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:justify-end">
                {inviteCode ? (
                  <>
                    <HeroPanelButton
                      type="button"
                      variant="outline"
                      contentSized
                      className={cn(businessUi.btnSecondary, "sm:w-auto")}
                      onClick={handleCopyCode}
                    >
                      <HeroPanelButtonIcon>
                        <Copy aria-hidden />
                      </HeroPanelButtonIcon>
                      <span className="leading-snug">{t("business.staffPage.copy")}</span>
                    </HeroPanelButton>
                    <HeroPanelButton
                      type="button"
                      variant="outline"
                      contentSized
                      className={cn(businessUi.btnSecondary, "sm:w-auto")}
                      onClick={handleRegenerate}
                      disabled={isGenerating}
                    >
                      <HeroPanelButtonIcon>
                        <RefreshCw className={cn(isGenerating && "animate-spin")} aria-hidden />
                      </HeroPanelButtonIcon>
                      <span className="leading-snug">{t("business.staffPage.regenerate")}</span>
                    </HeroPanelButton>
                  </>
                ) : (
                  <HeroPanelButton
                    type="button"
                    variant="outline"
                    contentSized
                    className={cn(businessUi.btnSecondary, "sm:w-auto")}
                    onClick={handleGenerateInvite}
                    disabled={!isBusiness || isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <HeroPanelButtonIcon>
                          <RefreshCw className="animate-spin" aria-hidden />
                        </HeroPanelButtonIcon>
                        <span className="leading-snug">{t("business.staffPage.generating")}</span>
                      </>
                    ) : (
                      <>
                        <HeroPanelButtonIcon>
                          <KeyRound aria-hidden />
                        </HeroPanelButtonIcon>
                        <span className="leading-snug">{t("business.staffPage.generateInvite")}</span>
                      </>
                    )}
                  </HeroPanelButton>
                )}
                <HeroPanelButton
                  type="button"
                  contentSized
                  className={cn(businessUi.btnPrimary, "sm:w-auto")}
                  onClick={() => isBusiness && setShowAddModal(true)}
                  disabled={!isBusiness}
                >
                  <HeroPanelButtonIcon>
                    <Plus aria-hidden />
                  </HeroPanelButtonIcon>
                  <span className="leading-snug">{t("business.staffPage.addEmployee")}</span>
                </HeroPanelButton>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      <Card className={businessUi.atAGlanceCard}>
          <CardContent className={businessUi.atAGlanceContent}>
            <p className={businessUi.atAGlanceLabel}>{t("business.qrPage.atAGlance")}</p>
            <div className={cn(businessUi.atAGlanceGrid, "sm:grid-cols-2 lg:grid-cols-4")}>
              <div>
                <p className={businessUi.atAGlanceStatLabel}>{t("business.staffPage.glanceTeam")}</p>
                <p className={businessUi.atAGlanceStatValue}>{employees.length}</p>
              </div>
              <div>
                <p className={businessUi.atAGlanceStatLabel}>{t("business.staffPage.glanceActive")}</p>
                <p className={businessUi.atAGlanceStatValue}>{activeCount}</p>
              </div>
              <div>
                <p className={businessUi.atAGlanceStatLabel}>{t("business.staffPage.labelTipsMonth")}</p>
                <p className={businessUi.atAGlanceStatValue}>{formatEur(tipsMonthTotal)}</p>
              </div>
              <div>
                <p className={businessUi.atAGlanceStatLabel}>{t("business.staffPage.glancePending")}</p>
                <p className={businessUi.atAGlanceStatValue}>{pendingInviteCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

      <div className="min-w-0 space-y-6">
          <Card className={cn(businessUi.cardStatic, "w-full")}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("business.staffPage.searchTitle")}</CardTitle>
              <CardDescription className={businessUi.cardDesc}>{t("business.staffPage.filterDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  placeholder={t("business.staffPage.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-black/[0.10] bg-background py-3 pl-10 pr-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </CardContent>
          </Card>

        {error ? (
          <div className={cn(businessUi.cardStatic, "p-4 text-sm text-destructive")}>
            <p className="font-medium">{error}</p>
            <button
              type="button"
              onClick={() => void fetchEmployees()}
              className="mt-2 text-primary hover:underline text-sm font-medium"
            >
              {t("business.staffPage.tryAgain")}
            </button>
          </div>
        ) : null}

        {isBackgroundStaffRefresh ? (
          <div
            className="flex items-center justify-end gap-2 text-xs font-medium text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <InlineSpinner />
            <span>{t("dashboard.refresh.updating")}</span>
          </div>
        ) : null}

        {isInitialStaffLoad ? (
          <StaffRosterTableSkeleton rows={6} />
        ) : isLargeScreen ? (
        <div className={cn(businessUi.tablePanel)}>
          <table className="w-full min-w-[72rem]">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">{t("business.staffPage.thEmployee")}</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">{t("business.staffPage.thRole")}</th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {t("business.staffPage.thQrAssignment")}
                  </span>
                </th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-foreground">{t("business.staffPage.thContact")}</th>
                <th className="text-right px-6 py-4 text-sm font-semibold text-foreground">{t("business.staffPage.thTipsMonth")}</th>
                <th className="text-right px-6 py-4 text-sm font-semibold text-foreground">{t("business.staffPage.thRating")}</th>
                <th className="text-center px-6 py-4 text-sm font-semibold text-foreground">{t("business.staffPage.thActive")}</th>
                <th className="whitespace-nowrap px-6 py-4 text-right text-sm font-semibold text-foreground">
                  {t("business.staffPage.thActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12">
                    <div className={DASH_EMPTY_STATE}>
                      <Users className={DASH_EMPTY_ICON} />
                      <p className="text-sm font-medium">{t("business.staffPage.emptyTitle")}</p>
                      <p className="mt-1 text-sm text-gray-400">{t("business.staffPage.emptySubtitle")}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((employee, index) => {
                  const rosterKey = staffRosterNoteKey(employee);
                  const rosterNote = rosterNoteText(rosterKey, t);
                  return (
                <motion.tr
                  key={employee.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={[
                    "border-t border-border hover:bg-muted/30 transition-colors",
                    !employee.isActive ? "bg-muted/20 opacity-90" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <ProfileAvatar
                        src={employee.avatar}
                        displayName={employee.name}
                        className="h-10 w-10"
                      />
                      <div>
                        <p className="font-semibold text-foreground">{employee.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("business.staffPage.joinedLabel", { date: employee.joinedDate })}
                        </p>
                        {rosterNote ? (
                          <p className={rosterNoteClassName(rosterKey)}>{rosterNote}</p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-foreground">{formatStaffRoleLabel(employee.role, t)}</span>
                  </td>
                  <td className="px-6 py-4 max-w-[200px]">
                    <p className="text-sm text-foreground truncate">
                      {employee.locationId
                        ? venueOptions.find((l) => l.id === employee.locationId)?.name ?? t("business.staffPage.na")
                        : t("business.staffPage.na")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {employee.assignedTableIds.length > 0
                        ? t("business.staffPage.tableCount", { count: employee.assignedTableIds.length })
                        : t("business.staffPage.noTables")}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm space-y-1">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="w-3 h-3" />
                        <span>{employee.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        <span>{employee.phone || t("business.staffPage.noPhone")}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div>
                      <p className="font-bold text-foreground">{formatEur(Number(employee.tips))}</p>
                      <p className="text-xs text-accent">{employee.growth}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {employee.rating != null ? (
                        <>
                          <Star className="w-4 h-4 text-accent fill-accent" />
                          <span className="font-semibold text-foreground">{employee.rating}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-sm">{t("business.staffPage.newMember")}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={employee.isActive}
                      onClick={() => handleActivationToggleRequest(employee)}
                      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all hover:opacity-90 active:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        employee.isActive ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className="pointer-events-none inline-block h-6 w-6 translate-x-0.5 rounded-full bg-white shadow transition-transform"
                        style={{
                          transform: employee.isActive ? "translateX(1.25rem)" : "translateX(0.125rem)",
                        }}
                      />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleQrDownload(employee)}
                        disabled={!canUseQr || !employee.isActive}
                        className={[
                          "p-2 rounded-lg border border-transparent transition-all",
                          canUseQr && employee.isActive
                            ? "hover:bg-muted hover:border-border active:opacity-90"
                            : "opacity-45 cursor-not-allowed",
                        ].join(" ")}
                        title={
                          !employee.isActive
                            ? t("business.staffPage.qrTitleInactive")
                            : canUseQr
                              ? t("business.staffPage.qrTitleActive")
                              : t("business.staffPage.qrTitleLocked")
                        }
                      >
                        <QrCode className="w-4 h-4 text-foreground" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(employee);
                        }}
                        className="p-2 rounded-lg border border-transparent hover:bg-muted hover:border-border active:opacity-90 transition-all"
                        title={t("business.staffPage.editTooltip")}
                      >
                        <Edit className="w-4 h-4 text-foreground" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openDelete(employee)}
                        className="p-2 rounded-lg border border-transparent hover:bg-red-500/10 hover:border-red-500/30 active:opacity-90 transition-all"
                        title={t("business.staffPage.removeStaffTitle")}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        ) : (
        <div className="space-y-4">
          {filteredEmployees.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{t("business.staffPage.mobileEmpty")}</div>
          ) : (
            filteredEmployees.map((employee, index) => {
              const rosterKey = staffRosterNoteKey(employee);
              const rosterNote = rosterNoteText(rosterKey, t);
              return (
            <motion.div
              key={employee.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={cn(
                businessUi.listItem,
                "p-4",
                !employee.isActive && "border-dashed bg-muted/25 opacity-95",
              )}
            >
              <div className="flex items-start justify-between mb-4 gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <ProfileAvatar
                    src={employee.avatar}
                    displayName={employee.name}
                    className="h-12 w-12 shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground truncate">{employee.name}</h3>
                    <p className="text-sm text-muted-foreground">{formatStaffRoleLabel(employee.role, t)}</p>
                    {rosterNote ? (
                      <p className={rosterNoteClassName(rosterKey)}>{rosterNote}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {employee.locationId
                        ? venueOptions.find((l) => l.id === employee.locationId)?.name ?? t("business.staffPage.na")
                        : t("business.staffPage.noVenue")}{" "}
                      ·{" "}
                      {employee.assignedTableIds.length > 0
                        ? t("business.staffPage.tableCount", { count: employee.assignedTableIds.length })
                        : t("business.staffPage.mobileNoTablesShort")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-muted-foreground">{t("business.staffPage.thActive")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={employee.isActive}
                    onClick={() => handleActivationToggleRequest(employee)}
                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all hover:opacity-90 active:opacity-90 ${
                      employee.isActive ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className="pointer-events-none inline-block h-6 w-6 translate-x-0.5 rounded-full bg-white shadow transition-transform"
                      style={{
                        transform: employee.isActive ? "translateX(1.25rem)" : "translateX(0.125rem)",
                      }}
                    />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("business.staffPage.labelTipsMonth")}</p>
                  <p className="text-lg font-bold text-foreground">{formatEur(Number(employee.tips))}</p>
                  <p className="text-xs text-accent">{employee.growth}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("business.staffPage.labelRating")}</p>
                  <div className="flex items-center gap-1">
                    {employee.rating != null ? (
                      <>
                        <Star className="w-4 h-4 text-accent fill-accent" />
                        <span className="text-lg font-bold text-foreground">{employee.rating}</span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("business.staffPage.newMember")}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleQrDownload(employee)}
                  disabled={!canUseQr || !employee.isActive}
                  className={[
                    "flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-all",
                    canUseQr && employee.isActive
                      ? "bg-primary/10 text-foreground hover:bg-primary/20 active:opacity-90"
                      : "bg-muted/40 text-muted-foreground cursor-not-allowed opacity-60",
                  ].join(" ")}
                  title={
                    !employee.isActive
                      ? t("business.staffPage.qrTitleInactive")
                      : canUseQr
                        ? t("business.staffPage.qrTitleActive")
                        : t("business.staffPage.qrTitleLocked")
                  }
                >
                  <QrCode className="h-4 w-4" />
                  {t("business.staffPage.qrButton")}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(employee);
                  }}
                  className="px-4 py-2 border border-border rounded-lg hover:bg-muted active:opacity-90 transition-all text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Edit className="w-4 h-4" />
                  {t("business.staffPage.editButton")}
                </button>
                <button
                  type="button"
                  onClick={() => openDelete(employee)}
                  className="col-span-2 flex items-center justify-center gap-2 rounded-lg border border-destructive px-4 py-2 text-sm font-medium text-destructive transition-all hover:bg-destructive/10 active:opacity-90"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("business.staffPage.removeStaffButton")}
                </button>
              </div>
            </motion.div>
              );
            })
          )}
        </div>
        )}
      </div>

      {typeof document !== "undefined"
        ? createPortal(
            <>
      {/* Add Employee Modal — scrollable body, actions pinned to bottom */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex h-[min(90vh,44rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_10px_30px_rgba(0,0,0,0.06)]"
          >
            <div className="shrink-0 border-b border-border px-5 pt-5 pb-3">
              <h2 className="text-xl font-bold text-foreground">{t("business.staffPage.addEmployeeTitle")}</h2>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddEmployeeSubmit();
              }}
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-gutter:stable]">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelFullName")}</label>
                      <input
                        type="text"
                        placeholder={t("business.staffPage.placeholderNameExample")}
                        value={addForm.name}
                        onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelRole")}</label>
                      <select
                        value={addForm.role}
                        onChange={(e) =>
                          setAddForm((f) => ({
                            ...f,
                            role: e.target.value,
                            customRole: e.target.value === STAFF_ROLE_OTHER_VALUE ? f.customRole : "",
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <StaffRoleSelectOptions />
                      </select>
                    </div>
                  </div>
                  {addForm.role === STAFF_ROLE_OTHER_VALUE ? (
                    <StaffCustomRoleField
                      value={addForm.customRole}
                      onChange={(customRole) => setAddForm((f) => ({ ...f, customRole }))}
                    />
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 sm:col-span-1">
                      <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelEmailRequired")}</label>
                      <input
                        type="email"
                        placeholder={t("business.staffPage.phEmailExample")}
                        value={addForm.email}
                        onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="min-w-0 sm:col-span-1">
                      <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelPhoneOptional")}</label>
                      <input
                        type="tel"
                        placeholder={t("business.staffPage.phPhoneExample")}
                        value={addForm.phone}
                        onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("business.staffPage.emailHint")}</p>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelAssignedLocation")}</label>
                    <select
                      value={addForm.locationId}
                      onChange={(e) => {
                        const next = e.target.value;
                        setAddForm((f) => ({
                          ...f,
                          locationId: next,
                          tableIds: f.tableIds.filter((tid) => {
                            const row = safeTableOptions.find((x) => x.id === tid);
                            return !next || (row && row.locationId === next);
                          }),
                        }));
                      }}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">{t("business.staffPage.notSet")}</option>
                      {venueOptions.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">{t("business.staffPage.locationHintVenue")}</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelAssignedTables")}</label>
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-background p-2">
                      {tablesForAddPicker.length === 0 ? (
                        <p className="px-1 py-2 text-xs text-muted-foreground">{t("business.staffPage.noTablesFilter")}</p>
                      ) : (
                        <div className="space-y-1">
                          {tablesForAddPicker.map((tbl) => (
                            <label
                              key={tbl.id}
                              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                            >
                              <input
                                id={`table-checkbox-${tbl.id}`}
                                name={`table-${tbl.id}`}
                                type="checkbox"
                                className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                                checked={addForm.tableIds.includes(tbl.id)}
                                onChange={(e) => {
                                  setAddForm((f) => ({
                                    ...f,
                                    tableIds: e.target.checked
                                      ? [...f.tableIds, tbl.id]
                                      : f.tableIds.filter((id) => id !== tbl.id),
                                  }));
                                }}
                              />
                              <span className="min-w-0 truncate">{tbl.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">({tbl.location.name})</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="shrink-0 border-t border-border bg-card px-5 py-4">
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowAddModal(false)}
                  >
                    {t("business.staffPage.modalCancel")}
                  </Button>
                  <Button type="submit" disabled={isSubmitting} className="flex-1">
                    {isSubmitting ? t("business.staffPage.adding") : t("business.staffPage.addEmployee")}
                  </Button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit employee — scrollable body, actions pinned */}
      {showEditModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex h-[min(90vh,44rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_10px_30px_rgba(0,0,0,0.06)]"
          >
            <div className="shrink-0 border-b border-border px-5 pt-5 pb-3">
              <h2 className="text-xl font-bold text-foreground">{t("business.staffPage.editEmployeeTitle")}</h2>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-gutter:stable]">
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelFullName")}</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelRole")}</label>
                    <select
                      value={editForm.role}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          role: e.target.value,
                          customRole: e.target.value === STAFF_ROLE_OTHER_VALUE ? f.customRole : "",
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <StaffRoleSelectOptions />
                    </select>
                  </div>
                </div>
                {editForm.role === STAFF_ROLE_OTHER_VALUE ? (
                  <StaffCustomRoleField
                    value={editForm.customRole}
                    onChange={(customRole) => setEditForm((f) => ({ ...f, customRole }))}
                  />
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelEmail")}</label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.monthlyGoalUsd")}</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={t("business.staffPage.placeholderNoGoal")}
                      value={editForm.monthlyGoal}
                      onChange={(e) => setEditForm((f) => ({ ...f, monthlyGoal: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelAssignedLocation")}</label>
                  <select
                    value={editForm.locationId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setEditForm((f) => ({
                        ...f,
                        locationId: next,
                        tableIds: f.tableIds.filter((tid) => {
                          const row = safeTableOptions.find((x) => x.id === tid);
                          return !next || (row && row.locationId === next);
                        }),
                      }));
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">{t("business.staffPage.notSet")}</option>
                    {venueOptions.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">{t("business.staffPage.labelAssignedTables")}</label>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-background p-2">
                    {tablesForEditPicker.length === 0 ? (
                      <p className="px-1 py-2 text-xs text-muted-foreground">{t("business.staffPage.noTablesFilter")}</p>
                    ) : (
                      <div className="space-y-1">
                        {tablesForEditPicker.map((tbl) => (
                          <label
                            key={tbl.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                              checked={editForm.tableIds.includes(tbl.id)}
                              onChange={(e) => {
                                setEditForm((f) => ({
                                  ...f,
                                  tableIds: e.target.checked
                                    ? [...f.tableIds, tbl.id]
                                    : f.tableIds.filter((id) => id !== tbl.id),
                                }));
                              }}
                            />
                            <span className="min-w-0 truncate">{tbl.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">({tbl.location.name})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-3 pt-1">
                  <input
                    type="checkbox"
                    checked={editForm.isActive}
                    onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-sm text-foreground">{t("business.staffPage.activeProfileLabel")}</span>
                </label>
              </div>
            </div>
            <div className="shrink-0 border-t border-border bg-card px-5 py-4">
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1"
                >
                  {t("business.staffPage.modalCancel")}
                </Button>
                <Button type="button" disabled={savingEdit} onClick={handleEditSave} className="flex-1">
                  {savingEdit ? t("business.staffPage.saving") : t("business.staffPage.save")}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Deactivate confirmation */}
      {showDeactivateModal && deactivateTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-md rounded-xl border border-border bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-xl font-bold text-foreground">
              {t("business.staffPage.deactivateConfirmTitle")}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t("business.staffPage.deactivateConfirmBody", { name: deactivateTarget.name })}
            </p>
            <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <input
                type="checkbox"
                checked={deactivateAcknowledged}
                onChange={(e) => setDeactivateAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
              />
              <span className="text-sm text-foreground">
                {t("business.staffPage.deactivateConfirmCheckbox")}
              </span>
            </label>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={closeDeactivateConfirm}
                disabled={deactivating}
              >
                {t("business.staffPage.modalCancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                disabled={!deactivateAcknowledged || deactivating}
                onClick={() => void handleDeactivateConfirm()}
              >
                {deactivating
                  ? t("business.staffPage.deactivating")
                  : t("business.staffPage.deactivateConfirmAction")}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteModal && deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card rounded-xl border border-border p-6 max-w-md w-full"
          >
            <h2 className="text-xl font-bold text-foreground mb-2">{t("business.staffPage.deleteConfirmTitle")}</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {t("business.staffPage.deleteConfirmBody", { name: deleteTarget.name })}
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteTarget(null);
                }}
              >
                {t("business.staffPage.modalCancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                disabled={deleting}
                onClick={handleDeleteConfirm}
              >
                {deleting ? t("business.staffPage.removing") : t("business.staffPage.delete")}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
