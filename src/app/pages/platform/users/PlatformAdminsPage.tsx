import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, Shield, UserCog, Users } from "lucide-react";
import { PlatformPage, PlatformPageHeader } from "../../../components/platform/PlatformPageChrome";
import {
  ConsoleAvatar,
  ConsoleCallout,
  ConsoleCard,
  ConsoleEmpty,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsoleSkeletonRows,
  ConsoleTable,
} from "../../../components/platform/console/AdminConsole";
import { formatCount, formatDateTime, formatRelative, humanizeAuditAction } from "../../../components/platform/console/consoleFormat";
import { useRecentAuditLogs } from "../../../components/platform/console/useRecentAuditLogs";
import { PLATFORM_REPORTS_BASE, PLATFORM_USERS_BASE } from "../../../components/platform/platformAdminNav";

type AdminActivity = { email: string; lastAction: string; lastAt: string; count: number };

export function PlatformAdminsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { items, loading, error } = useRecentAuditLogs(200);

  // Audit entries are written by platform admins and admin-scoped API access, newest first.
  const admins = useMemo(() => {
    const byEmail = new Map<string, AdminActivity>();
    for (const row of items) {
      const key = row.userEmail || row.userId;
      const cur = byEmail.get(key);
      if (cur) cur.count += 1;
      else byEmail.set(key, { email: key, lastAction: row.action, lastAt: row.createdAt, count: 1 });
    }
    return [...byEmail.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [items]);

  const last24h = useMemo(() => {
    const since = Date.now() - 86_400_000;
    return new Set(items.filter((r) => new Date(r.createdAt).getTime() >= since).map((r) => r.userEmail)).size;
  }, [items]);

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Shield}
        title={t("admin.platformAdminsPage.title")}
        subtitle={t("admin.platformAdminsPage.subtitle")}
        actions={
          <Link to={`${PLATFORM_USERS_BASE}/management`} className="ac-btn ac-btn--secondary">
            {t("admin.sidebar.users.management")}
          </Link>
        }
      />

      <ConsoleCallout tone="info" icon={UserCog}>
        {t("admin.platformAdminsPage.body")}
      </ConsoleCallout>

      <ConsoleKpiGrid columns={3} label={t("admin.platformAdminsPage.title")}>
        <ConsoleKpi icon={Users} label={t("admin.console.admins.kpiActive")} value={formatCount(admins.length, lang)} hint={t("admin.console.security.sample", { count: items.length })} loading={loading} />
        <ConsoleKpi icon={Activity} tone="info" label={t("admin.console.admins.kpi24h")} value={formatCount(last24h, lang)} loading={loading} />
        <ConsoleKpi icon={Shield} label={t("admin.console.admins.kpiActions")} value={formatCount(items.length, lang)} loading={loading} href={`${PLATFORM_REPORTS_BASE}/audit-logs`} cta={t("admin.auditLogsPage.title")} />
      </ConsoleKpiGrid>

      <ConsoleCard icon={Activity} title={t("admin.console.admins.activityTitle")} description={t("admin.console.security.sample", { count: items.length })} flush>
        {loading ? (
          <ConsoleSkeletonRows rows={4} />
        ) : error ? (
          <div className="p-5">
            <ConsoleCallout tone="failure">{error}</ConsoleCallout>
          </div>
        ) : admins.length === 0 ? (
          <ConsoleEmpty icon={Users} title={t("admin.auditLogsPage.empty")} />
        ) : (
          <ConsoleTable label={t("admin.console.admins.activityTitle")}>
            <thead>
              <tr>
                <th>{t("admin.console.admins.colAdmin")}</th>
                <th>{t("admin.console.admins.colLastAction")}</th>
                <th>{t("admin.console.admins.colLastSeen")}</th>
                <th className="ac-num">{t("admin.console.admins.colCount")}</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.email}>
                  <td data-primary>
                    <span className="inline-flex items-center gap-3">
                      <ConsoleAvatar name={a.email} />
                      <span className="ac-cell-primary break-all">{a.email}</span>
                    </span>
                  </td>
                  <td data-label={t("admin.console.admins.colLastAction")}>
                    {humanizeAuditAction(a.lastAction)}
                    <span className="ac-cell-secondary ac-mono">{a.lastAction}</span>
                  </td>
                  <td data-label={t("admin.console.admins.colLastSeen")} className="ac-nowrap">
                    {formatRelative(a.lastAt, lang)}
                    <span className="ac-cell-secondary">{formatDateTime(a.lastAt, lang)}</span>
                  </td>
                  <td data-label={t("admin.console.admins.colCount")} className="ac-num font-semibold">
                    {formatCount(a.count, lang)}
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
