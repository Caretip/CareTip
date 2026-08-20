import { useMemo, useState } from "react";
import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronRight,
  Loader2,
  Search,
  Trash2,
} from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "@/app/components/business/BusinessModuleWorkspaceHeader";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  InlineSpinner,
  NotificationInboxListSkeleton,
} from "@/app/components/dashboard/DashboardSectionLoading";
import { DashboardWorkspaceEmptyState } from "@/app/components/dashboard/DashboardWorkspaceEmptyState";
import { useNotifications, type NotificationListFilters } from "@/app/hooks/useNotifications";
import type { InboxNotification } from "@/app/lib/api";
import {
  filterInboxNotifications,
  getNotificationCategoryStyle,
  groupNotificationsByDate,
  INBOX_FILTER_CHIPS,
  type InboxCategoryFilter,
} from "@/app/lib/notificationInboxUi";
import {
  formatNotificationRelativeTime,
  getNotificationCategory,
  inboxNotificationActionLabel,
  inboxNotificationCategoryLabel,
  inboxNotificationHasOpenAction,
  resolveInboxNotificationDestination,
} from "@/app/lib/notificationNavigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/app/components/ui/sheet";
import {
  SupportStatusBadge,
  isSupportNotificationType,
} from "@/app/components/support/supportTicketUi";
import { cn } from "@/lib/utils";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type { SupportTicketStatus } from "@/app/lib/api";

type NavOpts = { role?: string; isPlatformAdmin?: boolean };

function filterChipLabel(filter: InboxCategoryFilter, t: TFunction): string {
  if (filter === "all") return t("notifications.inbox.filter.all");
  if (filter === "unread") return t("notifications.inbox.filter.unread");
  return t(`notifications.categories.${filter}`);
}

function dateGroupLabel(bucket: string, t: TFunction): string {
  return t(`notifications.inbox.dateGroup.${bucket}`);
}

function NotificationCard({
  notification,
  navOpts,
  onOpenDetail,
  onAction,
  onDelete,
}: {
  notification: InboxNotification;
  navOpts: NavOpts;
  onOpenDetail: () => void;
  onAction: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const category = getNotificationCategory(notification);
  const style = getNotificationCategoryStyle(category);
  const Icon = style.icon;
  const actionLabel = inboxNotificationActionLabel(notification, navOpts, t);
  const hasAction = inboxNotificationHasOpenAction(notification, navOpts);
  const metaStatus = notification.metadata?.status;
  const showTicketBadge = isSupportNotificationType(notification.type);

  return (
    <article
      className={cn(
        "group relative flex gap-3 px-3.5 py-3.5 transition-colors sm:gap-4 sm:px-5 sm:py-4",
        notification.read
          ? "bg-transparent hover:bg-muted/35"
          : "bg-primary/[0.035] hover:bg-primary/[0.055]",
        !notification.read &&
          "before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11",
          style.bgClass,
        )}
      >
        <Icon className={cn("h-5 w-5", style.iconClass)} aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {inboxNotificationCategoryLabel(category, t)}
            </span>
            {showTicketBadge ? (
              <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                Ticket
              </span>
            ) : null}
            {typeof metaStatus === "string" &&
            ["OPEN", "PENDING", "RESOLVED", "CLOSED"].includes(metaStatus) ? (
              <SupportStatusBadge status={metaStatus as SupportTicketStatus} />
            ) : null}
            {!notification.read ? (
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label={t("notifications.inbox.unreadBadge")} />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label={t("notifications.inbox.deleteAria")}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
            <time
              className="text-[11px] font-medium tabular-nums text-muted-foreground"
              dateTime={notification.createdAt}
            >
              {formatNotificationRelativeTime(notification.createdAt, i18n.language, t)}
            </time>
          </div>
        </div>

        <button
          type="button"
          className="mt-1.5 w-full text-left"
          onClick={onOpenDetail}
        >
          <h3
            className={cn(
              "text-sm font-semibold leading-snug sm:text-[0.9375rem]",
              notification.read ? "text-foreground/90" : "text-foreground",
            )}
          >
            {notification.title}
          </h3>
          {notification.message ? (
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {notification.message}
            </p>
          ) : null}
        </button>

        {hasAction && actionLabel ? (
          <Button
            type="button"
            size="sm"
            variant={notification.read ? "outline" : "default"}
            className="mt-3 h-8 gap-1 px-3 text-xs font-semibold"
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
          >
            {actionLabel}
            <ChevronRight className="h-3.5 w-3.5 opacity-80" aria-hidden />
          </Button>
        ) : (
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={onOpenDetail}
          >
            {t("notifications.actions.viewDetails")}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}

function NotificationDetailPanel({
  notification,
  navOpts,
  onAction,
  onDelete,
}: {
  notification: InboxNotification;
  navOpts: NavOpts;
  onAction: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const category = getNotificationCategory(notification);
  const style = getNotificationCategoryStyle(category);
  const Icon = style.icon;
  const actionLabel = inboxNotificationActionLabel(notification, navOpts, t);
  const hasAction = inboxNotificationHasOpenAction(notification, navOpts);

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-border px-5 py-5 sm:px-6">
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", style.bgClass)}>
          <Icon className={cn("h-6 w-6", style.iconClass)} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {inboxNotificationCategoryLabel(category, t)}
          </span>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{notification.title}</h2>
          <time className="mt-1 block text-xs text-muted-foreground" dateTime={notification.createdAt}>
            {formatNotificationRelativeTime(notification.createdAt, i18n.language, t)}
          </time>
        </div>
      </div>
      <div className="max-h-[50dvh] overflow-y-auto px-5 py-5 sm:px-6">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{notification.message}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-4 sm:px-6">
        {hasAction && actionLabel ? (
          <Button type="button" className="flex-1 sm:flex-none" onClick={onAction}>
            {actionLabel}
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className={cn(
            "gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive",
            hasAction && actionLabel ? "sm:ml-auto" : "w-full sm:w-auto",
          )}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {t("notifications.inbox.delete")}
        </Button>
      </div>
    </div>
  );
}

function InboxEmptyState() {
  const { t } = useTranslation();
  const hint = t("notifications.inbox.emptyHint").trim();
  const body = t("notifications.inbox.emptyBodyPremium").trim();
  const description = [body, hint].filter(Boolean).join(" ");
  return (
    <DashboardWorkspaceEmptyState
      icon={<BellRing className="h-5 w-5" aria-hidden />}
      title={t("notifications.inbox.emptyTitle")}
      description={description || undefined}
    />
  );
}

export type NotificationInboxFeedProps = {
  enabled: boolean;
  isPlatformAdmin: boolean;
  navRole?: string;
  listFilters?: NotificationListFilters;
  pageTitle: string;
  pageSubtitle: string;
};

export function NotificationInboxFeed({
  enabled,
  isPlatformAdmin,
  navRole,
  listFilters,
  pageTitle,
  pageSubtitle,
}: NotificationInboxFeedProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const navOpts: NavOpts = { role: navRole, isPlatformAdmin };

  const [categoryFilter, setCategoryFilter] = useState<InboxCategoryFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [detailNotification, setDetailNotification] = useState<InboxNotification | null>(null);

  const mergedFilters = useMemo((): NotificationListFilters | undefined => {
    const base = { ...listFilters };
    if (appliedSearch.trim()) base.q = appliedSearch.trim();
    return Object.keys(base).length ? base : undefined;
  }, [listFilters, appliedSearch]);

  const {
    unreadCount,
    items,
    loading,
    nextCursor,
    loadNotifications,
    markRead,
    markAllRead,
    deleteNotification,
  } = useNotifications({
    enabled,
    loadList: true,
    listFilters: mergedFilters,
  });

  const rawList = items ?? [];
  const filteredList = useMemo(
    () => filterInboxNotifications(rawList, categoryFilter),
    [rawList, categoryFilter],
  );
  const grouped = useMemo(() => groupNotificationsByDate(filteredList), [filteredList]);

  const isInitialLoad = loading && rawList.length === 0;
  const isRefreshing = loading && rawList.length > 0;
  const shownCount = rawList.length;
  const hasMore = Boolean(nextCursor);

  const openAction = (n: InboxNotification) => {
    void markRead(n.id);
    const dest = resolveInboxNotificationDestination(n, navOpts);
    if (dest) navigate(dest);
  };

  const openDetail = (n: InboxNotification) => {
    if (!n.read) void markRead(n.id);
    setDetailNotification(n);
  };

  const handleDelete = (n: InboxNotification) => {
    void deleteNotification(n.id);
    if (detailNotification?.id === n.id) setDetailNotification(null);
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4 pb-8 sm:space-y-5 caretip-mobile-notifications-inbox">
      {/* Header */}
      <BusinessModuleWorkspaceHeader
        personality="notifications"
        badge={t("notifications.inbox.badge")}
        icon={Bell}
        title={pageTitle}
        subtitle={pageSubtitle}
        actions={
          unreadCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full shrink-0 gap-1.5 border-white/25 bg-white/10 text-white hover:bg-white/15 hover:text-white sm:w-auto"
              onClick={() => void markAllRead()}
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              {t("notifications.inbox.markAllRead")}
            </Button>
          ) : undefined
        }
      />
      <p className="text-sm font-medium text-muted-foreground">
        {t("notifications.inbox.statsLine", {
          unread: unreadCount,
          shown: shownCount,
          more: hasMore ? "+" : "",
        })}
      </p>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
        <div className="border-b border-border/70 px-3.5 py-3.5 sm:px-5 sm:py-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedSearch(searchInput);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="h-10 border-border/70 bg-background/70 pl-9"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("notifications.inbox.searchPlaceholder")}
                aria-label={t("notifications.inbox.searchAria")}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" className="h-10 shrink-0 px-4">
              {t("notifications.inbox.search")}
            </Button>
          </form>

          <div className="mt-3 flex gap-2 overflow-x-auto snap-x snap-mandatory scroll-px-1 pb-0.5 [-webkit-overflow-scrolling:touch] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {INBOX_FILTER_CHIPS.map((chip) => {
              const active = categoryFilter === chip;
              const chipUnread = chip === "unread" ? unreadCount : 0;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setCategoryFilter(chip)}
                  className={cn(
                    "inline-flex min-h-[40px] shrink-0 snap-start touch-manipulation items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                      : "border-border/70 bg-background/50 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {filterChipLabel(chip, t)}
                  {chip === "unread" && chipUnread > 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums",
                        active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/15 text-primary",
                      )}
                    >
                      {chipUnread > 99 ? "99+" : chipUnread}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {isRefreshing ? (
          <div
            className="flex items-center justify-center gap-2 border-b border-border/60 bg-muted/25 px-3 py-2 text-xs font-medium text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <InlineSpinner />
            {t("dashboard.refresh.updating")}
          </div>
        ) : null}

        {isInitialLoad ? (
          <NotificationInboxListSkeleton rows={5} className="rounded-none border-0 shadow-none" />
        ) : filteredList.length === 0 ? (
          rawList.length === 0 ? (
            <div className="px-6 py-12">
              <InboxEmptyState />
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <Bell className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" aria-hidden />
              <p className="text-sm font-medium text-foreground">{t("notifications.inbox.filterEmptyTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("notifications.inbox.filterEmptyBody")}</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="mt-2"
                onClick={() => setCategoryFilter("all")}
              >
                {t("notifications.inbox.clearFilters")}
              </Button>
            </div>
          )
        ) : (
          <div>
            {grouped.map(({ bucket, items: bucketItems }, groupIndex) => (
              <section
                key={bucket}
                aria-label={dateGroupLabel(bucket, t)}
                className={cn(groupIndex > 0 && "border-t border-border/60")}
              >
                <h2 className="bg-muted/20 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-5">
                  {dateGroupLabel(bucket, t)}
                </h2>
                <ul className="divide-y divide-border/60">
                  {bucketItems.map((n) => (
                    <li key={n.id}>
                      <NotificationCard
                        notification={n}
                        navOpts={navOpts}
                        onOpenDetail={() => openDetail(n)}
                        onAction={() => openAction(n)}
                        onDelete={() => handleDelete(n)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {nextCursor ? (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            className="min-w-[10rem]"
            onClick={() => void loadNotifications({ append: true, cursor: nextCursor })}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("notifications.inbox.loadMore")}
          </Button>
        </div>
      ) : null}

      <Sheet open={Boolean(detailNotification)} onOpenChange={(open) => !open && setDetailNotification(null)}>
        <SheetContent side="bottom" className="max-h-[88dvh] rounded-t-2xl px-0 pb-8">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("notifications.inbox.detailTitle")}</SheetTitle>
          </SheetHeader>
          {detailNotification ? (
            <NotificationDetailPanel
              notification={detailNotification}
              navOpts={navOpts}
              onAction={() => {
                setDetailNotification(null);
                openAction(detailNotification);
              }}
              onDelete={() => handleDelete(detailNotification)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
