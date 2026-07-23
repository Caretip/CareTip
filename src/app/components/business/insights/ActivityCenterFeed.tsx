/**
 * ARCHITECTURE INVARIANT — Activity Center UI
 * -------------------------------------------
 * This feed must render BusinessActivityEvent rows only (via useActivityCenterFeed props).
 * It must NEVER import or depend on:
 *   - useBusinessTipsModuleData / listBusinessTips / tip ledger DTOs
 *   - useBusinessAnalytics / analytics aggregates
 *   - subscribeTipReceived / tip.received / tip_received sockets
 *   - useLiveActivityStream
 *   - Transactions or Analytics fetch paths
 *
 * Allowed data path: parent hook → GET /api/business/activity + activity.created.
 * Venue calendar labels use businessVenueTime (presentation only).
 * See docs/ARCHITECTURE_ACTIVITY_CENTER.md
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CreditCard,
  Mail,
  QrCode,
  Radio,
  Trophy,
  UserPlus,
} from "lucide-react";
import type { BusinessActivityFeedItem, ActivityEventPriority } from "../../../lib/api";
import type { ActivityCenterFilter } from "../../../lib/activityCenterFilters";
import { formatEur } from "../../../lib/formatEur";
import { formatTimeAgo } from "../../../lib/formatTimeAgo";
import { formatActivityVenueTimeParts } from "../../../lib/businessVenueTime";
import { DashboardWorkspacePanel } from "../../dashboard/DashboardWorkspacePanel";
import { cn } from "@/lib/utils";

const FILTER_CHIPS: { id: ActivityCenterFilter; labelKey: string }[] = [
  { id: "all", labelKey: "business.activityCenter.filter.all" },
  { id: "today", labelKey: "business.activityCenter.filter.today" },
  { id: "TIPS", labelKey: "business.activityCenter.filter.tips" },
  { id: "QR", labelKey: "business.activityCenter.filter.qr" },
  { id: "PAYMENTS", labelKey: "business.activityCenter.filter.payments" },
];

function iconForType(type: string) {
  switch (type) {
    case "tip.received":
      return Radio;
    case "qr.scanned":
      return QrCode;
    case "goal.achieved":
      return Trophy;
    case "payment.failed":
    case "payment.refunded":
      return type === "payment.failed" ? AlertTriangle : CreditCard;
    case "employee.invited":
      return Mail;
    case "employee.joined":
      return UserPlus;
    default:
      return Radio;
  }
}

function deepLinkForType(type: string): string | null {
  switch (type) {
    case "tip.received":
    case "payment.failed":
    case "payment.refunded":
      return "/dashboard/tips/transactions";
    case "qr.scanned":
      return "/dashboard/qr-studio/employees";
    case "goal.achieved":
      return "/dashboard/team/employees";
    case "employee.invited":
    case "employee.joined":
      return "/dashboard/team/employees";
    default:
      return null;
  }
}

function amountFromParams(type: string, params: Record<string, unknown>): number | null {
  if (
    type !== "tip.received" &&
    type !== "payment.failed" &&
    type !== "payment.refunded"
  ) {
    return null;
  }
  const raw = params.amountEur;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  return null;
}

function subtitleFromParams(
  item: BusinessActivityFeedItem,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const p = item.params;
  const parts: string[] = [];
  if (typeof p.employeeName === "string" && p.employeeName.trim()) {
    parts.push(p.employeeName.trim());
  }
  if (typeof p.scanType === "string" && p.scanType.trim()) {
    parts.push(p.scanType.trim());
  }
  if (typeof p.goalName === "string" && p.goalName.trim()) {
    parts.push(p.goalName.trim());
  }
  if (typeof p.channel === "string" && p.channel.trim() && item.type.startsWith("employee.")) {
    parts.push(t(`business.activityCenter.channel.${p.channel}`, { defaultValue: p.channel }));
  }
  if (typeof p.reason === "string" && p.reason.trim() && item.type.startsWith("payment.")) {
    parts.push(t(`business.activityCenter.reason.${p.reason}`, { defaultValue: p.reason }));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function priorityClass(priority: ActivityEventPriority): string {
  if (priority === "HIGH") return "border-l-2 border-l-amber-500/70";
  if (priority === "LOW") return "opacity-90";
  return "";
}

type ActivityCenterFeedProps = {
  items: BusinessActivityFeedItem[];
  liveIds: Set<string>;
  loading: boolean;
  refreshing?: boolean;
  filter: ActivityCenterFilter;
  onFilterChange: (filter: ActivityCenterFilter) => void;
  venueTimezone: string;
  hasMore: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  error?: string | null;
};

export function ActivityCenterFeed({
  items,
  liveIds,
  loading,
  refreshing = false,
  filter,
  onFilterChange,
  venueTimezone,
  hasMore,
  isLoadingOlder,
  onLoadOlder,
  error = null,
}: ActivityCenterFeedProps) {
  const { t, i18n } = useTranslation();
  const showSkeleton = loading && items.length === 0;
  const filterLabelId = "activity-center-filter-label";
  const locale = i18n.language?.startsWith("de") ? "de-DE" : "en-GB";

  return (
    <DashboardWorkspacePanel
      title={t("business.activityCenter.centerTitle")}
      headerExtra={
        refreshing ? (
          <span className="text-xs font-medium text-muted-foreground">{t("dashboard.refresh.updating")}</span>
        ) : (
          t("business.activityCenter.streamLabel")
        )
      }
    >
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {t("business.activityCenter.ssotHelper")}
        </p>
        <p id={filterLabelId} className="sr-only">
          {t("business.activityCenter.filterLabel")}
        </p>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-labelledby={filterLabelId}
        >
          {FILTER_CHIPS.map((chip) => {
            const active = filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onFilterChange(chip.id)}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                {t(chip.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <p className="px-4 py-4 text-center text-sm text-destructive sm:px-5" role="alert">
          {error}
        </p>
      ) : null}

      {showSkeleton ? (
        <div className="divide-y divide-border" aria-busy="true" aria-live="polite">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-4 sm:px-5">
              <div className="h-9 w-9 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-40 rounded bg-muted" />
                <div className="h-2.5 w-28 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground sm:px-5">
          {filter === "today"
            ? t("business.activityCenter.emptyToday")
            : t("business.activityCenter.empty")}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border" aria-live="polite">
            {items.map((item) => {
              const Icon = iconForType(item.type);
              const isLive = liveIds.has(item.id);
              const amount = amountFromParams(item.type, item.params);
              const subtitle = subtitleFromParams(item, t);
              const href = deepLinkForType(item.type);
              const title = t(item.titleKey, {
                ...item.params,
                defaultValue: t(`business.activityCenter.type.${item.type}`, {
                  defaultValue: item.type,
                }),
              });
              const venueTime = formatActivityVenueTimeParts(
                item.occurredAt,
                venueTimezone,
                locale,
              );
              const dayHeading =
                venueTime.dayLabel === "today"
                  ? t("business.activityCenter.time.today")
                  : venueTime.dayLabel === "yesterday"
                    ? t("business.activityCenter.time.yesterday")
                    : (venueTime.dateText ?? "—");

              const body = (
                <>
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground",
                      item.priority === "HIGH" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="truncate font-medium text-foreground">{title}</p>
                      {amount != null ? (
                        <p className="shrink-0 font-semibold tabular-nums text-primary">
                          {formatEur(amount)}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {subtitle ? <p className="truncate">{subtitle}</p> : null}
                      <p className="tabular-nums">
                        <span className="font-medium text-foreground/80">{dayHeading}</span>
                        <span className="mx-1.5 text-muted-foreground/70">·</span>
                        <span>{venueTime.timeText}</span>
                      </p>
                      <p className="mt-0.5">
                        <span>{formatTimeAgo(item.occurredAt)}</span>
                        {isLive ? (
                          <span className="ml-2 font-medium uppercase tracking-wide text-primary">
                            {t("status.live")}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </>
              );

              return (
                <li
                  key={item.id}
                  className={cn(
                    "px-4 py-3.5 sm:px-5",
                    priorityClass(item.priority),
                    isLive && "bg-primary/[0.04]",
                  )}
                >
                  {href ? (
                    <Link
                      to={href}
                      className="flex items-start gap-3 rounded-sm outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="border-t border-border px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={onLoadOlder}
                disabled={isLoadingOlder}
                className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                {isLoadingOlder
                  ? t("business.activityCenter.loadingOlder")
                  : t("business.activityCenter.loadOlder")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </DashboardWorkspacePanel>
  );
}
