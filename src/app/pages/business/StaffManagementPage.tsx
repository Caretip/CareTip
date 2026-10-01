import { motion } from "motion/react";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatVenueDateTime, resolveBusinessTimezone } from "../../lib/businessVenueTime";
import {
  Search,
  Star,
  Edit,
  QrCode,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Users,
  MapPin,
  Plus,
  MoreHorizontal,
} from "lucide-react";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useCopyFeedback } from "../../hooks/useCopyFeedback";
import { useMinWidthMedia } from "@/lib/motionPerf";
import { useSocket } from "../../hooks/useSocket";
import { REALTIME_EVENTS } from "../../lib/realtime/realtimeContracts";
import { useRealtimeFallback } from "../../hooks/useRealtimeFallback";
import { fetchVenueCatalog } from "../../lib/businessVenueCatalog";
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
  type EmployeePayoutConnectionState,
} from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { downloadPlainEmployeeQr, downloadPlainEmployeeQrLegacy } from "../../lib/plainQr";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { TeamGrowthUpgradeNotice } from "../../components/subscription/TeamGrowthUpgradeNotice";
import { isApiSubscriptionRequiredError } from "../../lib/apiError";
import { StaffRosterTableSkeleton, InlineSpinner } from "../../components/dashboard/DashboardSectionLoading";
import { useBusinessPageBoot } from "../../lib/useBusinessPageBoot";
import { EmployeeProfilePhoto } from "../../components/ui/profile-avatar";
import { StaffPayoutConnectBadge } from "../../components/business/staff/StaffPayoutConnectBadge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBusinessTeamHeaderActions } from "../../components/business/BusinessTeamHeaderActions";
import { cn } from "@/lib/utils";
import {
  DASH_EMPTY_ICON,
  DASH_EMPTY_STATE,
} from "@/components/ui/dashboard-styles";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import {
  STAFF_ROLE_OTHER_VALUE,
  STANDARD_STAFF_ROLE_OPTIONS,
  collectCustomStaffRoles,
  formatStaffRoleLabel,
  isPresetStaffRole,
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

function StaffRoleSelectOptions({
  canCreateCustom,
  customRoles,
  lockedCustomRole,
}: {
  canCreateCustom: boolean;
  customRoles: readonly string[];
  /** Basic: keep showing an employee’s existing custom title without offering create. */
  lockedCustomRole?: string;
}) {
  const { t } = useTranslation();
  const locked = lockedCustomRole?.trim() ?? "";
  const showLocked =
    Boolean(locked) &&
    !canCreateCustom &&
    !customRoles.some((r) => r.toLowerCase() === locked.toLowerCase());

  return (
    <>
      <optgroup label={t("business.staffPage.roleStandardGroup")}>
        {STANDARD_STAFF_ROLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </option>
        ))}
      </optgroup>
      {canCreateCustom && customRoles.length > 0 ? (
        <optgroup label={t("business.staffPage.roleCustomGroup")}>
          {customRoles.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </optgroup>
      ) : null}
      {showLocked ? <option value={locked}>{locked}</option> : null}
      {canCreateCustom ? (
        <option value={STAFF_ROLE_OTHER_VALUE}>{t("business.staffPage.roleOther")}</option>
      ) : null}
    </>
  );
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
  payoutConnectState?: EmployeePayoutConnectionState;
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

function staffQrAssignmentLabels(
  employee: StaffRow,
  venueOptions: LocationDTO[],
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  if (!employee.locationId) {
    return { primary: t("business.staffPage.noQrAssignment"), secondary: null as string | null };
  }
  const primary =
    venueOptions.find((l) => l.id === employee.locationId)?.name ?? t("business.staffPage.na");
  const secondary =
    employee.assignedTableIds.length > 0
      ? t("business.staffPage.tableCount", { count: employee.assignedTableIds.length })
      : t("business.staffPage.noTables");
  return { primary, secondary };
}

function StaffEmployeeActionsMenu({
  employee,
  canUseQr,
  onQr,
  onEdit,
  onDelete,
  t,
}: {
  employee: StaffRow;
  canUseQr: boolean;
  onQr: () => void;
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string) => string;
}) {
  const qrDisabled = !canUseQr || !employee.isActive;
  const qrTitle = !employee.isActive
    ? t("business.staffPage.qrTitleInactive")
    : canUseQr
      ? t("business.staffPage.qrTitleActive")
      : t("business.staffPage.qrTitleLocked");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t("business.staffPage.thActions")}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem disabled={qrDisabled} onSelect={onQr} title={qrTitle}>
          <QrCode className="mr-2 h-4 w-4" aria-hidden />
          {t("business.staffPage.qrButton")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <Edit className="mr-2 h-4 w-4" aria-hidden />
          {t("business.staffPage.editButton")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={onDelete}
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden />
          {t("business.staffPage.removeStaffButton")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function sameStringIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function StaffManagementPage() {
  const { t, i18n } = useTranslation();
  const { user, isBusiness, authHydrated, sessionValidated } = useRequireAuth();
  const { copy: copyToClipboard, isCopied } = useCopyFeedback();
  const isLargeScreen = useMinWidthMedia(1024);
  const { hasFeature, advancedAnalyticsEnabled } = useSubscriptionEntitlements({
    enabled: isBusiness,
    role: "business",
  });
  const canGrowTeam = hasFeature("teamManagement");
  const canCreateCustomJobTitles = hasFeature("customJobTitles");
  const canSetEmployeeGoals = hasFeature("employeeGoals");
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
  const teamCustomRoles = useMemo(
    () => collectCustomStaffRoles(employees.map((e) => e.role)),
    [employees],
  );
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
        payoutConnectState: e.payoutConnectState ?? "not_connected",
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
    socket.on(REALTIME_EVENTS.GOAL_UPDATED, sync);
    return () => {
      socket.off("business_data_updated", sync);
      socket.off("verification_updated", sync);
      socket.off(REALTIME_EVENTS.GOAL_UPDATED, sync);
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
    const ok = await copyToClipboard("invite", inviteCode);
    if (!ok) {
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
    if (!isPresetStaffRole(role) && !canCreateCustomJobTitles) {
      toastErr(t("business.staffPage.toastCustomRoleProRequired"));
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
      const row: StaffRow = {
        id: created.id,
        slug: null,
        name: created.name,
        role: created.jobTitle,
        avatar: null,
        tips: 0,
        rating: null,
        email: created.email,
        phone: addForm.phone.trim(),
        joinedDate: "",
        growth: "",
        isActive: false,
        activationStatus: "pending_activation",
        emailVerified: false,
        passwordIsSet: false,
        monthlyGoal: null,
        locationId: created.locationId ?? (addForm.locationId.trim() || null),
        assignedTableIds: created.assignedTableIds ?? addForm.tableIds,
        payoutConnectState: "not_connected",
      };
      setEmployees((prev) => {
        const next = [row, ...prev.filter((e) => e.id !== row.id)];
        if (user.businessId) setPageSessionCache(`business:staff:${user.businessId}`, next);
        return next;
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
      invalidateStaffRosterCaches();
      void fetchEmployees({ quiet: true, revalidate: true });
      toastOk(t("business.staffPage.toastInviteSent", { name: created.name }));
    } catch (err) {
      logClientError("StaffManagementPage", err);
      toastErr(toUserFriendlyMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEdit = (employee: StaffRow) => {
    const resolved = resolveStaffRoleForForm(
      employee.role,
      canCreateCustomJobTitles ? teamCustomRoles : [],
    );
    const roleForSelect =
      !canCreateCustomJobTitles &&
      resolved.role === STAFF_ROLE_OTHER_VALUE &&
      resolved.customRole
        ? resolved.customRole
        : resolved.role;
    setEditForm({
      id: employee.id,
      name: employee.name,
      role: roleForSelect,
      customRole:
        canCreateCustomJobTitles && resolved.role === STAFF_ROLE_OTHER_VALUE
          ? resolved.customRole
          : "",
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
    const previousRole = employees.find((e) => e.id === editForm.id)?.role ?? "";
    const keepingExistingCustom =
      !isPresetStaffRole(role) &&
      previousRole.trim().toLowerCase() === role.toLowerCase();
    if (!isPresetStaffRole(role) && !canCreateCustomJobTitles && !keepingExistingCustom) {
      toastErr(t("business.staffPage.toastCustomRoleProRequired"));
      return;
    }
    const previous = employees.find((e) => e.id === editForm.id);
    const payload: {
      name: string;
      role: string;
      email: string;
      isActive: boolean;
      monthlyGoal?: number | null;
      locationId?: string | null;
      tableIds?: string[];
    } = {
      name,
      role,
      email,
      isActive: editForm.isActive,
    };
    if (canSetEmployeeGoals) {
      const rawGoal = editForm.monthlyGoal.trim();
      let nextGoal: number | null = null;
      if (rawGoal !== "") {
        const n = parseFloat(rawGoal);
        if (Number.isNaN(n) || n < 0) {
          toastErr(t("business.staffPage.toastMonthlyGoalInvalid"));
          return;
        }
        nextGoal = n;
      }
      const prevGoal = previous?.monthlyGoal ?? null;
      if (nextGoal !== prevGoal) {
        payload.monthlyGoal = nextGoal;
      }
    }
    const nextLocationId = editForm.locationId.trim() ? editForm.locationId : null;
    const prevLocationId = previous?.locationId ?? null;
    const assignmentsChanged =
      nextLocationId !== prevLocationId ||
      !sameStringIdSet(editForm.tableIds, previous?.assignedTableIds ?? []);
    if (assignmentsChanged) {
      payload.locationId = nextLocationId;
      payload.tableIds = editForm.tableIds;
    }
    setSavingEdit(true);
    try {
      const updated = await updateEmployee(editForm.id, payload);
      setEmployees((prev) => {
        const next = prev.map((e) =>
          e.id === updated.id
            ? {
                ...e,
                name: updated.name,
                role: updated.jobTitle,
                email: updated.email,
                isActive: updated.isActive,
                monthlyGoal: updated.monthlyGoal,
                slug: updated.slug ?? e.slug,
                avatar: updated.avatar ?? e.avatar,
                locationId:
                  updated.locationId !== undefined ? updated.locationId ?? null : e.locationId,
                assignedTableIds: updated.assignedTableIds ?? e.assignedTableIds,
              }
            : e,
        );
        if (user?.businessId) setPageSessionCache(`business:staff:${user.businessId}`, next);
        return next;
      });
      setShowEditModal(false);
      invalidateStaffRosterCaches();
      void fetchEmployees({ quiet: true, revalidate: true });
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
    const removedId = deleteTarget.id;
    setDeleting(true);
    try {
      await deleteEmployee(removedId);
      setEmployees((prev) => prev.filter((e) => e.id !== removedId));
      setShowDeleteModal(false);
      setDeleteTarget(null);
      invalidateStaffRosterCaches();
      void fetchEmployees({ quiet: true, revalidate: true });
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
      if (bs && es) await downloadPlainEmployeeQr(bs, es, employee.name);
      else await downloadPlainEmployeeQrLegacy(employee.id, employee.name);
      toastOk(t("business.staffPage.toastQrDownloaded"));
    } catch (err) {
      logClientError("StaffManagementPage", err);
      toastErr(t("business.staffPage.toastQrDownloadFailed"));
    }
  };

  const formatExpiresAt = (iso: string) => {
    try {
      return formatVenueDateTime(iso, resolveBusinessTimezone(), i18n.language || "en");
    } catch (err) {
      logClientError("StaffManagementPage", err);
      return null;
    }
  };

  const isInitialStaffLoad = loading && employees.length === 0;
  const isBackgroundStaffRefresh = loading && employees.length > 0;
  const { showInitialSkeleton } = useBusinessPageBoot("staff", isInitialStaffLoad);
  const teamHeaderActions = useBusinessTeamHeaderActions();

  const activeCount = employees.filter(isFullyOnboardedDashboardStaff).length;
  const tipsMonthTotal = employees.reduce((s, e) => s + (e.tips ?? 0), 0);
  const pendingInviteCount = employees.filter(
    (e) =>
      e.activationStatus === "pending_activation" ||
      e.activationStatus === "pending_verification",
  ).length;
  const rosterSearchEmpty =
    employees.length > 0 && filteredEmployees.length === 0 && searchQuery.trim().length > 0;

  const staffPrimaryActions = useMemo(
    () => (
      <div className="team-employees-page-actions">
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
                {isCopied("invite") ? <Check aria-hidden /> : <Copy aria-hidden />}
              </HeroPanelButtonIcon>
              <span className="leading-snug">
                {isCopied("invite") ? t("common.copied") : t("business.staffPage.copy")}
              </span>
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
    ),
    [
      inviteCode,
      isGenerating,
      isBusiness,
      isCopied,
      t,
      handleCopyCode,
      handleRegenerate,
      handleGenerateInvite,
    ],
  );

  useLayoutEffect(() => {
    if (!teamHeaderActions) return;
    if (!canGrowTeam) {
      teamHeaderActions.setActions(null);
      return;
    }
    teamHeaderActions.setActions(staffPrimaryActions);
    return () => teamHeaderActions.setActions(null);
  }, [teamHeaderActions, canGrowTeam, staffPrimaryActions]);

  if (!user) {
    return null;
  }

  return (
    <div className="team-employees-workspace pt-2 sm:pt-4">
      {!canGrowTeam ? (
        <TeamGrowthUpgradeNotice />
      ) : (
        <div className="team-employees-invite">
          <p className="team-employees-invite__title">{t("business.staffPage.inviteTeamTitle")}</p>
          <p className="team-employees-invite__desc">{t("business.staffPage.inviteTeamDesc")}</p>
          {pendingInviteCount > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("business.staffPage.glancePending")}:{" "}
              <span className="font-semibold tabular-nums text-foreground">{pendingInviteCount}</span>
            </p>
          ) : null}
          {inviteCode ? (
            <div className="mt-3 rounded-md border border-border/70 bg-background/80 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("business.staffPage.inviteCodeLabel")}
              </p>
              <p className="mt-1.5 select-all break-all font-mono text-lg font-bold tracking-[0.12em] text-foreground sm:text-xl">
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
      )}

      <div
        className="team-employees-kpi-strip"
        role="group"
        aria-label={t("business.qrPage.atAGlance")}
      >
        <div>
          <p className="team-employees-kpi__label">{t("business.staffPage.glanceTeam")}</p>
          <p className="team-employees-kpi__value">{employees.length}</p>
        </div>
        <div>
          <p className="team-employees-kpi__label">{t("business.staffPage.glanceActive")}</p>
          <p className="team-employees-kpi__value">{activeCount}</p>
        </div>
        <div>
          <p className="team-employees-kpi__label">{t("business.staffPage.labelTipsMonth")}</p>
          <p className="team-employees-kpi__value">{formatEur(tipsMonthTotal)}</p>
        </div>
        <div>
          <p className="team-employees-kpi__label">{t("business.staffPage.glancePending")}</p>
          <p className="team-employees-kpi__value">{pendingInviteCount}</p>
        </div>
      </div>

      <section className="team-employees-roster" aria-labelledby="team-employees-roster-title">
        <div className="team-employees-roster__header">
          <div className="min-w-0">
            <h2 id="team-employees-roster-title" className="team-employees-roster__title">
              {t("business.staffPage.rosterSectionTitle")}
            </h2>
            <p className="team-employees-roster__meta">
              {t("business.staffPage.rosterSectionMeta", { count: employees.length })}
            </p>
          </div>
          <div className="team-employees-search">
            <Search className="team-employees-search__icon" aria-hidden />
            <input
              type="search"
              className="team-employees-search__input"
              placeholder={t("business.staffPage.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t("business.staffPage.searchPlaceholder")}
            />
          </div>
        </div>

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

        {showInitialSkeleton ? (
          <StaffRosterTableSkeleton rows={6} />
        ) : isLargeScreen ? (
        <div className="team-employees-table-panel">
          <table className="team-employees-table">
            <thead>
              <tr>
                <th scope="col">{t("business.staffPage.thEmployee")}</th>
                <th scope="col">{t("business.staffPage.thRole")}</th>
                <th scope="col">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    {t("business.staffPage.thQrAssignment")}
                  </span>
                </th>
                <th scope="col">{t("business.staffPage.thContact")}</th>
                <th scope="col" className="team-employees-table__num">
                  {t("business.staffPage.thTipsMonth")}
                </th>
                <th scope="col" className="team-employees-table__num">
                  {t("business.staffPage.thRating")}
                </th>
                <th scope="col" className="team-employees-table__center">
                  {t("business.staffPage.thActive")}
                </th>
                <th scope="col" className="team-employees-table__num">
                  <span className="sr-only">{t("business.staffPage.thActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12">
                    <div className={DASH_EMPTY_STATE}>
                      <Users className={DASH_EMPTY_ICON} />
                      <p className="text-sm font-medium">
                        {rosterSearchEmpty
                          ? t("business.staffPage.searchEmpty")
                          : t("business.staffPage.emptyTitle")}
                      </p>
                      {!rosterSearchEmpty && t("business.staffPage.emptySubtitle").trim() ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t("business.staffPage.emptySubtitle")}
                        </p>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((employee) => {
                  const rosterKey = staffRosterNoteKey(employee);
                  const rosterNote = rosterNoteText(rosterKey, t);
                  const qrLabels = staffQrAssignmentLabels(employee, venueOptions, t);
                  return (
                <tr
                  key={employee.id}
                  className={cn(!employee.isActive && "team-employees-table__row--inactive")}
                >
                  <td>
                    <div className="flex items-start gap-3 min-w-0">
                      <EmployeeProfilePhoto
                        src={employee.avatar}
                        displayName={employee.name}
                        className="h-10 w-10 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="team-employees-table__name">{employee.name}</p>
                        <p className="team-employees-table__sub">
                          {t("business.staffPage.joinedLabel", { date: employee.joinedDate })}
                        </p>
                        {rosterNote ? (
                          <p className={rosterNoteClassName(rosterKey)}>{rosterNote}</p>
                        ) : null}
                        <div className="mt-1">
                          <StaffPayoutConnectBadge state={employee.payoutConnectState} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="text-sm text-foreground">
                      {formatStaffRoleLabel(employee.role, t)}
                    </span>
                  </td>
                  <td className="max-w-[12rem]">
                    <p className="team-employees-qr-primary">{qrLabels.primary}</p>
                    {qrLabels.secondary ? (
                      <p className="team-employees-qr-secondary">{qrLabels.secondary}</p>
                    ) : null}
                  </td>
                  <td>
                    <div className="team-employees-contact">
                      <span className="team-employees-contact__line">{employee.email}</span>
                      <span className="team-employees-contact__line">
                        {employee.phone || t("business.staffPage.noPhone")}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="team-employees-tips">
                      <p>{formatEur(Number(employee.tips))}</p>
                      {employee.growth ? (
                        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{employee.growth}</p>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="team-employees-rating">
                      {employee.rating != null ? (
                        <>
                          <Star className="h-3.5 w-3.5 text-accent fill-accent" aria-hidden />
                          <span>{employee.rating}</span>
                        </>
                      ) : (
                        <span className="text-sm font-normal text-muted-foreground">
                          {t("business.staffPage.newMember")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-center">
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
                  <td className="text-right">
                    <StaffEmployeeActionsMenu
                      employee={employee}
                      canUseQr={canUseQr}
                      onQr={() => void handleQrDownload(employee)}
                      onEdit={() => openEdit(employee)}
                      onDelete={() => openDelete(employee)}
                      t={t}
                    />
                  </td>
                </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        ) : (
        <div className="space-y-3">
          {filteredEmployees.length === 0 ? (
            <div className={cn(DASH_EMPTY_STATE, "py-12")}>
              <Users className={DASH_EMPTY_ICON} />
              <p className="text-sm font-medium text-foreground">
                {rosterSearchEmpty
                  ? t("business.staffPage.searchEmpty")
                  : t("business.staffPage.mobileEmpty")}
              </p>
            </div>
          ) : (
            filteredEmployees.map((employee) => {
              const rosterKey = staffRosterNoteKey(employee);
              const rosterNote = rosterNoteText(rosterKey, t);
              const qrLabels = staffQrAssignmentLabels(employee, venueOptions, t);
              return (
            <article
              key={employee.id}
              className={cn(
                "team-employees-mobile-card",
                !employee.isActive && "team-employees-mobile-card--inactive",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <EmployeeProfilePhoto
                    src={employee.avatar}
                    displayName={employee.name}
                    className="h-11 w-11 shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 className="team-employees-table__name truncate">{employee.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {formatStaffRoleLabel(employee.role, t)}
                    </p>
                    {rosterNote ? (
                      <p className={rosterNoteClassName(rosterKey)}>{rosterNote}</p>
                    ) : null}
                    <div className="mt-1">
                      <StaffPayoutConnectBadge state={employee.payoutConnectState} />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StaffEmployeeActionsMenu
                    employee={employee}
                    canUseQr={canUseQr}
                    onQr={() => void handleQrDownload(employee)}
                    onEdit={() => openEdit(employee)}
                    onDelete={() => openDelete(employee)}
                    t={t}
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("business.staffPage.thQrAssignment")}
                  </p>
                  <p className="team-employees-qr-primary mt-0.5">{qrLabels.primary}</p>
                  {qrLabels.secondary ? (
                    <p className="team-employees-qr-secondary">{qrLabels.secondary}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("business.staffPage.thActive")}
                  </p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={employee.isActive}
                    onClick={() => handleActivationToggleRequest(employee)}
                    className={cn(
                      "relative mt-1 inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      employee.isActive ? "bg-primary" : "bg-muted",
                    )}
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

              <div className="mt-3 flex items-end justify-between gap-3 border-t border-border/60 pt-3">
                <div>
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("business.staffPage.labelTipsMonth")}
                  </p>
                  <p className="team-employees-tips mt-0.5 text-left">{formatEur(Number(employee.tips))}</p>
                </div>
                <div className="team-employees-rating">
                  {employee.rating != null ? (
                    <>
                      <Star className="h-3.5 w-3.5 text-accent fill-accent" aria-hidden />
                      <span>{employee.rating}</span>
                    </>
                  ) : (
                    <span className="text-sm font-normal text-muted-foreground">
                      {t("business.staffPage.newMember")}
                    </span>
                  )}
                </div>
              </div>

              <div className="team-employees-mobile-card__contact">
                <span>{employee.email}</span>
                <span className="mt-0.5 block">{employee.phone || t("business.staffPage.noPhone")}</span>
              </div>
            </article>
              );
            })
          )}
        </div>
        )}
      </section>

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
                        <StaffRoleSelectOptions
                          canCreateCustom={canCreateCustomJobTitles}
                          customRoles={teamCustomRoles}
                        />
                      </select>
                    </div>
                  </div>
                  {canCreateCustomJobTitles && addForm.role === STAFF_ROLE_OTHER_VALUE ? (
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
                      <StaffRoleSelectOptions
                        canCreateCustom={canCreateCustomJobTitles}
                        customRoles={teamCustomRoles}
                        lockedCustomRole={
                          !canCreateCustomJobTitles && !isPresetStaffRole(editForm.role)
                            ? editForm.role
                            : undefined
                        }
                      />
                    </select>
                  </div>
                </div>
                {canCreateCustomJobTitles && editForm.role === STAFF_ROLE_OTHER_VALUE ? (
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
                  {canSetEmployeeGoals ? (
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
                  ) : null}
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
