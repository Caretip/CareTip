import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Building2, ChevronRight, MapPin, Users } from "lucide-react";
import {
  fetchPlatformBusinesses,
  fetchPlatformStats,
  type PlatformBusinessRow,
  type PlatformGlobalStats,
} from "../../../lib/api";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import { PlatformPage, PlatformPageHeader } from "../../../components/platform/PlatformPageChrome";
import {
  ConsoleAvatar,
  ConsoleCallout,
  ConsoleCard,
  ConsoleEmpty,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsoleMeter,
  ConsoleSearch,
  ConsoleSkeletonRows,
  ConsoleTable,
  ConsoleToolbar,
  useRowLink,
} from "../../../components/platform/console/AdminConsole";
import { formatCount } from "../../../components/platform/console/consoleFormat";
import { PLATFORM_BUSINESS_BASE, PLATFORM_USERS_BASE } from "../../../components/platform/platformAdminNav";

export function PlatformStaffAccountsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [stats, setStats] = useState<PlatformGlobalStats | null>(null);
  const [rows, setRows] = useState<PlatformBusinessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const rowLink = useRowLink();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchPlatformStats(), fetchPlatformBusinesses({ workflow: "onboarding", status: "all", take: 100, sort: "newest" })])
      .then(([s, b]) => {
        if (cancelled) return;
        setStats(s);
        setRows(b.businesses ?? []);
      })
      .catch((e) => {
        logClientError("PlatformStaffAccountsPage.load", e);
        if (!cancelled) setError(toUserFriendlyMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(
    () =>
      [...(rows ?? [])]
        .filter((b) => !q.trim() || `${b.name} ${b.ownerEmail}`.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => (b.staffCount ?? 0) - (a.staffCount ?? 0)),
    [q, rows],
  );
  const maxStaff = Math.max(1, ...sorted.map((b) => b.staffCount ?? 0));
  const withStaff = (rows ?? []).filter((b) => (b.staffCount ?? 0) > 0).length;
  const loading = !rows && !error;

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Users}
        title={t("admin.staffAccountsPage.title")}
        subtitle={t("admin.staffAccountsPage.subtitle")}
        actions={
          <Link to={`${PLATFORM_USERS_BASE}/management`} className="ac-btn ac-btn--secondary">
            {t("admin.sidebar.users.management")}
          </Link>
        }
      />

      <ConsoleKpiGrid columns={3} label={t("admin.staffAccountsPage.title")}>
        <ConsoleKpi icon={Users} tone="attention" label={t("admin.overview.kpi.staff")} value={formatCount(stats?.employeesCount, lang)} loading={loading} />
        <ConsoleKpi icon={Building2} label={t("admin.console.staff.kpiBusinessesWithStaff")} value={`${formatCount(withStaff, lang)} / ${formatCount(rows?.length, lang)}`} loading={loading} />
        <ConsoleKpi icon={MapPin} label={t("admin.console.overview.locations")} value={formatCount(stats?.locationsCount, lang)} loading={loading} />
      </ConsoleKpiGrid>

      <ConsoleCard icon={Building2} title={t("admin.console.staff.byBusiness")} description={t("admin.staffAccountsPage.body")} flush>
        <ConsoleToolbar
          end={
            <ConsoleSearch value={q} onChange={setQ} placeholder={t("admin.searchBusinessesPlaceholder")} label={t("admin.searchBusinessesAria")} />
          }
        />
        {loading ? (
          <ConsoleSkeletonRows rows={5} />
        ) : error ? (
          <div className="p-5">
            <ConsoleCallout tone="failure">{error}</ConsoleCallout>
          </div>
        ) : sorted.length === 0 ? (
          <ConsoleEmpty icon={Users} title={t("admin.noBusinesses")} />
        ) : (
          <ConsoleTable label={t("admin.console.staff.byBusiness")}>
            <thead>
              <tr>
                <th>{t("admin.colBusiness")}</th>
                <th>{t("admin.colOwner")}</th>
                <th style={{ width: "32%" }}>{t("admin.overview.kpi.staff")}</th>
                <th className="ac-num">{t("admin.console.overview.locations")}</th>
                <th className="ac-actions">
                  <span className="sr-only">{t("admin.colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => (
                <tr key={b.id} {...rowLink(`${PLATFORM_BUSINESS_BASE}/${b.id}`)}>
                  <td data-primary>
                    <span className="inline-flex items-center gap-3">
                      <ConsoleAvatar name={b.name} />
                      <span className="ac-cell-primary">{b.name}</span>
                    </span>
                  </td>
                  <td data-label={t("admin.colOwner")} className="break-all">
                    {b.ownerEmail}
                  </td>
                  <td data-label={t("admin.overview.kpi.staff")}>
                    <span className="flex items-center gap-3">
                      <span className="w-8 shrink-0 text-right font-bold tabular-nums">{b.staffCount ?? 0}</span>
                      <span className="hidden flex-1 md:block">
                        <ConsoleMeter value={b.staffCount ?? 0} max={maxStaff} brand />
                      </span>
                    </span>
                  </td>
                  <td data-label={t("admin.console.overview.locations")} className="ac-num">
                    {b.locationCount ?? 0}
                  </td>
                  <td className="ac-actions">
                    <Link to={`${PLATFORM_BUSINESS_BASE}/${b.id}`} className="ac-btn ac-btn--ghost ac-btn--sm">
                      {t("admin.view")}
                      <ChevronRight aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </ConsoleTable>
        )}
      </ConsoleCard>
    </PlatformPage>
  );
}
