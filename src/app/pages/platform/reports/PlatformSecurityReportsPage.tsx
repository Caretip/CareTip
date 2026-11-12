import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Fingerprint, KeyRound, LifeBuoy, Shield, ShieldCheck, UserCog } from "lucide-react";
import { PlatformPage, PlatformPageHeader } from "../../../components/platform/PlatformPageChrome";
import {
  ConsoleAvatar,
  ConsoleCallout,
  ConsoleCard,
  ConsoleEmpty,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsoleSegments,
  ConsoleSkeletonRows,
  ConsoleStatus,
  ConsoleTable,
  ConsoleToolbar,
  type ConsoleTone,
} from "../../../components/platform/console/AdminConsole";
import { formatCount, formatDateTime, formatRelative, humanizeAuditAction } from "../../../components/platform/console/consoleFormat";
import { securityCategory, useRecentAuditLogs, type SecurityCategory } from "../../../components/platform/console/useRecentAuditLogs";
import { PLATFORM_REPORTS_BASE } from "../../../components/platform/platformAdminNav";

const CATEGORY_TONE: Record<SecurityCategory, ConsoleTone> = {
  auth: "info",
  mfa: "attention",
  impersonation: "dispute",
  recovery: "attention",
  legalHold: "neutral",
  dataAccess: "info",
};

type Filter = "all" | SecurityCategory;

export function PlatformSecurityReportsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { items, loading, error, reload } = useRecentAuditLogs(200);
  const [filter, setFilter] = useState<Filter>("all");

  const events = useMemo(
    () => items.map((row) => ({ row, cat: securityCategory(row.action) })).filter((e): e is { row: typeof e.row; cat: SecurityCategory } => e.cat !== null),
    [items],
  );
  const counts = useMemo(() => {
    const c: Record<SecurityCategory, number> = { auth: 0, mfa: 0, impersonation: 0, recovery: 0, legalHold: 0, dataAccess: 0 };
    for (const e of events) c[e.cat] += 1;
    return c;
  }, [events]);
  const visible = filter === "all" ? events : events.filter((e) => e.cat === filter);
  const cats: SecurityCategory[] = ["auth", "mfa", "impersonation", "recovery", "legalHold", "dataAccess"];

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Shield}
        title={t("admin.securityReportsPage.title")}
        subtitle={t("admin.securityReportsPage.subtitle")}
        actions={
          <Link to={`${PLATFORM_REPORTS_BASE}/audit-logs`} className="ac-btn ac-btn--secondary">
            {t("admin.auditLogsPage.title")}
          </Link>
        }
      />

      <ConsoleKpiGrid columns={4} label={t("admin.securityReportsPage.title")}>
        <ConsoleKpi icon={ShieldCheck} label={t("admin.console.security.kpiEvents")} value={formatCount(events.length, lang)} loading={loading} hint={t("admin.console.security.sample", { count: items.length })} />
        <ConsoleKpi icon={Fingerprint} tone={counts.mfa > 0 ? "attention" : undefined} label={t("admin.console.security.cat.mfa")} value={formatCount(counts.mfa, lang)} loading={loading} />
        <ConsoleKpi icon={UserCog} tone={counts.impersonation > 0 ? "dispute" : undefined} label={t("admin.console.security.cat.impersonation")} value={formatCount(counts.impersonation, lang)} loading={loading} />
        <ConsoleKpi icon={LifeBuoy} label={t("admin.console.security.cat.recovery")} value={formatCount(counts.recovery, lang)} loading={loading} />
      </ConsoleKpiGrid>

      <ConsoleCard
        icon={KeyRound}
        title={t("admin.console.security.eventsTitle")}
        description={t("admin.securityReportsPage.body")}
        flush
      >
        <ConsoleToolbar
          start={
            <ConsoleSegments
              label={t("admin.console.security.eventsTitle")}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all" as Filter, label: t("admin.subscriptions.filters.all"), count: events.length },
                ...cats.map((c) => ({ value: c as Filter, label: t(`admin.console.security.cat.${c}`), count: counts[c] })),
              ]}
            />
          }
        />
        {loading ? (
          <ConsoleSkeletonRows rows={6} />
        ) : error ? (
          <div className="p-5">
            <ConsoleCallout tone="failure" action={<button type="button" className="ac-btn ac-btn--secondary ac-btn--sm" onClick={() => void reload()}>{t("admin.retry")}</button>}>
              {error}
            </ConsoleCallout>
          </div>
        ) : visible.length === 0 ? (
          <ConsoleEmpty icon={ShieldCheck} title={t("admin.console.security.empty")} description={t("admin.console.security.sample", { count: items.length })} />
        ) : (
          <ConsoleTable label={t("admin.console.security.eventsTitle")}>
            <thead>
              <tr>
                <th>{t("admin.auditLogsPage.colAction")}</th>
                <th>{t("admin.console.security.colCategory")}</th>
                <th>{t("admin.auditLogsPage.colUser")}</th>
                <th>{t("admin.auditLogsPage.colTime")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row, cat }) => (
                <tr key={row.id}>
                  <td data-primary>
                    <span className="ac-cell-primary">{humanizeAuditAction(row.action)}</span>
                    <span className="ac-cell-secondary ac-mono">{row.action}</span>
                  </td>
                  <td data-label={t("admin.console.security.colCategory")}>
                    <ConsoleStatus tone={CATEGORY_TONE[cat]}>{t(`admin.console.security.cat.${cat}`)}</ConsoleStatus>
                  </td>
                  <td data-label={t("admin.auditLogsPage.colUser")}>
                    <span className="inline-flex items-center gap-2">
                      <ConsoleAvatar name={row.userEmail} size="sm" />
                      <span className="break-all">{row.userEmail}</span>
                    </span>
                  </td>
                  <td data-label={t("admin.auditLogsPage.colTime")} className="ac-nowrap">
                    {formatRelative(row.createdAt, lang)}
                    <span className="ac-cell-secondary">{formatDateTime(row.createdAt, lang)}</span>
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
