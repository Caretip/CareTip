import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { fetchPlatformAuditLogs, type PlatformAuditLogRow } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
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
import { PlatformAuditLogMobileCard } from "../../components/platform/platformAdminMobileCards";
import { platformUi } from "../../components/platform/platformDashboardUi";
import { cn } from "@/lib/utils";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_MEDIUM_MS,
} from "../../lib/pageSessionCache";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
  } catch (err) {
    logClientError("AuditLogsPage.formatTime", err);
    return iso;
  }
}

export function AuditLogsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PlatformAuditLogRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const meta = (r.metadata ?? "").toLowerCase();
      return (
        r.action.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        meta.includes(q) ||
        r.id.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery]);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    const cacheKey = "platform:audit-logs";
    const cached = getPageSessionCache<{ items: PlatformAuditLogRow[]; total: number }>(
      cacheKey,
      PAGE_CACHE_TTL_MEDIUM_MS,
    );
    const useCachedFirst = !quiet && cached !== null;
    if (useCachedFirst) {
      setRows(cached.items);
      setTotal(cached.total);
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
    }
    try {
      const res = await fetchPlatformAuditLogs({ take: 200, skip: 0 });
      setRows(res.items);
      setTotal(res.total);
      setPageSessionCache(cacheKey, { items: res.items, total: res.total });
    } catch (e) {
      logClientError("AuditLogsPage", e);
      if (!useCachedFirst) {
        toast.error(toUserFriendlyMessage(e));
        setRows([]);
        setTotal(0);
      }
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const emptyMessage = t("admin.auditLogsPage.empty");
  const noMatchMessage = t("admin.auditLogsPage.noSearchMatches");
  const isInitialLoad = loading && rows.length === 0;

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={FileText}
        title={t("admin.auditLogsPage.title")}
        subtitle={t("admin.auditLogsPage.subtitle", { count: total })}
      />

      {!loading && rows.length > 0 ? (
        <PlatformSearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t("admin.auditLogsPage.filterPlaceholder")}
          ariaLabel={t("admin.auditLogsPage.filterAria")}
        />
      ) : null}

      <PlatformResponsiveData
        mobile={
          isInitialLoad ? (
            <DashboardListSkeleton rows={6} minHeightClass="min-h-0" />
          ) : rows.length === 0 ? (
            <p className={platformUi.emptyState}>{emptyMessage}</p>
          ) : filteredRows.length === 0 ? (
            <p className={platformUi.emptyState}>{noMatchMessage}</p>
          ) : (
            filteredRows.map((r) => (
              <PlatformAuditLogMobileCard key={r.id} row={r} formatTime={formatTime} />
            ))
          )
        }
        desktop={
          <table className={cn(platformUi.table, "platform-admin-audit-table w-full table-fixed")}>
            <colgroup>
              <col className="w-[11rem]" />
              <col className="w-[28%]" />
              <col className="w-[14rem]" />
              <col />
            </colgroup>
            <thead>
              <tr className={platformUi.tableHeadRow}>
                <th className={platformUi.tableTh}>{t("admin.auditLogsPage.colTime")}</th>
                <th className={platformUi.tableTh}>{t("admin.auditLogsPage.colAction")}</th>
                <th className={platformUi.tableTh}>{t("admin.auditLogsPage.colUser")}</th>
                <th className={platformUi.tableTh}>{t("admin.auditLogsPage.colDetails")}</th>
              </tr>
            </thead>
            <tbody>
              {isInitialLoad ? (
                <PlatformAdminTableSkeleton rows={8} cols={4} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className={platformUi.emptyState}>
                    {emptyMessage}
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className={platformUi.emptyState}>
                    {noMatchMessage}
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.id} className={platformUi.tableRow}>
                    <td className={`${platformUi.tableTd} whitespace-nowrap text-xs text-muted-foreground`}>
                      {formatTime(r.createdAt)}
                    </td>
                    <td className={cn(platformUi.tableTd, "font-mono text-xs")}>
                      <span className="block truncate" title={r.action}>{r.action}</span>
                    </td>
                    <td className={cn(platformUi.tableTd, "text-xs")}>
                      <span
                        className="block max-w-full truncate whitespace-nowrap"
                        title={r.userEmail}
                      >
                        {r.userEmail}
                      </span>
                    </td>
                    <td
                      className={cn(platformUi.tableTd, "truncate text-xs text-muted-foreground")}
                      title={r.metadata ?? ""}
                    >
                      <span className="block truncate">{r.metadata ?? t("format.notAvailable")}</span>
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
