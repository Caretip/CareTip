import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Users, UserCog } from "lucide-react";
import { toast } from "sonner";
import { fetchPlatformBusinesses, impersonateManagerAPI, type PlatformBusinessRow } from "../../lib/api";
import { getMemoryAccessToken, setMemoryAccessToken } from "../../lib/accessTokenStore";
import { saveImpersonationAdminBackup, clearImpersonationAdminBackup } from "../../lib/impersonationSessionBackup";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { useAuth, userFromAuthResponse } from "../../hooks/useAuth";
import { logClientError } from "../../lib/clientLog";
import {
  DashboardListSkeleton,
  PlatformAdminTableSkeleton,
} from "../../components/dashboard/DashboardSectionLoading";
import {
  PlatformPage,
  PlatformPageHeader,
  PlatformResponsiveData,
  PlatformSearchField,
} from "../../components/platform/PlatformPageChrome";
import { PlatformUserMobileCard } from "../../components/platform/platformAdminMobileCards";
import {
  OnboardingVerificationStatusChip,
} from "../../components/verification/VerificationWorkflowStatusChip";
import { platformUi } from "../../components/platform/platformDashboardUi";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_MEDIUM_MS,
} from "../../lib/pageSessionCache";

export function PlatformUserManagementPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PlatformBusinessRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { user, replaceUser } = useAuth();
  const navigate = useNavigate();

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    const cacheKey = "platform:users-businesses";
    const cached = getPageSessionCache<PlatformBusinessRow[]>(cacheKey, PAGE_CACHE_TTL_MEDIUM_MS);
    const useCachedFirst = !quiet && cached !== null;
    if (useCachedFirst) {
      setRows(cached);
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
    }
    try {
      const res = await fetchPlatformBusinesses();
      setRows(res.businesses);
      setPageSessionCache(cacheKey, res.businesses);
    } catch (e) {
      logClientError("PlatformUserManagementPage.load", e);
      if (!useCachedFirst) {
        toast.error(toUserFriendlyMessage(e));
        setRows([]);
      }
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q) ||
        b.ownerEmail.toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  const impersonate = async (b: PlatformBusinessRow) => {
    if (!user || user.role !== "platform_admin") return;
    setBusyId(b.id);
    try {
      const token = getMemoryAccessToken();
      if (token && user) {
        saveImpersonationAdminBackup(token, user);
      }

      const data = await impersonateManagerAPI(b.id);
      setMemoryAccessToken(data.token);
      replaceUser(userFromAuthResponse(data.user));
      toast.message(t("admin.userManagementPage.impersonateToast", { name: b.name }));
      navigate("/dashboard");
    } catch (e) {
      logClientError("PlatformUserManagementPage.impersonate", e);
      clearImpersonationAdminBackup();
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const emptyMessage =
    rows.length === 0
      ? t("admin.userManagementPage.emptyList")
      : t("admin.userManagementPage.noSearchMatches");
  const isInitialLoad = loading && rows.length === 0;

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Users}
        title={t("admin.userManagementPage.title")}
        subtitle={t("admin.userManagementPage.subtitle")}
      />

      <PlatformSearchField
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder={t("admin.userManagementPage.searchPlaceholder")}
        ariaLabel={t("admin.userManagementPage.searchAria")}
      />

      <PlatformResponsiveData
        mobile={
          isInitialLoad ? (
            <DashboardListSkeleton rows={6} minHeightClass="min-h-0" />
          ) : filteredRows.length === 0 ? (
            <p className={platformUi.emptyState}>{emptyMessage}</p>
          ) : (
            filteredRows.map((b) => (
              <PlatformUserMobileCard
                key={b.id}
                business={b}
                busy={busyId !== null}
                onImpersonate={() => void impersonate(b)}
              />
            ))
          )
        }
        desktop={
          <table className={platformUi.table}>
            <thead>
              <tr className={platformUi.tableHeadRow}>
                <th className={platformUi.tableTh}>{t("admin.userManagementPage.colBusiness")}</th>
                <th className={platformUi.tableTh}>{t("admin.userManagementPage.colManagerEmail")}</th>
                <th className={platformUi.tableTh}>{t("admin.userManagementPage.colOnboardingVerification")}</th>
                <th className={`${platformUi.tableTh} text-right`}>{t("admin.userManagementPage.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {isInitialLoad ? (
                <PlatformAdminTableSkeleton rows={8} cols={4} />
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className={platformUi.emptyState}>
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                filteredRows.map((b) => (
                  <tr key={b.id} className={platformUi.tableRow}>
                    <td className={`${platformUi.tableTd} font-medium`}>{b.name}</td>
                    <td className={`${platformUi.tableTd} text-xs text-muted-foreground`}>{b.ownerEmail}</td>
                    <td className={platformUi.tableTd}>
                      <OnboardingVerificationStatusChip status={b.onboardingVerificationStatus} />
                    </td>
                    <td className={`${platformUi.tableTd} text-right`}>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void impersonate(b)}
                        className="platform-admin-row-action inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-50"
                      >
                        <UserCog className="h-3.5 w-3.5" aria-hidden />
                        {busyId === b.id
                          ? t("admin.userManagementPage.opening")
                          : t("admin.userManagementPage.impersonateCta")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        }
      />
    </PlatformPage>
  );
}
