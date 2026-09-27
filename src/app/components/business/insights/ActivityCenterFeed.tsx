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
import { translateActivitySource } from "../../../lib/activitySourceTranslator";
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
  if (item.type === "qr.scanned") {
    return translateActivitySource(item, t)?.subtitle ?? null;
  }

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
    <div className="business-activity-center-feed space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={filterLabelId} className="sr-only">
          {t("business.activityCenter.filterLabel")}
        </p>
        <div
          className="employee-tip-activity-filters min-w-0 flex-1"
          role="tablist"
          aria-labelledby={filterLabelId}
        >
          {FILTER_CHIPS.map((chip) => {
            const active = filter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                role="tab"
                onClick={() => onFilterChange(chip.id)}
                aria-selected={active}
                aria-pressed={active}
                className="employee-tip-activity-filter"
              >
                {t(chip.labelKey)}
              </button>
            );
          })}
        </div>
        {refreshing ? (
          <span className="business-activity-center-feed__status shrink-0">
            {t("dashboard.refresh.updating")}
          </span>
        ) : (
          <span className="business-activity-live-pill shrink-0">
            <span className="business-activity-live-pill__dot" aria-hidden />
            {t("business.activityCenter.streamLabel")}
          </span>
        )}
      </div>

      {error ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {showSkeleton ? (
        <div className="business-activity-center-skeleton" aria-busy="true" aria-live="polite">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="business-activity-center-skeleton__row" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-left">
          <p className="text-sm font-medium text-foreground">
            {filter === "today"
              ? t("business.activityCenter.emptyToday")
              : t("business.activityCenter.empty")}
          </p>
        </div>
      ) : (
        <>
          <ul className="employee-tip-activity-timeline m-0 list-none p-0" aria-live="polite">
            {items.map((item) => {
              const Icon = iconForType(item.type);
              const isLive = liveIds.has(item.id);
              const amount = amountFromParams(item.type, item.params);
              const href = deepLinkForType(item.type);

              const qrTranslation = item.type === "qr.scanned" ? translateActivitySource(item, t) : null;
              const subtitle = qrTranslation?.subtitle ?? subtitleFromParams(item, t);
              const title =
                qrTranslation?.title ??
                t(item.titleKey, {
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

              const rowClass = cn(
                "business-activity-center-item",
                item.priority === "HIGH" && "business-activity-center-item--high",
                priorityClass(item.priority),
                isLive && "bg-primary/[0.03]",
              );

              const amountLabel = amount != null ? formatEur(amount) : null;

              const body = (
                <>
                  <div className="business-activity-center-item__icon">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="business-activity-center-item__main min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm font-semibold leading-snug text-foreground line-clamp-2">{title}</p>
                      {amountLabel ? (
                        <p className="business-activity-center-item__amount-inline shrink-0 sm:hidden">
                          {amountLabel}
                        </p>
                      ) : null}
                    </div>
                    {subtitle ? (
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground line-clamp-2">{subtitle}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                      <span>
                        <span className="font-medium text-foreground/85">{dayHeading}</span>
                        <span className="mx-1.5 text-muted-foreground/70">·</span>
                        <span>{venueTime.timeText}</span>
                      </span>
                      {filter !== "today" ? (
                        <>
                          <span className="text-muted-foreground/50" aria-hidden>·</span>
                          <span>{formatTimeAgo(item.occurredAt)}</span>
                        </>
                      ) : null}
                      {isLive ? (
                        <span className="font-medium uppercase tracking-wide text-primary">
                          {t("status.live")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {amountLabel ? (
                    <p className="business-activity-center-item__amount business-activity-center-item__amount--desktop">
                      {amountLabel}
                    </p>
                  ) : (
                    <span className="hidden sm:block" aria-hidden />
                  )}
                </>
              );

              return (
                <li key={item.id} className={rowClass}>
                  {href ? (
                    <Link
                      to={href}
                      className="contents rounded-sm outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={onLoadOlder}
                disabled={isLoadingOlder}
                className="min-h-11 w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60 sm:w-auto sm:min-w-[12rem]"
              >
                {isLoadingOlder
                  ? t("business.activityCenter.loadingOlder")
                  : t("business.activityCenter.loadOlder")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
