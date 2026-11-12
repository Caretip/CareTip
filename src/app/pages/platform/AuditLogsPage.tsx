import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Activity, FileText, ShieldAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { fetchPlatformAuditLogs, type PlatformAuditLogRow } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import {
  PlatformPage,
  PlatformPageHeader,
} from "../../components/platform/PlatformPageChrome";
import {
  ConsoleAvatar,
  ConsoleCard,
  ConsoleEmpty,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsolePager,
  ConsoleSearch,
  ConsoleSegments,
  ConsoleSkeletonRows,
  ConsoleStatus,
  ConsoleTable,
  ConsoleToolbar,
} from "../../components/platform/console/AdminConsole";
import { formatCount, formatRelative, humanizeAuditAction } from "../../components/platform/console/consoleFormat";
import { securityCategory } from "../../components/platform/console/useRecentAuditLogs";

type AuditView = "all" | "actions" | "api" | "security";
const AUDIT_PAGE_SIZE = 25;

/** Metadata is a JSON string; surface path + HTTP status as chips, keep the rest as text. */
function parseMeta(raw: string | null): { path?: string; status?: number; rest: string | null } {
  if (!raw) return { rest: null };
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const { path, status, ...rest } = obj;
    const restText = Object.keys(rest).length ? JSON.stringify(rest) : null;
    return {
      path: typeof path === "string" ? path : undefined,
      status: typeof status === "number" ? status : undefined,
      rest: restText,
    };
  } catch {
    return { rest: raw };
  }
}
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
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<AuditView>("all");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<PlatformAuditLogRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const inView = rows.filter((r) =>
      view === "all"
        ? true
        : view === "api"
          ? r.action === "platform.api"
          : view === "security"
            ? securityCategory(r.action) !== null
            : r.action !== "platform.api",
    );
    if (!q) return inView;
    return inView.filter((r) => {
      const meta = (r.metadata ?? "").toLowerCase();
      return (
        r.action.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        meta.includes(q) ||
        r.id.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, view]);

  useEffect(() => setPage(0), [searchQuery, view]);

  const viewCounts = useMemo(
    () => ({
      all: rows.length,
      api: rows.filter((r) => r.action === "platform.api").length,
      security: rows.filter((r) => securityCategory(r.action) !== null).length,
      actions: rows.filter((r) => r.action !== "platform.api").length,
    }),
    [rows],
  );
  const actors = useMemo(() => new Set(rows.map((r) => r.userEmail)).size, [rows]);
  const last24h = useMemo(() => rows.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 86_400_000).length, [rows]);

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
  const lang = i18n.language;
  const pageRows = filteredRows.slice(page * AUDIT_PAGE_SIZE, (page + 1) * AUDIT_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / AUDIT_PAGE_SIZE));

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={FileText}
        title={t("admin.auditLogsPage.title")}
        subtitle={t("admin.auditLogsPage.subtitle", { count: total })}
      />

      <ConsoleKpiGrid columns={4} label={t("admin.auditLogsPage.title")}>
        <ConsoleKpi icon={FileText} label={t("admin.console.audit.kpiTotal")} value={formatCount(total, lang)} loading={isInitialLoad} />
        <ConsoleKpi icon={Activity} tone="info" label={t("admin.console.admins.kpi24h")} value={formatCount(last24h, lang)} hint={t("admin.console.security.sample", { count: rows.length })} loading={isInitialLoad} />
        <ConsoleKpi icon={Users} label={t("admin.console.audit.kpiActors")} value={formatCount(actors, lang)} loading={isInitialLoad} />
        <ConsoleKpi icon={ShieldAlert} tone={viewCounts.security > 0 ? "attention" : undefined} label={t("admin.console.security.kpiEvents")} value={formatCount(viewCounts.security, lang)} loading={isInitialLoad} />
      </ConsoleKpiGrid>

      <ConsoleCard flush>
        <ConsoleToolbar
          start={
            <ConsoleSegments
              label={t("admin.auditLogsPage.filterAria")}
              value={view}
              onChange={setView}
              options={[
                { value: "all" as AuditView, label: t("admin.subscriptions.filters.all"), count: viewCounts.all },
                { value: "actions" as AuditView, label: t("admin.console.audit.viewActions"), count: viewCounts.actions },
                { value: "security" as AuditView, label: t("admin.console.security.kpiEvents"), count: viewCounts.security },
                { value: "api" as AuditView, label: t("admin.console.audit.viewApi"), count: viewCounts.api },
              ]}
            />
          }
          end={
            <ConsoleSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t("admin.auditLogsPage.filterPlaceholder")}
              label={t("admin.auditLogsPage.filterAria")}
              wide
            />
          }
        />
        {isInitialLoad ? (
          <ConsoleSkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <ConsoleEmpty icon={FileText} title={emptyMessage} />
        ) : filteredRows.length === 0 ? (
          <ConsoleEmpty icon={FileText} title={noMatchMessage} />
        ) : (
          <ConsoleTable label={t("admin.auditLogsPage.title")} className="platform-admin-audit-table">
            <thead>
              <tr>
                <th>{t("admin.auditLogsPage.colTime")}</th>
                <th>{t("admin.auditLogsPage.colAction")}</th>
                <th>{t("admin.auditLogsPage.colUser")}</th>
                <th>{t("admin.auditLogsPage.colDetails")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const meta = parseMeta(r.metadata);
                return (
                  <tr key={r.id}>
                    <td data-label={t("admin.auditLogsPage.colTime")} className="ac-nowrap">
                      <span title={formatTime(r.createdAt)}>{formatRelative(r.createdAt, lang)}</span>
                      <span className="ac-cell-secondary">{formatTime(r.createdAt)}</span>
                    </td>
                    <td data-primary>
                      <span className="ac-cell-primary">{humanizeAuditAction(r.action)}</span>
                      <span className="ac-cell-secondary ac-mono" title={r.action}>
                        {r.action}
                      </span>
                    </td>
                    <td data-label={t("admin.auditLogsPage.colUser")}>
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <ConsoleAvatar name={r.userEmail} size="sm" />
                        <span className="truncate" title={r.userEmail} style={{ maxWidth: "14rem" }}>
                          {r.userEmail}
                        </span>
                      </span>
                    </td>
                    <td data-label={t("admin.auditLogsPage.colDetails")}>
                      <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 md:justify-start">
                        {meta.status != null ? (
                          <ConsoleStatus tone={meta.status >= 500 ? "failure" : meta.status >= 400 ? "attention" : "success"}>
                            {meta.status}
                          </ConsoleStatus>
                        ) : null}
                        {meta.path ? <span className="ac-mono break-all">{meta.path}</span> : null}
                        {meta.rest ? (
                          <span className="ac-muted block max-w-[22rem] truncate text-xs" title={meta.rest}>
                            {meta.rest}
                          </span>
                        ) : null}
                        {!meta.path && !meta.rest && meta.status == null ? <span className="ac-muted">{t("format.notAvailable")}</span> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </ConsoleTable>
        )}
        {filteredRows.length > AUDIT_PAGE_SIZE ? (
          <ConsolePager
            summary={t("admin.subscriptions.pagination", {
              from: page * AUDIT_PAGE_SIZE + 1,
              to: Math.min((page + 1) * AUDIT_PAGE_SIZE, filteredRows.length),
              total: filteredRows.length,
            })}
            prevLabel={t("admin.subscriptions.prevPage")}
            nextLabel={t("admin.subscriptions.nextPage")}
            prevDisabled={page === 0}
            nextDisabled={page + 1 >= pageCount}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        ) : null}
      </ConsoleCard>
    </PlatformPage>
  );
}
